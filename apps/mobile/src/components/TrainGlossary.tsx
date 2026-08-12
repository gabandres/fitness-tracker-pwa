import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { BottomSheet } from './BottomSheet';
import { useT, type I18nKey } from '@/i18n';
import { useThemedStyles, type Theme } from '@/lib/theme-context';
import { font, space } from '@/theme';

/** Term keys under `train.glossary.*`; each has a matching `…Body` entry, so
 *  adding a term is one line here and two per locale. */
const SECTIONS: { title: I18nKey; terms: string[] }[] = [
  { title: 'train.glossary.sectionLogging', terms: ['rir', 'setTypes', 'cluster', 'rest'] },
  {
    title: 'train.glossary.sectionProgress',
    terms: ['progression', 'suggest', 'last', 'pr', 'e1rm', 'volume', 'topSet'],
  },
  { title: 'train.glossary.sectionPlates', terms: ['perSide', 'short', 'warmupPct'] },
];

/**
 * Plain-language definitions for the Train tab's lifting vocabulary — RIR, set
 * types, clusters, auto-progression, e1RM, volume, plate math.
 *
 * The logger is dense with terms that only read as obvious to someone who
 * already trains that way: a user asked what RIR meant, and RIR was one of ten
 * undefined words on the same screen. Opened from the "?" on the Train header
 * and from the active session, so the answer is one tap from the question.
 */
export function TrainGlossary({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const t = useT();
  const styles = useThemedStyles(createStyles);

  return (
    <BottomSheet visible={visible} onClose={onClose}>
      <Text style={styles.title}>{t('train.glossary.title')}</Text>
      <Text style={styles.intro}>{t('train.glossary.intro')}</Text>
      <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollBody}>
        {SECTIONS.map((section) => (
          <View key={section.title} style={styles.section}>
            <Text style={styles.sectionLabel}>{t(section.title)}</Text>
            {section.terms.map((term) => (
              <View key={term} style={styles.term}>
                <Text style={styles.termName}>{t(`train.glossary.${term}` as I18nKey)}</Text>
                <Text style={styles.termBody}>{t(`train.glossary.${term}Body` as I18nKey)}</Text>
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
