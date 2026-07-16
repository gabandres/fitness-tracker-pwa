import { Ionicons } from '@expo/vector-icons';
import { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import type { PurchasesStoreProduct } from 'react-native-purchases';
import { BottomSheet } from './BottomSheet';
import { useT } from '@/i18n';
import * as haptics from '@/lib/haptics';
import { getTipProducts, purchaseTip } from '@/lib/purchases';
import { useTheme, useThemedStyles, type Theme } from '@/lib/theme-context';
import { font, radius, space } from '@/theme';

interface Props {
  visible: boolean;
  onClose: () => void;
}

/** Tip jar (App Review 3.1.1): three consumable IAP tiers, altruistic — a tip
 *  unlocks nothing. iOS only; the caller gates on isTipIapAvailable(). */
export function TipSheet({ visible, onClose }: Props) {
  const t = useT();
  const styles = useThemedStyles(createStyles);
  const { colors } = useTheme();
  const [products, setProducts] = useState<PurchasesStoreProduct[] | null>(null);
  const [buying, setBuying] = useState<string | null>(null);
  const [thanks, setThanks] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!visible) return;
    setProducts(null);
    setBuying(null);
    setThanks(false);
    setError('');
    let alive = true;
    getTipProducts()
      .then((p) => alive && setProducts(p))
      .catch(() => alive && (setProducts([]), setError(t('tip.loadFailed'))));
    return () => {
      alive = false;
    };
  }, [visible, t]);

  async function onTip(product: PurchasesStoreProduct) {
    setBuying(product.identifier);
    setError('');
    const result = await purchaseTip(product);
    setBuying(null);
    if (result === 'success') {
      haptics.success();
      setThanks(true);
    } else if (result === 'error') {
      haptics.warning();
      setError(t('tip.failed'));
    }
    // 'cancelled' → silent, leave the sheet open.
  }

  const labels = [t('tip.small'), t('tip.medium'), t('tip.large')];

  return (
    <BottomSheet visible={visible} onClose={onClose}>
      {thanks ? (
        <View style={styles.center}>
          <Ionicons name="heart" size={40} color={colors.accent} />
          <Text style={styles.title}>{t('tip.thanksTitle')}</Text>
          <Text style={styles.body}>{t('tip.thanksBody')}</Text>
          <TouchableOpacity style={styles.done} onPress={onClose}>
            <Text style={styles.doneText}>{t('common.done')}</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <View style={styles.pad}>
          <Text style={styles.title}>{t('tip.title')}</Text>
          <Text style={styles.body}>{t('tip.body')}</Text>
          {products === null ? (
            <ActivityIndicator color={colors.accent} style={{ marginVertical: space.xl }} />
          ) : products.length === 0 ? (
            <Text style={[styles.body, { marginTop: space.lg }]}>{t('tip.unavailable')}</Text>
          ) : (
            products.map((p, i) => (
              <TouchableOpacity
                key={p.identifier}
                style={styles.tier}
                disabled={!!buying}
                onPress={() => onTip(p)}
                testID={`tip-${p.identifier}`}
              >
                <Text style={styles.tierLabel}>{labels[i] ?? p.title}</Text>
                {buying === p.identifier ? (
                  <ActivityIndicator color={colors.onInk} />
                ) : (
                  <Text style={styles.tierPrice}>{p.priceString}</Text>
                )}
              </TouchableOpacity>
            ))
          )}
          {error ? <Text style={styles.err}>{error}</Text> : null}
        </View>
      )}
    </BottomSheet>
  );
}

const createStyles = ({ colors }: Theme) => StyleSheet.create({
  pad: { paddingBottom: space.sm },
  center: { alignItems: 'center', gap: space.sm, paddingVertical: space.lg },
  title: { fontSize: font.h2, fontWeight: '800', color: colors.ink, textAlign: 'center' },
  body: { fontSize: font.body, color: colors.muted, textAlign: 'center', marginTop: space.xs },
  tier: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: colors.ink,
    borderRadius: radius.md,
    paddingHorizontal: space.lg,
    paddingVertical: space.md,
    marginTop: space.md,
  },
  tierLabel: { color: colors.onInk, fontWeight: '700', fontSize: font.body },
  tierPrice: { color: colors.onInk, fontWeight: '800', fontSize: font.body },
  err: { color: colors.danger, fontSize: font.small, textAlign: 'center', marginTop: space.md },
  done: {
    marginTop: space.md,
    backgroundColor: colors.ink,
    borderRadius: radius.md,
    paddingHorizontal: space.xl,
    paddingVertical: space.md,
  },
  doneText: { color: colors.onInk, fontWeight: '700', fontSize: font.body },
});
