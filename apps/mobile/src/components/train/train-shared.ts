import type { I18nKey } from '@/i18n';
import type { LogStyle, SetKind, WorkoutSet } from '@/lib/workout';

/**
 * Label maps and small parsers shared by the Train screen and its modals.
 *
 * These were defined in the middle of `app/(app)/train.tsx` and used from four
 * places in it; when the template editor moved out they had to live somewhere
 * both could import. Pure — no hooks, no styles, no components — so anything in
 * Train can take them without pulling a render tree along.
 */

export const LOG_STYLES: { value: LogStyle; labelKey: I18nKey }[] = [
  { value: 'weight-reps', labelKey: 'logStyle.weightReps' },
  { value: 'bodyweight', labelKey: 'logStyle.bodyweight' },
  { value: 'time', labelKey: 'logStyle.time' },
];

export const SET_KINDS: { value: WorkoutSet['kind']; labelKey: I18nKey; descKey: I18nKey }[] = [
  { value: 'warmup', labelKey: 'train.kind.warmup', descKey: 'train.kindDesc.warmup' },
  { value: 'working', labelKey: 'train.kind.working', descKey: 'train.kindDesc.working' },
  { value: 'activation', labelKey: 'train.kind.activation', descKey: 'train.kindDesc.activation' },
  { value: 'mini', labelKey: 'train.kind.mini', descKey: 'train.kindDesc.mini' },
  { value: 'drop', labelKey: 'train.kind.drop', descKey: 'train.kindDesc.drop' },
  // ADR-0028. Last in the picker deliberately: it is the least-used kind and
  // pushing it above `drop` would reorder a list users already have muscle
  // memory for.
  { value: 'mobility', labelKey: 'train.kind.mobility', descKey: 'train.kindDesc.mobility' },
];

export function logStyleKey(style: LogStyle | undefined): I18nKey {
  return style === 'bodyweight' ? 'logStyle.bodyweight' : style === 'time' ? 'logStyle.time' : 'logStyle.weightReps';
}

export function kindLabelKey(kind: SetKind): I18nKey {
  return (SET_KINDS.find((k) => k.value === kind) ?? SET_KINDS[1]).labelKey;
}

/** Parse a text-field buffer to a number, or `undefined` for blank/garbage.
 *  Blank must stay `undefined` rather than 0 — a cleared weight field means
 *  "not entered", and writing 0 would log a real set at no load. */
export function numOrUndef(s: string): number | undefined {
  const t = s.trim();
  if (t === '') return undefined;
  const n = Number(t);
  return Number.isFinite(n) ? n : undefined;
}
