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

  private async registerAndGetToken(): Promise<string | null> {
    try {
      // Register the FCM service worker on a NARROW scope so it doesn't
      // collide with Angular's ngsw-worker.js (which claims root scope
      // `/`). Two SWs on the same scope → one wins silently, the other
      // never installs. Symptom: getToken() resolves but background
      // pushes never fire `onBackgroundMessage`.
      const swReg = await navigator.serviceWorker.register(
        '/firebase-messaging-sw.js',
        { scope: '/firebase-cloud-messaging-push-scope' },
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
      const title = payload.notification?.title ?? 'Macro Log';
      const body = payload.notification?.body ?? '';
      callback(title, body);
    });
  }
}
