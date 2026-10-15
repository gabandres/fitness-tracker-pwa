export const environment = {
  production: false,
  // Local dev routes at the Firebase Emulator Suite (`npm run dev` boots it).
  // The `firebase` config below still names the real project — the emulators
  // run under that same projectId (singleProjectMode) but hold isolated,
  // seeded data, so nothing here can touch prod. Set to false only if you
  // deliberately need `ng serve` to hit the live project.
  useEmulators: true,
  firebase: {
    projectId: 'fitness-tracker-gb-1775407101',
    appId: '1:647810616435:web:b0d7e4c6484c972a2c2e06',
    storageBucket: 'fitness-tracker-gb-1775407101.firebasestorage.app',
    apiKey: 'AIzaSyB6oYsAEinJ_-TQcMkKIIRuW5yqql8RxUs',
    authDomain: 'fitness-tracker-gb-1775407101.firebaseapp.com',
    messagingSenderId: '647810616435',
  },
  sentry: {
    dsn: '',
    sampleRate: 1.0,
  },
  // Dev never ships to Plausible; we only want the console + Sentry
  // breadcrumb side effects so we can verify events wire correctly.
  analytics: {
    plausibleEnabled: false,
    plausibleDomain: '',
    plausibleEndpoint: 'https://plausible.io/api/event',
  },
};
