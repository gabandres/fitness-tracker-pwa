import { CameraView, useCameraPermissions } from 'expo-camera';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Modal, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { OffLookupError, type FoodSource } from '@macrolog/core';
import { lookupProduct } from '@/lib/barcode';
import { useT, type I18nKey } from '@/i18n';
import * as haptics from '@/lib/haptics';
import { track } from '@/lib/analytics';
import { useTheme, useThemedStyles, type Theme } from '@/lib/theme-context';
import { font, radius, space } from '@/theme';

export interface BarcodeEstimate {
  calories: number;
  protein?: number;
  carbs?: number;
  fat?: number;
  mealLabel: string;
  /** Grams-first save context (ADR-0013): lets "Save to My Foods" store a
   *  gram-weighted, barcode-deduped CustomFood instead of `serving:1`. */
  serving?: {
    grams?: number;
    source: FoodSource;
    barcode?: string;
    brand?: string;
    name?: string;
  };
}

/** Mobile has no `tError` — `t` takes a typed I18nKey, not a runtime code — so
 *  the two codes the resolver can raise map to keys here. Kept local on
 *  purpose: a general helper would have exactly one caller today (the coach
 *  path at lib/coach.ts already has its own working handling). */
const ERROR_KEYS: Record<string, I18nKey> = {
  FOOD_NOT_FOUND: 'errors.foodNotFound',
  FOOD_NO_NUTRITION: 'errors.foodNoNutrition',
};

function errorKeyFor(e: unknown): I18nKey {
  return (e instanceof OffLookupError && ERROR_KEYS[e.code]) || 'barcode.failed';
}

interface Props {
  visible: boolean;
  onClose: () => void;
  onPick: (estimate: BarcodeEstimate) => void;
  /** Camera access is permanently denied — there is no OS prompt left to show,
   *  so the scanner bows out and the caller explains it inline instead. */
  onDenied: () => void;
}

/** Full-screen barcode scanner (native only — expo-camera). Scans an EAN/UPC,
 *  looks it up on OpenFoodFacts, and emits a BarcodeEstimate that prefills
 *  the entry form. A `handled` latch makes the first scan win so the lookup
 *  fires once. */
export function BarcodeScanner({ visible, onClose, onPick, onDenied }: Props) {
  const t = useT();
  const styles = useThemedStyles(createStyles);
  const { colors } = useTheme();
  const [permission, requestPermission] = useCameraPermissions();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const handled = useRef(false);

  useEffect(() => {
    if (visible) {
      handled.current = false;
      setBusy(false);
      setError('');
    }
  }, [visible]);

  // Auto-request on open — no custom pre-prompt before the OS dialog, per App
  // Review 5.1.1(iv). The scanner modal only opens after the user taps "Scan",
  // so intent is already established; fire the system prompt straight away.
  useEffect(() => {
    if (visible && permission?.status === 'undetermined') {
      requestPermission();
    }
  }, [visible, permission, requestPermission]);

  // Permanently denied: hand back to the caller rather than rendering our own
  // message screen here. App Review 5.1.1(iv) (submission 5ba1c7f5) read the
  // old in-modal "Open Settings / Cancel" screen as a pre-prompt with an exit
  // button, so this surface now only ever shows a spinner or the live camera.
  useEffect(() => {
    if (visible && permission && !permission.granted && !permission.canAskAgain) {
      onDenied();
    }
  }, [visible, permission, onDenied]);

  async function onScanned(barcode: string) {
    if (handled.current) return;
    handled.current = true;
    setBusy(true);
    setError('');
    haptics.tap();
    try {
      track('barcode_scan');
      const { calories, protein, carbs, fat, productName, serving } = await lookupProduct(barcode);
      haptics.success();
      onPick({
        calories,
        protein,
        carbs: carbs ?? undefined,
        fat: fat ?? undefined,
        mealLabel: productName,
        // Assembled by the resolver so both frontends emit the same shape.
        serving,
      });
    } catch (e) {
      setError(t(errorKeyFor(e)));
      setBusy(false);
      // Allow another scan after a miss.
      handled.current = false;
    }
  }

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <SafeAreaView style={styles.screen} edges={['top', 'bottom']}>
        {!permission?.granted ? (
          // Loading, the OS prompt is being presented (auto-requested above), or
          // denied — in which case onDenied() is already closing this modal.
          <View style={styles.center}><ActivityIndicator color={colors.white} /></View>
        ) : (
          <View style={styles.fill}>
            <CameraView
              style={StyleSheet.absoluteFill}
              facing="back"
              barcodeScannerSettings={{ barcodeTypes: ['ean13', 'ean8', 'upc_a', 'upc_e'] }}
              onBarcodeScanned={busy ? undefined : (r) => onScanned(r.data)}
            />
            <View style={[styles.overlay, { pointerEvents: 'box-none' }]}>
              <Text style={styles.hint}>{t('barcode.point')}</Text>
              <View style={styles.reticle} />
              {busy ? <ActivityIndicator color={colors.white} style={{ marginTop: space.lg }} /> : null}
              {error ? <Text style={styles.err}>{error}</Text> : null}
              <TouchableOpacity style={styles.cancel} onPress={onClose} testID="barcode-cancel">
                <Text style={styles.cancelText}>{t('common.cancel')}</Text>
              </TouchableOpacity>
            </View>
          </View>
        )}
      </SafeAreaView>
    </Modal>
  );
}

const createStyles = ({ colors }: Theme) => StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.ink },
  fill: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: space.xl, gap: space.md },
  overlay: { ...StyleSheet.absoluteFill, alignItems: 'center', justifyContent: 'center', gap: space.lg },
  hint: { color: colors.white, fontSize: font.h3, fontWeight: '700' },
  reticle: {
    width: 240,
    height: 150,
    borderWidth: 2,
    borderColor: colors.white,
    borderRadius: radius.md,
    backgroundColor: 'transparent',
  },
  err: { color: '#ffb4a8', fontSize: font.small, textAlign: 'center', paddingHorizontal: space.xl },
  cancel: { marginTop: space.lg, paddingHorizontal: space.xl, paddingVertical: space.md },
  cancelText: { color: colors.white, fontWeight: '700', fontSize: font.body },
});
