/**
 * Health Connect can hand back a Weight or Hydration record whose value is
 * missing. Until 2026-09-28 the adapter turned that into a 0 — and since 0 is
 * a storable water value, a valueless record overwrote a real day with
 * nothing. A sample whose value is not a finite number > 0 is now skipped.
 * Also pins the per-source tag core folds sleep by, and the asleep-stages-only
 * duration for a session that carries stages.
 */
import { MIDNIGHT } from '@macrolog/core';
import { hcRecordsToSamples } from '@/lib/health';

const meta = (pkg: string) => ({ dataOrigin: pkg });

it('skips Hydration records with no volume rather than importing a 0 that overwrites the day', () => {
  const samples = hcRecordsToSamples('water', [
    { startTime: '2026-09-27T09:00:00Z', endTime: '2026-09-27T09:00:00Z', volume: { inLiters: 0.5 }, metadata: meta('com.water') },
    { startTime: '2026-09-27T10:00:00Z', endTime: '2026-09-27T10:00:00Z', volume: {}, metadata: meta('com.water') },
    { startTime: '2026-09-27T11:00:00Z', endTime: '2026-09-27T11:00:00Z', metadata: meta('com.water') },
    { startTime: '2026-09-27T12:00:00Z', endTime: '2026-09-27T12:00:00Z', volume: { inLiters: 0 }, metadata: meta('com.water') },
    { startTime: '2026-09-27T13:00:00Z', endTime: '2026-09-27T13:00:00Z', volume: { inLiters: Number.NaN }, metadata: meta('com.water') },
  ], MIDNIGHT);
  expect(samples).toHaveLength(1);
  expect(samples[0].value).toBeCloseTo(16.9, 1);
  expect(samples[0].source).toBe('com.water');
});

it('skips Weight records with no mass, and reads either unit when present', () => {
  const samples = hcRecordsToSamples('weight', [
    { time: '2026-09-27T07:00:00Z', weight: { inPounds: 180 }, metadata: meta('com.scale') },
    { time: '2026-09-26T07:00:00Z', weight: { inKilograms: 80 }, metadata: meta('com.scale') },
    { time: '2026-09-25T07:00:00Z', weight: {}, metadata: meta('com.scale') },
    { time: '2026-09-24T07:00:00Z', metadata: meta('com.scale') },
    { time: '2026-09-23T07:00:00Z', weight: { inPounds: 0 }, metadata: meta('com.scale') },
  ], MIDNIGHT);
  expect(samples.map((s) => Math.round(s.value))).toEqual([180, 176]);
  expect(samples.every((s) => s.source === 'com.scale')).toBe(true);
});

it('tags sleep with its source and counts only asleep stages when stages exist', () => {
  const samples = hcRecordsToSamples('sleep', [
    {
      startTime: '2026-09-26T23:00:00Z', endTime: '2026-09-27T07:00:00Z', metadata: meta('com.ouraring.oura'),
      stages: [
        { startTime: '2026-09-26T23:00:00Z', endTime: '2026-09-26T23:30:00Z', stage: 1 }, // awake
        { startTime: '2026-09-26T23:30:00Z', endTime: '2026-09-27T06:30:00Z', stage: 4 }, // light
        { startTime: '2026-09-27T06:30:00Z', endTime: '2026-09-27T07:00:00Z', stage: 3 }, // out of bed
      ],
    },
    { startTime: '2026-09-26T23:10:00Z', endTime: '2026-09-27T07:10:00Z', metadata: meta('com.google.android.apps.fitness') },
  ], MIDNIGHT);
  expect(samples).toHaveLength(2);
  expect(samples[0].source).toBe('com.ouraring.oura');
  expect(samples[0].value).toBe(7);
  expect(samples[1].source).toBe('com.google.android.apps.fitness');
  expect(samples[1].value).toBe(8);
});
