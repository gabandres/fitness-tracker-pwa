import { Platform } from 'react-native';
import { resolveSpeechLocale } from '@macrolog/core';

/**
 * The thin native seam for dictating a meal.
 *
 * The interesting decisions are pure and live in `@macrolog/core/speech-locale`
 * (which tag to ask for, and what a transcript means). This file is only the
 * parts that need a device: permissions, capability probing, and start/stop.
 *
 * `requireOptionalNativeModule`-style guarding is done with a lazy require so
 * the module's absence — Expo Go, web, or a binary built before this shipped —
 * degrades to "voice unavailable" instead of throwing at import time. That is
 * the same shape `modules/quick-add-credentials` and `src/lib/widget.ts` use.
 */

type SpeechModule = {
  requestPermissionsAsync(): Promise<{ granted: boolean; canAskAgain: boolean }>;
  getSupportedLocales(): Promise<{ locales: string[]; installedLocales: string[] }>;
  supportsOnDeviceRecognition(): boolean;
  start(opts: Record<string, unknown>): void;
  stop(): void;
  abort?(): void;
};

function native(): SpeechModule | null {
  if (Platform.OS === 'web') return null;
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    return require('expo-speech-recognition').ExpoSpeechRecognitionModule as SpeechModule;
  } catch {
    return null;
  }
}

/** Whether dictation can be offered at all in this binary. */
export function isSpeechAvailable(): boolean {
  return native() != null;
}

/**
 * Ask for mic + speech permission, at the moment the user taps the mic.
 *
 * Never on sheet open: iOS gives exactly one shot at that prompt for the life of
 * the install, and spending it before the user has expressed intent is how apps
 * get denied permanently. A denial here must leave typing completely usable —
 * the caller degrades, it does not nag.
 */
export async function requestSpeechPermission(): Promise<
  'granted' | 'denied' | 'unavailable'
> {
  const mod = native();
  if (!mod) return 'unavailable';
  try {
    const res = await mod.requestPermissionsAsync();
    return res.granted ? 'granted' : 'denied';
  } catch {
    return 'denied';
  }
}

/**
 * Which locale to dictate in, and whether it can run without the network.
 *
 * On-device is preferred but **not forced**: what someone ate is health data and
 * should stay on the phone where possible, yet a locale with no local model
 * would return silence — the worst outcome, because it is indistinguishable
 * from a broken mic. So we ask the device what it actually has and only request
 * on-device when the resolved tag is genuinely installed.
 *
 * If the capability probe fails for any reason we fall back to network
 * recognition in the resolved locale rather than giving up: platform-cloud
 * recognition still costs us nothing (it is the OS's service, not ours — this
 * feature spends no Gemini at any point).
 */
export async function speechConfigFor(
  appLocale: string,
): Promise<{ lang: string; onDevice: boolean }> {
  const mod = native();
  if (!mod) return { lang: 'en-US', onDevice: false };
  try {
    const { locales, installedLocales } = await mod.getSupportedLocales();
    const lang = resolveSpeechLocale(appLocale, locales.length ? locales : installedLocales);
    const onDevice =
      mod.supportsOnDeviceRecognition() &&
      installedLocales.some((l) => l.toLowerCase() === lang.toLowerCase());
    return { lang, onDevice };
  } catch {
    return { lang: resolveSpeechLocale(appLocale, []), onDevice: false };
  }
}

/** Begin listening. Caller subscribes to results via `useSpeechRecognitionEvent`. */
export function startListening(lang: string, onDevice: boolean): void {
  native()?.start({
    lang,
    interimResults: true,
    continuous: false,
    requiresOnDeviceRecognition: onDevice,
  });
}

export function stopListening(): void {
  native()?.stop();
}
