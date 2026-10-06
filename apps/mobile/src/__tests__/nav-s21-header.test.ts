import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DETAIL_ROUTES, HEADER_ROUTES } from '@/lib/root-stack';

/**
 * One native header for every pushed detail screen (S21-1, S21-9).
 *
 * Settings, the two targets screens and Feedback were hidden tabs with a
 * drawn chevron; Coach and Milestones drew their own too; Connected apps had a
 * native large title. The root layout now gives all of them the same system
 * header — back button, swipe-back, title — so this pins that no screen draws
 * a second one under it, and that keyboard screens measure their offset now
 * that they no longer start at the top of the window.
 */
const APP = join(__dirname, '..', 'app');
const read = (name: string) => readFileSync(join(APP, `${name}.tsx`), 'utf8');

describe('the shared detail header', () => {
  const root = readFileSync(join(APP, '_layout.tsx'), 'utf8');

  it('every header route is a detail route', () => {
    for (const name of HEADER_ROUTES) expect(DETAIL_ROUTES.has(name)).toBe(true);
  });

  it.each([...HEADER_ROUTES])('%s gets the shared header from the root layout', (name) => {
    expect(root).toContain(`<Stack.Screen name="${name}" options={headerOptions('${name}')} />`);
    expect(root).toMatch(new RegExp(`name: '${name}', titleKey: '`));
  });

  it.each([...HEADER_ROUTES])('%s draws no header row or chevron of its own', (name) => {
    const src = read(name);
    expect(src).not.toMatch(/styles\.header\b/);
    expect(src).not.toMatch(/edges=\{\[\s*'top'/);
    // Connected apps keeps ONE drawn chevron: its cold-open escape to Settings.
    if (name !== 'connected-apps') expect(src).not.toMatch(/chevron-back|chevron\.left/);
  });

  it.each(['coach', 'feedback', 'daily-targets', 'refine-targets'])(
    '%s measures its keyboard offset under the header',
    (name) => {
      expect(read(name)).toMatch(/<KeyboardAvoidingView[^>]*\bautomaticOffset\b/);
    },
  );

  it('the header keeps the brand face without a weight (ADR-0014)', () => {
    expect(root).toMatch(/headerTitleStyle: \{ color: colors\.ink, fontFamily: type\.heading \}/);
  });

  it('the hidden tab routes are gone from the tab layout', () => {
    const tabs = readFileSync(join(APP, '(app)', '_layout.tsx'), 'utf8');
    expect(tabs).not.toMatch(/href: null/);
  });
});
