/**
 * Program v2 as the owner specified it on 2026-10-11 ("Ignia — Program v2:
 * Push supersets, Lateral Raise ×2, volume report, Zone 2 band, sleep
 * field"). The SAME object `scripts/owner-data-2026-10-11-program-v2.mts`
 * writes as drafts, so the tests pin exactly what the script creates.
 *
 * - Supersets on Push only: A = flat press + floor crunch, B = incline +
 *   single-leg calf raise (B1's cluster 1 with the L cluster, cluster 2 with
 *   the R — the flow alternates units, so this falls out of the order), C =
 *   overhead extension + lateral raise. Pull and Leg run straight.
 * - The floor crunch and the calf raise move from Leg to Push.
 * - Lateral raise 1 → 2 clusters, the drop set on the last cluster only — the
 *   one volume increase.
 * - Timers: 30 s transitions and rounds, 60 s after a block, 60 s between the
 *   lateral raise's own clusters, and A1/B1 at least 90 s between their own
 *   clusters. Straight rows: 105 s (90–120) into the same primary muscle,
 *   60 s on a switch, computed (`StraightRestRule`).
 * - Zone 2 keeps its 20 min, with a 120–130 bpm band.
 * - Loads are never written here: every row is copied from the live template
 *   and refreshed from it again at the switch.
 */
import type { DraftLayout, StraightRestRule } from '../superset-context';
import { ZONE2_BAND } from '../cardio';

const STRAIGHT_REST: StraightRestRule = { sameSec: 105, sameMaxSec: 120, switchSec: 60, afterBlockSec: 60 };
const shared = { transitionRestSec: 30, roundRestSec: 30, straightRest: STRAIGHT_REST, zone2Band: { ...ZONE2_BAND } };

export const PROGRAM_V2_LAYOUTS: DraftLayout[] = [
  {
    draftOf: 'Push Day',
    label: 'Push Day — Program v2',
    ...shared,
    rows: [
      { exercise: 'DB Flat Press', group: 'A', pairPosition: 1, minClusterRestSec: 90 },
      { exercise: 'Weighted Floor Crunch', from: 'Leg Day', group: 'A', pairPosition: 2 },
      { exercise: 'Incline Dumbbell Press', group: 'B', pairPosition: 1, minClusterRestSec: 90 },
      { exercise: 'Single-leg DB calf raise', from: 'Leg Day', group: 'B', pairPosition: 2, addCue: '1–2 s pause at the bottom stretch.', cueAlreadyIf: /1\s*[–-]\s*2\s*s(ec)?\s*pause/i },
      { exercise: 'Seated DB Shoulder Press', keepBaseline: true },
      { exercise: 'Deficit Push-up' },
      { exercise: 'Overhead DB Extension', group: 'C', pairPosition: 1 },
      { exercise: 'DB Lateral Raise', group: 'C', pairPosition: 2, clusters: 2, restClusterSec: 60 },
      { exercise: 'Skull Crusher' },
    ],
  },
  {
    draftOf: 'Pull Day',
    label: 'Pull Day — Program v2',
    ...shared,
    rows: [
      { exercise: 'Seated Machine Row' },
      { exercise: 'Neutral-grip pull-up' },
      { exercise: 'Wide-grip lat pulldown' },
      { exercise: 'Chest-supported DB row' },
      { exercise: 'Rear delt DB flye' },
      { exercise: 'Incline DB Curl 45°' },
      { exercise: 'DB hammer curl' },
    ],
  },
  {
    draftOf: 'Leg Day',
    label: 'Leg Day — Program v2',
    ...shared,
    rows: [
      { exercise: 'Smith squat' },
      { exercise: 'DB Romanian deadlift' },
      { exercise: 'Leg Extensions' },
      { exercise: 'Leg Curls' },
      { exercise: 'Hanging Knee Raise' },
    ],
  },
];
