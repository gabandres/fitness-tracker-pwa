/**
 * Per-day target records — what the calorie and protein targets WERE on each
 * day, and why they moved.
 *
 * ## Why this exists
 *
 * Targets are derived at read time (`targets.ts`). With nothing stored, every
 * screen showed TODAY's target for every past day, and a target that moved on
 * its own moved silently: on 2026-10-08 the owner's protein target read 130 g
 * instead of 135 with nothing on screen saying why. The cause was a 0.2 lb
 * weigh-in crossing a 5 g rounding edge on the live g/kg basis (153.8 → 153.6
 * lb at 1.9 g/kg), which is correct arithmetic and an unacceptable experience.
 *
 * Three rules, owner-set on 2026-10-08:
 *  1. A user-set target is never overwritten by recalculation (`targets.ts`:
 *     `targetMode: 'custom'` + a manual value; the computed number is only a
 *     suggestion).
 *  2. Every AUTOMATIC change is announced: old value, new value, reason.
 *  3. Past days keep the target that was in effect on that day.
 *
 * ## The record
 *
 * `users/{uid}/dailyTargets/{YYYY-MM-DD}`, one per day the app was opened (or
 * a script recorded one). The client writes it from Today; this module is the
 * pure decision: given today's computed targets and the stored records, what
 * to write and whether a notice is owed. Days with no record are UNKNOWN —
 * nothing here ever reconstructs one, and readers fall back to "no record".
 *
 * A change is detected against the day's STARTING point: today's original
 * values when today's record already moved once (kept in `change.from`), else
 * the last stored record — usually yesterday's, possibly weeks old. A record
 * carries the inputs it was computed from (`basis`), so the reason can name
 * what moved even across a gap.
 */
import type { DailyTargets, TargetSource } from './targets';
import { isTimestampLike, toDate } from './firestore-mappers';

export type { TargetSource };

/** The inputs an automatic target was computed from — what a reason names. */
export interface TargetBasis {
  /** The weight the protein g/kg basis read, pounds. */
  weightLb?: number | null;
  proteinPerKg?: number | null;
  paceLbPerWeek?: number | null;
  calorieFloor?: number | null;
}

/** One field's move. */
export interface FieldChange {
  from: number;
  to: number;
  fromSource: TargetSource;
  toSource: TargetSource;
}

export type TargetChangeReason =
  /** The user set their own number. */
  | { kind: 'user-set'; field: 'kcal' | 'protein' }
  /** The user removed their own number; the automatic one took over. */
  | { kind: 'user-cleared'; field: 'kcal' | 'protein' }
  /** Protein on a live g/kg basis followed the newest weigh-in. */
  | { kind: 'weight'; fromLb: number; toLb: number; perKg: number }
  /** The g/kg basis itself changed (Refine targets). */
  | { kind: 'protein-per-kg'; from: number; to: number }
  /** The maintenance estimate moved, and the calorie target with it. */
  | { kind: 'maintenance'; from: number; to: number }
  | { kind: 'pace'; from: number; to: number }
  | { kind: 'calorie-floor'; from: number; to: number }
  /** Moved, and nothing recorded names why (a record with no basis, or a
   *  formula change in an app update). Said plainly rather than guessed. */
  | { kind: 'recalculated'; field: 'kcal' | 'protein' };

export interface TargetChange {
  kcal?: FieldChange;
  protein?: FieldChange;
  reasons: TargetChangeReason[];
}

export interface DailyTargetRecord {
  /** `YYYY-MM-DD`, the user's day (and the document id). */
  date: string;
  kcalTarget: number;
  kcalSource: TargetSource;
  proteinTarget: number;
  proteinSource: TargetSource;
  /** The maintenance estimate (`TdeeResult.trueTdee`) the day was planned on. */
  maintenanceEstimate?: number;
  maintenanceSource?: 'measured' | 'formula' | 'seed';
  /** Composition-adjusted maintenance (ADR-0043), when the client had one. */
  compositionAdjustedMaintenance?: number;
  basis?: TargetBasis;
  /** Present only on a day the target changed. */
  change?: TargetChange;
  /** When the user dismissed the change notice. */
  noticeAckAt?: Date;
  recordedBy: 'app' | 'prompt';
  recordedAt: Date;
  updatedAt: Date;
}

/** What today's targets are, in record form (no bookkeeping fields). */
export type TargetSnapshot = Pick<
  DailyTargetRecord,
  'kcalTarget' | 'kcalSource' | 'proteinTarget' | 'proteinSource'
  | 'maintenanceEstimate' | 'maintenanceSource' | 'compositionAdjustedMaintenance' | 'basis'
>;

/** Today's record values from the target chain and the profile it read. */
export function targetSnapshot(
  t: DailyTargets,
  profile: { targetPaceLbsPerWeek?: number | null; calorieFloor?: number | null; proteinPerKg?: number | null } | null,
  compositionAdjustedMaintenance?: number | null,
): TargetSnapshot {
  const trueTdee = (t.tdee as { trueTdee?: number }).trueTdee;
  return {
    kcalTarget: t.calorieTarget,
    kcalSource: t.calorieSource,
    proteinTarget: t.proteinTarget,
    proteinSource: t.proteinSource,
    ...(trueTdee != null && Number.isFinite(trueTdee) ? { maintenanceEstimate: Math.round(trueTdee) } : {}),
    ...(t.tdee.source ? { maintenanceSource: t.tdee.source } : {}),
    ...(compositionAdjustedMaintenance != null ? { compositionAdjustedMaintenance: Math.round(compositionAdjustedMaintenance) } : {}),
    basis: {
      weightLb: t.proteinBasis?.weightLb ?? t.currentWeight ?? null,
      proteinPerKg: profile?.proteinPerKg ?? null,
      paceLbPerWeek: profile?.targetPaceLbsPerWeek ?? null,
      calorieFloor: profile?.calorieFloor ?? null,
    },
  };
}

function fieldChange(from: { v: number; s: TargetSource }, toV: number, toS: TargetSource): FieldChange | undefined {
  return from.v === toV && from.s === toS ? undefined : { from: from.v, to: toV, fromSource: from.s, toSource: toS };
}

/** Why the fields that moved, moved — from the two snapshots' sources and bases. */
function reasonsFor(
  prev: TargetSnapshot,
  next: TargetSnapshot,
  kcal: FieldChange | undefined,
  protein: FieldChange | undefined,
): TargetChangeReason[] {
  const out: TargetChangeReason[] = [];
  const a = prev.basis ?? {};
  const b = next.basis ?? {};
  if (protein) {
    if (protein.toSource === 'user') out.push({ kind: 'user-set', field: 'protein' });
    else if (protein.fromSource === 'user') out.push({ kind: 'user-cleared', field: 'protein' });
    else if (a.proteinPerKg != null && b.proteinPerKg != null && a.proteinPerKg !== b.proteinPerKg) {
      out.push({ kind: 'protein-per-kg', from: a.proteinPerKg, to: b.proteinPerKg });
    } else if (a.weightLb != null && b.weightLb != null && a.weightLb !== b.weightLb && b.proteinPerKg != null) {
      out.push({ kind: 'weight', fromLb: a.weightLb, toLb: b.weightLb, perKg: b.proteinPerKg });
    } else out.push({ kind: 'recalculated', field: 'protein' });
  }
  if (kcal) {
    if (kcal.toSource === 'user') out.push({ kind: 'user-set', field: 'kcal' });
    else if (kcal.fromSource === 'user') out.push({ kind: 'user-cleared', field: 'kcal' });
    else {
      const before = out.length;
      if (a.calorieFloor != null && b.calorieFloor != null && a.calorieFloor !== b.calorieFloor) {
        out.push({ kind: 'calorie-floor', from: a.calorieFloor, to: b.calorieFloor });
      }
      if (a.paceLbPerWeek != null && b.paceLbPerWeek != null && a.paceLbPerWeek !== b.paceLbPerWeek) {
        out.push({ kind: 'pace', from: a.paceLbPerWeek, to: b.paceLbPerWeek });
      }
      if (prev.maintenanceEstimate != null && next.maintenanceEstimate != null
        && prev.maintenanceEstimate !== next.maintenanceEstimate) {
        out.push({ kind: 'maintenance', from: prev.maintenanceEstimate, to: next.maintenanceEstimate });
      }
      if (out.length === before) out.push({ kind: 'recalculated', field: 'kcal' });
    }
  }
  return out;
}

/** The record to store for today — `null` when today's stored record already
 *  says exactly this. Bookkeeping timestamps and `recordedBy` are the caller's. */
export type PlannedTargetRecord = Omit<DailyTargetRecord, 'recordedAt' | 'updatedAt' | 'recordedBy'>;

/**
 * Decide today's record. Pure.
 *
 * @param today    the user's day key.
 * @param now      today's computed targets.
 * @param records  stored records, any order; only those on or before `today`
 *                 are read, and none is ever modified except today's.
 */
export function planTargetRecord(
  today: string,
  now: TargetSnapshot,
  records: readonly DailyTargetRecord[],
): PlannedTargetRecord | null {
  const past = records.filter((r) => r.date <= today).sort((x, y) => (x.date < y.date ? 1 : -1));
  const existing = past[0]?.date === today ? past[0] : null;
  const previous = existing ? past[1] ?? null : past[0] ?? null;

  if (existing && existing.kcalTarget === now.kcalTarget && existing.kcalSource === now.kcalSource
    && existing.proteinTarget === now.proteinTarget && existing.proteinSource === now.proteinSource) {
    return null;
  }

  // The day's starting point, per field: the original values today's record
  // kept when it moved, else the last stored day, else today's own first
  // record (a day that started with no history).
  const origin = previous ?? existing;
  if (!origin) return { date: today, ...now }; // a first record: nothing to compare

  const kcalFrom = existing?.change?.kcal
    ? { v: existing.change.kcal.from, s: existing.change.kcal.fromSource }
    : { v: origin.kcalTarget, s: origin.kcalSource };
  const proteinFrom = existing?.change?.protein
    ? { v: existing.change.protein.from, s: existing.change.protein.fromSource }
    : { v: origin.proteinTarget, s: origin.proteinSource };

  const kcal = fieldChange(kcalFrom, now.kcalTarget, now.kcalSource);
  const protein = fieldChange(proteinFrom, now.proteinTarget, now.proteinSource);
  if (!kcal && !protein) return { date: today, ...now }; // back where the day started

  return {
    date: today,
    ...now,
    change: {
      ...(kcal ? { kcal } : {}),
      ...(protein ? { protein } : {}),
      reasons: reasonsFor(origin, now, kcal, protein),
    },
  };
}

/** `users/{uid}/dailyTargets/{date}` → domain. Tolerant of a partial doc: a
 *  record missing a required number is unusable and maps to null. */
export function toDailyTargetRecord(id: string, data: Record<string, unknown>): DailyTargetRecord | null {
  const n = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);
  const src = (v: unknown): TargetSource | undefined => (v === 'user' || v === 'auto' ? v : undefined);
  const kcal = n(data['kcalTarget']);
  const protein = n(data['proteinTarget']);
  const kcalSource = src(data['kcalSource']);
  const proteinSource = src(data['proteinSource']);
  if (kcal == null || protein == null || !kcalSource || !proteinSource) return null;
  const ms = data['maintenanceSource'];
  return {
    date: typeof data['date'] === 'string' ? data['date'] : id,
    kcalTarget: kcal, kcalSource, proteinTarget: protein, proteinSource,
    ...(n(data['maintenanceEstimate']) != null ? { maintenanceEstimate: n(data['maintenanceEstimate']) } : {}),
    ...(ms === 'measured' || ms === 'formula' || ms === 'seed' ? { maintenanceSource: ms } : {}),
    ...(n(data['compositionAdjustedMaintenance']) != null
      ? { compositionAdjustedMaintenance: n(data['compositionAdjustedMaintenance']) } : {}),
    ...(data['basis'] && typeof data['basis'] === 'object' ? { basis: data['basis'] as TargetBasis } : {}),
    ...(data['change'] && typeof data['change'] === 'object' ? { change: data['change'] as TargetChange } : {}),
    ...(isTimestampLike(data['noticeAckAt']) || data['noticeAckAt'] instanceof Date
      ? { noticeAckAt: toDate(data['noticeAckAt']) } : {}),
    recordedBy: data['recordedBy'] === 'prompt' ? 'prompt' : 'app',
    recordedAt: toDate(data['recordedAt']),
    updatedAt: toDate(data['updatedAt']),
  };
}

/** True when the record carries an AUTOMATIC change the user has not
 *  dismissed — the kind that owes a notice. A change the user made
 *  themselves is recorded with its reason, not announced back to them. */
export function owesNotice(r: DailyTargetRecord | null | undefined): boolean {
  if (!r?.change || r.noticeAckAt) return false;
  const auto = (c?: FieldChange) => c != null && c.toSource === 'auto';
  return auto(r.change.kcal) || auto(r.change.protein);
}

const num = (n: number) => (Number.isInteger(n) ? String(n) : String(+n.toFixed(2)));

/** One English line — the export's `targetChangeReason`. The app renders the
 *  same reasons through its own i18n keys; this is the file format. */
export function describeTargetChange(change: TargetChange): string {
  const parts: string[] = [];
  if (change.protein) {
    const p = change.protein;
    parts.push(`protein ${num(p.from)} g (${p.fromSource}) -> ${num(p.to)} g (${p.toSource})`);
  }
  if (change.kcal) {
    const k = change.kcal;
    parts.push(`kcal ${num(k.from)} (${k.fromSource}) -> ${num(k.to)} (${k.toSource})`);
  }
  const why = change.reasons.map((r) => {
    switch (r.kind) {
      case 'user-set': return `user set the ${r.field === 'kcal' ? 'calorie' : 'protein'} target`;
      case 'user-cleared': return `user returned the ${r.field === 'kcal' ? 'calorie' : 'protein'} target to automatic`;
      case 'weight': return `weight ${num(r.fromLb)} -> ${num(r.toLb)} lb at ${num(r.perKg)} g/kg`;
      case 'protein-per-kg': return `protein basis ${num(r.from)} -> ${num(r.to)} g/kg`;
      case 'maintenance': return `maintenance estimate ${num(r.from)} -> ${num(r.to)} kcal`;
      case 'pace': return `pace ${num(r.from)} -> ${num(r.to)} lb/week`;
      case 'calorie-floor': return `calorie floor ${num(r.from)} -> ${num(r.to)}`;
      case 'recalculated': return `${r.field === 'kcal' ? 'calorie' : 'protein'} target recalculated`;
    }
  });
  return `${parts.join('; ')}: ${why.join('; ')}`;
}
