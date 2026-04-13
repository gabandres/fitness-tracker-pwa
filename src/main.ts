import { bootstrapApplication } from '@angular/platform-browser';
import * as Sentry from '@sentry/angular';
import { appConfig } from './app/app.config';
import { App } from './app/app';
import { environment } from './environments/environment';

// Initialize Sentry BEFORE bootstrap so it can capture init errors too.
// No-op when DSN is empty — safe to ship without a real DSN configured.
if (environment.sentry.dsn) {
  Sentry.init({
    dsn: environment.sentry.dsn,
    sampleRate: environment.sentry.sampleRate,
    // Release tag: use the Firebase hosting version so dashboards group
    // errors by deploy. Falls back to 'dev' when not set.
    release: (globalThis as any).__MACROLOG_RELEASE__ ?? 'dev',
    environment: environment.production ? 'prod' : 'dev',
  });
}

bootstrapApplication(App, appConfig)
  .catch((err) => console.error(err));
