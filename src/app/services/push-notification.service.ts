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
  private readonly messaging = inject(Messaging);

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
    if (!('Notification' in window)) {
      this.permission.set('unsupported');
      return null;
    }

    const result = await Notification.requestPermission();
    this.permission.set(result as PushPermission);
    if (result !== 'granted') return null;

    try {
      // Register the FCM-specific service worker.
      const swReg = await navigator.serviceWorker.register('/firebase-messaging-sw.js');

      const token = await getToken(this.messaging, {
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

  /** Listen for foreground messages and invoke a callback. */
  onForegroundMessage(callback: (title: string, body: string) => void): void {
    onMessage(this.messaging, (payload) => {
      const title = payload.notification?.title ?? 'Macro Log';
      const body = payload.notification?.body ?? '';
      callback(title, body);
    });
  }
}
