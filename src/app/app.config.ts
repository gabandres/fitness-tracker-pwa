import { ApplicationConfig, EnvironmentProviders, ErrorHandler, provideBrowserGlobalErrorListeners, isDevMode } from '@angular/core';
import * as Sentry from '@sentry/angular';
import { provideRouter } from '@angular/router';
import { provideFirebaseApp, initializeApp, getApp } from '@angular/fire/app';
import {
  provideFirestore,
  initializeFirestore,
  persistentLocalCache,
  persistentMultipleTabManager,
} from '@angular/fire/firestore';
import { provideAuth, getAuth } from '@angular/fire/auth';
import { provideFunctions, getFunctions } from '@angular/fire/functions';
import { provideMessaging, getMessaging } from '@angular/fire/messaging';
import {
  LucideAngularModule,
  Plus,
  X,
  Calendar,
  Settings,
  Moon,
  Sun,
  Trash2,
  CircleDot,
  TrendingUp,
  Activity,
  Camera,
  ScanLine,
  Flame,
  ChevronLeft,
  ChevronRight,
  Check,
  HelpCircle,
  ArrowLeft,
  Pencil,
  Sparkles,
  Droplets,
  Footprints,
  Image as LucideImage,
  Type as LucideType,
  Home,
  User,
  Timer,
  Scale,
  Ruler,
  ChevronDown,
  Share2,
} from 'lucide-angular';

import { routes } from './app.routes';
import { provideServiceWorker } from '@angular/service-worker';
import { environment } from '../environments/environment';
import { provideTranslocoConfig } from './i18n/transloco.providers';
import { LEDGER_PORT } from './ledger/ports/ledger.port';
import { FirebaseService } from './services/firebase.service';

/**
 * Only provide Firebase Messaging when the browser supports the required APIs
 * (Notification API + Service Worker). This avoids the
 * "messaging/unsupported-browser" FirebaseError in browsers like older Safari,
 * Firefox private browsing, or SSR environments.
 */
function provideMessagingIfSupported(): EnvironmentProviders[] {
  if (typeof window !== 'undefined'
    && 'Notification' in window
    && 'serviceWorker' in navigator) {
    return [provideMessaging(() => getMessaging())];
  }
  return [];
}

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideRouter(routes),
    provideFirebaseApp(() => initializeApp(environment.firebase)),
    provideAuth(() => getAuth()),
    provideFunctions(() => getFunctions()),
    ...provideMessagingIfSupported(),
    // Enable Firestore offline persistence so writes queue locally
    // when the user is offline and sync when the connection returns.
    provideFirestore(() =>
      initializeFirestore(getApp(), {
        localCache: persistentLocalCache({
          tabManager: persistentMultipleTabManager(),
        }),
      }),
    ),
    provideServiceWorker('ngsw-worker.js', {
      enabled: !isDevMode(),
      registrationStrategy: 'registerWhenStable:30000',
    }),
    provideTranslocoConfig(),
    // Sentry error handler: reports uncaught exceptions to Sentry when a
    // DSN is configured. When no DSN is set, Sentry.init() in main.ts is
    // skipped and this handler silently passes through — no user-visible
    // difference from the default Angular handler.
    { provide: ErrorHandler, useValue: Sentry.createErrorHandler() },
    // LedgerStore seam (#6): the app depends on LEDGER_PORT; FirebaseService is one impl.
    { provide: LEDGER_PORT, useExisting: FirebaseService },
    // Lucide icons used by v2 primitives. Each icon must be registered
    // here (or in the consuming component) so the LucideAngularComponent
    // can resolve <lucide-icon name="…"> at runtime. Tree-shakes per
    // import so unused icons are never bundled.
    LucideAngularModule.pick({
      Plus, X, Calendar, Settings, Moon, Sun, Trash2,
      CircleDot, TrendingUp, Activity, Camera, ScanLine,
      Flame, ChevronLeft, ChevronRight, Check, HelpCircle,
      ArrowLeft, Pencil, Sparkles, Droplets, Footprints,
      Image: LucideImage, Type: LucideType,
      Home, User, Timer, Scale, Ruler, ChevronDown, Share2,
    }).providers!,
  ],
};
