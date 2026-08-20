import { describe, it, expect } from 'vitest';

/**
 * FIX C's enforcement half — the substitute for a lint rule.
 *
 * `TdeeResult.newDailyTarget` is a raw branch output. The seed branch hardcodes
 * 1800, which is below any `calorieFloor` above 1800, and only `targets.ts`
 * applies the floor on every path. Three call sites read it directly and could
 * report a target under the user's own floor; two of them fed that number to an
 * LLM, which then advised against it in prose.
 *
 * This repo has **no ESLint** (checked 2026-08-19: no `eslint.config.*`, no
 * `.eslintrc*`, no `lint` script), so a lint rule is not an available
 * mechanism. A source scan in the test suite is, and CI already runs
 * `npm --prefix packages/core test` on every PR.
 *
 * **It scans the whole tree, not a list of known offenders**, so a file that
 * does not exist yet is covered the day it is written. That is the point: the
 * three original call sites were each added innocently, one at a time, by
 * someone reading a plausible-looking field off a result object.
 *
 * ## Why `import.meta.glob` and not `node:fs`
 *
 * `packages/core` is deliberately dependency-free and its tsconfig pins
 * `"types": []`, so importing `node:fs` would fail
 * `npm --prefix packages/core run typecheck` — which CI runs as a separate
 * step. Widening `types` to include `node` would also stop that empty array
 * from catching an accidental node import in real core code, which is the
 * thing it is there for. Vite's glob needs no types and no runtime dependency.
 */

/** Raw source of everywhere app or shared code lives. Patterns must be literal
 *  for Vite to statically analyse them, hence one call each. */
const SOURCES: Record<string, Record<string, string>> = {
  'packages/core/src': (import.meta as any).glob('./**/*.ts', {
    query: '?raw', import: 'default', eager: true,
  }),
  'src/app': (import.meta as any).glob('../../../src/app/**/*.ts', {
    query: '?raw', import: 'default', eager: true,
  }),
  'apps/mobile/src': (import.meta as any).glob('../../../apps/mobile/src/**/*.{ts,tsx}', {
    query: '?raw', import: 'default', eager: true,
  }),
  'functions/src': (import.meta as any).glob('../../../functions/src/**/*.ts', {
    query: '?raw', import: 'default', eager: true,
  }),
};

/** The two files ALLOWED to touch the raw value: the one that produces it, and
 *  the one that clamps it. Nothing else, ever. */
const ALLOWED = [/(^|\/)tdee\.ts$/, /(^|\/)targets\.ts$/];
const IS_TEST = /\.(test|spec)\.(ts|tsx)$/;

const DOTTED = /\.\s*newDailyTarget\b/;
const DESTRUCTURED = /\{[^{}]*\bnewDailyTarget\b[^{}]*\}\s*=/;

/**
 * Strip comments and string literals so prose ABOUT the field — of which this
 * codebase has a great deal, deliberately — is not read as a use of it.
 *
 * Template literals keep their `${…}` expressions and lose only the literal
 * text between them. That is not a nicety: two of the three original
 * violations were `` `- Daily target: ${tdee.newDailyTarget} kcal/day` ``, so a
 * stripper that blanked whole templates would have reported the codebase clean
 * on the exact bug it exists to find. The self-check below pins that.
 */
function stripNonCode(src: string): string {
  let s = src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/[^\n]*/g, ' ');

  s = s.replace(/`(?:\\[\s\S]|\$\{[^}]*\}|[^\\`])*`/g, (lit) => {
    const keep = /\$\{[^}]*\}/g;
    let out = '';
    let last = 0;
    let m: RegExpExecArray | null;
    while ((m = keep.exec(lit)) !== null) {
      out += ' '.repeat(m.index - last) + m[0];
      last = m.index + m[0].length;
    }
    return out + ' '.repeat(lit.length - last);
  });

  return s.replace(/'(?:\\.|[^\\'])*'/g, ' ').replace(/"(?:\\.|[^\\"])*"/g, ' ');
}

function normalise(root: string, key: string): string {
  const tail = key.replace(/^.*?(?:\.\.\/)*/, '');
  return key.startsWith('./') ? `${root}/${key.slice(2)}` : tail;
}

describe('newDailyTarget is read only through targets.ts', () => {
  it('sees every source root — a moved directory must fail loudly, not scan nothing', () => {
    for (const [root, files] of Object.entries(SOURCES)) {
      expect(
        Object.keys(files).length,
        `${root} matched no files — the glob is stale and this guard is blind there`,
      ).toBeGreaterThan(0);
    }
  });

  it('finds no direct read of .newDailyTarget outside tdee.ts and targets.ts', () => {
    const offenders: string[] = [];

    for (const [root, files] of Object.entries(SOURCES)) {
      for (const [key, src] of Object.entries(files)) {
        const path = normalise(root, key);
        if (IS_TEST.test(path) || ALLOWED.some((re) => re.test(path))) continue;

        const code = stripNonCode(src);
        if (DOTTED.test(code) || DESTRUCTURED.test(code)) offenders.push(path);
      }
    }

    expect(
      offenders,
      'These files read TdeeResult.newDailyTarget directly, bypassing the ' +
        'calorieFloor clamp. Use finalCalorieTarget(tdee, profile) from ' +
        'packages/core/src/targets.ts instead.\n  ' + offenders.join('\n  '),
    ).toEqual([]);
  });

  it('actually detects a violation — the guard is not vacuously green', () => {
    // If `stripNonCode` ever over-strips, the scan above passes for the wrong
    // reason and nobody notices for a year. Pin both shapes it must catch and
    // all three it must ignore.
    const hit = (s: string) => DOTTED.test(stripNonCode(s)) || DESTRUCTURED.test(stripNonCode(s));

    expect(hit('const t = tdee.newDailyTarget;')).toBe(true);
    expect(hit('lines.push(`- Target: ${tdee.newDailyTarget} kcal`);')).toBe(true);
    expect(hit('const { newDailyTarget } = tdee;')).toBe(true);
    expect(hit('return { calorieTarget: tdee.newDailyTarget };')).toBe(true);

    expect(hit('// tdee.newDailyTarget is the raw value')).toBe(false);
    expect(hit('/** see tdee.newDailyTarget for why */')).toBe(false);
    expect(hit("const s = 'tdee.newDailyTarget';")).toBe(false);
    expect(hit('const s = `a tdee.newDailyTarget in prose`;')).toBe(false);
  });
});
