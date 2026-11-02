jest.mock('@/lib/auth', () => ({ useAuth: () => ({ user: null, profile: null, isAdmin: false }) }));
import { MIDNIGHT, type TravelPlanEntry } from '@macrolog/core';
import { renderWithProviders as render } from '@/test-utils';
import { TravelPlanCard } from '@/components/TravelPlanCard';
import type { WorkoutSession } from '@/lib/workout';

const PLAN: TravelPlanEntry[] = [
  { from: '2026-11-02', to: '2026-11-02', kind: 'rest', label: 'Rest', note: 'planned rest day' },
  { from: '2026-11-03', to: '2026-11-03', kind: 'session', label: 'Travel C', templateId: 'c', note: 'calibration session' },
  { from: '2026-11-04', to: '2026-11-05', kind: 'session', label: 'Travel D', templateId: 'd' },
];
const done = (day: string, templateId: string) => ({
  status: 'completed', date: new Date(`${day}T12:00:00`), templateId, exercises: [],
}) as unknown as WorkoutSession;

describe('TravelPlanCard', () => {
  it('shows the week and the next planned session on the rest day', async () => {
    const { getByTestId, getByText } = await render(<TravelPlanCard plan={PLAN} todayKey="2026-11-02" sessions={[]} boundary={MIDNIGHT} />);
    expect(getByText('This week')).toBeTruthy();
    expect(getByTestId('travel-plan-next').props.children).toContain('Travel C');
    expect(getByTestId('travel-plan-2026-11-02-rest')).toBeTruthy();
    expect(getByTestId('travel-plan-2026-11-03-upcoming')).toBeTruthy();
  });
  it('marks a trained session done and a passed one skipped, never missed', async () => {
    const { getByTestId, queryByText } = await render(<TravelPlanCard plan={PLAN} todayKey="2026-11-06" sessions={[done('2026-11-03', 'c')]} boundary={MIDNIGHT} />);
    expect(getByTestId('travel-plan-2026-11-03-done')).toBeTruthy();
    expect(getByTestId('travel-plan-2026-11-04-skipped')).toBeTruthy();
    expect(queryByText(/missed/i)).toBeNull();
  });
});
