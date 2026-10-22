import { readdirSync, readFileSync } from 'fs';
import { dirname, join } from 'path';

/**
 * `patches/@firebase+firestore+*.patch` — the fast path in the Firestore SDK's
 * string comparator (ADR-0016 amendment 3).
 *
 * The SDK compares every document key through `__PRIVATE_compareUtf8Strings`,
 * a `charAt` loop over both strings; measured on a Release build with the
 * owner's data copied to a test account, that loop was about half of a tab's
 * first-visit JS stall. The patch answers strings without surrogates with the
 * engine's own comparison.
 *
 * Two things are pinned here. The patch is present in the build the app
 * bundles (Metro resolves the `react-native` entry, `dist/common-*.rn.js`), so
 * a firebase upgrade that drops it fails here rather than silently bringing
 * the stall back. And the patched comparator orders strings exactly as UTF-8
 * bytes do — the order the SDK requires to agree with the server — including
 * emoji, other astral characters, lone surrogates and U+E000–U+FFFF, the range
 * where UTF-16 code-unit order and UTF-8 order disagree.
 */

function sdkSource(): string {
  const dist = dirname(require.resolve('@firebase/firestore/package.json'));
  const file = readdirSync(join(dist, 'dist')).find((f) => /^common-.*\.rn\.js$/.test(f));
  if (!file) throw new Error('no React Native build of @firebase/firestore found');
  return readFileSync(join(dist, 'dist', file), 'utf8');
}

/** Lifts the comparator and its helpers out of the SDK bundle. */
function loadComparator(src: string): (a: string, b: string) => number {
  const grab = (name: string) => {
    const start = src.indexOf(`function ${name}(`);
    if (start < 0) throw new Error(`${name} not found`);
    let depth = 0;
    for (let i = src.indexOf('{', start); i < src.length; i++) {
      if (src[i] === '{') depth++;
      else if (src[i] === '}' && --depth === 0) return src.slice(start, i + 1);
    }
    throw new Error(`${name} not closed`);
  };
  const surrogate = src.match(/const __IGNIA_SURROGATE = [^;]+;/)?.[0] ?? '';
  // `isSurrogate` reads two minified module constants (the U+D800/U+DFFF
  // bounds); lift their declaration rather than restating the values.
  const isSurrogate = grab('__PRIVATE_isSurrogate');
  const [, lo, hi] = isSurrogate.match(/>= (\w+) && \w+ <= (\w+)/) ?? [];
  const bounds = src.match(new RegExp(`const ${lo} = \\d+, ${hi} = \\d+;`))?.[0];
  if (!bounds) throw new Error('surrogate bounds not found');
  const body = [
    surrogate,
    bounds,
    grab('__PRIVATE_primitiveComparator'),
    isSurrogate,
    grab('__PRIVATE_compareUtf8StringsLoop'),
    grab('__PRIVATE_compareUtf8Strings'),
    'return __PRIVATE_compareUtf8Strings;',
  ].join('\n');
  return new Function(body)() as (a: string, b: string) => number;
}

const utf8Order = (a: string, b: string) => Math.sign(Buffer.compare(Buffer.from(a, 'utf8'), Buffer.from(b, 'utf8')));

/** Deterministic PRNG, so a failure reproduces. */
function rng(seed: number) {
  return () => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed / 0x7fffffff;
  };
}

/** A surrogate that is not half of a pair. */
const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;

const POOL = ['a', 'b', 'z', 'A', '0', '/', '-', 'é', 'ñ', '中', '', '�', '😀', '𝄞', '\uD83D'];

describe('the Firestore UTF-8 comparator patch', () => {
  const src = sdkSource();

  it('is applied to the build the app bundles', () => {
    expect(src).toContain('__IGNIA_SURROGATE');
    expect(src).toContain('function __PRIVATE_compareUtf8StringsLoop(');
  });

  it('orders strings exactly as their UTF-8 bytes do', () => {
    const compare = loadComparator(src);
    const next = rng(42);
    const word = () =>
      Array.from({ length: 1 + Math.floor(next() * 8) }, () => POOL[Math.floor(next() * POOL.length)]).join('');
    for (let i = 0; i < 5000; i++) {
      const a = word();
      const b = next() < 0.3 ? a + word() : word();
      // A lone surrogate has no UTF-8 form (Node writes U+FFFD); only the SDK's
      // own loop defines its order, so those pairs are checked for agreement
      // with that loop rather than with the bytes.
      if (LONE_SURROGATE.test(a) || LONE_SURROGATE.test(b)) continue;
      expect([a, b, Math.sign(compare(a, b))]).toEqual([a, b, utf8Order(a, b)]);
    }
  });

  it('agrees with the original loop on every pair, surrogates included', () => {
    const compare = loadComparator(src);
    const loop = loadComparator(src.replace(/if \(!__IGNIA_SURROGATE[^\n]*\n/, ''));
    const next = rng(7);
    const word = () =>
      Array.from({ length: Math.floor(next() * 8) }, () => POOL[Math.floor(next() * POOL.length)]).join('');
    for (let i = 0; i < 5000; i++) {
      const a = word();
      const b = word();
      expect(Math.sign(compare(a, b))).toBe(Math.sign(loop(a, b)));
    }
  });

  it('keeps the Firestore document-key shape fast-pathed and correctly ordered', () => {
    const compare = loadComparator(src);
    const keys = ['users/abc/dailyLogs/2026-10-01', 'users/abc/dailyLogs/2026-10-02', 'users/abd/dailyLogs/0'];
    expect(compare(keys[0], keys[1])).toBeLessThan(0);
    expect(compare(keys[1], keys[2])).toBeLessThan(0);
    expect(compare(keys[2], keys[2])).toBe(0);
  });
});
