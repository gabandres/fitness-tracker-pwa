import { describe, expect, it } from 'vitest';
import { isExpiredOneOff, isOneOffTemplate, oneOffOf, oneOffsToArchive, rotationTemplates } from './rotation-templates';
import { nextTemplateUp, previousCell } from './train-plan';
import { sanitizeTravelPlan, volumeWaiver } from './travel-plan';
import { workingSetCells } from './train-view';
import { toWorkoutTemplate } from './workout-mappers';
import type { WorkoutSession, WorkoutTemplate } from './workout';

const tpl = (id: string, extra: Partial<WorkoutTemplate> = {}): WorkoutTemplate => ({
  id, name: id, exercises: [], createdAt: new Date(0), updatedAt: new Date(0), ...extra,
});
const ses = (templateId: string, status: WorkoutSession['status'] = 'completed', date = new Date('2026-11-17T12:00:00Z')): WorkoutSession => ({
  status, templateId, date, exercises: [], createdAt: date, updatedAt: date,
});
const ONE_OFF = { archiveOn: '2026-11-19' };

describe('one-off templates (2026-11-16)', () => {
  it('maps gymBusy and a well-formed oneOff; drops a malformed one', () => {
    const t = toWorkoutTemplate('x', { name: 'x', exercises: [], gymBusy: true, oneOff: ONE_OFF });
    expect(t.gymBusy).toBe(true);
    expect(t.oneOff).toEqual(ONE_OFF);
    expect(toWorkoutTemplate('y', { name: 'y', exercises: [], gymBusy: 'yes', oneOff: { archiveOn: '19/11' } })).not.toHaveProperty('oneOff');
    expect(toWorkoutTemplate('y', { name: 'y', exercises: [], gymBusy: 'yes' })).not.toHaveProperty('gymBusy');
    expect(oneOffOf(null)).toBeUndefined();
  });

  it('archives after a COMPLETED session, or on archiveOn — whichever first', () => {
    const t = tpl('airbnb', { oneOff: ONE_OFF });
    expect(oneOffsToArchive([t], [], '2026-11-17')).toEqual([]);
    expect(oneOffsToArchive([t], [ses('airbnb', 'active')], '2026-11-17')).toEqual([]);
    expect(oneOffsToArchive([t], [ses('airbnb', 'paused')], '2026-11-17')).toEqual([]);
    expect(oneOffsToArchive([t], [ses('airbnb')], '2026-11-17')).toEqual([t]);
    expect(oneOffsToArchive([t], [], '2026-11-19')).toEqual([t]);
    expect(oneOffsToArchive([{ ...t, archivedAt: new Date() }], [ses('airbnb')], '2026-11-19')).toEqual([]);
    // A normal template is never archived by this.
    expect(oneOffsToArchive([tpl('leg')], [ses('leg')], '2030-01-01')).toEqual([]);
    expect(isExpiredOneOff(t, '2026-11-18')).toBe(false);
    expect(isExpiredOneOff(t, '2026-11-19')).toBe(true);
    expect(isOneOffTemplate(tpl('leg'))).toBe(false);
  });

  it('is never part of a rotation', () => {
    const leg = tpl('leg');
    const one = tpl('airbnb', { oneOff: ONE_OFF });
    const now = new Date('2026-11-18T12:00:00Z').getTime();
    expect(rotationTemplates([leg, one], new Set(), [ses('leg'), ses('airbnb')], now)).toEqual([leg]);
    expect(rotationTemplates([leg, one], new Set(), [], now)).toEqual([leg]);
  });

  it('is never "next up" by itself (never-performed would otherwise win)', () => {
    const leg = tpl('leg');
    const one = tpl('airbnb', { oneOff: ONE_OFF });
    const now = new Date('2026-11-18T12:00:00Z').getTime();
    expect(nextTemplateUp([leg, one], [ses('leg', 'completed', new Date('2026-11-01T12:00:00Z'))], now)?.template.id).toBe('leg');
  });
});

describe('stack positions (WorkoutSet.plate)', () => {
  it('formats a plate set as "#N×reps" and never as a load', () => {
    const sets = [
      { kind: 'activation' as const, group: 1, plate: 7, reps: 12 },
      { kind: 'activation' as const, group: 2, weight: 26.4555, unit: 'kg' as const, reps: 10 },
    ];
    expect(workingSetCells({ sets }, 'weight-reps', 'metric')).toEqual(['#7×12', '12×10']);
    expect(previousCell(sets[0], 'weight-reps')).toBe('#7×12');
  });
});

describe('volumeOk plan notes (2026-11-16)', () => {
  const plan = sanitizeTravelPlan([
    { from: '2026-11-16', to: '2026-11-22', kind: 'note', label: 'Week of 11/16 — travel + re-entry — OK', volumeOk: true },
    { from: '2026-11-17', to: '2026-11-17', kind: 'session', label: 'S', templateId: 'x', volumeOk: true },
  ]);
  it('keeps volumeOk on notes only', () => {
    expect(plan[0].volumeOk).toBe(true);
    expect(plan[1]).not.toHaveProperty('volumeOk');
  });
  it('waives the week it spans, nothing outside it', () => {
    expect(volumeWaiver([{ plan }], '2026-11-15')).toBeNull();
    expect(volumeWaiver([{ plan }], '2026-11-16')?.label).toMatch(/OK$/);
    expect(volumeWaiver([{ plan }], '2026-11-22')).not.toBeNull();
    expect(volumeWaiver([{ plan }], '2026-11-23')).toBeNull();
    expect(volumeWaiver([], '2026-11-17')).toBeNull();
  });
});

describe('skipped rows and plate estimates (2026-11-17)', () => {
  const at = new Date('2026-11-17T15:00:00Z');
  const s: WorkoutSession = {
    status: 'completed', templateId: 'airbnb', templateName: 'Airbnb', date: at, createdAt: at, updatedAt: at,
    exercises: [
      { exerciseId: 'bss', name: 'Bulgarian Split Squat (DB)', cues: [], sets: [], skipped: 'no stable bench' },
      { exerciseId: 'row', name: 'Row', cues: [], logStyle: 'weight-reps', sets: [{ kind: 'activation', group: 1, weight: 121.25, unit: 'kg', plate: 11, reps: 12, rir: 0, done: true }] },
    ],
  };
  it('a skipped row is named in the workout notes; an estimate set exports its kg, not "plate"', async () => {
    const { buildCsv } = await import('./csv-export');
    const csv = buildCsv({ logs: [], measurements: [], dailyWeights: {}, dailyWater: {}, dailySleep: {}, workoutSessions: [s] });
    const [head, ...lines] = csv.split('\r\n');
    const cols = head.split(',');
    const rows = lines.map((l) => Object.fromEntries(l.split(',').map((v, i) => [cols[i], v])));
    expect(rows.find((r) => r.type === 'workout')!.notes).toContain('skipped: Bulgarian Split Squat (DB) (no stable bench)');
    const set = rows.find((r) => r.type === 'workout_set')!;
    expect(set.unit).toBe('kg');
    expect(rows.filter((r) => r.type === 'workout_set')).toHaveLength(1);
    expect(workingSetCells(s.exercises[1], 'weight-reps', 'metric')).toEqual(['55×12']);
  });
});
