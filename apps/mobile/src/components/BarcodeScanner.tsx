import Ionicons from '@expo/vector-icons/Ionicons';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Modal, Platform, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { OffLookupError, type FoodSource } from '@macrolog/core';
import { lookupProduct } from '@/lib/barcode';
import { useT, type I18nKey } from '@/i18n';
import * as haptics from '@/lib/haptics';
import { track } from '@/lib/analytics';
import { announce } from '@/lib/a11y';
import { isOffline } from '@/lib/connectivity';
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

/**
 * A lookup that failed in transit is not a product the database lacks (U8).
 * `fetch` rejects with a TypeError when there is no network at all; the
 * app-wide verdict (`connectivity.ts`) covers the slow-to-fail cases. Either
 * way the copy says "you're offline" — "not found" sent people to type in a
 * product that would have resolved one bar of signal later.
 */
function errorKeyFor(e: unknown): I18nKey {
  if (e instanceof OffLookupError) return ERROR_KEYS[e.code] ?? 'barcode.failed';
  if (e instanceof TypeError || isOffline()) return 'barcode.offline';
  return 'barcode.failed';
}

/** How long a code that missed for a transient reason (offline, a server
 *  error) rests before the camera may look it up again. */
const MISS_RETRY_MS = 3000;

/** Apple's 44pt / Material's 48dp floor for the Cancel and label buttons. */
const TARGET = Platform.OS === 'android' ? 48 : 44;
/** The glass behind overlay text: white on it is ≥ 7:1 whatever the feed shows. */
const SCRIM = 'rgba(0,0,0,0.62)';

interface Props {
  visible: boolean;
  onClose: () => void;
  onPick: (estimate: BarcodeEstimate) => void;
  /** Camera access is permanently denied — there is no OS prompt left to show,
   *  so the scanner bows out and the caller explains it inline instead. */
  onDenied: () => void;
  /**
   * Optional next step after a miss: "Enter it from the label". Receives the
   * barcode that was not found, so the caller can open its manual form and
   * remember the code for the food it saves. The button renders only when this
   * is passed — a scanner without it still says what to do (cancel and type),
   * it just cannot do it for the user.
   */
  onEnterFromLabel?: (barcode: string) => void;
  /** Optional other next step after a miss: back to the name search (U8). A
   *  product the barcode database lacks is often in the food index by name. */
  onSearchByName?: () => void;
}

/** Full-screen barcode scanner (native only — expo-camera). Scans an EAN/UPC,
 *  looks it up on OpenFoodFacts, and emits a BarcodeEstimate that prefills
 *  the entry form. A `handled` latch makes the first scan win so the lookup
 *  fires once. */
export function BarcodeScanner({ visible, onClose, onPick, onDenied, onEnterFromLabel, onSearchByName }: Props) {
  const t = useT();
  const styles = useThemedStyles(createStyles);
  const { colors } = useTheme();
  const [permission, requestPermission] = useCameraPermissions();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  /** The code behind the current miss — what "Enter it from the label" hands on. */
  const [missed, setMissed] = useState('');
  /** The torch (U8): a barcode under a restaurant table or in a dim pantry
   *  does not scan, and the phone's own flashlight is two swipes away. */
  const [torch, setTorch] = useState(false);
  /** Whether the current miss is the network's, not the database's — the
   *  label and name-search ways out are for a product that is not there. */
  const [offlineMiss, setOfflineMiss] = useState(false);
  const handled = useRef(false);
  const lastMiss = useRef('');
  /** Whether the last miss can never resolve this session (the database lacks
   *  the product), and until when a transient one (offline, a 5xx) rests. */
  const missFinal = useRef(false);
  const missUntil = useRef(0);

  useEffect(() => {
    if (visible) {
      handled.current = false;
      setBusy(false);
      setError('');
      setMissed('');
      setOfflineMiss(false);
      setTorch(false);
      lastMiss.current = '';
      missFinal.current = false;
      missUntil.current = 0;
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
    // The label that just missed is usually still in frame, and the camera
    // reports it on every frame. Without this each report was a fresh lookup —
    // a haptic tap, a `barcode_scan` event and a flicker of the miss panel,
    // several times a second. A product the database lacks is not re-asked at
    // all until a different code is read; a miss the network caused rests for
    // MISS_RETRY_MS, since one bar of signal later it may resolve.
    if (barcode === lastMiss.current && (missFinal.current || Date.now() < missUntil.current)) return;
    const retry = barcode === lastMiss.current;
    handled.current = true;
    setBusy(true);
    // A retry of the same code keeps its miss on screen until it has an
    // answer — clearing it blinked the panel and its buttons away under a thumb.
    if (!retry) setError('');
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
      const key = errorKeyFor(e);
      const offline = key === 'barcode.offline';
      const msg = t(key);
      const next = t(offline ? 'barcode.offlineNext' : onEnterFromLabel ? 'barcode.missRetry' : 'barcode.missNext');
      setError(msg);
      setMissed(barcode);
      setOfflineMiss(offline);
      // Spoken, not just drawn: the camera view gives VoiceOver nothing to land
      // on, so a miss was silence followed by more silence. The next step rides
      // along so the announcement is something to act on, not only a verdict.
      // The text below is an Android live region, hence the flag.
      // Once per code: the camera keeps reading after a miss, so the same
      // label in frame would otherwise repeat the whole sentence every lookup.
      if (barcode !== lastMiss.current) announce(`${msg} ${next}`, { androidHasLiveRegion: true });
      lastMiss.current = barcode;
      missFinal.current = e instanceof OffLookupError;
      missUntil.current = Date.now() + MISS_RETRY_MS;
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
          // On the black camera surface in both themes (see `screen`), so
          // white, like the overlay below.
          <View style={styles.center}><ActivityIndicator color={colors.white} /></View>
        ) : (
          <View style={styles.fill}>
            <CameraView
              style={StyleSheet.absoluteFill}
              facing="back"
              enableTorch={torch}
              barcodeScannerSettings={{ barcodeTypes: ['ean13', 'ean8', 'upc_a', 'upc_e'] }}
              onBarcodeScanned={busy ? undefined : (r) => onScanned(r.data)}
            />
            {/* Everything over the feed sits on a dark glass panel (A8): white
                text straight on a camera image measured 1.3–1.5:1 over a
                bright label, which is what a barcode usually is. */}
            <View style={[styles.overlay, { pointerEvents: 'box-none' }]}>
              <Text style={[styles.hint, styles.glass]}>{t('barcode.point')}</Text>
              <View style={styles.reticle} />
              {busy ? (
                <View style={styles.glassRound}>
                  <ActivityIndicator color={colors.white} />
                </View>
              ) : null}
              {error ? (
                // A miss used to end at "isn't in the Open Food Facts database
                // yet" — a verdict with no way forward. The second line is the
                // way forward; the buttons, when the caller wires them, take it.
                <View
                  style={[styles.miss, styles.glass]}
                  accessibilityRole="alert"
                  accessibilityLiveRegion="polite"
                  testID="barcode-miss"
                >
                  <Text style={styles.err}>{error}</Text>
                  <Text style={styles.errNext}>
                    {t(offlineMiss ? 'barcode.offlineNext' : onEnterFromLabel ? 'barcode.missRetry' : 'barcode.missNext')}
                  </Text>
                </View>
              ) : null}
              {error && (onEnterFromLabel || onSearchByName) ? (
                <View style={styles.missActions}>
                  {onSearchByName ? (
                    <TouchableOpacity
                      style={styles.label}
                      onPress={onSearchByName}
                      accessibilityRole="button"
                      testID="barcode-search-name"
                    >
                      <Text style={styles.labelText}>{t('barcode.searchByName')}</Text>
                    </TouchableOpacity>
                  ) : null}
                  {onEnterFromLabel ? (
                    <TouchableOpacity
                      style={styles.label}
                      onPress={() => onEnterFromLabel(missed)}
                      accessibilityRole="button"
                      testID="barcode-enter-label"
                    >
                      <Text style={styles.labelText}>{t('barcode.enterFromLabel')}</Text>
                    </TouchableOpacity>
                  ) : null}
                </View>
              ) : null}
              <View style={styles.bottomRow}>
                <TouchableOpacity
                  style={[styles.torch, torch && styles.torchOn]}
                  onPress={() => {
                    haptics.tap();
                    setTorch((v) => !v);
                  }}
                  accessibilityRole="switch"
                  accessibilityLabel={t('barcode.torch')}
                  accessibilityState={{ checked: torch }}
                  testID="barcode-torch"
                >
                  <Ionicons name={torch ? 'flashlight' : 'flashlight-outline'} size={22} color={torch ? '#000' : colors.white} />
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.cancel, styles.glass]}
                  onPress={onClose}
                  accessibilityRole="button"
                  testID="barcode-cancel"
                >
                  <Text style={styles.cancelText}>{t('common.cancel')}</Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>
        )}
      </SafeAreaView>
    </Modal>
  );
}

const createStyles = ({ colors }: Theme) => StyleSheet.create({
  // Black in both themes: this is a camera surface, and `ink` is off-white in
  // dark mode — the screen flashed white before the feed arrived.
  screen: { flex: 1, backgroundColor: '#000' },
  fill: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: space.xl, gap: space.md },
  overlay: { ...StyleSheet.absoluteFill, alignItems: 'center', justifyContent: 'center', gap: space.lg, paddingHorizontal: space.lg },
  // The dark glass behind anything drawn on the feed (A8). Fixed, not themed:
  // the surface underneath is a camera image in both themes.
  glass: {
    backgroundColor: SCRIM,
    borderRadius: radius.md,
    overflow: 'hidden',
    paddingHorizontal: space.lg,
    paddingVertical: space.sm,
  },
  glassRound: { backgroundColor: SCRIM, borderRadius: 24, padding: space.sm },
  hint: { color: colors.white, fontSize: font.h3, fontWeight: '700' },
  reticle: {
    width: 240,
    height: 150,
    borderWidth: 2,
    borderColor: colors.white,
    borderRadius: radius.md,
    backgroundColor: 'transparent',
  },
  miss: { alignItems: 'center', gap: space.xs, maxWidth: '100%' },
  err: { color: '#ffb4a8', fontSize: font.small, textAlign: 'center' },
  errNext: { color: colors.white, fontSize: font.small, textAlign: 'center' },
  missActions: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: space.sm },
  // Outlined in white on the glass: it sits on the camera feed, not a themed
  // surface, and the border is what sets it apart from Cancel below.
  label: {
    minHeight: TARGET,
    justifyContent: 'center',
    paddingHorizontal: space.lg,
    borderRadius: radius.md,
    borderWidth: 2,
    borderColor: colors.white,
    backgroundColor: SCRIM,
  },
  labelText: { color: colors.white, fontWeight: '700', fontSize: font.body },
  bottomRow: { flexDirection: 'row', alignItems: 'center', gap: space.md, marginTop: space.lg },
  torch: {
    width: TARGET + 4,
    height: TARGET + 4,
    borderRadius: (TARGET + 4) / 2,
    backgroundColor: SCRIM,
    alignItems: 'center',
    justifyContent: 'center',
  },
  torchOn: { backgroundColor: colors.white },
  // `minHeight` states the floor instead of leaving it to padding + line
  // height, which is how this, the only way out of the modal, ended up under it.
  cancel: { minHeight: TARGET, justifyContent: 'center', paddingHorizontal: space.xl, paddingVertical: space.md },
  cancelText: { color: colors.white, fontWeight: '700', fontSize: font.body },
});
