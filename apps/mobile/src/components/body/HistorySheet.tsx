import type { ReactElement } from 'react';
import { SectionList, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { BottomSheet, NATIVE_SHEETS } from '@/components/BottomSheet';
import { useThemedStyles, type Theme } from '@/lib/theme-context';
import { font, space } from '@/theme';

export interface HistorySection<T> {
  /** "September 2026" — already localized by the caller. */
  title: string;
  data: T[];
}

/**
 * "Show all", as a virtualized list in a sheet (Body review, U6 + Pf3).
 *
 * "Show all" used to expand the list IN the screen's ScrollView, mounting
 * every weigh-in a user had ever recorded — a daily weigher's four years is
 * ~1,400 rows built at once, on the JS thread, to show eight. A `SectionList`
 * mounts what is on screen, and the month headers turn a wall of dates into
 * something scannable. It is a sheet rather than a route because routes under
 * `(app)/` are tabs to the tab layout (not this module's file), and a sheet
 * keeps the user's place on Body.
 *
 * Wrapped in its own `GestureHandlerRootView`: the rows are swipeable, and RNGH
 * cannot see the app root's view through a native modal (the template editor
 * learned this first).
 *
 * Height (Body re-score, bug 7): on iOS the list FILLS the sheet. The route at
 * a height detent is `flex: 1` (`app/sheet.tsx`), so the list follows the
 * detent — a fixed 72% of the window left the last rows under the edge at the
 * 0.6 detent and a fifth of the sheet empty at full height. The JS sheet
 * elsewhere is as tall as its content, where `flex: 1` measures as zero, so it
 * keeps the fixed height.
 */
export function HistorySheet<T>({
  visible,
  onClose,
  title,
  sections,
  renderItem,
  keyOf,
  testID,
}: {
  visible: boolean;
  onClose: () => void;
  title: string;
  sections: HistorySection<T>[];
  renderItem: (item: T) => ReactElement;
  keyOf: (item: T) => string;
  testID?: string;
}) {
  const styles = useThemedStyles(createStyles);
  const { height } = useWindowDimensions();
  return (
    <BottomSheet visible={visible} onClose={onClose} native detents={[0.6, 1]}>
      <GestureHandlerRootView style={NATIVE_SHEETS ? styles.fill : { height: Math.round(height * 0.72) }}>
        <Text style={styles.title} accessibilityRole="header">
          {title}
        </Text>
        <SectionList
          sections={sections}
          keyExtractor={keyOf}
          renderItem={({ item }) => <View style={styles.item}>{renderItem(item)}</View>}
          renderSectionHeader={({ section }) => (
            <Text style={styles.section} accessibilityRole="header">
              {section.title}
            </Text>
          )}
          // Not sticky: on iOS the native sheet is Liquid Glass, and an opaque
          // header bar sliding over it reads as a rendering fault.
          stickySectionHeadersEnabled={false}
          initialNumToRender={16}
          windowSize={7}
          contentContainerStyle={styles.content}
          testID={testID}
        />
      </GestureHandlerRootView>
    </BottomSheet>
  );
}

const createStyles = ({ colors }: Theme) =>
  StyleSheet.create({
    fill: { flex: 1 },
    title: { fontSize: font.h2, fontWeight: '800', color: colors.ink, marginBottom: space.sm },
    section: {
      fontSize: font.small,
      fontWeight: '700',
      color: colors.muted,
      paddingVertical: space.sm,
    },
    item: { marginBottom: space.sm },
    content: { paddingBottom: space.xl },
  });
