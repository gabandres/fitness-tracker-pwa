import { ApplicationConfig, ErrorHandler, provideBrowserGlobalErrorListeners } from '@angular/core';
import * as Sentry from '@sentry/angular';
import { provideRouter } from '@angular/router';
import { provideFirebaseApp, initializeApp, getApp } from '@angular/fire/app';
import {
  provideFirestore,
  initializeFirestore,
  connectFirestoreEmulator,
} from '@angular/fire/firestore';
import { provideAuth, getAuth, connectAuthEmulator } from '@angular/fire/auth';
import { provideFunctions, getFunctions, connectFunctionsEmulator } from '@angular/fire/functions';
import { LucideAngularModule, Check } from 'lucide-angular';

import { routes } from './app.routes';
import { environment } from '../environments/environment';
import { provideTranslocoConfig } from './i18n/transloco.providers';

/**
 * The web shell's providers (ADR-0036). What is NOT here is the point:
 * no service worker (the PWA is retired and `safety-worker.js` is what ships
 * at `/ngsw-worker.js` now), no Messaging (web push went with it), no
 * Storage (nothing on the shell uploads), no persistent Firestore cache
 * (the admin panel reads live data and the public pages read one doc each).
 */
export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideRouter(routes),
    provideFirebaseApp(() => initializeApp(environment.firebase)),
    // In dev (environment.useEmulators), point every Firebase service at the
    // local Emulator Suite (`npm run dev`) so nothing touches prod data.
    provideAuth(() => {
      const auth = getAuth();
      if (environment.useEmulators) {
        connectAuthEmulator(auth, 'http://localhost:9099', { disableWarnings: true });
      }
      return auth;
    }),
    provideFunctions(() => {
      const functions = getFunctions();
      if (environment.useEmulators) connectFunctionsEmulator(functions, 'localhost', 5001);
      return functions;
    }),
    provideFirestore(() => {
      const fs = initializeFirestore(getApp(), {});
      if (environment.useEmulators) connectFirestoreEmulator(fs, 'localhost', 8080);
      return fs;
    }),
    provideTranslocoConfig(),
    // Sentry error handler: reports uncaught exceptions to Sentry when a
    // DSN is configured. When no DSN is set, Sentry.init() in main.ts is
    // skipped and this handler silently passes through.
    { provide: ErrorHandler, useValue: Sentry.createErrorHandler() },
    // Lucide icons used by the surviving components. Each icon must be
    // registered here so `<lucide-icon name="…">` resolves at runtime.
    LucideAngularModule.pick({ Check }).providers!,
  ],
};
