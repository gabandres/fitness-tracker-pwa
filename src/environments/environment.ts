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
  // HTTP-referrer-locked to macrolog.web.app + localhost:4200.
  // Free tier; no billing linked — worst case of leak is quota burn.
  gemini: {
    apiKey: 'AIzaSyAQ4evv79iwaktmYj-ZN9pD0RU5yT9s53E',
    // Moving alias — always tracks the latest stable flash model.
    // Real options today include: gemini-2.5-flash (stable pin),
    // gemini-3-flash-preview, gemini-3.1-flash-lite-preview, gemini-pro-latest.
    model: 'gemini-flash-latest',
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
  // Stripe subscription. Paste the price ID from your Stripe dashboard
  // after running STRIPE_SETUP.md. Empty priceId hides the Subscribe
  // button entirely, so it's safe to commit an empty value.
  stripe: {
    // Macro Log Pro — $3/mo recurring. LIVE MODE.
    // Test-mode equivalent was price_1TLaxbHvWnhD3GuYuzSJU0hs
    // (prod_UKFSWsfTK1bJqG); the test product + price are still in
    // Stripe should we ever need to re-verify a flow there.
    priceId: 'price_1TLnJdHvWnhD3GuYy7gWFvyJ',
    displayPrice: '$3/mo',
    trialDays: 7,
  },
};
