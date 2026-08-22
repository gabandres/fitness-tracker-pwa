import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Every bottom sheet in this app is `<BottomSheet>`. This fails the build if a
 * new one hand-rolls its own.
 *
 * A source-level lock rather than a render assertion, on purpose — the same
 * shape as `tdee-consumers.test.ts`. What it guards is a defect no render can
 * see and no reviewer reliably catches, because a hand-rolled sheet looks
 * completely fine in isolation:
 *
 * - `<Modal animationType="slide">` slides the dim backdrop UP THE SCREEN with
 *   the panel, so the dim reads as a grey rectangle climbing rather than a
 *   cover. That is the "weird backdrop" `EntrySheet` was originally rebuilt to
 *   avoid, and four other sheets then reintroduced by copying the easy version.
 * - A hand-rolled sheet has no drag-to-dismiss unless it also copies the
 *   `PanResponder`, and the ones here did not.
 * - It has to remember `useKeyboardSheetPadding`. `EntrySheet` kept its own
 *   `paddingBottom: kbHeight || 32` instead, which omits `insets.bottom` at
 *   rest — the exact expression that put Save under the LG VS988's 48dp
 *   navigation bar and cost it taps near its lower edge.
 *
 * All three are invisible to `tsc` and to `jest`, which is what earns a test
 * that reads source text.
 *
 * **`BarcodeScanner` is the one legitimate exception** and is listed below: it
 * is a full-screen camera takeover, not a sheet, and it has no panel, handle
 * or backdrop to share.
 */

const SRC = join(__dirname, '..');

/** Files allowed to name `animationType="slide"`. */
const ALLOWED = new Set(['components/BarcodeScanner.tsx']);

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.tsx?$/.test(name)) out.push(full);
  }
  return out;
}

/** Repo-relative, forward-slashed, for readable failures. */
function rel(file: string): string {
  return file.slice(SRC.length + 1).split('\\').join('/');
}

describe('every bottom sheet is the same component', () => {
  const files = walk(SRC).filter((f) => !f.includes('__tests__'));

  it('finds the source tree (guards against the walk silently matching nothing)', () => {
    expect(files.length).toBeGreaterThan(50);
  });

  it('nobody hand-rolls a slide-up Modal', () => {
    // Line-by-line and comment-skipping, because several files now EXPLAIN
    // this rule and naming the thing you are banning must not trip the ban.
    const offenders = files
      .filter((f) => !ALLOWED.has(rel(f)))
      .filter((f) =>
        readFileSync(f, 'utf8')
          .split('\n')
          .some((line) => {
            const trimmed = line.trim();
            if (trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*')) {
              return false;
            }
            return trimmed.includes('animationType="slide"');
          }),
      )
      .map(rel);
    expect(offenders).toEqual([]);
  });

  it('the keyboard padding is only ever applied by BottomSheet', () => {
    // A second caller means a second sheet shell, which is how the rest of
    // this drifts back apart. `use-keyboard-sheet-style.ts` itself is where
    // the hook is defined, so it is not a caller.
    const callers = files
      .filter((f) => readFileSync(f, 'utf8').includes('useKeyboardSheetPadding('))
      .map(rel)
      .sort();
    expect(callers).toEqual(['components/BottomSheet.tsx', 'lib/use-keyboard-sheet-style.ts']);
  });
});
