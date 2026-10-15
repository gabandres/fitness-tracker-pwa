jest.mock('@/lib/firebase', () => ({ functions: {} }));
jest.mock('firebase/functions', () => ({ httpsCallable: jest.fn() }));
jest.mock('@/lib/session-restore', () => ({ clearStoredSession: jest.fn() }));

import { isDeadSessionError, runAccountDeletion } from '@/lib/deleteAccount';

/**
 * Account deletion, as a sequence (audit 2026-10-15).
 *
 * The server erases `users/{uid}` before the client signs out. Without a
 * "deleting" state raised FIRST, the profile listener confirmed "no profile"
 * and the gate sent the still-signed-in user to onboarding, and sign-out's
 * analytics flush wrote a usage row for the account just erased. A failure
 * that killed the token left the user signed in to an account that no longer
 * answers.
 */
function steps(overrides: Partial<Parameters<typeof runAccountDeletion>[0]> = {}) {
  const calls: string[] = [];
  const s = {
    begin: jest.fn(() => calls.push('begin')),
    erase: jest.fn(async () => {
      calls.push('erase');
    }),
    signOut: jest.fn(async () => {
      calls.push('signOut');
    }),
    forceSignOut: jest.fn(async () => {
      calls.push('forceSignOut');
    }),
    abort: jest.fn(() => calls.push('abort')),
    ...overrides,
  };
  return { s, calls };
}

it('raises the deleting state before the erase, and signs out after it', async () => {
  const { s, calls } = steps();
  await expect(runAccountDeletion(s)).resolves.toBe('deleted');
  expect(calls).toEqual(['begin', 'erase', 'signOut']);
});

it('an ordinary failure aborts, keeps the session, and rethrows', async () => {
  const err = { code: 'functions/internal' };
  const { s, calls } = steps({ erase: jest.fn().mockRejectedValue(err) });
  await expect(runAccountDeletion(s)).rejects.toBe(err);
  expect(calls).toEqual(['begin', 'abort']);
  expect(s.signOut).not.toHaveBeenCalled();
});

it.each(['auth/user-token-expired', 'auth/user-not-found', 'functions/unauthenticated'])(
  'a failure that killed the session (%s) signs out instead of stranding the user',
  async (code) => {
    const { s, calls } = steps({ erase: jest.fn().mockRejectedValue({ code }) });
    await expect(runAccountDeletion(s)).resolves.toBe('signed-out');
    expect(calls).toEqual(['begin', 'signOut']);
    expect(s.abort).not.toHaveBeenCalled();
  },
);

it('falls back to dropping the Firebase session when the full sign-out throws', async () => {
  const { s } = steps({ signOut: jest.fn().mockRejectedValue(new Error('widget')) });
  await expect(runAccountDeletion(s)).resolves.toBe('deleted');
  expect(s.forceSignOut).toHaveBeenCalled();
});

it('isDeadSessionError ignores ordinary failures', () => {
  expect(isDeadSessionError({ code: 'functions/internal' })).toBe(false);
  expect(isDeadSessionError({ code: 'functions/unavailable' })).toBe(false);
  // A missing/misrouted callable (404): the account is intact, so no sign-out.
  expect(isDeadSessionError({ code: 'functions/not-found' })).toBe(false);
  expect(isDeadSessionError(new Error('network'))).toBe(false);
  expect(isDeadSessionError(null)).toBe(false);
});
