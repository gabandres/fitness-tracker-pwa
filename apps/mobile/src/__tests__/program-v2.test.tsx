/**
 * Program v2 (2026-10-11) on the device: the sleep sheet's optional bedtime /
 * wake time, the Zone 2 band and flags on a cardio block (spec test 8), the
 * weekly fractional volume sheet (spec section 3), and an L/R lift's two
 * calls. The rules themselves are pinned in `packages/core/src/program-v2.test.ts`.
 */
import React from 'react';
import { fireEvent, renderWithProviders as render } from '@/test-utils';
import { DailyMetrics } from '@/components/DailyMetrics';
import { CardioBlockCard } from '@/components/train/CardioBlockCard';
import { WeeklyVolumeSheet } from '@/components/train/WeeklyVolumeSheet';
import type { WorkoutSession } from '@/lib/workout';

jest.mock('@/lib/auth', () => ({ useAuth: () => ({ user: null, profile: null }) }));
jest.mock('@/components/BottomSheet', () => {
  const actual = jest.requireActual('@/components/BottomSheet');
  return { ...actual, NATIVE_SHEETS: false, BottomSheet: (p: object) => actual.BottomSheet({ ...p, native: false }) };
});

const noop = () => {};

describe('sleep: hours, and an optional bedtime / wake time', () => {
  async function openSleep(onSetSleep: (h: number, t?: { bedtime: string | null; wakeTime: string | null }) => void, sleep: number | null = null, sleepTimes?: { bedtime?: string; wakeTime?: string }) {
    const view = await render(
      <DailyMetrics water={0} sleep={sleep} sleepTimes={sleepTimes} activity={undefined} fastStartedAt={null}
        onAddWater={noop} onSetSleep={onSetSleep} onStartFast={noop} onBreakFast={noop} />,
    );
    await fireEvent.press(view.getByTestId('sleep-open'));
    return view;
  }

  it('a night not logged yet opens BLANK — never yesterday\'s value', async () => {
    const view = await openSleep(noop, null);
    expect(view.getByTestId('sleep-input').props.value).toBe('');
    expect(view.getByTestId('sleep-bedtime').props.value).toBe('');
  });

  it('saves decimal hours with the bedtime and wake time ("7:05" → "07:05")', async () => {
    const save = jest.fn();
    const view = await openSleep(save);
    await fireEvent.changeText(view.getByTestId('sleep-input'), '6.8');
    await fireEvent.changeText(view.getByTestId('sleep-bedtime'), '23:40');
    await fireEvent.changeText(view.getByTestId('sleep-wake'), '7:05');
    await fireEvent.press(view.getByTestId('sleep-save'));
    expect(save).toHaveBeenCalledWith(6.8, { bedtime: '23:40', wakeTime: '07:05' });
  });

  it('a time that is not a clock time blocks Save and says how to write it', async () => {
    const save = jest.fn();
    const view = await openSleep(save);
    await fireEvent.changeText(view.getByTestId('sleep-input'), '7');
    await fireEvent.changeText(view.getByTestId('sleep-bedtime'), '25:10');
    expect(view.getByTestId('sleep-times-invalid')).toBeTruthy();
    await fireEvent.press(view.getByTestId('sleep-save'));
    expect(save).not.toHaveBeenCalled();
  });

  it('clearing a time it had clears it (null), hours alone leave the times blank', async () => {
    const save = jest.fn();
    const view = await openSleep(save, 7, { bedtime: '23:00', wakeTime: '06:30' });
    expect(view.getByTestId('sleep-bedtime').props.value).toBe('23:00');
    await fireEvent.changeText(view.getByTestId('sleep-bedtime'), '');
    await fireEvent.press(view.getByTestId('sleep-save'));
    expect(save).toHaveBeenCalledWith(7, { bedtime: null, wakeTime: '06:30' });
  });
});

describe('Zone 2 on a cardio block (test 8)', () => {
  const card = (over: object) => render(
    <CardioBlockCard
      block={{ modality: 'walk', label: 'Zone 2', durationSec: 1200, source: 'manual', targetHrMin: 120, targetHrMax: 130, ...over }}
      index={0}
      onPatch={noop}
      onCommit={noop}
      onRemove={noop}
    />,
  );

  it('shows the band; avgHR 135 → "outside Zone 2 band"; RPE 8 → "too high"', async () => {
    const ui = await card({ avgHr: 135, rpe: 8 });
    expect(ui.getByTestId('cardio-band-0')).toHaveTextContent('Target HR 120–130 bpm');
    expect(ui.getByTestId('cardio-out-of-band-0')).toHaveTextContent('Outside Zone 2 band (120–130 bpm)');
    expect(ui.getByTestId('cardio-rpe-high-0')).toHaveTextContent('RPE too high for Zone 2');
  });

  it('avgHR 125 and no RPE → no flag, and the RPE field is BLANK (never a default 10)', async () => {
    const ui = await card({ avgHr: 125 });
    expect(ui.queryByTestId('cardio-out-of-band-0')).toBeNull();
    expect(ui.queryByTestId('cardio-rpe-high-0')).toBeNull();
    expect(ui.getByTestId('cardio-rpe-0').props.defaultValue).toBe('');
  });
});

describe('weekly volume (clusters, myo-rep)', () => {
  const at = new Date('2026-10-12T18:00:00Z');
  const act = (g: number, label?: string) => [
    { kind: 'activation' as const, group: g, weight: 20, reps: 12, ...(label ? { label } : {}) },
    { kind: 'mini' as const, group: g, weight: 20, reps: 4 },
  ];
  const sessions = [{
    id: 's1', status: 'completed', templateName: 'Push Day', date: at, createdAt: at, updatedAt: at,
    exercises: [
      { exerciseId: 'flat', name: 'DB Flat Press', cues: [], sets: [...act(1), ...act(2)] },
      { exerciseId: 'lat', name: 'DB Lateral Raise', cues: [], sets: act(1) },
      { exerciseId: 'calf', name: 'Single-leg DB calf raise', cues: [], sets: [...act(1, 'L'), ...act(2, 'R')] },
      // Thirteen chest clusters' worth, to cross the per-session plateau.
      { exerciseId: 'fly', name: 'Cable fly', cues: [], sets: Array.from({ length: 11 }, (_, i) => act(i + 1)).flat() },
    ],
  }] as unknown as WorkoutSession[];

  it('lists the muscles with clusters lowest first, counts an L+R pair once, flags the plateau', async () => {
    const ui = await render(
      <WeeklyVolumeSheet visible onClose={noop} sessions={sessions} catalog={[]} templates={[]} now={at.getTime() + 1000} />,
    );
    expect(ui.getByText('Muscle — lowest total first')).toBeTruthy();
    expect(ui.getByTestId('weekly-volume-calves')).toHaveTextContent('1 total · 1 as main muscle · 0 planned', { exact: false });
    expect(ui.getByTestId('weekly-volume-sideDelt')).toHaveTextContent('1 total · 1 as main muscle', { exact: false });
    expect(ui.getByTestId('weekly-volume-triceps')).toHaveTextContent('6.5 total · 0 as main muscle', { exact: false });
    expect(ui.getByTestId('weekly-volume-plateau-chest')).toHaveTextContent('clusters in one session — past the point', { exact: false });
    // Muscles with nothing logged or planned are one line, not rows of zeros
    // (train-ux X2).
    expect(ui.queryByTestId('weekly-volume-quads')).toBeNull();
    expect(ui.getByTestId('weekly-volume-idle')).toHaveTextContent(/^No clusters in the last 7 days: .*Quads/);
  });

  it('a straight-set week says so in one line instead of twelve zero rows (train-ux H1/X2)', async () => {
    const straight = [{
      id: 's2', status: 'completed', templateName: 'Upper A', date: at, createdAt: at, updatedAt: at,
      exercises: [{ exerciseId: 'b', name: 'Bench Press', cues: [], sets: [{ kind: 'working', weight: 135, reps: 8 }] }],
    }] as unknown as WorkoutSession[];
    const ui = await render(
      <WeeklyVolumeSheet visible onClose={noop} sessions={straight} catalog={[]} templates={[]} now={at.getTime() + 1000} straightSets={9} />,
    );
    expect(ui.getByTestId('weekly-volume-empty')).toHaveTextContent(/^No myo-rep clusters logged or planned/);
    expect(ui.queryByTestId('weekly-volume-chest')).toBeNull();
    expect(ui.getByTestId('weekly-volume-straight')).toHaveTextContent('Straight working sets in the last 7 days: 9', { exact: false });
  });

  it('has a visible Done that closes it (train-ux H7)', async () => {
    const close = jest.fn();
    const ui = await render(
      <WeeklyVolumeSheet visible onClose={close} sessions={sessions} catalog={[]} templates={[]} now={at.getTime() + 1000} />,
    );
    await fireEvent.press(ui.getByTestId('weekly-volume-done'));
    expect(close).toHaveBeenCalled();
  });
});
