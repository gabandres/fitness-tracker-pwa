import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { BottomSheet } from './BottomSheet';
import { useT, type I18nKey } from '@/i18n';
import { useThemedStyles, type Theme } from '@/lib/theme-context';
import { font, space } from '@/theme';

/**
 * Plain-language definitions for one screen's vocabulary, in a bottom sheet
 * opened from a "?" in that screen's header.
 *
 * This was `TrainGlossary`, built for the lifting terms after a user asked
 * what RIR meant. UX_AUDIT F6 is the same finding on the two most-viewed
 * panels: Today leads with `0 / 2,323 kcal` and `maintenance 2,723`, Trends
 * with a **MEASURED** badge, *Maintenance estimate* and *73% logging
 * completeness*, and not one of them is defined anywhere in the app. Rather
 * than invent a second way to explain a word, the Train component was
 * generalised and the "?" put on all three headers — same icon, same place,
 * same sheet.
 *
 * A term is one entry in a `GlossarySection` plus two strings per locale
 * (`<prefix>.<term>` and `<prefix>.<term>Body`).
 */

export interface GlossarySection {
  title: I18nKey;
  terms: string[];
}

export function Glossary({
  visible,
  onClose,
  titleKey,
  introKey,
  prefix,
  sections,
  testID,
}: {
  visible: boolean;
  onClose: () => void;
  titleKey: I18nKey;
  introKey: I18nKey;
  /** i18n namespace the term keys hang off, e.g. `train.glossary`. */
  prefix: string;
  sections: GlossarySection[];
  testID?: string;
}) {
  const t = useT();
  const styles = useThemedStyles(createStyles);

  return (
    <BottomSheet visible={visible} onClose={onClose}>
      <Text style={styles.title} testID={testID}>{t(titleKey)}</Text>
      <Text style={styles.intro}>{t(introKey)}</Text>
      <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollBody}>
        {sections.map((section) => (
          <View key={section.title} style={styles.section}>
            {/* A single-section glossary does not need a heading telling the
                reader what the only group is. */}
            {sections.length > 1 ? (
              <Text style={styles.sectionLabel}>{t(section.title)}</Text>
            ) : null}
            {section.terms.map((term) => (
              <View key={term} style={styles.term}>
                <Text style={styles.termName}>{t(`${prefix}.${term}` as I18nKey)}</Text>
                <Text style={styles.termBody}>{t(`${prefix}.${term}Body` as I18nKey)}</Text>
              </View>
            ))}
          </View>
        ))}
      </ScrollView>
    </BottomSheet>
  );
}

const createStyles = ({ colors }: Theme) => StyleSheet.create({
  title: { fontSize: font.h2, fontWeight: '800', color: colors.ink },
  intro: { fontSize: font.small, color: colors.muted, marginTop: space.xs },
  // Capped so a long glossary scrolls inside the sheet instead of pushing the
  // sheet past its own maxHeight and clipping the last terms.
  scroll: { maxHeight: 460, marginTop: space.md },
  scrollBody: { paddingBottom: space.md },
  section: { marginBottom: space.lg },
  sectionLabel: {
    fontSize: font.tiny,
    textTransform: 'uppercase',
    letterSpacing: 0.6,
    color: colors.muted,
    marginBottom: space.sm,
  },
  term: { marginBottom: space.md },
  termName: { fontSize: font.body, fontWeight: '700', color: colors.ink },
  termBody: { fontSize: font.small, color: colors.muted, marginTop: 2, lineHeight: 19 },
});
