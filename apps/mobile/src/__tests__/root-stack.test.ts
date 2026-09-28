import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { APP_ROUTE, DETAIL_ROUTES, reconcileRootRoutes } from '@/lib/root-stack';

/**
 * Coach and Milestones are root stack routes pushed over the tabs
 * (UX_AUDIT S18-14), and the root layout reconciles the stack so the
 * `replace()`-based navigation written for `<Slot>` keeps working on it.
 *
 * Two halves. The pure half pins `reconcileRootRoutes`, which is the whole
 * reason a native stack at the root is safe here: without it a tour dismissal
 * would leave two mounted tab shells and a swipe-back from Today into Today.
 * The source half is the route-resolution check: every `/coach` and
 * `/milestones` href in the app must land on a file at the root of
 * `src/app`, and neither may still be declared as a tab.
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

describe('coach and milestones resolve as root stack routes', () => {
  it.each([...DETAIL_ROUTES])('%s.tsx lives at the root of src/app, not in (app)', (name) => {
    expect(existsSync(join(APP_DIR, `${name}.tsx`))).toBe(true);
    expect(existsSync(join(APP_DIR, '(app)', `${name}.tsx`))).toBe(false);
  });

  it('every href to a detail route points at a file that exists', () => {
    const hrefs = new Set<string>();
    for (const file of sourceFiles(SRC)) {
      const src = readFileSync(file, 'utf8');
      for (const m of src.matchAll(/['"`]\/(coach|milestones)(?:[?'"`])/g)) hrefs.add(m[1]);
    }
    // The links exist — this is not vacuously green because nothing links.
    expect([...hrefs].sort()).toEqual(['coach', 'milestones']);
    for (const name of hrefs) expect(existsSync(join(APP_DIR, `${name}.tsx`))).toBe(true);
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

  it('neither screen reserves FAB_BAND any more — nothing floats over a stack route', () => {
    for (const name of DETAIL_ROUTES) {
      const src = readFileSync(join(APP_DIR, `${name}.tsx`), 'utf8');
      // Usage and import, not mentions — the comment that says why it left is fine.
      expect(src).not.toMatch(/paddingBottom:\s*FAB_BAND/);
      expect(src).not.toMatch(/import\s*\{[^}]*\bFAB_BAND\b/);
    }
  });

  it('the Maestro flows still find the back buttons they tap', () => {
    // 07-coach / 17-coach-ask leave the screen through `coach-back`; the
    // capture flows open `ignia://milestones`. Both testIDs must survive the
    // move — these drive real devices, and a rename here is a red suite there.
    expect(readFileSync(join(APP_DIR, 'coach.tsx'), 'utf8')).toMatch(/testID="coach-back"/);
    expect(readFileSync(join(APP_DIR, 'milestones.tsx'), 'utf8')).toMatch(/testID="milestones-back"/);
  });
});
