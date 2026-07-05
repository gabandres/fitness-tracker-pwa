import { Injectable, inject, signal } from '@angular/core';
import { Messaging, getToken, onMessage } from '@angular/fire/messaging';
import { environment } from '../../environments/environment';

export type PushPermission = 'default' | 'granted' | 'denied' | 'unsupported';

/**
 * Handles FCM push notification permission, token retrieval,
 * and foreground message display. Background messages are handled
 * by public/firebase-messaging-sw.js.
 */
@Injectable({ providedIn: 'root' })
export class PushNotificationService {
  private readonly messaging = inject(Messaging, { optional: true });

  readonly permission = signal<PushPermission>(
    'Notification' in window ? Notification.permission as PushPermission : 'unsupported',
  );
  readonly fcmToken = signal<string | null>(null);

  constructor() {
    // Native `Notification.permission` is read-once at construction. If
    // the user flips permission in browser settings (e.g. revokes after
    // granting elsewhere), the signal silently lies until the next page
    // load — and any UI gated on this state, like the post-first-entry
    // prompt on today-v2, decides wrong. Re-sync on visibility flips
    // (cheap, fires whenever the tab regains focus after settings).
    if (typeof document !== 'undefined' && 'Notification' in window) {
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState !== 'visible') return;
        const native = Notification.permission as PushPermission;
        if (this.permission() !== native) this.permission.set(native);
      });
    }
  }

  /**
   * Request notification permission and get the FCM token.
   * Must be called after user interaction (browser requirement).
   * Returns the token string or null if permission denied.
   */
  async requestPermissionAndGetToken(): Promise<string | null> {
    if (!this.messaging || !('Notification' in window)) {
      this.permission.set('unsupported');
      return null;
    }

    const result = await Notification.requestPermission();
    this.permission.set(result as PushPermission);
    if (result !== 'granted') return null;

    return this.registerAndGetToken();
  }

  /**
   * Refresh path: when Notification.permission is already 'granted' on
   * app boot, re-fetch the FCM token without prompting. FCM tokens
   * rotate (device wipe, browser data clear, server-side invalidation
   * after stale-token cleanup) — without a refresh, the saved token
   * silently goes dead and the user stops receiving pushes.
   */
  async refreshTokenIfGranted(): Promise<string | null> {
    if (!this.messaging || !('Notification' in window)) return null;
    if (Notification.permission !== 'granted') return null;
    this.permission.set('granted');
    return this.registerAndGetToken();
  }

  private static readonly FCM_SW_SCOPE = '/firebase-cloud-messaging-push-scope';
  private orphanCleaned = false;

  private async registerAndGetToken(): Promise<string | null> {
    try {
      // Migration: earlier code registered firebase-messaging-sw.js at
      // root scope `/`, which collided with ngsw. Existing devices still
      // carry that orphan registration. Unregister any FCM SW that isn't
      // on our narrow scope before installing the new one. One-shot per
      // service instance — registration list is cheap but not free.
      if (!this.orphanCleaned) {
        this.orphanCleaned = true;
        try {
          const regs = await navigator.serviceWorker.getRegistrations();
          await Promise.all(
            regs
              .filter((r) =>
                r.active?.scriptURL.includes('firebase-messaging-sw.js') &&
                r.scope.replace(/\/$/, '') !==
                  new URL(PushNotificationService.FCM_SW_SCOPE, location.origin).toString().replace(/\/$/, ''),
              )
              .map((r) => r.unregister()),
          );
        } catch { /* registration enumeration failed — non-fatal */ }
      }

      // Register the FCM service worker on a NARROW scope so it doesn't
      // collide with Angular's ngsw-worker.js (which claims root scope
      // `/`). Two SWs on the same scope → one wins silently, the other
      // never installs. Symptom: getToken() resolves but background
      // pushes never fire `onBackgroundMessage`.
      const swReg = await navigator.serviceWorker.register(
        '/firebase-messaging-sw.js',
        { scope: PushNotificationService.FCM_SW_SCOPE },
      );

      const token = await getToken(this.messaging!, {
        vapidKey: environment.firebase.vapidKey,
        serviceWorkerRegistration: swReg,
      });

      this.fcmToken.set(token);
      return token;
    } catch (err) {
      console.error('FCM token retrieval failed:', err);
      return null;
    }
  }

  /** Listen for foreground messages. Guards against duplicate listeners. */
  private unsubForeground: (() => void) | null = null;

  onForegroundMessage(callback: (title: string, body: string) => void): void {
    if (!this.messaging) return;
    this.unsubForeground?.();
    this.unsubForeground = onMessage(this.messaging, (payload) => {
      const title = payload.notification?.title ?? 'Ignia';
      const body = payload.notification?.body ?? '';
      callback(title, body);
    });
  }
}
