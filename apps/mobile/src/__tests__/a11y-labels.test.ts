import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Every icon-only control must say what it does.
 *
 * ## Why a source scan and not a render test
 *
 * The defect this catches is uniform and boring: a `<Pressable>` wrapping a
 * single `<Ionicons>` with no `accessibilityLabel`. VoiceOver and TalkBack
 * announce those as "button" and nothing else, so a screen-reader user gets a
 * row of identical unnamed buttons — the share icon, the calendar icon, the
 * dismiss X — and no way to tell them apart.
 *
 * Rendering each one would need a test per screen, most of which do not have
 * one, and would still miss any control behind a conditional branch. Reading
 * the source finds all of them, including the ones nobody has written a test
 * for yet. The trade is that this is a lint, not a proof: it cannot tell a good
 * label from a bad one, only a present one from an absent one.
 *
 * The `LogSpeedDial` bug is the reason for the second half of that sentence —
 * its `+` carried a label the whole time, and the label was the name of a
 * *different* button.
 *
 * ## Adding a control
 *
 * Give it `accessibilityLabel`. If it genuinely has no meaning on its own —
 * decoration, or a backdrop that only closes something — mark it
 * `accessibilityElementsHidden` / `importantForAccessibility="no"` instead, and
 * this test will leave it alone.
 */

const SRC = join(__dirname, '..');
const TOUCHABLES = ['TouchableOpacity', 'Pressable', 'PressScale', 'AnimatedPressable'];

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (entry === '__tests__') continue;
      sourceFiles(full, out);
    } else if (entry.endsWith('.tsx')) {
      out.push(full);
    }
  }
  return out;
}

interface Offender {
  file: string;
  line: number;
  snippet: string;
}

/**
 * Opening tags of touchable elements, with their attribute text.
 *
 * Deliberately crude — a regex over JSX, not a parser. It is looking for one
 * specific shape and the cost of a false negative here is a missing label, not
 * a broken build.
 */
function findUnlabelled(source: string, file: string): Offender[] {
  const out: Offender[] = [];
  const open = new RegExp(`<(${TOUCHABLES.join('|')})\\b`, 'g');
  let match: RegExpExecArray | null;
  while ((match = open.exec(source)) != null) {
    // Attributes run to the end of the opening tag. Find it by scanning for the
    // first '>' that is not inside a brace expression or a string.
    let depth = 0;
    let i = match.index + match[0].length;
    let inString: string | null = null;
    for (; i < source.length; i++) {
      const c = source[i];
      if (inString) {
        if (c === inString) inString = null;
        continue;
      }
      if (c === '"' || c === "'" || c === '`') inString = c;
      else if (c === '{') depth++;
      else if (c === '}') depth--;
      else if (c === '>' && depth === 0) break;
    }
    const attrs = source.slice(match.index, i);
    const selfClosing = source[i - 1] === '/';

    if (
      attrs.includes('accessibilityLabel') ||
      attrs.includes('accessibilityElementsHidden') ||
      attrs.includes('importantForAccessibility')
    ) {
      continue;
    }

    // Only icon-only controls: anything rendering its own <Text> already
    // announces that text, which is a better label than one we would invent.
    const body = selfClosing ? attrs : source.slice(i, i + 500);
    const hasIcon = /<Ionicons\b/.test(attrs) || /<Ionicons\b/.test(body.slice(0, 300));
    const hasText = /<Text[\s>]/.test(body.slice(0, 300));
    if (!hasIcon || hasText) continue;

    out.push({
      file,
      line: source.slice(0, match.index).split('\n').length,
      snippet: attrs.slice(0, 80).replace(/\s+/g, ' '),
    });
  }
  return out;
}

describe('icon-only controls carry an accessibility label', () => {
  it('finds none unlabelled anywhere in the app', () => {
    const offenders: Offender[] = [];
    for (const file of sourceFiles(SRC)) {
      offenders.push(...findUnlabelled(readFileSync(file, 'utf8'), file.slice(SRC.length + 1)));
    }

    const report = offenders.map((o) => `  ${o.file}:${o.line}  ${o.snippet}`).join('\n');
    expect(offenders.length === 0 ? '' : `\n${report}\n`).toBe('');
  });

  it('detects the shape it is supposed to detect', () => {
    // Guards the guard: a scan that silently matches nothing passes forever.
    const bad = `<Pressable onPress={x} testID="y">\n  <Ionicons name="close" size={20} />\n</Pressable>`;
    expect(findUnlabelled(bad, 'sample.tsx')).toHaveLength(1);

    const good = `<Pressable onPress={x} accessibilityLabel={t('common.dismiss')}>\n  <Ionicons name="close" size={20} />\n</Pressable>`;
    expect(findUnlabelled(good, 'sample.tsx')).toHaveLength(0);
  });
});
