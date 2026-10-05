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
  const guarded = !!entry?.guarded;
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
      <Reanimated.View style={[styles.pad, !fit && styles.root, !fit && padding]}>
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

const createStyles = ({ colors }: Theme) =>
  StyleSheet.create({
    root: { flex: 1 },
    chainStop: { height: 0 },
    surface: {
      // iOS paints the sheet itself (Liquid Glass on 26); everywhere else the
      // route is the surface.
      backgroundColor: Platform.OS === 'ios' ? 'transparent' : colors.paper,
    },
    pad: {
      paddingHorizontal: space.xl,
      paddingTop: space.xl,
    },
  });
