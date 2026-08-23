import { Alert, Linking } from 'react-native';
import type { TFn } from '@/i18n';

/**
 * Open a web link, and survive the device saying no.
 *
 * ## The defect this closes
 *
 * Every external link in Settings called `Linking.openURL(url)` bare — no
 * `await`, no `.catch()`, no `void`. That promise rejects, and a rejected
 * promise nobody handles is reported by Sentry exactly like a crash.
 *
 * It was not theoretical. `IGNIA-MOBILE-8`: ten events from one user on
 * **iPhone 17,2 / iOS 26.6.1, release 1.2.0 build 55 — the public App Store
 * build** — spread over ten days, every one of them
 * `Unable to open URL: https://ignia.fit/support`, with a touch on a Text
 * element as the last breadcrumb. Someone tapped *Help and support* ten times
 * across ten days and the app did nothing at all, ten times, in silence.
 *
 * `openURL` rejects when iOS declines to hand the URL anywhere — Screen Time
 * or MDM web restrictions, a managed-device profile, no browser able to claim
 * https. None of that is recoverable from inside the app, and none of it is a
 * bug in the app. What IS a bug is having no answer for it.
 *
 * So: the failure becomes an alert carrying the URL itself, which the user can
 * read and type somewhere else. `/privacy` and `/terms` use this same path,
 * and those two are not optional decoration — Apple 5.1.1(i) requires the
 * privacy policy to be reachable inside the app, so a silent no-op there is a
 * review risk on top of a user-facing one.
 *
 * Failures are swallowed after the alert rather than rethrown. The user has
 * already been told, by the alert, in their own language; re-raising would put
 * the same non-actionable event back into Sentry, which is where this started.
 */
export async function openExternal(url: string, t?: TFn): Promise<void> {
  try {
    await Linking.openURL(url);
  } catch {
    Alert.alert(
      t ? t('link.failedTitle') : "Couldn't open that link",
      t ? t('link.failedBody', { url }) : `Open this in your browser instead:\n\n${url}`,
    );
  }
}
