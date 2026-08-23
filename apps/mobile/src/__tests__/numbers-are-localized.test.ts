/**
 * No bare `toLocaleString()` / `toLocaleDateString()` / `toLocaleTimeString()`
 * in app source.
 *
 * A no-argument call formats with the **device** locale, not the language the
 * user picked in Ignia. `lib/date-format.ts` was written when that was found
 * for dates — a Spanish-speaking user on an English phone read "Tuesday, July
 * 28" under "Hoy", and it reached the Spanish App Store screenshots before
 * anyone noticed.
 *
 * The identical bug was sitting in every NUMBER in the app and could not be
 * seen, because the two shipped locales were `en` and `es-PR` and both the
 * United States and Puerto Rico group with a comma. `widgets/strings.ts` even
 * recorded that coincidence as a reason not to bother. Adding pt-BR broke it:
 * Brazil groups with a dot, so a Brazilian read `1,974 kcal`, and a user on a
 * Brazilian phone running the app in English read `1.974` — which in English
 * is one point nine seven four.
 *
 * The failure is silent in both directions and no type or test would have
 * caught it, so it is caught here instead. Use `formatNumber(n, locale)` /
 * `formatDate` / `formatTime` from `@/lib/date-format`; module-level helpers
 * that cannot call a hook take the locale as a parameter.
 */
import { readFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';

const SRC = join(__dirname, '..');

/** `date-format.ts` is where the localized wrappers live — it is the one file
 *  that is *supposed* to call these, with a locale argument. */
const ALLOWED = ['lib/date-format.ts'];

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) {
      if (name === '__tests__' || name === 'node_modules') continue;
      out.push(...walk(p));
    } else if (/\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name)) {
      out.push(p);
    }
  }
  return out;
}

describe('numbers and dates are formatted in the APP locale', () => {
  it('has no argument-less toLocale* calls outside date-format.ts', () => {
    const offenders: string[] = [];
    for (const file of walk(SRC)) {
      const rel = file.slice(SRC.length + 1).replace(/\\/g, '/');
      if (ALLOWED.includes(rel)) continue;
      const src = readFileSync(file, 'utf8');
      src.split('\n').forEach((line, i) => {
        if (/\.toLocale(String|DateString|TimeString)\(\s*\)/.test(line)) {
          offenders.push(`${rel}:${i + 1}  ${line.trim()}`);
        }
      });
    }
    expect(offenders).toEqual([]);
  });
});
