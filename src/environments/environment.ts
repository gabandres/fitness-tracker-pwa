export const environment = {
  production: true,
  firebase: {
    projectId: 'fitness-tracker-gb-1775407101',
    appId: '1:647810616435:web:b0d7e4c6484c972a2c2e06',
    storageBucket: 'fitness-tracker-gb-1775407101.firebasestorage.app',
    apiKey: 'AIzaSyB6oYsAEinJ_-TQcMkKIIRuW5yqql8RxUs',
    authDomain: 'fitness-tracker-gb-1775407101.firebaseapp.com',
    messagingSenderId: '647810616435',
  },
  // HTTP-referrer-locked to macrolog.web.app + localhost:4200.
  // Free tier; no billing linked — worst case of leak is quota burn.
  gemini: {
    apiKey: 'AIzaSyAQ4evv79iwaktmYj-ZN9pD0RU5yT9s53E',
    model: 'gemini-3.1-flash-preview',
  },
};
