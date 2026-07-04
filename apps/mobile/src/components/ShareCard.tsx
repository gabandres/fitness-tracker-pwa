import { StyleSheet, Text, View } from 'react-native';
import { type ShareStats, shareStatItems } from '@macrolog/core';
import { type I18nKey, useT } from '@/i18n';
import { font, palettes, radius, space } from '@/theme';

// Deliberately NOT theme-reactive: the captured share image keeps one fixed
// brand look (light Frost) no matter what scheme the sharer's phone is in.
const colors = palettes.light.colors;

const LABEL: Record<'streak' | 'days' | 'lost' | 'gained', I18nKey> = {
  streak: 'today.shareStreak',
  days: 'today.shareDays',
  lost: 'today.shareLost',
  gained: 'today.shareGained',
};

/**
 * The numbers-only progress card captured for sharing (react-native-view-shot).
 * Privacy: streak / days / weight delta only — never a photo (ADR-0010). Tile
 * selection comes from the shared @macrolog/core shareStatItems.
 */
export function ShareCard({ stats }: { stats: ShareStats }) {
  const t = useT();
  const tiles = shareStatItems(stats);
  return (
    <View style={styles.card}>
      <View style={styles.rule} />
      <Text style={styles.wordmark}>Macro Log</Text>
      <View style={styles.tiles}>
        {tiles.map((tile) => (
          <View key={tile.kind} style={styles.tile}>
            <Text style={styles.tileValue}>{tile.value}</Text>
            <Text style={styles.tileLabel}>{t(LABEL[tile.kind])}</Text>
          </View>
        ))}
      </View>
      <Text style={styles.tagline}>{t('today.shareTagline')}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    width: 360,
    backgroundColor: colors.card,
    borderRadius: radius.lg,
    paddingVertical: space.xxl,
    paddingHorizontal: space.xl,
    gap: space.xl,
    overflow: 'hidden',
  },
  rule: { position: 'absolute', left: 0, top: 0, bottom: 0, width: 8, backgroundColor: colors.accent },
  wordmark: { fontSize: font.h3, fontWeight: '800', color: colors.accent, letterSpacing: 0.3 },
  tiles: { flexDirection: 'row', justifyContent: 'space-between', gap: space.md },
  tile: { flex: 1, alignItems: 'center', gap: 4 },
  tileValue: { fontSize: 40, fontWeight: '800', color: colors.ink },
  tileLabel: { fontSize: font.tiny, color: colors.muted, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.5, textAlign: 'center' },
  tagline: { fontSize: font.small, color: colors.muted },
});
