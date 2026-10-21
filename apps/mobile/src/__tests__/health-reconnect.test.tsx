/**
 * The Today prompt to reconnect Apple Health (owner, 2026-10-20: "the
 * reconnect should be mandatory to all who have Apple Watch, or at least
 * prompt them"). It cannot be mandatory — iOS lets a user decline the sheet
 * and never reports a read grant — so it is a Nudge that comes back.
 */
import { act, fireEvent, renderWithProviders as render } from '@/test-utils';
import { HealthReconnectCard } from '@/components/HealthReconnectCard';
import { RECONNECT_SNOOZE_MS, shouldPromptReconnect } from '@/lib/health-reconnect-rule';

jest.mock('@/lib/auth', () => ({ useAuth: () => ({ user: null, profile: null }) }));

const base = { ios: true, connected: true, needsReauth: true, sawWatch: true, snoozedUntil: null, now: 1_000 };

describe('who is prompted', () => {
  it('an iOS user with Apple Watch workouts, connected under the pre-HR scope', () => {
    expect(shouldPromptReconnect(base)).toBe(true);
  });
  it('not on Android, not when disconnected, not once reconnected, not without a Watch', () => {
    expect(shouldPromptReconnect({ ...base, ios: false })).toBe(false);
    expect(shouldPromptReconnect({ ...base, connected: false })).toBe(false);
    expect(shouldPromptReconnect({ ...base, needsReauth: false })).toBe(false);
    expect(shouldPromptReconnect({ ...base, sawWatch: false })).toBe(false);
  });
  it('"Later" hides it for three days, then it comes back', () => {
    expect(shouldPromptReconnect({ ...base, snoozedUntil: 1_000 + RECONNECT_SNOOZE_MS })).toBe(false);
    expect(shouldPromptReconnect({ ...base, snoozedUntil: 1_000 + RECONNECT_SNOOZE_MS, now: 2_000 + RECONNECT_SNOOZE_MS })).toBe(true);
  });
});

describe('HealthReconnectCard', () => {
  const props = (visible: boolean) => ({ visible, busy: false, reconnect: jest.fn(async () => {}), later: jest.fn(async () => {}) });

  it('Reconnect opens the permission flow; Later snoozes', async () => {
    const r = props(true);
    const view = await render(<HealthReconnectCard reconnect={r} />);
    expect(view.getByText('Reconnect Apple Health')).toBeTruthy();
    await act(async () => { await fireEvent.press(view.getByTestId('health-reconnect-go')); });
    expect(r.reconnect).toHaveBeenCalledTimes(1);
    await act(async () => { await fireEvent.press(view.getByTestId('health-reconnect-later')); });
    expect(r.later).toHaveBeenCalledTimes(1);
  });

  it('renders nothing when not due, or when another Nudge holds the slot', async () => {
    expect((await render(<HealthReconnectCard reconnect={props(false)} />)).queryByTestId('health-reconnect')).toBeNull();
    expect((await render(<HealthReconnectCard reconnect={props(true)} suppressed />)).queryByTestId('health-reconnect')).toBeNull();
  });
});
