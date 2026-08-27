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

/**
 * What the exercise-creation chips offer. Three of the four ARE log styles;
 * `mobility` is not one, and that asymmetry is the point.
 *
 * A stretch differs from a plank in two ways at once — it is logged in seconds
 * AND its sets do not count toward records or progression — and a user thinks
 * of that as one choice, not two. Before this, picking "Time" gave a timed
 * exercise whose sets still defaulted to `working`, so a hand-made stretch
 * could take a `maxDurationSec` PR and never trip the dose note: exactly the
 * outcome ADR-0028 decision 1 exists to prevent, reached through the
 * hand-authoring door instead of the seeded one.
 *
 * The alternative was defaulting `time` -> `mobility`, and it was rejected:
 * a plank and a dead hang are genuinely working sets, so that default guesses,
 * and BOTH of its failure directions are silent — a mis-tagged stretch takes a
 * phantom PR, a mis-tagged plank silently stops earning one. A fourth chip
 * removes the guess rather than improving it.
 *
 * Nothing new is stored. The choice resolves to a `logStyle` and a `SetKind`;
 * no field says "this exercise is mobility", so ADR-0028 amendment 1A's
 * refusal to classify `Exercise` stands untouched.
 */
export type CreationStyle = LogStyle | 'mobility';

export const CREATION_STYLES: { value: CreationStyle; labelKey: I18nKey }[] = [
  { value: 'weight-reps', labelKey: 'logStyle.weightReps' },
  { value: 'bodyweight', labelKey: 'logStyle.bodyweight' },
  { value: 'time', labelKey: 'logStyle.time' },
  { value: 'mobility', labelKey: 'train.kind.mobility' },
];

/** The stored `logStyle` a creation choice implies — mobility is timed. */
export function logStyleFor(s: CreationStyle): LogStyle {
  return s === 'mobility' ? 'time' : s;
}

/** The `SetKind` a creation choice implies for the sets it scaffolds. */
export function setKindFor(s: CreationStyle): SetKind {
  return s === 'mobility' ? 'mobility' : 'working';
}

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
