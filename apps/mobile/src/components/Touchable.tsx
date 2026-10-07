import type { ComponentProps } from 'react';
import { Platform, Pressable, TouchableOpacity } from 'react-native';

/**
 * The Android ink ripple — the same neutral grey `PressScale` uses
 * (`lib/motion.tsx`), drawn in the foreground so it reads over an ink fill, a
 * card and the paper alike, in both themes. For a `Pressable` that sets
 * `android_ripple` itself.
 */
export const RIPPLE = { color: 'rgba(128, 128, 128, 0.22)', foreground: false } as const;

/**
 * `TouchableOpacity` on iOS, a rippling `Pressable` on Android — for primary
 * controls: filled CTAs and list rows that navigate.
 *
 * A Material user reads the ripple as "this is a button"; an opacity dip is
 * the iOS idiom and on Android looked like nothing happened (UX_AUDIT S20,
 * Impeccable: "no ripple on custom buttons"). Not `PressScale`: that swaps the
 * iOS opacity dip for a spring scale, and iOS press feedback was to stay
 * exactly as it was. Same props as `TouchableOpacity`; `activeOpacity` is the
 * iOS half's and is dropped on Android.
 *
 * Born in Train (`train/Touchable.tsx`, S20) and promoted here 2026-10-06
 * (S21 sweep) for Settings, Body, Connected apps, Coach, History and the
 * targets/feedback screens. Train still imports it through its old path.
 */
export function Touchable({ activeOpacity, ...rest }: ComponentProps<typeof TouchableOpacity>) {
  if (Platform.OS !== 'android') return <TouchableOpacity activeOpacity={activeOpacity} {...rest} />;
  return <Pressable android_ripple={RIPPLE} {...(rest as ComponentProps<typeof Pressable>)} />;
}
