import type { TFn } from '@/i18n';
import type { MenuButtonAction } from '@/components/MenuButton';
import type { ExerciseMenuAction } from './ExerciseMenuSheet';

/**
 * The live session's ⋯ rows (`ExerciseMenuAction`, built for
 * `ExerciseMenuSheet`) as native menu rows (`MenuButton`). One list feeds both,
 * so the sheet — the fallback on binaries without `modules/native-menu-button`
 * — and the system menu cannot offer different actions.
 */

/** The Ionicons the Train menus use → the SF Symbol for the same idea. A row
 *  whose icon is missing here simply shows no image on iOS. */
export const IONICON_TO_SF: Readonly<Record<string, string>> = {
  'add-circle-outline': 'plus.circle',
  'arrow-down-outline': 'arrow.down',
  'arrow-up-outline': 'arrow.up',
  'arrow-undo-outline': 'arrow.uturn.backward',
  'barbell-outline': 'dumbbell',
  'copy-outline': 'plus.square.on.square',
  'layers-outline': 'square.stack.3d.up',
  'options-outline': 'slider.horizontal.3',
  'reorder-three-outline': 'arrow.up.arrow.down',
  'stats-chart-outline': 'chart.line.uptrend.xyaxis',
  'swap-horizontal-outline': 'arrow.left.arrow.right',
  'timer-outline': 'timer',
  'trash-outline': 'trash',
  'walk-outline': 'figure.walk',
};

export function toMenuButtonActions(actions: readonly ExerciseMenuAction[], t: TFn): MenuButtonAction[] {
  return actions.map((a) => {
    const subtitle = a.desc ?? (a.descKey ? t(a.descKey) : undefined);
    const sfSymbol = IONICON_TO_SF[a.icon as string];
    return {
      key: a.key,
      title: t(a.labelKey),
      ...(subtitle ? { subtitle } : {}),
      ...(sfSymbol ? { sfSymbol } : {}),
      ...(a.destructive ? { destructive: true } : {}),
      onPress: a.onPress,
    };
  });
}
