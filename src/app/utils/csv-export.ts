import type { DailyLog, Measurement } from '../services/firebase.service';
import { localDateKey } from './date';

const COLS = [
  'type', 'date', 'timestamp',
  'calories', 'protein', 'weight', 'exerciseCompleted', 'mealLabel',
  'waterMl',
  'waist', 'chest', 'bicep', 'hip',
] as const;
type Col = typeof COLS[number];

function escape(v: unknown): string {
  if (v === undefined || v === null || v === '') return '';
  const s = String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function row(values: Partial<Record<Col, unknown>>): string {
  return COLS.map((c) => escape(values[c])).join(',');
}

export interface ExportData {
  logs: DailyLog[];
  measurements: Measurement[];
  dailyWeights: Record<string, number>;
  dailyWater: Record<string, number>;
}

/**
 * Long-format CSV: every row carries a `type` discriminator
 * (meal | weight | water | measurement) and only fills the columns
 * relevant to that type. Opens cleanly in Excel/Sheets and lets users
 * filter by type to recover any single dataset.
 */
export function buildCsv(data: ExportData): string {
  const rows: string[] = [COLS.join(',')];

  const sortedLogs = [...data.logs].sort((a, b) => a.date.getTime() - b.date.getTime());
  for (const l of sortedLogs) {
    rows.push(row({
      type: 'meal',
      date: localDateKey(l.date),
      timestamp: l.date.toISOString(),
      calories: l.calories,
      protein: l.protein,
      weight: l.weight,
      exerciseCompleted: l.exerciseCompleted ? 'true' : '',
      mealLabel: l.mealLabel,
    }));
  }

  const weightKeys = Object.keys(data.dailyWeights).sort();
  for (const date of weightKeys) {
    rows.push(row({ type: 'weight', date, weight: data.dailyWeights[date] }));
  }

  const waterKeys = Object.keys(data.dailyWater).sort();
  for (const date of waterKeys) {
    rows.push(row({ type: 'water', date, waterMl: data.dailyWater[date] }));
  }

  const sortedMeasurements = [...data.measurements].sort((a, b) => a.date.getTime() - b.date.getTime());
  for (const m of sortedMeasurements) {
    rows.push(row({
      type: 'measurement',
      date: localDateKey(m.date),
      timestamp: m.date.toISOString(),
      waist: m.waist,
      chest: m.chest,
      bicep: m.bicep,
      hip: m.hip,
    }));
  }

  return rows.join('\r\n');
}

/** Trigger a browser download for the given CSV string. UTF-8 BOM
 *  prepended so Excel detects the encoding and renders non-ASCII
 *  meal labels (e.g. Spanish accents) correctly. */
export function downloadCsv(filename: string, csv: string): void {
  const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
