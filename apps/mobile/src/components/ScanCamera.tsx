import Ionicons from '@expo/vector-icons/Ionicons';
import { CameraView } from 'expo-camera';
import { useEffect, useRef, useState } from 'react';
import { Image, Platform, StyleSheet, Text, View } from 'react-native';
import { useReducedMotion } from 'react-native-reanimated';
import { useT } from '@/i18n';
import { announce } from '@/lib/a11y';
import * as haptics from '@/lib/haptics';
import { PressScale } from '@/lib/motion';
import { useTheme, useThemedStyles, type Theme } from '@/lib/theme-context';
import { font, radius, space } from '@/theme';

/** Apple's 44pt / Material's 48dp floor, as on the rest of the scan screen. */
const TARGET = Platform.OS === 'android' ? 48 : 44;
/** The shutter is the one control on this screen a thumb looks for without
 *  looking, so it is well past the floor — the size camera apps train. */
const SHUTTER = 76;

interface Props {
  /** The photos already taken or picked for this meal (ADR-0029 item 5). */
  photos: string[];
  max: number;
  /** Whether a note is already written — the chip says "Edit note" if so. */
  hasNote: boolean;
  /** One line under the strip: the multi-photo cost, or scans left. */
  footnote?: string | null;
  /** The last attempt's error, or "you're offline" — above the controls, with
   *  "Search instead" when the network is the problem (U9). */
  notice?: { text: string; onSearch?: () => void } | null;
  /** A shot landed. The first shot of a meal is analyzed straight away by the
   *  caller; later ones join the strip. */
  onShot: (uri: string) => void;
  onRemove: (index: number) => void;
  onLibrary: () => void;
  onNote: () => void;
  onAnalyze: () => void;
}

/**
 * The in-app viewfinder for a meal photo.
 *
 * It replaces the hand-off to the system camera (`launchCameraAsync`), which
 * cost two taps that bought nothing: the OS shutter, then the OS "Use Photo"
 * confirm. Here the shutter IS the capture, and the photo lands straight in
 * the strip below — whose remove buttons are the undo the confirm used to be.
 * Since S20 the FIRST shot is analyzed straight away by the caller (Cancel on
 * the wait is its undo), which takes a plate from seven taps to four; Analyze
 * here is for a strip of several angles.
 *
 * **Image pipeline is unchanged on purpose.** The picker was called with
 * `quality: 1` and the full-size file went through `encodeMealPhoto` (768 px,
 * JPEG 0.8) before upload. `takePictureAsync({ quality: 1 })` hands that same
 * encoder a full-size file, so the bytes sent, the quota a scan costs and the
 * image the model sees are what they were. `skipProcessing` stays off: it is
 * what rotates the file to the device's orientation, and the encoder does not.
 *
 * Permission is the caller's job — this only mounts once access is granted,
 * the same split BarcodeScanner has with its caller.
 */
export function ScanCamera({ photos, max, hasNote, footnote, notice, onShot, onRemove, onLibrary, onNote, onAnalyze }: Props) {
  const t = useT();
  const styles = useThemedStyles(createStyles);
  const { colors } = useTheme();
  const reduce = useReducedMotion();
  const camera = useRef<CameraView>(null);
  /** A capture in flight. A second press while the first is still writing its
   *  file would add a duplicate of the same plate and charge a scan for it. */
  const [busy, setBusy] = useState(false);
  const [flash, setFlash] = useState(false);
  const [failed, setFailed] = useState(false);
  // The screen opens straight into the viewfinder, so the first tap can land
  // before the session is up — `takePictureAsync` then throws and the user is
  // told the photo failed. The shutter waits for `onCameraReady` instead.
  const [ready, setReady] = useState(false);
  // …but never forever: a device that never fires the event would otherwise
  // be left with a dead shutter. After 2 s it is enabled regardless, and a
  // too-early capture still lands in the "couldn't take that" path below.
  useEffect(() => {
    if (ready) return;
    const timer = setTimeout(() => setReady(true), 2000);
    return () => clearTimeout(timer);
  }, [ready]);
  const full = photos.length >= max;

  async function shoot() {
    if (busy || full || !ready || !camera.current) return;
    setBusy(true);
    setFailed(false);
    haptics.tap();
    try {
      const pic = await camera.current.takePictureAsync({ quality: 1 });
      if (!pic?.uri) throw new Error('no-uri');
      onShot(pic.uri);
    } catch {
      // Not ready yet, or the session dropped (a call came in). Said, not
      // swallowed: a shutter that silently does nothing reads as broken.
      setFailed(true);
      haptics.warning();
      announce(t('scan.shotFailed'), { androidHasLiveRegion: true });
    } finally {
      setBusy(false);
    }
  }

  return (
    <View style={styles.wrap}>
      <View style={styles.viewport}>
        {/* The live feed means nothing to a screen reader and would otherwise
            be one large unlabelled element to swipe past on the way to the
            shutter; only the controls are in the tree. */}
        <View
          style={StyleSheet.absoluteFill}
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
        >
          <CameraView
            ref={camera}
            style={StyleSheet.absoluteFill}
            facing="back"
            flash={flash ? 'on' : 'off'}
            // The native shutter flash is motion; reduce-motion users get the
            // haptic and the thumbnail appearing instead.
            animateShutter={!reduce}
            onCameraReady={() => setReady(true)}
            testID="scan-camera"
          />
        </View>
        <View style={[styles.frameHint, { pointerEvents: 'none' }]}>
          <Text style={styles.frameHintText}>{t('scan.frameHint')}</Text>
        </View>
        <PressScale
          style={styles.flash}
          scaleTo={0.9}
          onPress={() => {
            haptics.tap();
            setFlash((f) => !f);
          }}
          testID="scan-flash"
          accessibilityRole="switch"
          accessibilityLabel={t('scan.flash')}
          accessibilityState={{ checked: flash }}
        >
          <Ionicons name={flash ? 'flash' : 'flash-off'} size={20} color={colors.white} />
        </PressScale>
      </View>

      {/* The strip, and the note chip beside it. The chip shows before the
          first shot too: that shot is analyzed at once, so a note has to be
          writable before it. */}
      <View style={styles.stripRow}>
        {photos.map((uri, i) => (
          <View key={uri} style={styles.thumbWrap}>
            <Image source={{ uri }} style={styles.thumb} resizeMode="cover" accessibilityIgnoresInvertColors />
            <PressScale
              style={styles.thumbRemove}
              scaleTo={0.9}
              onPress={() => onRemove(i)}
              testID={`scan-shot-remove-${i}`}
              accessibilityRole="button"
              accessibilityLabel={t('scan.removePhoto', { n: i + 1 })}
              hitSlop={(TARGET - 22) / 2}
            >
              <Ionicons name="close" size={14} color={colors.onInk} />
            </PressScale>
          </View>
        ))}
        {/* The note is optional, so it is a chip, not a step: a plate with
            nothing to say about it goes straight from the shutter to the
            reading. */}
        <PressScale
          style={styles.noteChip}
          scaleTo={0.96}
          onPress={onNote}
          testID="scan-add-note"
          accessibilityRole="button"
          accessibilityHint={t('scan.noteHelp')}
        >
          <Ionicons name={hasNote ? 'create' : 'create-outline'} size={16} color={colors.ink} />
          <Text style={styles.noteChipText} numberOfLines={1}>
            {t(hasNote ? 'scan.editNote' : 'scan.addNote')}
          </Text>
        </PressScale>
      </View>

      {notice ? (
        <View style={styles.notice} testID="scan-notice">
          <Text style={styles.noticeText} accessibilityLiveRegion="polite">{notice.text}</Text>
          {notice.onSearch ? (
            <PressScale
              style={styles.noticeAction}
              scaleTo={0.96}
              onPress={notice.onSearch}
              accessibilityRole="button"
              testID="scan-search-instead"
            >
              <Ionicons name="search" size={16} color={colors.ink} />
              <Text style={styles.noticeActionText} numberOfLines={1}>{t('scan.searchInstead')}</Text>
            </PressScale>
          ) : null}
        </View>
      ) : null}

      {failed ? (
        <Text style={styles.failed} accessibilityLiveRegion="polite" testID="scan-shot-failed">
          {t('scan.shotFailed')}
        </Text>
      ) : footnote || full ? (
        <Text style={styles.footnote}>{full ? t('scan.photosFull', { max }) : footnote}</Text>
      ) : null}

      <View style={styles.controls}>
        <View style={styles.side}>
          <PressScale
            style={styles.library}
            scaleTo={0.92}
            onPress={onLibrary}
            disabled={full}
            // `scan-choose` is the intro's library button too — the Maestro
            // capture flows tap it by id, and it is the same action.
            testID="scan-choose"
            accessibilityRole="button"
            accessibilityLabel={t('scan.choose')}
            accessibilityState={{ disabled: full }}
          >
            <Ionicons name="images-outline" size={24} color={full ? colors.faint : colors.ink} />
          </PressScale>
        </View>

        <PressScale
          style={[styles.shutter, (full || busy || !ready) && styles.shutterOff]}
          scaleTo={0.92}
          onPress={shoot}
          disabled={full || busy || !ready}
          testID="scan-shutter"
          accessibilityRole="button"
          accessibilityLabel={t('scan.take')}
          accessibilityHint={full ? t('scan.photosFull', { max }) : undefined}
          accessibilityState={{ disabled: full || busy || !ready, busy: busy || !ready }}
        >
          <View style={styles.shutterDisc} />
        </PressScale>

        <View style={styles.side}>
          {photos.length ? (
            <PressScale
              style={styles.analyze}
              scaleTo={0.96}
              onPress={onAnalyze}
              disabled={busy}
              testID="scan-analyze"
              accessibilityRole="button"
              accessibilityHint={photos.length > 1 ? t('scan.multiCost', { n: photos.length }) : undefined}
              accessibilityState={{ disabled: busy }}
            >
              <Text style={styles.analyzeText} numberOfLines={1} adjustsFontSizeToFit>
                {t('scan.analyze')}
              </Text>
            </PressScale>
          ) : null}
        </View>
      </View>
    </View>
  );
}

const createStyles = ({ colors }: Theme) =>
  StyleSheet.create({
    wrap: { flex: 1, paddingHorizontal: space.lg, paddingBottom: space.lg, gap: space.md },
    viewport: { flex: 1, borderRadius: radius.lg, overflow: 'hidden', backgroundColor: colors.heroPanel },
    // On the camera feed, not a themed surface: white on a fixed dark scrim,
    // as BarcodeScanner's overlay is.
    frameHint: {
      position: 'absolute',
      left: 0,
      right: 0,
      bottom: space.md,
      alignItems: 'center',
    },
    frameHintText: {
      color: colors.white,
      fontSize: font.small,
      fontWeight: '600',
      backgroundColor: 'rgba(0,0,0,0.5)',
      borderRadius: radius.pill,
      overflow: 'hidden',
      paddingHorizontal: space.md,
      paddingVertical: space.xs,
    },
    flash: {
      position: 'absolute',
      top: space.sm,
      right: space.sm,
      width: TARGET,
      height: TARGET,
      borderRadius: TARGET / 2,
      backgroundColor: 'rgba(0,0,0,0.45)',
      alignItems: 'center',
      justifyContent: 'center',
    },
    stripRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
    thumbWrap: { width: 56, height: 56 },
    thumb: { width: '100%', height: '100%', borderRadius: radius.sm, backgroundColor: colors.card },
    thumbRemove: {
      position: 'absolute',
      top: -6,
      right: -6,
      width: 22,
      height: 22,
      borderRadius: 11,
      backgroundColor: colors.ink,
      alignItems: 'center',
      justifyContent: 'center',
    },
    noteChip: {
      flex: 1,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: space.xs,
      minHeight: TARGET,
      borderRadius: radius.md,
      borderWidth: 1,
      borderStyle: 'dashed',
      borderColor: colors.lineStrong,
      paddingHorizontal: space.sm,
    },
    noteChipText: { flexShrink: 1, fontSize: font.small, fontWeight: '700', color: colors.ink },
    footnote: { fontSize: font.small, color: colors.muted, textAlign: 'center' },
    notice: { flexDirection: 'row', alignItems: 'center', gap: space.sm, flexWrap: 'wrap' },
    noticeText: { flex: 1, minWidth: 160, fontSize: font.small, color: colors.ink },
    noticeAction: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: space.xs,
      minHeight: TARGET,
      paddingHorizontal: space.md,
      borderRadius: radius.md,
      borderWidth: 1,
      borderColor: colors.lineStrong,
      backgroundColor: colors.card,
    },
    noticeActionText: { fontSize: font.small, fontWeight: '700', color: colors.ink },
    failed: { fontSize: font.small, color: colors.danger, textAlign: 'center' },
    controls: { flexDirection: 'row', alignItems: 'center' },
    side: { flex: 1, alignItems: 'center', justifyContent: 'center' },
    library: {
      width: TARGET + 8,
      height: TARGET + 8,
      borderRadius: (TARGET + 8) / 2,
      borderWidth: 1,
      borderColor: colors.line,
      backgroundColor: colors.card,
      alignItems: 'center',
      justifyContent: 'center',
    },
    shutter: {
      width: SHUTTER,
      height: SHUTTER,
      borderRadius: SHUTTER / 2,
      borderWidth: 4,
      borderColor: colors.ink,
      alignItems: 'center',
      justifyContent: 'center',
    },
    shutterOff: { opacity: 0.4 },
    shutterDisc: { width: SHUTTER - 16, height: SHUTTER - 16, borderRadius: (SHUTTER - 16) / 2, backgroundColor: colors.ink },
    analyze: {
      minHeight: TARGET + 4,
      minWidth: 96,
      paddingHorizontal: space.md,
      borderRadius: radius.pill,
      // `ink` + `onInk`, the app's strong CTA, rather than the coral accent:
      // white on dark-theme coral is under AA, and onInk inverts with the theme.
      backgroundColor: colors.ink,
      alignItems: 'center',
      justifyContent: 'center',
    },
    analyzeText: { color: colors.onInk, fontSize: font.body, fontWeight: '700' },
  });
