import { useEffect, useRef } from 'react';
import { Platform, StyleSheet, View } from 'react-native';
import { useLocalSearchParams, useNavigation } from 'expo-router';
import { usePreventRemove } from 'expo-router/react-navigation';
import Reanimated from 'react-native-reanimated';
import { ConfirmHost } from '@/components/ConfirmSheet';
import { ToastSheetHost } from '@/components/Toast';
import { useKeyboardSheetPadding } from '@/lib/use-keyboard-sheet-style';
import {
  dismissSheet,
  getSheetPortal,
  isClosing,
  registerPresenter,
  useSheetPortal,
  type PortalCloseVia,
} from '@/lib/sheet-portal';
import { useThemedStyles, type Theme } from '@/lib/theme-context';
import { space } from '@/theme';

/**
 * The native sheet (UX_AUDIT S20): a `formSheet` on the root stack that renders
 * whatever `BottomSheet native` published under `id` (`lib/sheet-portal.ts`).
 *
 * iOS presents it with `UISheetPresentationController` — real detents, the
 * system grabber, the interactive swipe-down, the dimming view, and on iOS 26
 * the Liquid Glass material at the smaller detent. None of that is drawn here.
 * What IS here is what the JS sheet used to carry inside its `Modal`: the
 * in-sheet toast host and confirm host (iOS cannot present a modal from a
 * controller that is already presenting one, and this sheet IS one), and the
 * keyboard padding.
 */
export default function SheetRoute() {
  const params = useLocalSearchParams<{ id: string; [key: string]: string }>();
  const id = params.id;
  const navigation = useNavigation();
  const entry = useSheetPortal(id);
  const styles = useThemedStyles(createStyles);
  const padding = useKeyboardSheetPadding(space.lg);

  // Registered for the route's lifetime. `dismiss` pops THIS route — the
  // navigation object is the screen's own, so `goBack` targets its key.
  const userDismissed = useRef(true);
  useEffect(() => {
    if (!id) return;
    const unregister = registerPresenter(id, {
      dismiss: () => {
        userDismissed.current = false;
        navigation.goBack();
      },
    });
    if (getSheetPortal(id)?.visible === false) {
      // The owner closed between the push and this mount.
      dismissSheet(id);
    }
    return () => {
      unregister();
      // Gone without the owner asking: a swipe-down, a tap on the dimmed area,
      // or Android back on an unguarded sheet. Let the owner catch up.
      if (userDismissed.current) getSheetPortal(id)?.requestClose('drag');
    };
  }, [id, navigation]);

  // A guarded sheet (typed content) refuses the native dismissal; the owner
  // decides — usually by asking. A programmatic close is always let through.
  const guarded = !!entry?.guarded || (Platform.OS === 'android' && !!entry?.backSteps);
  usePreventRemove(guarded, ({ data }) => {
    if (!id) return;
    if (isClosing(id)) {
      navigation.dispatch(data.action);
      return;
    }
    const via: PortalCloseVia = data.action.type === 'GO_BACK' ? 'back' : 'drag';
    const closed = getSheetPortal(id)?.requestClose(via) !== false;
    // The owner closed (it will dismiss through `dismissSheet`, which sets
    // `closing`) — nothing to do here. Otherwise the sheet stays put.
    void closed;
  });

  // A `'fit'` sheet is as tall as its content: iOS measures the content, so
  // nothing here may stretch to fill (`flex: 1` would measure as zero).
  const fit = params.detents === 'fit';
  if (!entry) return <View style={fit ? null : styles.root} />;
  return (
    <View style={[styles.surface, !fit && styles.root]} testID={entry.testID}>
      {/* Keyboard: iOS lifts a `'fit'` sheet above the keyboard itself, so
          padding it as well left a screen-tall sheet with a blank band. A
          sheet at a height detent stays put, and its content needs the room. */}
      {/* Android: the Material drag handle (32 × 4 dp). iOS draws its own
          grabber (`sheetGrabberVisible`). Decorative — back and the scrim are
          the accessible ways out. */}
      {Platform.OS === 'android' ? (
        <View style={styles.handleZone} importantForAccessibility="no-hide-descendants">
          <View style={styles.handle} />
        </View>
      ) : null}
      <Reanimated.View style={[styles.pad, Platform.OS === 'android' && styles.padAndroid, !fit && styles.root, (!fit || Platform.OS === 'android') && padding]}>
        {/* react-native-screens pins the FIRST scroll view it finds down a
            sheet's first-child chain to x = 0, which threw away the padding
            whenever a sheet opened on a ScrollView: every Train sheet drew its
            first letters off the left edge (Maestro 16, iOS 26). An empty native
            view first means the chain ends here, not at the content's
            ScrollView. `collapsable={false}`, or Fabric flattens it away.
            (Wrapping the content in a box instead fixed the shift but lost the
            meal form's typed name — Maestro 11 — so it is a sibling.) */}
        <View collapsable={false} style={styles.chainStop} />
        {entry.node}
      </Reanimated.View>
      {entry.overlays ? <ToastSheetHost sheetId={id} /> : null}
      {entry.overlays ? <ConfirmHost /> : null}
    </View>
  );
}

const createStyles = ({ colors, scheme }: Theme) =>
  StyleSheet.create({
    root: { flex: 1 },
    chainStop: { height: 0 },
    surface: {
      // The route paints an OPAQUE surface on every platform. iOS 26 draws
      // Liquid Glass behind a sheet below its full detent, and this was
      // transparent so the glass showed — but glass shows what is behind it:
      // the orange + and the dark hero card read through the text of every
      // `fit` / half-height sheet (S21 simulator QA, the maintenance, Body and
      // Train glossaries). The add sheet looked right only because it opens at
      // the full detent, where iOS goes opaque on its own. UIKit still clips
      // the surface to the sheet's rounded shape and keeps its edge; Android
      // keeps Material's 28 dp top corners.
      //
      // Dark mode takes the ELEVATED surface, `card`, plus a
      // hairline (S21): `paper` is the canvas the sheet rises over, and under
      // the scrim it measured 1.05:1 against it — the sheet's edge was a
      // guess. It is the fix the JS sheet always carried for the meal sheet
      // (`EntrySheet`'s `sheetDark` contentStyle), which this native path
      // dropped when Android moved to native sheets (`2cee36b7`); here it
      // covers every native sheet, not just that one.
      backgroundColor: scheme === 'dark' ? colors.card : colors.paper,
      ...(Platform.OS === 'android'
        ? { borderTopLeftRadius: 28, borderTopRightRadius: 28, overflow: 'hidden' as const }
        : null),
      ...(Platform.OS === 'android' && scheme === 'dark'
        ? { borderTopWidth: StyleSheet.hairlineWidth, borderColor: colors.lineStrong }
        : null),
    },
    handleZone: { alignItems: 'center', paddingTop: 16, paddingBottom: 6 },
    handle: { width: 32, height: 4, borderRadius: 2, backgroundColor: colors.lineStrong },
    // The handle zone already gives the top its room.
    padAndroid: { paddingTop: space.sm },
    pad: {
      paddingHorizontal: space.xl,
      paddingTop: space.xl,
    },
  });
