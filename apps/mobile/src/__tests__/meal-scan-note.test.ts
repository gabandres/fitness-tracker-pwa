/**
 * The wire half of ADR-0029 items 1 and 2.
 *
 * Two properties, both about what the CLIENT sends and reads rather than about
 * what the model does with it:
 *
 * 1. **A note is sent only when there is one.** An empty note must be an
 *    omitted key, not a blank string. The server fences a present note into the
 *    prompt, so sending `""` would append an empty fenced block to every scan —
 *    tokens spent to say nothing, on a feature whose entire cost argument is
 *    "~5% more tokens".
 * 2. **`measured` survives the adapter, and only as `true`.** The review screen
 *    renders a weighed portion differently from a guessed one (item 4), so the
 *    flag has to arrive; and it must never arrive as `false`, or a client that
 *    predates the field and one looking at an estimate stop agreeing.
 *
 * `mealScan.ts` builds the callable at module scope, so the mock stands in for
 * Firebase the same way `scan-error-message.test.ts` does — except here the
 * mock also RECORDS its payload, which is the thing under test.
 */

const sent: unknown[] = [];
const response = {
  data: {
    items: [
      { name: 'white rice', grams: 180, calories: 234, protein: 4.9, carbs: 50, fat: 0.5, confidence: 0.9, source: 'usda', fdcId: '1', matchedDescription: 'Rice, white, cooked', measured: true },
      { name: 'black beans', grams: 90, calories: 118, protein: 7.9, carbs: 21, fat: 0.5, confidence: 0.9, source: 'usda', fdcId: '2', matchedDescription: 'Beans, black, cooked' },
    ],
    calories: 352, protein: 12.8, carbs: 71, fat: 1,
    description: 'rice and beans', confidence: 'high', photosRemaining: 2,
  },
};

jest.mock('firebase/functions', () => ({
  httpsCallable: () => async (payload: unknown) => {
    sent.push(payload);
    return response;
  },
}));
jest.mock('@/lib/firebase', () => ({ functions: {} }));

import { analyzeMealPhoto } from '@/lib/mealScan';

const lastPayload = () => sent[sent.length - 1] as Record<string, unknown>;

beforeEach(() => {
  sent.length = 0;
});

describe('analyzeMealPhoto — the note (ADR-0029 item 1)', () => {
  it('omits the key entirely when no note was typed', async () => {
    await analyzeMealPhoto('b64', 'en');
    expect('note' in lastPayload()).toBe(false);
  });

  it('omits it for a whitespace-only note rather than sending a blank one', async () => {
    await analyzeMealPhoto('b64', 'en', '   \n  ');
    expect('note' in lastPayload()).toBe(false);
  });

  it('sends a real note, trimmed', async () => {
    await analyzeMealPhoto('b64', 'en', '  half a cup of rice  ');
    expect(lastPayload().note).toBe('half a cup of rice');
  });

  it('still sends the photo and locale unchanged', async () => {
    await analyzeMealPhoto('b64', 'es-PR', 'arroz');
    expect(lastPayload()).toMatchObject({ photoBase64: 'b64', locale: 'es-PR' });
  });
});

describe('analyzeMealPhoto — measured grams (ADR-0029 item 2)', () => {
  it('carries `measured` through to the item the review screen renders', async () => {
    const scan = await analyzeMealPhoto('b64', 'en');
    expect(scan.items[0].measured).toBe(true);
  });

  it('leaves it ABSENT on an ordinary estimate, never false', async () => {
    // Absent and `false` are not interchangeable here: absent is also what a
    // response from a server predating this field looks like, and the review
    // screen must treat those two identically.
    const scan = await analyzeMealPhoto('b64', 'en');
    expect(scan.items[1].measured).toBeUndefined();
    expect('measured' in scan.items[1]).toBe(false);
  });
});
