import { readdirSync, readFileSync, statSync } from 'fs';
import { join, relative } from 'path';

/**
 * Every scroller inside a native sheet must carry `nestedScrollEnabled`.
 *
 * On Android the native sheet is a react-native-screens formSheet, i.e. a
 * Material `BottomSheetBehavior`, which hands a drag to a child scroller only
 * when that child has nested scrolling enabled — off by default in React
 * Native. Without the prop every downward drag belongs to the sheet: the
 * template editor could not be scrolled back up, and a slow drag dismissed it
 * (Train UX round 2, Maestro 18 on the Android emulator). The prop is a no-op
 * on iOS.
 *
 * Static on purpose: the failure is a native gesture that no jest render can
 * reproduce, and it reaches users silently.
 */
const SRC = join(__dirname, '..');
// A JSX opening tag starts its own line; `useRef<ScrollView>` does not. The
// props run to the tag's first `>` that is not part of an arrow (`=>`).
const SCROLLER = /^[ \t]*<(ScrollView|Animated\.ScrollView|FlatList|SectionList|KeyboardAwareScrollView)\b((?:[^>]|=>)*)>/gm;

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    if (name === '__tests__' || name === 'node_modules') return [];
    if (statSync(p).isDirectory()) return files(p);
    return /\.tsx$/.test(name) ? [p] : [];
  });
}

/** Files whose sheet is native: a `<BottomSheet` opened with the `native` prop. */
const nativeSheetFiles = files(SRC).filter((p) => /<BottomSheet\b[^>]*?\bnative\b/s.test(readFileSync(p, 'utf8')));

describe('scrollers inside native sheets enable nested scrolling (Android)', () => {
  it('finds the native sheets', () => {
    expect(nativeSheetFiles.length).toBeGreaterThan(5);
  });

  it.each(nativeSheetFiles.map((p) => [relative(SRC, p), p]))('%s', (_name, p) => {
    const src = readFileSync(p, 'utf8');
    const missing = [...src.matchAll(SCROLLER)]
      // A scroller rendered OUTSIDE the sheet (a tab's own list) is exempt by
      // testID; there is one, the Train home scroll.
      .filter((m) => !/testID="train-start-scroll"/.test(m[2]))
      .filter((m) => !/\bnestedScrollEnabled\b/.test(m[2]))
      .map((m) => `${m[1]} at line ${src.slice(0, m.index).split('\n').length}`);
    expect(missing).toEqual([]);
  });
});
