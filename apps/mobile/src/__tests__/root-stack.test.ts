import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { APP_ROUTE, DETAIL_ROUTES, reconcileRootRoutes } from '@/lib/root-stack';

/**
 * Coach, Milestones and History are root stack routes pushed over the tabs
 * (UX_AUDIT S18-14; History since the Today review's P1, 2026-10-04), and the
 * root layout reconciles the stack so the
 * `replace()`-based navigation written for `<Slot>` keeps working on it.
 *
 * Two halves. The pure half pins `reconcileRootRoutes`, which is the whole
 * reason a native stack at the root is safe here: without it a tour dismissal
 * would leave two mounted tab shells and a swipe-back from Today into Today.
 * The source half is the route-resolution check: every `/coach`,
 * `/milestones` and `/history` href in the app must land on a route at the
 * root of `src/app`, and none may still be declared as a tab.
 */

type R = { name: string; key: string };
const r = (name: string, key = name): R => ({ name, key });

describe('reconcileRootRoutes — the <Slot> contract on a native stack', () => {
  it('leaves a lone (app) alone', () => {
    expect(reconcileRootRoutes([r(APP_ROUTE)], 0)).toBeNull();
  });

  it('keeps (app) under a pushed detail route, so back has somewhere to go', () => {
    const routes = [r(APP_ROUTE), r('coach')];
    expect(reconcileRootRoutes(routes, 1)).toBeNull();
    // History is one of them now: Today's calendar icon pushes it.
    expect(DETAIL_ROUTES.has('history')).toBe(true);
    expect(reconcileRootRoutes([r(APP_ROUTE), r('history')], 1)).toBeNull();
  });

  it('keeps (app) under the tour, what\'s-new and a Settings-opened onboarding', () => {
    for (const name of ['tour', 'whats-new', 'onboarding']) {
      expect(reconcileRootRoutes([r(APP_ROUTE), r(name)], 1)).toBeNull();
    }
  });

  it('drops the stale (app) that replace("/(app)") leaves beneath the new one', () => {
    const stale = r(APP_ROUTE, 'app-1');
    const fresh = r(APP_ROUTE, 'app-2');
    const keep = reconcileRootRoutes([stale, fresh], 1);
    expect(keep).toEqual([fresh]);
    // By identity, not by copy: the caller hands these back to `resetRoot`,
    // and React Navigation keeps a screen mounted only while its key survives.
    expect(keep![0]).toBe(fresh);
  });

  it('keeps only the newest (app) under a detail route', () => {
    const stale = r(APP_ROUTE, 'app-1');
    const fresh = r(APP_ROUTE, 'app-2');
    const coach = r('coach');
    expect(reconcileRootRoutes([stale, fresh, coach], 2)).toEqual([fresh, coach]);
  });

  it('never keeps the app shell under the sign-in or verify-email screens', () => {
    const signIn = r('sign-in');
    expect(reconcileRootRoutes([r(APP_ROUTE), r('coach'), signIn], 2)).toEqual([signIn]);
    const verify = r('verify-email');
    expect(reconcileRootRoutes([r(APP_ROUTE), verify], 1)).toEqual([verify]);
    expect(reconcileRootRoutes([signIn], 0)).toBeNull();
  });

  it('Settings → Daily targets: back lands on Settings, not Today (S21-1)', () => {
    // As hidden tabs, both lived inside `(app)` and back went to the tab
    // navigator's first route. As root stack routes they stack, and the
    // reconcile leaves the chain alone — so a pop returns to Settings.
    for (const name of ['settings', 'daily-targets', 'refine-targets', 'feedback']) {
      expect(DETAIL_ROUTES.has(name)).toBe(true);
    }
    expect(reconcileRootRoutes([r(APP_ROUTE), r('settings'), r('daily-targets')], 2)).toBeNull();
    expect(reconcileRootRoutes([r(APP_ROUTE), r('settings'), r('refine-targets')], 2)).toBeNull();
  });

  it('keeps one copy of a pushed route: Redo setup returning to Settings (rule 3)', () => {
    // Settings → Redo setup pushes onboarding; onboarding leaves with
    // replace('/settings'), which swaps itself for a SECOND Settings.
    const first = r('settings', 'settings-1');
    const second = r('settings', 'settings-2');
    const app = r(APP_ROUTE);
    expect(reconcileRootRoutes([app, first, second], 2)).toEqual([app, second]);
    // What's New → Feedback is a replace too, and never duplicates anything.
    expect(reconcileRootRoutes([app, r('feedback')], 1)).toBeNull();
    // Everything between the two copies goes with the stale one.
    expect(reconcileRootRoutes([app, first, r('daily-targets'), second], 3)).toEqual([app, second]);
  });

  it('accepts a cold deep link straight onto a detail route', () => {
    // `ignia://coach` with nothing beneath it: nothing to fix, the screen's own
    // back button falls back to `replace('/(app)')`.
    expect(reconcileRootRoutes([r('coach')], 0)).toBeNull();
  });

  it('is a no-op on an empty state', () => {
    expect(reconcileRootRoutes([], 0)).toBeNull();
  });
});

const SRC = join(__dirname, '..');
const APP_DIR = join(SRC, 'app');

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (entry === '__tests__') continue;
      sourceFiles(full, out);
    } else if (/\.tsx?$/.test(entry)) {
      out.push(full);
    }
  }
  return out;
}

/** A root route is a file (`coach.tsx`) or a directory with a layout
 *  (`history/_layout.tsx`, which carries its own stack). */
const routeAtRoot = (dir: string, name: string) =>
  existsSync(join(dir, `${name}.tsx`)) || existsSync(join(dir, name, '_layout.tsx'));

/** The screen files a detail route draws — for the source checks below. */
const screenFiles = (name: string): string[] =>
  existsSync(join(APP_DIR, `${name}.tsx`))
    ? [join(APP_DIR, `${name}.tsx`)]
    : readdirSync(join(APP_DIR, name))
        .filter((f) => f.endsWith('.tsx') && f !== '_layout.tsx')
        .map((f) => join(APP_DIR, name, f));

describe('detail routes resolve as root stack routes', () => {
  it.each([...DETAIL_ROUTES])('%s lives at the root of src/app, not in (app)', (name) => {
    expect(routeAtRoot(APP_DIR, name)).toBe(true);
    expect(routeAtRoot(join(APP_DIR, '(app)'), name)).toBe(false);
  });

  it('every href to a detail route points at a route that exists', () => {
    const hrefs = new Set<string>();
    for (const file of sourceFiles(SRC)) {
      const src = readFileSync(file, 'utf8');
      for (const m of src.matchAll(/['"`]\/([a-z-]+)(?:[?/'"`])/g)) {
        if (DETAIL_ROUTES.has(m[1])) hrefs.add(m[1]);
      }
    }
    // The links exist — this is not vacuously green because nothing links.
    expect([...hrefs].sort()).toEqual([...DETAIL_ROUTES].sort());
    for (const name of hrefs) expect(routeAtRoot(APP_DIR, name)).toBe(true);
  });

  it('the tab layout no longer declares them, and the root stack does', () => {
    const tabs = readFileSync(join(APP_DIR, '(app)', '_layout.tsx'), 'utf8');
    for (const name of DETAIL_ROUTES) {
      expect(tabs).not.toMatch(new RegExp(`<Tabs\\.Screen\\s+name="${name}"`));
    }
    const root = readFileSync(join(APP_DIR, '_layout.tsx'), 'utf8');
    expect(root).toMatch(/<Stack\b/);
    expect(root).not.toMatch(/<Slot\s*\/>/);
    for (const name of DETAIL_ROUTES) {
      expect(root).toMatch(new RegExp(`<Stack\\.Screen\\s+name="${name}"`));
    }
  });

  it('no detail screen reserves FAB_BAND any more — nothing floats over a stack route', () => {
    for (const name of DETAIL_ROUTES) {
      for (const file of screenFiles(name)) {
        const src = readFileSync(file, 'utf8');
        // Usage and import, not mentions — the comment that says why it left is fine.
        expect(src).not.toMatch(/paddingBottom:\s*FAB_BAND/);
        expect(src).not.toMatch(/import\s*\{[^}]*\bFAB_BAND\b/);
      }
    }
  });

  it('History leads with a back button, and puts the calendar under a cold-opened day', () => {
    // As a hidden tab it had no back at all (review P1). The calendar's back
    // falls through to Today when nothing is beneath it (a cold deep link).
    const calendar = readFileSync(join(APP_DIR, 'history', 'index.tsx'), 'utf8');
    expect(calendar).toMatch(/testID="history-back"/);
    expect(calendar).toMatch(/router\.canGoBack\(\) \? router\.back\(\) : router\.replace\('\/\(app\)'\)/);
    expect(readFileSync(join(APP_DIR, 'history', '_layout.tsx'), 'utf8')).toMatch(/initialRouteName: 'index'/);
  });

  it('a cold-opened detail screen still has a testID\'d way back', () => {
    // The capture flows open `ignia://milestones` cold and leave through
    // `milestones-back`. Since S21-9 the back button is the native header's
    // own (no testID) when there is something beneath; the cold-open escape
    // the root layout draws keeps the old IDs. Flows that push a screen and
    // then tap `coach-back` / `settings-back` / `refine-back` must use the
    // system back now (Maestro `back`, or the "Back" label on iOS).
    const root = readFileSync(join(APP_DIR, '_layout.tsx'), 'utf8');
    for (const id of ['coach-back', 'milestones-back', 'settings-back', 'refine-back']) {
      expect(root).toContain(`backTestID: '${id}'`);
    }
  });
});
