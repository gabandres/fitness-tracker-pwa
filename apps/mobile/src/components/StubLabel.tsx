import { StyleSheet, Text } from 'react-native';
import { useThemedStyles, type Theme } from '@/lib/theme-context';
import { font, space } from '@/theme';

/**
 * The label of a Trends **stub row**, with its leading term made scannable.
 *
 * ## The problem this fixes, measured rather than guessed
 *
 * A user was told "go to Trends" and could not find the Fasting card (#115).
 * The obvious explanations were both wrong. The row was not missing and it was
 * not lying — the **Trends card contract** was satisfied, the row acted, and it
 * said honestly why it was empty.
 *
 * What was wrong is that **38 of 43 accounts (88%) have neither a Sleep card nor
 * a Fasting card**, so for almost everyone the entire feature is represented by
 * one line of `colors.muted` text at `font.small` — the dimmest thing on the
 * screen. With both cards absent the section header does not render either, so
 * nothing on screen groups those two lines or names them as the thing you were
 * sent to look at. They read as a footnote under the weekly card.
 *
 * ## Why this, and not a copy change
 *
 * The first proposal was to make the stub name its threshold. Reading the
 * strings killed it: the progress row **already** says `{n} of {need} fasts`,
 * and telling a user with zero fasts that they need three is naming an unearned
 * target — the forward-pressure pattern this codebase rejects everywhere else.
 *
 * So the copy is left exactly as it is and only the *hierarchy* changes. Every
 * stub string begins with the feature name and a `·` separator, in all three
 * locales — `Fasting ·` / `Ayuno ·` / `Jejum ·`. Rendering that head in
 * `colors.ink` makes the row scannable as *"here is Fasting"* while the
 * explanation stays quiet. No new keys, and it cannot drift out of sync with
 * the copy because it is derived from it.
 *
 * A locale that ever drops the separator degrades to the old all-muted line
 * rather than throwing or rendering a mangled head.
 */

/** The separator every stub string uses between the feature name and the
 *  explanation. Not a general-purpose constant — it is this row's contract. */
const SEP = ' · ';

export function StubLabel({ text, testID }: { text: string; testID?: string }) {
  const styles = useThemedStyles(createStyles);
  const at = text.indexOf(SEP);

  if (at < 0) {
    return (
      <Text style={styles.label} testID={testID}>
        {text}
      </Text>
    );
  }

  return (
    <Text style={styles.label} testID={testID}>
      <Text style={styles.head}>{text.slice(0, at)}</Text>
      {text.slice(at)}
    </Text>
  );
}

const createStyles = ({ colors }: Theme) =>
  StyleSheet.create({
    // Matches the `linkLabel` this replaced, including the `flex: 1` that keeps
    // the dismiss control inside the scroll body's padding (a device-only bug
    // fixed once already — RNTL runs no Yoga pass).
    label: { flex: 1, fontSize: font.small, color: colors.muted, marginRight: space.xs },
    head: { color: colors.ink, fontWeight: '700' },
  });
