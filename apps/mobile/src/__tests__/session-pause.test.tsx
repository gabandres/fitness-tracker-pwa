jest.mock('@/lib/auth', () => ({ useAuth: () => ({ user: null, profile: null, isAdmin: false }) }));
import { fireEvent } from '@testing-library/react-native';
import { MIDNIGHT, kgToLb } from '@macrolog/core';
import { renderWithProviders as render } from '@/test-utils';
import { PausedSessionCard } from '@/components/train/PausedSessionCard';
import { setLine } from '@/components/train/train-summary';
import type { SessionExercise, WorkoutSession, WorkoutSet } from '@/lib/workout';

const cl = (done: boolean): WorkoutSet[] => (['activation', 'mini', 'mini'] as const).map((kind) => (done ? { kind, group: 1, weight: 0, reps: 8, done: true } : { kind, group: 1 }));
const ex = (id: string, name: string, sets: WorkoutSet[], extra: Partial<SessionExercise> = {}): SessionExercise => ({ exerciseId: id, name, cues: [], sets, logStyle: 'weight-reps', ...extra });
const paused: WorkoutSession = {
  id: 'd1', status: 'paused', templateName: 'Travel D', date: new Date('2026-11-04T06:40:00'),
  segments: [{ start: new Date('2026-11-04T06:40:00'), end: new Date('2026-11-04T07:17:00') }],
  exercises: [
    ex('pull', 'Pull-up', cl(true), { supersetGroup: 'C', pairPosition: 1 }),
    ex('crunch', 'Kneeling Cable Crunch', cl(false), { supersetGroup: 'C', pairPosition: 2 }),
    ex('push', 'Deficit Push-up', cl(false)),
    ex('skull', 'Skull Crusher', cl(false), { supersetGroup: 'E', pairPosition: 1 }),
    ex('lat', 'DB Lateral Raise', [...cl(false), ...cl(false).map((x) => ({ ...x, group: 2 })), { kind: 'drop', group: 2 }], { supersetGroup: 'E', pairPosition: 2 }),
    ex('hammer', 'DB Hammer Curl', cl(true), { supersetGroup: 'E', pairPosition: 3 }),
    ex('face', 'Rope Face Pull', cl(false)),
  ],
  createdAt: new Date(), updatedAt: new Date(),
};

describe('PausedSessionCard', () => {
  it('says what to resume and how many steps are left, in the template order', async () => {
    const onResume = jest.fn();
    const { getByTestId, getByText } = await render(<PausedSessionCard session={paused} boundary={MIDNIGHT} onResume={onResume} />);
    expect(getByText(/Resume Travel D — 6 exercises left/)).toBeTruthy();
    fireEvent.press(getByTestId('paused-session-d1'));
    expect(onResume).toHaveBeenCalled();
  });
});

describe('history line for a kg row', () => {
  it('reads in kg, with the pound equivalent as a secondary label', () => {
    const row = ex('row', 'Seated Cable Row', [{ kind: 'activation', group: 1, weight: kgToLb(40), reps: 9 }], { loadUnit: 'kg' });
    expect(setLine(row, 'weight-reps', 'us')).toBe('40×9   kg · 40 kg (88.2 lb)');
    const home = ex('row', 'Row', [{ kind: 'activation', group: 1, weight: 135, reps: 9 }]);
    expect(setLine(home, 'weight-reps', 'us')).toBe('135×9');
  });
  it('a set reads in the unit it was typed in: 12 kg is "12 kg (26.5 lb)", never "12.0 kg"', () => {
    const rdl = ex('rdl', 'DB RDL', [{ kind: 'working', weight: kgToLb(12), reps: 8, unit: 'kg' }]);
    expect(setLine(rdl, 'weight-reps', 'us')).toBe('12×8   kg · 12 kg (26.5 lb)');
    const lb = ex('c', 'Curl', [{ kind: 'working', weight: 25, reps: 10, unit: 'lb' }]);
    expect(setLine(lb, 'weight-reps', 'metric')).toBe('25×10   lb · 25 lb (11.3 kg)');
  });
});
