import type { LogEntry, MealType } from './types';

/**
 * Switcher-import parser: turns a CSV exported from another tracker
 * (MyFitnessPal, Lose It!, Cronometer — or anything with recognizable
 * headers) into persistable `LogEntry` rows. Pure and dependency-free
 * (ADR-0003 sibling): header detection, RFC-4180 field splitting, date
 * coercion, and range clamping all live here and nowhere else, so the
 * one interface is the test surface.
 *
 * Column detection is header-name based, not vendor based — each vendor
 * names the same concepts differently ("Calories" / "Energy (kcal)",
 * "Carbohydrates (g)" / "Carbs (g)") and vendors reorder columns between
 * app versions. Matching on names keeps one parser covering all three
 * plus hand-rolled spreadsheets.
 */

export interface ImportParseResult {
  /** Persistable rows, oldest-first. */
  entries: LogEntry[];
  /** Rows skipped (no date, no calories, or out-of-range values). */
  skipped: number;
  /** Local date keys of the earliest/latest imported rows. */
  firstDate: string | null;
  lastDate: string | null;
  totalCalories: number;
}

export type ImportParseError =
  | 'empty-file'
  | 'no-header-match'   // couldn't find date + calories columns
  | 'no-rows';          // header matched but every row was unusable

export type ImportParse =
  | { ok: true; result: ImportParseResult }
  | { ok: false; error: ImportParseError };

// ─── Header detection ─────────────────────────────────────────────
// Lowercased, trimmed header → concept. First match per concept wins.

const DATE_HEADERS = ['date', 'day'];
const CALORIE_HEADERS = ['calories', 'energy (kcal)', 'energy', 'calories (kcal)', 'kcal'];
const PROTEIN_HEADERS = ['protein (g)', 'protein'];
const CARB_HEADERS = ['carbohydrates (g)', 'carbohydrates', 'carbs (g)', 'carbs', 'net carbs (g)'];
const FAT_HEADERS = ['fat (g)', 'fat', 'total fat'];
const LABEL_HEADERS = ['food name', 'name', 'meal', 'food', 'item', 'description', 'note', 'title'];
const TIME_HEADERS = ['time'];
// MFP calls it "Meal", Lose It! "Type", Cronometer "Group". Values map
// to a diary slot only when recognizable; anything else is left unslotted
// (safe even for generic header names like "type").
const MEALTYPE_HEADERS = ['meal', 'meal type', 'type', 'group'];

function findColumn(headers: string[], candidates: string[]): number {
  for (const c of candidates) {
    const i = headers.indexOf(c);
    if (i !== -1) return i;
  }
  return -1;
}

// ─── RFC-4180-ish line splitting ──────────────────────────────────
// Handles quoted fields with embedded commas/quotes/newlines. Returns
// one string[] per record.

function splitRecords(text: string): string[][] {
  const records: string[][] = [];
  let field = '';
  let record: string[] = [];
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else field += ch;
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      record.push(field); field = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      record.push(field); field = '';
      if (record.length > 1 || record[0] !== '') records.push(record);
      record = [];
    } else field += ch;
  }
  record.push(field);
  if (record.length > 1 || record[0] !== '') records.push(record);
  return records;
}

// ─── Field coercion ───────────────────────────────────────────────

/** Strip thousands separators / units MFP sometimes embeds ("1,234"). */
function num(raw: string | undefined): number | null {
  if (raw == null) return null;
  const cleaned = raw.replace(/[",]/g, '').replace(/[^\d.+-]/g, '').trim();
  if (cleaned === '' || cleaned === '-' || cleaned === '--') return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

/** Accepts YYYY-MM-DD (MFP, Cronometer) and M/D/YYYY (Lose It!). */
function parseDate(raw: string | undefined): { y: number; m: number; d: number } | null {
  if (!raw) return null;
  const s = raw.trim().replace(/"/g, '');
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(s);
  if (m) return { y: +m[1], m: +m[2], d: +m[3] };
  m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})/.exec(s);
  if (m) return { y: +m[3], m: +m[1], d: +m[2] };
  return null;
}

/** "08:30" / "8:30 AM" / "14:05" → hour + minute, else null. */
function parseTime(raw: string | undefined): { h: number; min: number } | null {
  if (!raw) return null;
  const m = /^(\d{1,2}):(\d{2})(?:\s*([AaPp])\.?[Mm]?)?/.exec(raw.trim());
  if (!m) return null;
  let h = +m[1];
  const min = +m[2];
  const ap = m[3]?.toLowerCase();
  if (ap === 'p' && h < 12) h += 12;
  if (ap === 'a' && h === 12) h = 0;
  if (h > 23 || min > 59) return null;
  return { h, min };
}

/** "Breakfast" / "Morning Snack" / "Cena" → diary slot, else null. */
function parseMealTypeValue(raw: string | undefined): MealType | null {
  if (!raw) return null;
  const s = raw.trim().toLowerCase();
  if (s.startsWith('breakfast') || s === 'desayuno') return 'breakfast';
  if (s.startsWith('lunch') || s === 'almuerzo') return 'lunch';
  if (s.startsWith('dinner') || s.startsWith('supper') || s === 'cena') return 'dinner';
  if (s.includes('snack') || s === 'merienda') return 'snack';
  return null;
}

const keyOf = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/**
 * Parse a CSV export into LogEntry rows. Rows missing a parsable date or
 * calories are counted in `skipped`, never fatal. Values are clamped to
 * the same ranges firestore.rules enforces (calories 0–19999, macros
 * 0–999) so a bad row can't fail the whole batch write later.
 */
export function parseImportCsv(text: string): ImportParse {
  const records = splitRecords(text ?? '');
  if (records.length === 0) return { ok: false, error: 'empty-file' };

  const headers = records[0].map((h) => h.trim().toLowerCase());
  const dateCol = findColumn(headers, DATE_HEADERS);
  const kcalCol = findColumn(headers, CALORIE_HEADERS);
  if (dateCol === -1 || kcalCol === -1) return { ok: false, error: 'no-header-match' };

  const proteinCol = findColumn(headers, PROTEIN_HEADERS);
  const carbsCol = findColumn(headers, CARB_HEADERS);
  const fatCol = findColumn(headers, FAT_HEADERS);
  const labelCol = findColumn(headers, LABEL_HEADERS);
  const timeCol = findColumn(headers, TIME_HEADERS);
  const mealTypeCol = findColumn(headers, MEALTYPE_HEADERS);

  const entries: LogEntry[] = [];
  let skipped = 0;
  let totalCalories = 0;

  for (const rec of records.slice(1)) {
    const date = parseDate(rec[dateCol]);
    const calories = num(rec[kcalCol]);
    if (!date || calories == null || calories < 0 || calories >= 20000) {
      skipped++;
      continue;
    }
    // Default to local noon (matches the manual backdated-entry rule —
    // noon can't bleed into the previous day under negative UTC offsets);
    // use the export's own time when present.
    const time = parseTime(timeCol !== -1 ? rec[timeCol] : undefined);
    const timestamp = new Date(date.y, date.m - 1, date.d, time?.h ?? 12, time?.min ?? 0, 0);
    if (isNaN(timestamp.getTime())) { skipped++; continue; }

    const entry: LogEntry = { calories: Math.round(calories), timestamp };

    const protein = num(proteinCol !== -1 ? rec[proteinCol] : undefined);
    if (protein != null && protein >= 0 && protein < 1000) entry.protein = Math.round(protein);
    const carbs = num(carbsCol !== -1 ? rec[carbsCol] : undefined);
    if (carbs != null && carbs >= 0 && carbs < 1000) entry.carbs = Math.round(carbs);
    const fat = num(fatCol !== -1 ? rec[fatCol] : undefined);
    if (fat != null && fat >= 0 && fat < 1000) entry.fat = Math.round(fat);

    const mealType = mealTypeCol !== -1 ? parseMealTypeValue(rec[mealTypeCol]) : null;
    if (mealType) entry.mealType = mealType;

    const label = (labelCol !== -1 ? rec[labelCol] : '')?.trim();
    // When the only label source IS the meal column and it mapped to a
    // slot, the label would just repeat the slot name — drop it.
    if (label && !(mealType && labelCol === mealTypeCol)) {
      entry.mealLabel = label.slice(0, 100);
    }

    totalCalories += entry.calories;
    entries.push(entry);
  }

  if (entries.length === 0) return { ok: false, error: 'no-rows' };

  entries.sort((a, b) => a.timestamp!.getTime() - b.timestamp!.getTime());
  return {
    ok: true,
    result: {
      entries,
      skipped,
      firstDate: keyOf(entries[0].timestamp!),
      lastDate: keyOf(entries[entries.length - 1].timestamp!),
      totalCalories,
    },
  };
}
