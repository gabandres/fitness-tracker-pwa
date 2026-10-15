export const environment = {
  production: true,
  // Prod always talks to the real Firebase project. The dev config
  // (environment.development.ts) flips this to route local `ng serve` at the
  // Firebase Emulator Suite instead, so development never writes to prod data.
  useEmulators: false,
  firebase: {
    projectId: 'fitness-tracker-gb-1775407101',
    appId: '1:647810616435:web:b0d7e4c6484c972a2c2e06',
    storageBucket: 'fitness-tracker-gb-1775407101.firebasestorage.app',
    apiKey: 'AIzaSyB6oYsAEinJ_-TQcMkKIIRuW5yqql8RxUs',
    authDomain: 'fitness-tracker-gb-1775407101.firebaseapp.com',
    messagingSenderId: '647810616435',
  },
  // Sentry error monitoring. Paste your DSN here — if left empty, the
  // integration no-ops (no init, no error handler registration), so
  // there's no cost to committing an empty value. DSNs are a public
  // identifier; safe to commit alongside other env config.
  sentry: {
    dsn: 'https://04ad050b06e105d05b66ff645e45557b@o507481.ingest.us.sentry.io/4511210459889664',
    // 1.0 = sample every error; 0.0 = sample none. Client-side only.
    sampleRate: 1.0,
  },
  // Analytics today piggybacks on Sentry breadcrumbs (zero cost, already
  // in the stack) — every event is attached to the current session, so a
  // crash report comes with the trail of events that led up to it.
  // If/when budget allows Plausible, fill in plausibleDomain and flip `plausibleEnabled` to true; the events
  // already emit, they just don't ship to Plausible. No other wiring
  // needed.
  analytics: {
    // Plausible is paid (~$9/mo) and requires the domain to be
    // registered in a Plausible account; until there's a subscription
    // in place, events would fire into the void. Keep the wiring so
    // flipping the flag back on is a one-line change, but leave it
    // off. Sentry breadcrumbs in AnalyticsService still capture the
    // funnel trail on any error report at zero cost.
    plausibleEnabled: false,
    plausibleDomain: 'ignia.fit',
    plausibleEndpoint: 'https://plausible.io/api/event',
  },
};
