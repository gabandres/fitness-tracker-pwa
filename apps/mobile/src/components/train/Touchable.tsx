import type { ComponentProps } from 'react';
import { Platform, Pressable, TouchableOpacity } from 'react-native';

/**
 * The Android ink ripple — the same neutral grey `PressScale` uses
 * (`lib/motion.tsx`), drawn in the foreground so it reads over an ink fill, a
 * card and the paper alike, in both themes. For a train `Pressable` that sets
 * `android_ripple` itself.
 */
export const TRAIN_RIPPLE = { color: 'rgba(128, 128, 128, 0.22)', foreground: true } as const;

/**
 * `TouchableOpacity` on iOS, a rippling `Pressable` on Android — Train's
 * buttons and rows.
 *
 * A Material user reads the ripple as "this is a button"; an opacity dip is
 * the iOS idiom and on Android looked like nothing happened (UX_AUDIT S20,
 * Impeccable: "no ripple on custom buttons"). Not `PressScale`: that swaps the
 * iOS opacity dip for a spring scale, and iOS press feedback was to stay
 * exactly as it was. Same props as `TouchableOpacity`; `activeOpacity` is the
 * iOS half's and is dropped on Android.
 */
export function Touchable({ activeOpacity, ...rest }: ComponentProps<typeof TouchableOpacity>) {
  if (Platform.OS !== 'android') return <TouchableOpacity activeOpacity={activeOpacity} {...rest} />;
  return <Pressable android_ripple={TRAIN_RIPPLE} {...(rest as ComponentProps<typeof Pressable>)} />;
}
