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

  // `backdropTestID` is the same affordance EntrySheet has carried since it was
  // written. Without it a flow can only dismiss this sheet by tapping a
  // COORDINATE, and that is viewport-dependent: the Train glossary is the
  // longest of the three, and on a 360x720dp screen its panel reaches to ~8% of
  // the screen height — so the `50%,8%` tap the suite used landed on the sheet
  // rather than the backdrop. The sheet stayed open over the tab bar and the
  // run died two steps later at "Tap on Today", which reads like a broken tab
  // bar. Measured on the LG G6 2026-08-23.
  //
  // The suite still dismisses by coordinate (`50%,5%`) because the device runs
  // the published OTA bundle and this id is not in it yet;
  // `.maestro/regression/19-glossary.yaml` says to switch once a bundle
  // carrying it ships.
  return (
    <BottomSheet visible={visible} onClose={onClose} backdropTestID="glossary-backdrop">
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
