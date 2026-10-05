import Ionicons from '@expo/vector-icons/Ionicons';
import type { ReactNode } from 'react';
import { Platform, TouchableOpacity, type StyleProp, type ViewStyle } from 'react-native';
import * as haptics from '@/lib/haptics';
import { useTheme } from '@/lib/theme-context';
import { NativeMenuButtonView, type NativeMenuAction } from '../../modules/native-menu-button';

/**
 * A "⋯" (or any face) that opens the SYSTEM menu on tap — a pull-down
 * `UIMenu` anchored to the button on iOS, an anchored `PopupMenu` on Android
 * (`modules/native-menu-button`). One tap, no sheet: the menu is drawn by the
 * OS, next to the thing it acts on, and dismissed by tapping anywhere.
 *
 * ## Fallback
 *
 * Where the module is absent (Expo Go, web, an older binary an OTA reached)
 * this renders the same face as a plain button that calls `onFallbackPress` —
 * the caller passes whatever it did before (open its menu sheet), so an old
 * binary keeps the old behaviour exactly and nothing has to be duplicated.
 *
 * ## The face
 *
 * `children` when given (a chip, a label); otherwise an ellipsis — an SF Symbol
 * drawn natively on iOS, the Ionicons glyph the app already uses on Android and
 * in the fallback. Size the hit target with `style` (44 pt minimum, as every
 * `headerIconBtn` here already is).
 *
 * ## Picks
 *
 * Each action's `onPress` runs once the system menu has closed — so a row that
 * opens a sheet can present it directly (no `SHEET_HANDOFF_MS` wait: there is
 * no sheet dismissing underneath it).
 */

export interface MenuButtonAction {
  key: string;
  title: string;
  subtitle?: string;
  /** iOS SF Symbol. */
  sfSymbol?: string;
  destructive?: boolean;
  disabled?: boolean;
  onPress: () => void;
}

/** True where `MenuButton` opens a native menu rather than `onFallbackPress`. */
export const hasNativeMenuButton = NativeMenuButtonView != null;

/** The native rows for `actions` — drops `onPress`, which cannot cross the
 *  bridge, and empty optionals. Pure — tested. */
export function toNativeMenuActions(actions: readonly MenuButtonAction[]): NativeMenuAction[] {
  return actions.map((a) => ({
    key: a.key,
    title: a.title,
    ...(a.subtitle ? { subtitle: a.subtitle } : {}),
    ...(a.sfSymbol ? { sfSymbol: a.sfSymbol } : {}),
    ...(a.destructive ? { destructive: true } : {}),
    ...(a.disabled ? { disabled: true } : {}),
  }));
}

/** Run the action a native pick named. Unknown or disabled keys do nothing.
 *  Pure apart from the call — tested. */
export function dispatchMenuAction(actions: readonly MenuButtonAction[], key: string): boolean {
  const action = actions.find((a) => a.key === key);
  if (!action || action.disabled) return false;
  action.onPress();
  return true;
}

export function MenuButton({
  actions,
  title,
  accessibilityLabel,
  accessibilityHint,
  testID,
  onFallbackPress,
  children,
  style,
  iconSize = 22,
  iconColor,
  enabled = true,
}: {
  actions: MenuButtonAction[];
  /** iOS: the menu's header line (e.g. the exercise name). */
  title?: string;
  accessibilityLabel: string;
  accessibilityHint?: string;
  testID?: string;
  /** What a tap does where there is no native menu — usually: open the sheet. */
  onFallbackPress: () => void;
  children?: ReactNode;
  style?: StyleProp<ViewStyle>;
  iconSize?: number;
  iconColor?: string;
  enabled?: boolean;
}) {
  const { colors } = useTheme();
  const tint = iconColor ?? colors.muted;
  const glyph = <Ionicons name="ellipsis-horizontal" size={iconSize} color={tint} />;

  if (NativeMenuButtonView != null) {
    const Native = NativeMenuButtonView;
    const ios = Platform.OS === 'ios';
    return (
      <Native
        style={style}
        actions={toNativeMenuActions(actions)}
        title={title}
        enabled={enabled}
        showsIcon={ios && children == null}
        iconName="ellipsis"
        iconSize={iconSize - 2}
        iconColor={tint}
        // iOS: on the native button (the one accessible element). Android:
        // on the view itself, which TalkBack reads as a button.
        buttonAccessibilityLabel={accessibilityLabel}
        buttonAccessibilityHint={accessibilityHint}
        buttonTestID={testID}
        {...(ios
          ? {}
          : {
              accessible: true,
              accessibilityRole: 'button' as const,
              accessibilityLabel,
              accessibilityHint,
              accessibilityState: { disabled: !enabled },
              testID,
            })}
        onAction={(e) => {
          haptics.selection();
          dispatchMenuAction(actions, e.nativeEvent.key);
        }}
      >
        {children ?? (ios ? null : glyph)}
      </Native>
    );
  }

  return (
    <TouchableOpacity
      style={style}
      onPress={onFallbackPress}
      disabled={!enabled}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ disabled: !enabled }}
      testID={testID}
    >
      {children ?? glyph}
    </TouchableOpacity>
  );
}
