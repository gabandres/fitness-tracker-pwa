// The module's write half pulls Firestore in; the helper under test is pure.
jest.mock('@/lib/firebase', () => ({ db: {} }));
jest.mock('firebase/firestore', () => ({ Timestamp: { now: () => 0 }, addDoc: jest.fn(), collection: jest.fn() }));

import { FEEDBACK_LOCALE_MAX_LENGTH, feedbackLocaleTag } from '@/lib/feedback';

/**
 * `firestore.rules` caps `feedback.locale` at 20 chars. A resolved device
 * locale can be far longer (`zh-Hant-TW-u-ca-chinese-nu-hanidec`), and one
 * over-long tag rejected the WHOLE report — the reporter's message included.
 */
it('reduces a tag to language-region', () => {
  expect(feedbackLocaleTag('pt-BR')).toBe('pt-BR');
  expect(feedbackLocaleTag('es-PR')).toBe('es-PR');
  expect(feedbackLocaleTag('en')).toBe('en');
  expect(feedbackLocaleTag('en_US')).toBe('en-US');
  expect(feedbackLocaleTag('es-419')).toBe('es-419');
});

it('drops script, variant and extension subtags', () => {
  expect(feedbackLocaleTag('zh-Hant-TW')).toBe('zh-TW');
  expect(feedbackLocaleTag('zh-Hant-TW-u-ca-chinese-nu-hanidec')).toBe('zh-TW');
  expect(feedbackLocaleTag('en-US-u-ca-gregory-hc-h12')).toBe('en-US');
  expect(feedbackLocaleTag('sr-Latn')).toBe('sr');
  expect(feedbackLocaleTag('de-CH-1996')).toBe('de-CH');
});

it('never exceeds the rules cap and falls back to en for junk', () => {
  expect(feedbackLocaleTag('x'.repeat(40)).length).toBeLessThanOrEqual(FEEDBACK_LOCALE_MAX_LENGTH);
  expect(feedbackLocaleTag('')).toBe('en');
  expect(feedbackLocaleTag(undefined)).toBe('en');
  expect(feedbackLocaleTag('123-US')).toBe('en');
});
