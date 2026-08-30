// `@/i18n` pulls in `@/lib/auth`, which imports firebase/auth — untranspiled
// ESM that jest cannot parse. Every screen test here stubs it for that reason.
jest.mock('@/lib/auth', () => ({
  useAuth: () => ({ user: { uid: 'u1' }, profile: null }),
}));

// `renderWithProviders`, not RNTL's bare `render`: StubLabel reads the palette
// through `useThemedStyles`, which throws outside a <ThemeProvider>.
import { renderWithProviders as render } from '@/test-utils';
import { StubLabel } from '@/components/StubLabel';
import { LOCALES, LOCALE_DEFS } from '@/i18n/registry';

/**
 * The stub row's leading term must stay scannable, in every locale.
 *
 * #115: 38 of 43 accounts (88%) have neither a Sleep card nor a Fasting card,
 * so for almost everyone the whole feature is one line of muted text — and with
 * both cards absent the section header does not render either. A user sent to
 * Trends to "look at fasting" had nothing on screen that named it.
 *
 * The fix derives the head from the copy rather than adding a key, so what this
 * suite really guards is the assumption that makes that safe: **every stub
 * string starts with the feature name and a `·` separator.** A locale that
 * loses it degrades silently to the old all-muted line, which is exactly the
 * invisible regression #115 was about.
 */

const STUB_KEYS = [
  'trends.sleepEmpty',
  'trends.sleepEmptyOura',
  'trends.sleepEmptyHealth',
  'trends.fastingEmpty',
  'trends.fastingEmptyRunning',
  'trends.fastingEmptyProgress',
] as const;

describe('StubLabel', () => {
  // `render` is async in this RNTL version — a synchronous destructure yields a
  // Promise and every query on it is undefined.
  it('splits the feature name from the explanation', async () => {
    const { getByTestId } = await render(
      <StubLabel text="Fasting · start one on Today" testID="s" />,
    );
    // Both halves render, and they render as one line of text rather than two
    // stacked elements — the row is deliberately a single line.
    expect(getByTestId('s')).toHaveTextContent('Fasting · start one on Today');
  });

  it('renders a string with no separator rather than throwing', async () => {
    const { getByTestId } = await render(<StubLabel text="No separator here" testID="s" />);
    expect(getByTestId('s')).toHaveTextContent('No separator here');
  });

  it('does not mistake an em dash inside the explanation for the separator', async () => {
    // Every real string contains an em dash AFTER the separator. Splitting on
    // the wrong one would put half the sentence in the emphasised head.
    const { getByTestId } = await render(
      <StubLabel text="Sleep · connected to Oura — no nights yet" testID="s" />,
    );
    expect(getByTestId('s')).toHaveTextContent('Sleep · connected to Oura — no nights yet');
  });

  describe('every stub string carries the separator', () => {
    it.each(LOCALES)('%s', (locale) => {
      const dict = LOCALE_DEFS[locale].dict;
      const missing = STUB_KEYS.filter((k) => !dict[k].includes(' · '));
      expect(missing).toEqual([]);
    });
  });

  it('puts the feature name first, not buried mid-sentence', () => {
    // The head must be short — it is a label, not a clause. A locale that
    // wrote "In the last two weeks · …" would emphasise the wrong thing.
    for (const locale of LOCALES) {
      const dict = LOCALE_DEFS[locale].dict;
      for (const key of STUB_KEYS) {
        const head = dict[key].slice(0, dict[key].indexOf(' · '));
        expect(head.split(/\s+/).length).toBeLessThanOrEqual(2);
      }
    }
  });
});
