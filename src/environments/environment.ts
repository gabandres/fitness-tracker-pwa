export const environment = {
  production: true,
  firebase: {
    projectId: 'fitness-tracker-gb-1775407101',
    appId: '1:647810616435:web:b0d7e4c6484c972a2c2e06',
    storageBucket: 'fitness-tracker-gb-1775407101.firebasestorage.app',
    apiKey: 'AIzaSyB6oYsAEinJ_-TQcMkKIIRuW5yqql8RxUs',
    authDomain: 'fitness-tracker-gb-1775407101.firebaseapp.com',
    messagingSenderId: '647810616435',
    vapidKey: 'BCPRNDtLom_i5wcXldvbNSl10mPFdUkBS5FEpb9tH9XEKB_tjM9eCTSvYPTHPLzVmvi32nnHz4uS3OJ_EkLErPE',
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
  // Stripe subscription. Paste the price IDs from your Stripe dashboard
  // after running STRIPE_SETUP.md. Empty priceIdMonthly hides the
  // Subscribe button entirely, so it's safe to commit empty values.
  // Test-mode equivalents were price_1TLaxbHvWnhD3GuYuzSJU0hs
  // (prod_UKFSWsfTK1bJqG); the test product + price are still in
  // Stripe should we ever need to re-verify a flow there.
  stripe: {
    priceIdMonthly: 'price_1TLnJdHvWnhD3GuYy7gWFvyJ',
    priceIdAnnual: 'price_1TN1eGHvWnhD3GuYS90n9x3a',
    displayPriceMonthly: '$3/mo',
    displayPriceAnnual: '$24/yr',
    // Price anchor for the annual pill — 12× monthly ($3 × 12 = $36) so
    // the savings vs raw monthly rate are visible at a glance. Leave
    // empty to hide the strike-through; never invent a number here.
    displayPriceAnnualAnchor: '$36/yr',
    annualSavingsPercent: 33,
    trialDays: 7,
  },
  // Analytics today piggybacks on Sentry breadcrumbs (zero cost, already
  // in the stack) — every event is attached to the current session, so a
  // crash report comes with the trail of paywall views / trial attempts
  // that led up to it. If/when budget allows Plausible, fill in
  // plausibleDomain and flip `plausibleEnabled` to true; the events
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
    plausibleDomain: 'macrolog.web.app',
    plausibleEndpoint: 'https://plausible.io/api/event',
  },
};
