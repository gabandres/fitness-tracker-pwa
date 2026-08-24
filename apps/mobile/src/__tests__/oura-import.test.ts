import {
  parseOuraWorkouts,
  toCardioBlockFromHealth,
  importableWorkouts,
  looksLikeSameEffort,
  mergeImportedBlocks,
} from '@macrolog/core';
import type { CardioBlock } from '@macrolog/core/cardio';

/**
 * The Oura Cloud import, end to end minus the network (issue #72).
 *
 * `src/lib/oura.ts` is three lines of glue over pieces that are each tested
 * where they live — the parser in `packages/core`, the pagination in
 * `functions/test`, the write path in `health-sync`. What NOTHING else covers
 * is the join: that a page of Oura JSON survives the whole pipeline as the
 * right blocks, and that a run arriving by BOTH transports is handled the way
 * ADR-0026 decision 4 says it must be.
 *
 * That second one is the reason this file exists. It is the case the issue
 * calls out as new, it is invisible to `tsc`, and the bug it guards against —
 * a silently duplicated run in a training history — is the kind a user notices
 * long before a test does.
 *
 * **What this cannot prove:** that Oura's wire shape is what we think. No
 * response from a real ring has been read. See the header of
 * `packages/core/src/oura-workouts.ts`.
 */

const T0 = Date.UTC(2026, 7, 24, 11, 0, 0);
const iso = (ms: number) => new Date(ms).toISOString();

/** A page as `fetchOuraWorkouts` returns it — Oura's records, untouched. */
function ouraPage(records: Record<string, unknown>[]) {
  return { data: records };
}

const RUN = {
  id: 'oura-doc-1',
  activity: 'running',
  calories: 612,
  day: '2026-08-24',
  distance: 8050,
  start_datetime: iso(T0),
  end_datetime: iso(T0 + 41 * 60_000),
  intensity: 'moderate',
  label: null,
  source: 'autodetected',
};

/** The pipeline `src/lib/oura.ts` runs, without the callable. */
function importPipeline(page: unknown): CardioBlock[] {
  const { workouts } = parseOuraWorkouts(page);
  return importableWorkouts(workouts)
    .map(toCardioBlockFromHealth)
    .filter((b) => b.modality !== 'other')
    .filter((b) => b.durationSec > 0);
}

describe('an Oura page becomes Train history', () => {
  it('lands as one cardio block with the right numbers', () => {
    const [block] = importPipeline(ouraPage([RUN]));

    expect(block.modality).toBe('run');
    expect(block.durationSec).toBe(41 * 60);
    expect(block.distanceM).toBe(8050);
    expect(block.kcal).toBe(612);
    expect(block.sourceId).toBe('oura-doc-1');
    expect(block.startedAt?.getTime()).toBe(T0);
  });

  it('says Oura without consulting the bundle-id guess', () => {
    const [block] = importPipeline(ouraPage([RUN]));
    // The risk the issue names: `normalizeProvider`'s Oura pattern has never
    // been checked against a real record, and if it is wrong the "via Oura"
    // chip renders `other` in front of the one person who owns the ring. This
    // transport is structurally immune — the record came FROM Oura, so
    // provenance is stated, not inferred.
    expect(block.provider).toBe('oura');
    expect(block.source).toBe('oura');
  });

  it('does not import strength training as cardio', () => {
    // Oura records weight training. Importing it would duplicate the sessions
    // the user logs in Train by hand, with no way to tell the copies apart.
    const blocks = importPipeline(
      ouraPage([{ ...RUN, id: 'w', activity: 'weightTraining' }]),
    );
    expect(blocks).toHaveLength(0);
  });

  it('drops a record it cannot read instead of storing a broken one', () => {
    const blocks = importPipeline(ouraPage([RUN, { id: 'half-a-record' }]));
    expect(blocks).toHaveLength(1);
  });
});

describe('the same run arriving through both transports', () => {
  /** The ring's run, as the OS health store hands it over. */
  const viaHealth: CardioBlock = {
    modality: 'run',
    durationSec: 41 * 60,
    source: 'health',
    provider: 'oura',
    sourceId: 'HK-11111111-2222-3333-4444-555555555555',
    // The health store's copy starts a minute earlier — the timing skew that
    // makes this hard, and the reason the overlap test measures against the
    // SHORTER span.
    startedAt: new Date(T0 - 60_000),
  };

  it('keeps BOTH blocks — nothing is silently merged', () => {
    const [viaCloud] = importPipeline(ouraPage([RUN]));
    const { blocks, changed } = mergeImportedBlocks([viaHealth], [viaCloud]);

    // ADR-0026 decision 4: a false positive destroys a real training record,
    // so the importer never collapses two records on its own. Two ids from two
    // stores are two records as far as the WRITE path is concerned.
    expect(blocks).toHaveLength(2);
    expect(changed).toBe(true);
  });

  it('but ASKS the user, which the old id short-circuit prevented', () => {
    const [viaCloud] = importPipeline(ouraPage([RUN]));
    // This is the whole fix. `looksLikeSameEffort` used to return false
    // whenever both blocks had a `sourceId`, on the reasoning that ids come
    // from one store. A second transport killed that premise, and the pair
    // that most needs a prompt was the pair getting none.
    expect(looksLikeSameEffort(viaHealth, viaCloud)).toBe(true);
  });

  it('still does not ask about two genuinely different sessions', () => {
    const [evening] = importPipeline(
      ouraPage([
        {
          ...RUN,
          id: 'oura-doc-2',
          start_datetime: iso(T0 + 8 * 3_600_000),
          end_datetime: iso(T0 + 8 * 3_600_000 + 41 * 60_000),
        },
      ]),
    );
    expect(looksLikeSameEffort(viaHealth, evening)).toBe(false);
  });

  it('re-importing the same Oura run updates it rather than adding a copy', () => {
    const [first] = importPipeline(ouraPage([RUN]));
    const [again] = importPipeline(ouraPage([{ ...RUN, calories: 640 }]));

    const { blocks, changed } = mergeImportedBlocks([first], [again]);
    expect(blocks).toHaveLength(1);
    expect(blocks[0].kcal).toBe(640);
    expect(changed).toBe(true);
  });

  it('a re-import keeps what the user added by hand', () => {
    const [first] = importPipeline(ouraPage([RUN]));
    const annotated: CardioBlock = { ...first, notes: 'legs felt heavy', rpe: 7 };

    const { blocks } = mergeImportedBlocks([annotated], importPipeline(ouraPage([RUN])));
    // The ring has nothing to say about notes or effort, and a sync must not
    // wipe them just because it re-read the record.
    expect(blocks[0].notes).toBe('legs felt heavy');
    expect(blocks[0].rpe).toBe(7);
  });

  it('a hand-logged run with no start time cannot be matched at all', () => {
    const [viaCloud] = importPipeline(ouraPage([RUN]));
    const handLogged: CardioBlock = { modality: 'run', durationSec: 41 * 60, source: 'manual' };
    // Nothing to anchor to, so no claim is made. Better than guessing.
    expect(looksLikeSameEffort(handLogged, viaCloud)).toBe(false);
  });
});
