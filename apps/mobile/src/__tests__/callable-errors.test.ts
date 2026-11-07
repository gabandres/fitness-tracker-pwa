/**
 * IGNIA-MOBILE-13 (2026-11-07): a new user signed up, switched to Mail while
 * `sendVerificationEmail` was in flight, and came back to "we couldn't send
 * the link". The function had sent it. These cases pin how a lost response
 * is told apart from a real refusal, and that a lost one is retried once.
 */
import {
  isLostCallableResponse,
  isRateLimited,
  sendWithLostResponseRetry,
} from '../lib/callable-errors';

// The exact shape Sentry recorded.
const lost = Object.assign(new Error('internal'), { code: 'functions/internal', message: 'internal' });
const serverInternal = Object.assign(new Error('Could not send the verification email.'), {
  code: 'functions/internal',
  details: { code: 'VERIFY_EMAIL_FAILED' },
});
const rateLimited = Object.assign(new Error('A verification email was just sent.'), {
  code: 'functions/resource-exhausted',
  details: { code: 'RATE_LIMITED' },
});

describe('isLostCallableResponse', () => {
  it('matches the bare internal the SDK reports for a failed fetch', () => {
    expect(isLostCallableResponse(lost)).toBe(true);
  });
  it('matches unavailable and deadline-exceeded', () => {
    expect(isLostCallableResponse({ code: 'functions/unavailable' })).toBe(true);
    expect(isLostCallableResponse({ code: 'functions/deadline-exceeded' })).toBe(true);
  });
  it('does not match an internal our server threw (it carries details)', () => {
    expect(isLostCallableResponse(serverInternal)).toBe(false);
  });
  it('does not match typed rejections or junk', () => {
    expect(isLostCallableResponse(rateLimited)).toBe(false);
    expect(isLostCallableResponse({ code: 'functions/unauthenticated' })).toBe(false);
    expect(isLostCallableResponse(null)).toBe(false);
    expect(isLostCallableResponse('internal')).toBe(false);
  });
});

describe('isRateLimited', () => {
  it('reads details.code', () => {
    expect(isRateLimited(rateLimited)).toBe(true);
    expect(isRateLimited(serverInternal)).toBe(false);
    expect(isRateLimited(undefined)).toBe(false);
  });
});

describe('sendWithLostResponseRetry', () => {
  it('sends once when the first call succeeds', async () => {
    const send = jest.fn().mockResolvedValue({ ok: true });
    await sendWithLostResponseRetry(send);
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('retries once on a lost response and succeeds', async () => {
    const send = jest.fn().mockRejectedValueOnce(lost).mockResolvedValueOnce({ ok: true });
    const onRetry = jest.fn();
    await sendWithLostResponseRetry(send, onRetry);
    expect(send).toHaveBeenCalledTimes(2);
    expect(onRetry).toHaveBeenCalledWith(lost);
  });

  it('treats RATE_LIMITED on the retry as sent (the first call reached the server)', async () => {
    const send = jest.fn().mockRejectedValueOnce(lost).mockRejectedValueOnce(rateLimited);
    await expect(sendWithLostResponseRetry(send)).resolves.toBeUndefined();
  });

  it('rethrows a real failure on the retry', async () => {
    const send = jest.fn().mockRejectedValueOnce(lost).mockRejectedValueOnce(serverInternal);
    await expect(sendWithLostResponseRetry(send)).rejects.toBe(serverInternal);
  });

  it('never retries a real server failure', async () => {
    const send = jest.fn().mockRejectedValue(serverInternal);
    await expect(sendWithLostResponseRetry(send)).rejects.toBe(serverInternal);
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('rethrows RATE_LIMITED on the FIRST call (the resend screen has its own copy for it)', async () => {
    const send = jest.fn().mockRejectedValue(rateLimited);
    await expect(sendWithLostResponseRetry(send)).rejects.toBe(rateLimited);
    expect(send).toHaveBeenCalledTimes(1);
  });
});
