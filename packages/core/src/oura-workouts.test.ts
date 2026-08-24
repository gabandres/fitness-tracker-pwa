import { describe, it, expect } from 'vitest';
import { parseOuraWorkouts, toHealthWorkout, ouraDateParam } from './oura-workouts';
import { toCardioBlockFromHealth, importableWorkouts } from './health-workouts';

/**
 * ## What these tests can and cannot prove
 *
 * They prove the parser is defensive and that a well-formed record lands as
 * the right `CardioBlock`. They do **not** prove the wire shape is right —
 * no response from a real ring has been read, and a test written from the same
 * assumption as the code agrees with it by construction. That is the whole
 * hazard the issue calls out, and no amount of hand-authored fixture closes it.
 *
 * So the fixtures below are deliberately built from the shape Oura *publishes*
 * (and two independent third-party clients corroborate), and every assertion
 * about a field we invented — provider, source, the absence of HR — is stated
 * loudly enough that a captured payload disagreeing with it fails here first.
 */

/** Oura's own documented example, verbatim, plus the fields it shows as null. */
const CYCLING = {
  id: '8f9a5221-639e-4a85-81cb-4065ef23f979',
  activity: 'cycling',
  calories: 300,
  day: '2021-01-01',
  distance: 13500.5,
  // NOTE the published example has end BEFORE start — 01:00 against 01:30.
  // Corrected here to a sane 30-minute ride; see the "end before start" test,
  // which pins that the literal example would be DROPPED rather than stored as
  // a negative duration.
  end_datetime: '2021-01-01T02:00:00.000000+00:00',
  intensity: 'moderate',
  label: null,
  source: 'manual',
  start_datetime: '2021-01-01T01:30:00.000000+00:00',
};

describe('toHealthWorkout', () => {
  it('reads a documented record into the shape the importer already eats', () => {
    const w = toHealthWorkout(CYCLING)!;
    expect(w).not.toBeNull();
    expect(w.id).toBe('8f9a5221-639e-4a85-81cb-4065ef23f979');
    expect(w.activityType).toBe('cycling');
    expect(w.endMs - w.startMs).toBe(30 * 60 * 1000);
    // Meters in, meters out — no conversion. A silent /1000 here would render
    // a 13.5 km ride as 13.5 m and look like a rounding bug on screen.
    expect(w.distanceM).toBe(13500.5);
    expect(w.kcal).toBe(300);
  });

  it('states its provenance instead of inferring it', () => {
    const w = toHealthWorkout(CYCLING)!;
    // The point of the cloud transport: `normalizeProvider`'s Oura pattern is
    // never consulted, so the "via Oura" chip cannot render `other` because a
    // bundle-id guess missed. This is the one risk the issue names, and this
    // path is structurally immune to it.
    expect(w.provider).toBe('oura');
    expect(w.source).toBe('oura');
    expect(w.sourceBundleId).toBeUndefined();
    expect(w.fromUs).toBe(false);
  });

  it('carries no heart rate, because the scope we requested does not include it', () => {
    // Asserted rather than assumed: if `avgHr` ever appears here it means
    // somebody widened the OAuth scope, which forces every connected user to
    // re-consent (ADR-0026 scope table). That should not happen quietly.
    expect(toHealthWorkout(CYCLING)!.avgHr).toBeUndefined();
  });

  it('does not turn Oura intensity into RPE', () => {
    const block = toCardioBlockFromHealth(toHealthWorkout(CYCLING)!);
    // `intensity: 'moderate'` is an algorithm's label; RPE is the user's own
    // judgement. Filling one from the other puts a number the user never gave
    // into a field only they can answer — and afterwards it is
    // indistinguishable from one they did.
    expect(block.rpe).toBeUndefined();
  });

  it.each([
    ['no id', { ...CYCLING, id: null }],
    ['empty id', { ...CYCLING, id: '' }],
    ['no activity', { ...CYCLING, activity: undefined }],
    ['unparseable start', { ...CYCLING, start_datetime: 'not a date' }],
    ['missing end', { ...CYCLING, end_datetime: null }],
    ['end before start', { ...CYCLING, end_datetime: '2021-01-01T01:00:00.000000+00:00' }],
    ['zero length', { ...CYCLING, end_datetime: CYCLING.start_datetime }],
    ['longer than a day', { ...CYCLING, end_datetime: '2021-01-03T01:30:00.000000+00:00' }],
  ])('drops a record it cannot read: %s', (_label, raw) => {
    // Dropping loses one workout. Coercing writes a corrupt one into a
    // training history the user trusts, where nothing downstream can tell it
    // apart from a real record.
    expect(toHealthWorkout(raw)).toBeNull();
  });

  it.each([
    ['null distance', 'distance'],
    ['null calories', 'calories'],
  ])('keeps a record missing an optional field: %s', (_label, key) => {
    const w = toHealthWorkout({ ...CYCLING, [key]: null })!;
    expect(w).not.toBeNull();
    // `undefined`, never 0 — `Number(null)` is 0, and a stored zero would drag
    // every average it lands in and read as "burned nothing".
    expect(w[key === 'distance' ? 'distanceM' : 'kcal']).toBeUndefined();
  });

  it('rejects a negative measurement rather than clamping it to zero', () => {
    expect(toHealthWorkout({ ...CYCLING, distance: -5 })!.distanceM).toBeUndefined();
  });

  it("uses the user's own label only where the modality table has nothing", () => {
    const placed = toCardioBlockFromHealth(
      toHealthWorkout({ ...CYCLING, label: 'Commute' })!,
    );
    // `cycling` maps cleanly to `ride`, which renders a translated name. A
    // label beside it would be redundant.
    expect(placed.modality).toBe('ride');
    expect(placed.label).toBeUndefined();

    const unplaced = toCardioBlockFromHealth(
      toHealthWorkout({ ...CYCLING, activity: 'padel', label: 'Padel with Ana' })!,
    );
    expect(unplaced.modality).toBe('other');
    // The user's words beat a humanized activity string, and unlike the
    // humanized form they need no translation.
    expect(unplaced.label).toBe('Padel with Ana');
  });

  it('falls back to the humanized activity when there is no label', () => {
    const b = toCardioBlockFromHealth(toHealthWorkout({ ...CYCLING, activity: 'padel' })!);
    expect(b.modality).toBe('other');
    expect(b.label).toBeTruthy();
    expect(b.label).not.toBe('padel');
  });
});

describe('parseOuraWorkouts', () => {
  it('reads a page and its continuation token', () => {
    const { workouts, nextToken, skipped } = parseOuraWorkouts({
      data: [CYCLING],
      next_token: 'abc123',
    });
    expect(workouts).toHaveLength(1);
    expect(nextToken).toBe('abc123');
    expect(skipped).toBe(0);
  });

  it('counts what it could not read instead of hiding it', () => {
    // A silent zero and a zero from twenty unparseable records look identical
    // otherwise, and they mean completely different things: "a rest week"
    // against "our parser is wrong about the wire shape".
    const { workouts, skipped } = parseOuraWorkouts({
      data: [CYCLING, { id: 'x' }, null, 'nonsense'],
    });
    expect(workouts).toHaveLength(1);
    expect(skipped).toBe(3);
  });

  it.each([
    ['undefined', undefined],
    ['null', null],
    ['a string', 'error'],
    ['an object with no data', {}],
    ['data that is not an array', { data: { id: 'x' } }],
  ])('never throws on a body shaped like %s', (_label, body) => {
    // The caller is a background import. A throw here becomes a 500 that tells
    // the user their ring is broken when it is our parser that is.
    expect(() => parseOuraWorkouts(body)).not.toThrow();
    expect(parseOuraWorkouts(body).workouts).toEqual([]);
  });

  it('treats an empty or absent next_token as the last page', () => {
    // A loop that keeps requesting on `''` runs forever against a server that
    // is answering correctly.
    expect(parseOuraWorkouts({ data: [], next_token: '' }).nextToken).toBeNull();
    expect(parseOuraWorkouts({ data: [] }).nextToken).toBeNull();
  });

  it('hands the existing importer something it can filter', () => {
    // The claim the whole file rests on: this produces `HealthWorkout`, so the
    // health-store path's own filter runs over it unchanged. No second
    // pipeline, no second mapper.
    const { workouts } = parseOuraWorkouts({ data: [CYCLING] });
    expect(importableWorkouts(workouts)).toHaveLength(1);
  });
});

describe('ouraDateParam', () => {
  it('formats YYYY-MM-DD in UTC', () => {
    expect(ouraDateParam(new Date('2026-08-24T23:30:00Z'))).toBe('2026-08-24');
  });

  it('is UTC and not local, on purpose', () => {
    // The window only bounds the REQUEST. Which local day a workout is filed
    // under is decided later from `startedAt`, by the importer that already
    // does this for the health store — so computing these bounds locally would
    // make the request vary by device without changing where anything lands.
    expect(ouraDateParam(new Date(Date.UTC(2026, 0, 1, 0, 0, 0)))).toBe('2026-01-01');
  });
});
