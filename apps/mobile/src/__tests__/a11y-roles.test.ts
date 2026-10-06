import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { openingTags, type OpeningTag } from './jsx-scan';

/**
 * Every pressable in the app carries an `accessibilityRole`.
 *
 * `a11y-labels.test.ts` covers icon-only controls — the ones with no text at
 * all. This is the other half (UX_AUDIT S18-1): a `<TouchableOpacity>` around
 * a `<Text>` DOES announce its text, but without a role VoiceOver reads it as
 * plain text, and a screen-reader user has no way to know it can be tapped.
 * EntrySheet had 1 role in 20 pressables; ConfirmSheet had 0 in 2.
 *
 * Same shape as its sibling — a source scan, not a render — and for the same
 * reason: it finds the controls behind conditional branches nobody has a
 * render test for.
 *
 * **Whole-app since 2026-10-06 (UX_AUDIT S21).** It began as a curated list
 * of the files the S18 audit named, widened one screen at a time; the scan
 * screen then mostly missed the S18 pass — exactly the drift a curated list
 * invites. It now reads every non-test `.tsx` under `src/app` and
 * `src/components`, so a new screen is strict the day it lands.
 *
 * A control is exempt if it is hidden from the tree (`accessible={false}`,
 * `accessibilityElementsHidden`, `importantForAccessibility="no…"`), which is
 * the right answer for a decorative wrapper. Nothing else is.
 *
 * The same files also get a `<TextInput>` check (bottom of the file): every
 * field names itself. Same files, because a screen brought up to "every control
 * announces what it is" is not there while its fields announce only a value.
 */
const SRC = join(__dirname, '..');

function tsxUnder(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(join(SRC, dir))) {
    const rel = `${dir}/${entry}`;
    if (statSync(join(SRC, rel)).isDirectory()) {
      if (entry !== '__tests__') tsxUnder(rel, out);
    } else if (entry.endsWith('.tsx') && !/\.test\.tsx$/.test(entry)) {
      out.push(rel);
    }
  }
  return out;
}

const FILES = [...tsxUnder('app'), ...tsxUnder('components')].sort();
// `Touchable` (TouchableOpacity on iOS, a rippling Pressable on Android) and
// EntrySheet's `Tappable` are pressables too — without them here every call
// site of the wrappers would silently leave this check.
const TOUCHABLES = ['TouchableOpacity', 'Pressable', 'PressScale', 'AnimatedPressable', 'Touchable', 'Tappable'];

interface Offender {
  file: string;
  line: number;
  snippet: string;
}

const HIDDEN = ['accessible={false}', 'accessibilityElementsHidden', 'importantForAccessibility'];

function offender(tag: OpeningTag, file: string): Offender {
  return { file, line: tag.line, snippet: tag.attrs.slice(0, 80).replace(/\s+/g, ' ') };
}

/** Touchables whose opening tag carries no `accessibilityRole` and is not
 *  hidden from the tree. */
export function findRoleless(source: string, file: string): Offender[] {
  return openingTags(source, TOUCHABLES)
    .filter(
      (tag) =>
        !tag.attrs.includes('accessibilityRole') &&
        // The ONE allowance: a wrapper that spreads its props (`Touchable`,
        // `Tappable`) gets its role at the call site, which is scanned as a
        // `Touchable`/`Tappable` in its own right.
        !/\{\.\.\.\(?(rest|props)\b/.test(tag.attrs) &&
        !HIDDEN.some((h) => tag.attrs.includes(h)),
    )
    .map((tag) => offender(tag, file));
}

/**
 * Text fields with no `accessibilityLabel`.
 *
 * A placeholder is not a label: it disappears the moment there is a value, so
 * VoiceOver reads a filled field as its value alone — "120, text field" on the
 * scan review, with nothing saying 120 of WHAT. And a visible title above the
 * field is not associated with it on iOS, where RN has no `labelledBy`.
 * `accessibilityLabelledBy` (Android) does not count for the same reason.
 */
export function findUnlabelledInputs(source: string, file: string): Offender[] {
  // `SheetTextInput` is the same field inside a native sheet (2026-10-04) —
  // without it here every sheet's inputs would silently leave this check.
  return openingTags(source, ['TextInput', 'SheetTextInput'])
    .filter(
      (tag) =>
        !tag.attrs.includes('accessibilityLabel=') &&
        !tag.attrs.includes('aria-label=') &&
        // A wrapper that spreads its props (`EntrySheet`'s `TextInputBase`)
        // gets its label at the call site, which this scan cannot follow.
        !tag.attrs.includes('{...') &&
        !HIDDEN.some((h) => tag.attrs.includes(h)),
    )
    .map((tag) => offender(tag, file));
}

function report(offenders: Offender[]): string {
  const lines = offenders.map((o) => `  ${o.file}:${o.line}  ${o.snippet}`).join('\n');
  return offenders.length === 0 ? '' : `\n${lines}\n`;
}

describe('pressables carry an accessibilityRole', () => {
  it.each(FILES)('%s', (file) => {
    expect(report(findRoleless(readFileSync(join(SRC, file), 'utf8'), file))).toBe('');
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

/**
 * Files whose fields predate this check, with the count they had when it
 * landed (2026-10-04). A RATCHET, not an exemption: the count may fall, never
 * rise, and a file leaves this map — and becomes strict — the day it reaches 0.
 * None of them is a logging sheet; the sheets are strict from day one.
 */
// RecipeImport.tsx left at 0 on 2026-10-06 (S21: its URL field is named).
const INPUTS_PENDING: Record<string, number> = {};

describe('text fields carry an accessibilityLabel', () => {
  it.each(FILES)('%s', (file) => {
    const found = findUnlabelledInputs(readFileSync(join(SRC, file), 'utf8'), file);
    const allowed = INPUTS_PENDING[file];
    if (allowed == null) {
      expect(report(found)).toBe('');
    } else {
      // Ratchet: report the list on a rise, and fail on a fall too so the
      // number here is lowered with the fix rather than left as headroom.
      expect({ file, unlabelled: found.length }).toEqual({ file, unlabelled: allowed });
    }
  });

  it('detects the shape it is supposed to detect', () => {
    const bad = `<TextInput value={g} onChangeText={set} placeholder="0" keyboardType="numeric" />`;
    expect(findUnlabelledInputs(bad, 'sample.tsx')).toHaveLength(1);

    const good = `<TextInput value={g} onChangeText={set} accessibilityLabel={t('scan.itemGramsLabel', { name })} />`;
    expect(findUnlabelledInputs(good, 'sample.tsx')).toHaveLength(0);

    // `accessibilityLabelledBy` is Android-only and must not satisfy the check.
    const androidOnly = `<TextInput value={g} accessibilityLabelledBy="title" />`;
    expect(findUnlabelledInputs(androidOnly, 'sample.tsx')).toHaveLength(1);
  });
});
