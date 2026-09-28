import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Every pressable in the logging sheets carries an `accessibilityRole`.
 *
 * `a11y-labels.test.ts` covers icon-only controls — the ones with no text at
 * all. This is the other half (UX_AUDIT S18-1): a `<TouchableOpacity>` around
 * a `<Text>` DOES announce its text, but without a role VoiceOver reads it as
 * plain text, and a screen-reader user has no way to know it can be tapped.
 * EntrySheet had 1 role in 20 pressables; ConfirmSheet had 0 in 2.
 *
 * Same shape as its sibling — a source scan, not a render — and for the same
 * reason: it finds the controls behind conditional branches nobody has a
 * render test for. Scoped to the components the audit named rather than the
 * whole tree, so it can be strict; widen the list as screens are brought up.
 *
 * A control is exempt if it is hidden from the tree (`accessible={false}`,
 * `accessibilityElementsHidden`, `importantForAccessibility="no…"`), which is
 * the right answer for a decorative wrapper. Nothing else is.
 */
const COMPONENTS = join(__dirname, '..', 'components');
const FILES = [
  'EntrySheet.tsx',
  'FoodSearch.tsx',
  'ConfirmSheet.tsx',
  'MealText.tsx',
  'RecipeBuilder.tsx',
  'RecipeImport.tsx',
  'DailyMetrics.tsx',
  'QuickAddCard.tsx',
  'BottomSheet.tsx',
  'MealEntries.tsx',
  'HeaderAvatar.tsx',
  'Toast.tsx',
  // S18-15 follow-up: the two Train modals' buttons carry roles too.
  'train/TemplateEditorModal.tsx',
  'train/RestNotifySheet.tsx',
];
const TOUCHABLES = ['TouchableOpacity', 'Pressable', 'PressScale', 'AnimatedPressable'];

interface Offender {
  file: string;
  line: number;
  snippet: string;
}

/** Opening tags of touchables, with their attribute text — the same crude
 *  brace/string-aware scan `a11y-labels.test.ts` uses. */
export function findRoleless(source: string, file: string): Offender[] {
  const out: Offender[] = [];
  const open = new RegExp(`<(${TOUCHABLES.join('|')})\\b`, 'g');
  let match: RegExpExecArray | null;
  while ((match = open.exec(source)) != null) {
    let depth = 0;
    let i = match.index + match[0].length;
    let inString: string | null = null;
    for (; i < source.length; i++) {
      const c = source[i];
      if (inString) {
        if (c === inString) inString = null;
        continue;
      }
      if (c === '/' && source[i + 1] === '/') {
        const nl = source.indexOf('\n', i);
        if (nl === -1) break;
        i = nl;
        continue;
      }
      if (c === '"' || c === "'" || c === '`') inString = c;
      else if (c === '{') depth++;
      else if (c === '}') depth--;
      else if (c === '>' && depth === 0) break;
    }
    const attrs = source.slice(match.index, i);
    if (
      attrs.includes('accessibilityRole') ||
      attrs.includes('accessible={false}') ||
      attrs.includes('accessibilityElementsHidden') ||
      attrs.includes('importantForAccessibility')
    ) {
      continue;
    }
    out.push({
      file,
      line: source.slice(0, match.index).split('\n').length,
      snippet: attrs.slice(0, 80).replace(/\s+/g, ' '),
    });
  }
  return out;
}

describe('pressables in the logging sheets carry an accessibilityRole', () => {
  it.each(FILES)('%s', (file) => {
    const offenders = findRoleless(readFileSync(join(COMPONENTS, file), 'utf8'), file);
    const report = offenders.map((o) => `  ${o.file}:${o.line}  ${o.snippet}`).join('\n');
    expect(offenders.length === 0 ? '' : `\n${report}\n`).toBe('');
  });

  it('detects the shape it is supposed to detect', () => {
    const bad = `<TouchableOpacity onPress={x} hitSlop={8}>\n  <Text>{t('common.cancel')}</Text>\n</TouchableOpacity>`;
    expect(findRoleless(bad, 'sample.tsx')).toHaveLength(1);

    const good = `<TouchableOpacity onPress={x} accessibilityRole="button">\n  <Text>{t('common.cancel')}</Text>\n</TouchableOpacity>`;
    expect(findRoleless(good, 'sample.tsx')).toHaveLength(0);

    // A conditional role still counts as one — the attribute is there.
    const conditional = `<PressScale onPress={x} accessibilityRole={on ? 'button' : undefined}>\n  <Text>a</Text>\n</PressScale>`;
    expect(findRoleless(conditional, 'sample.tsx')).toHaveLength(0);
  });
});
