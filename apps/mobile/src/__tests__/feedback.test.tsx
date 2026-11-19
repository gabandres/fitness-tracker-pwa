import { act, fireEvent, renderWithProviders as render } from '@/test-utils';

/**
 * The in-app feedback composer.
 *
 * The reporter's point was social, not technical — people who would not
 * message the owner directly will leave a note inside the app (UX_AUDIT,
 * Abdiel Medina, 2026-08-21). Two consequences are pinned here because they
 * are exactly what a later "tidy-up" would undo:
 *
 *  - the category chooser is **optional and clearable**. A required chip in
 *    front of a text box turns "tell me what you think" into a form;
 *  - the confirmation **replaces** the composer. A form still on screen after
 *    a successful send invites a second copy of the same report.
 */
const mockSendFeedback = jest.fn().mockResolvedValue(undefined);

// The discard guard (A31): capture what the screen hands `usePreventRemove`.
const mockGuard: { on: boolean; cb: ((e: { data: { action: unknown } }) => void) | null } = { on: false, cb: null };
const mockDispatch = jest.fn();
const mockConfirm = jest.fn();
jest.mock('@/components/ConfirmSheet', () => ({
  ConfirmHost: () => null,
  confirm: (o: unknown) => mockConfirm(o),
}));
jest.mock('expo-router/react-navigation', () => ({
  useNavigation: () => ({ dispatch: mockDispatch }),
  usePreventRemove: (on: boolean, cb: (e: { data: { action: unknown } }) => void) => {
    mockGuard.on = on;
    mockGuard.cb = cb;
  },
}));
jest.mock('expo-router', () => ({
  useRouter: () => ({ back: jest.fn(), push: jest.fn(), replace: jest.fn() }),
  usePathname: () => '/feedback',
}));

jest.mock('@/lib/auth', () => ({
  useAuth: () => ({ user: { uid: 'u1' }, profile: {} }),
}));

jest.mock('@/lib/feedback', () => ({
  FEEDBACK_MAX_LENGTH: 4000,
  sendFeedback: (...args: unknown[]) => mockSendFeedback(...args),
}));

import FeedbackScreen, { feedbackDirty } from '@/app/feedback';

beforeEach(() => mockSendFeedback.mockClear());

describe('Feedback composer', () => {
  it('sends with no category chosen', async () => {
    const { getByTestId } = await render(<FeedbackScreen />);
    await fireEvent.changeText(getByTestId('feedback-message'), 'the dial covers the result');
    await act(async () => {
      await fireEvent.press(getByTestId('feedback-send'));
    });
    expect(mockSendFeedback).toHaveBeenCalledWith('u1', {
      message: 'the dial covers the result',
      category: null,
    });
  });

  it('attaches a chosen category', async () => {
    const { getByTestId } = await render(<FeedbackScreen />);
    await fireEvent.press(getByTestId('feedback-cat-bug'));
    await fireEvent.changeText(getByTestId('feedback-message'), 'broken');
    await act(async () => {
      await fireEvent.press(getByTestId('feedback-send'));
    });
    expect(mockSendFeedback).toHaveBeenCalledWith('u1', { message: 'broken', category: 'bug' });
  });

  it('lets the chip be un-chosen', async () => {
    const { getByTestId } = await render(<FeedbackScreen />);
    await fireEvent.press(getByTestId('feedback-cat-idea'));
    await fireEvent.press(getByTestId('feedback-cat-idea'));
    await fireEvent.changeText(getByTestId('feedback-message'), 'never mind the label');
    await act(async () => {
      await fireEvent.press(getByTestId('feedback-send'));
    });
    expect(mockSendFeedback).toHaveBeenCalledWith('u1', {
      message: 'never mind the label',
      category: null,
    });
  });

  it('will not send an empty or whitespace-only message', async () => {
    const { getByTestId } = await render(<FeedbackScreen />);
    await act(async () => {
      await fireEvent.press(getByTestId('feedback-send'));
    });
    await fireEvent.changeText(getByTestId('feedback-message'), '   ');
    await act(async () => {
      await fireEvent.press(getByTestId('feedback-send'));
    });
    expect(mockSendFeedback).not.toHaveBeenCalled();
  });

  it('replaces the composer with a confirmation after a send', async () => {
    const { getByTestId, queryByTestId } = await render(<FeedbackScreen />);
    await fireEvent.changeText(getByTestId('feedback-message'), 'thanks');
    await act(async () => {
      await fireEvent.press(getByTestId('feedback-send'));
    });
    expect(getByTestId('feedback-sent')).toBeTruthy();
    expect(queryByTestId('feedback-message')).toBeNull();
  });
});

// ── A31: an unsent note is not dropped silently (2026-11-19) ──────────────
describe('discard guard', () => {
  it('feedbackDirty: only an unsent, non-blank note', () => {
    expect(feedbackDirty('', false)).toBe(false);
    expect(feedbackDirty('   ', false)).toBe(false);
    expect(feedbackDirty('broken', false)).toBe(true);
    expect(feedbackDirty('broken', true)).toBe(false);
  });

  it('guards a typed note, and stops guarding once it is sent', async () => {
    const { getByTestId } = await render(<FeedbackScreen />);
    expect(mockGuard.on).toBe(false);
    await fireEvent.changeText(getByTestId('feedback-message'), 'thanks');
    expect(mockGuard.on).toBe(true);
    mockConfirm.mockClear();
    mockGuard.cb?.({ data: { action: { type: 'GO_BACK' } } });
    expect(mockConfirm).toHaveBeenCalledWith(expect.objectContaining({ confirmText: 'Discard', cancelText: 'Keep editing' }));
    await act(async () => {
      await fireEvent.press(getByTestId('feedback-send'));
    });
    expect(mockGuard.on).toBe(false);
  });
});
