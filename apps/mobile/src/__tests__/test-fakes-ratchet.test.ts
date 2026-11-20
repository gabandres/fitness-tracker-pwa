/**
 * New tests cross the ledger through the in-memory Firestore
 * (`test-support/memory-firestore.ts`), not through a fake of their own.
 *
 * On 2026-11-20, 77 test files carried an inline fake of `@/lib/ledger` and
 * 24 an inline fake of the Firestore SDK: 580 lines of stubs, 104 distinct
 * ledger functions, and no test that ever read back what the code under test
 * had written. Rewriting them all at once was not worth the risk, so the
 * numbers below are a ratchet: they only go DOWN. Migrate a file (see
 * `day-logged-ledger.test.ts` and `train.completed-elsewhere.test.ts` for the
 * pattern) and lower its number in the same commit.
 */
/* eslint-disable @typescript-eslint/no-require-imports */
const fs = require('fs') as typeof import('fs');
const path = require('path') as typeof import('path');
/* eslint-enable @typescript-eslint/no-require-imports */

const LEDGER_FAKES_MAX = 77;
const FIRESTORE_FAKES_MAX = 24;

const src = path.resolve(__dirname, '..');
const tests: string[] = [];
const walk = (dir: string) => {
  for (const entry of fs.readdirSync(dir)) {
    const p = path.join(dir, entry);
    if (fs.statSync(p).isDirectory()) walk(p);
    else if (/\.test\.tsx?$/.test(p) && path.basename(p) !== 'test-fakes-ratchet.test.ts') tests.push(p);
  }
};
walk(src);

const count = (pattern: RegExp) => tests.filter((p) => pattern.test(fs.readFileSync(p, 'utf8'))).length;

describe('inline fakes only go down', () => {
  it('finds the test files', () => {
    expect(tests.length).toBeGreaterThan(300);
  });

  it(`at most ${LEDGER_FAKES_MAX} files fake the ledger inline`, () => {
    const n = count(/jest\.mock\('@\/lib\/ledger', \(\) => \(\{/);
    expect(n).toBeLessThanOrEqual(LEDGER_FAKES_MAX);
    // Lowered the count? Lower the constant too, so it cannot creep back.
    expect(LEDGER_FAKES_MAX - n).toBe(0);
  });

  it(`at most ${FIRESTORE_FAKES_MAX} files fake the Firestore SDK inline`, () => {
    const n = count(/jest\.mock\('firebase\/firestore', \(\) => \(\{/);
    expect(n).toBeLessThanOrEqual(FIRESTORE_FAKES_MAX);
    expect(FIRESTORE_FAKES_MAX - n).toBe(0);
  });
});
