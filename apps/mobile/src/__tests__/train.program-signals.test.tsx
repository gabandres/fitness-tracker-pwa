/**
 * Program v2.1 on Train's home screen (2026-10-15): "Consider a deload week"
 * on its trigger (core `deload.ts`), the accepted week's progress, and lifts
 * whose load is overdue (core `load-flags.ts`).
 */
import React from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { fireEvent, renderWithProviders as render, waitFor } from '@/test-utils';
import type { WorkoutSession, WorkoutTemplate } from '@/lib/workout';

const mockSetTrainingSettings = jest.fn().mockResolvedValue(undefined);
let mockProfile: Record<string, unknown> = {};
jest.mock('@/lib/auth', () => ({ useAuth: () => ({ user: { uid: 'u1' }, profile: mockProfile }) }));
jest.mock('@/lib/haptics', () => ({ tap: jest.fn(), warning: jest.fn() }));

import { ProgramSignals } from '@/components/train/ProgramSignals';

const NOW = new Date(2026, 9, 16, 9).getTime();
const day = (d: number) => new Date(2026, 9, d, 8);
const tpl = (id: string, name: string, rows: { id: string; name: string; load: number }[]): WorkoutTemplate =>
  ({ id, name, exercises: rows.map((r) => ({ exerciseId: r.id, name: r.name, targetLoad: r.load })) }) as unknown as WorkoutTemplate;
const session = (d: number, templateId: string, lifts: [string, number, number][], extra: object = {}): WorkoutSession =>
  ({
    id: `s${d}`, status: 'completed', date: day(d), templateId,
    exercises: lifts.map(([id, load, reps]) => ({
      exerciseId: id, name: id, cues: [],
      sets: [{ kind: 'activation', group: 1, weight: load, reps, rir: 0, done: true }],
    })),
    ...extra,
  }) as unknown as WorkoutSession;

const push = tpl('push', 'Push Day', [{ id: 'press', name: 'DB Flat Press', load: 25 }, { id: 'ohe', name: 'Overhead DB Extension', load: 30 }]);
const pull = tpl('pull', 'Pull Day', [{ id: 'row', name: 'Seated Machine Row', load: 100 }]);
// Both Push lifts down 2+ at the same load, two sessions running.
const slump = [
  session(1, 'push', [['press', 25, 10], ['ohe', 30, 12]]),
  session(5, 'push', [['press', 25, 8], ['ohe', 30, 10]]),
  session(9, 'push', [['press', 25, 7], ['ohe', 30, 9]]),
];

function renderSignals(sessions: WorkoutSession[], deload?: { active: boolean; remaining: string[]; done: string[] }) {
  return render(
    <ProgramSignals
      train={{ recentSessions: sessions, catalog: [], engineCatalog: [], deload, setDeloadStartedAt: mockSetTrainingSettings }}
      plannedTemplates={[push, pull]}
      now={NOW}
    />,
  );
}

beforeEach(async () => {
  mockSetTrainingSettings.mockClear();
  mockProfile = {};
  await AsyncStorage.clear();
});

describe('Consider a deload week', () => {
  it('shows on the trigger, naming each lift and its reads; Start writes deloadStartedAt', async () => {
    const ui = await renderSignals(slump);
    expect(ui.getByTestId('deload-signal')).toHaveTextContent('Consider a deload week', { exact: false });
    expect(ui.getByTestId('deload-lift-press')).toHaveTextContent('DB Flat Press · 25 lb: 10 → 8 → 7');
    await fireEvent.press(ui.getByTestId('deload-accept'));
    expect(mockSetTrainingSettings).toHaveBeenCalledWith(expect.any(Date));
  });

  it('one lift down is not a trigger', async () => {
    const ui = await renderSignals([
      session(1, 'push', [['press', 25, 10], ['ohe', 30, 12]]),
      session(5, 'push', [['press', 25, 8], ['ohe', 30, 12]]),
      session(9, 'push', [['press', 25, 7], ['ohe', 30, 12]]),
    ]);
    expect(ui.queryByTestId('deload-signal')).toBeNull();
  });

  it('"Not now" hides that signal, and it stays hidden on the next render', async () => {
    const ui = await renderSignals(slump);
    await fireEvent.press(ui.getByTestId('deload-dismiss'));
    expect(ui.queryByTestId('deload-signal')).toBeNull();
    const again = await renderSignals(slump);
    await waitFor(() => expect(again.queryByTestId('deload-signal')).toBeNull());
  });

  it('an accepted week shows what is left, not the trigger; End clears it', async () => {
    const ui = await renderSignals(slump, { active: true, remaining: ['pull'], done: ['push'] });
    expect(ui.queryByTestId('deload-signal')).toBeNull();
    expect(ui.getByTestId('deload-remaining')).toHaveTextContent('Left: Pull Day');
    await fireEvent.press(ui.getByTestId('deload-end'));
    expect(mockSetTrainingSettings).toHaveBeenCalledWith(null);
  });
});

describe('Load overdue', () => {
  it('flags a lift past the top of its range at the template load', async () => {
    // A press's range tops out well under 20.
    const ui = await renderSignals([session(9, 'push', [['press', 25, 20], ['ohe', 30, 10]])]);
    expect(ui.getByTestId('overdue-press')).toHaveTextContent('DB Flat Press (Push Day): 25 lb × 20', { exact: false });
    expect(ui.getByTestId('overdue-press')).toHaveTextContent('Raise the template load.', { exact: false });
    expect(ui.queryByTestId('overdue-ohe')).toBeNull();
  });

  it('nothing past the top: no card', async () => {
    const ui = await renderSignals([session(9, 'push', [['press', 25, 8], ['ohe', 30, 10]])]);
    expect(ui.queryByTestId('load-overdue')).toBeNull();
  });
});
