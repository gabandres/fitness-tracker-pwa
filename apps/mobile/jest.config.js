/**
 * Jest for the Expo app.
 *
 * `jest-expo` is the preset that mocks the native side of the SDK, which is
 * the only reason these tests can run without a device. Its transformIgnore
 * list has to cover every RN/Expo package that ships untranspiled ESM — the
 * default list misses a few this app depends on, and the symptom is an
 * "Unexpected token 'export'" inside node_modules rather than in your test.
 *
 * Scope note: this layer catches WIRING and LOGIC. It does NOT catch layout —
 * RNTL renders the element tree but never runs a Yoga layout pass, so a view
 * collapsed to zero height (the `flex: 1`-in-a-column bug that hid measurement
 * input, 2026-08-05) still renders and still passes here. Layout regressions
 * belong to the Maestro flows in apps/mobile/.maestro.
 */
module.exports = {
  preset: 'jest-expo',
  setupFilesAfterEnv: ['<rootDir>/jest.setup.js'],
  testMatch: ['<rootDir>/src/**/*.test.ts', '<rootDir>/src/**/*.test.tsx'],
  // Mirrors tsconfig.json `paths` — jest does not read tsconfig.
  moduleNameMapper: {
    '^@/assets/(.*)$': '<rootDir>/assets/$1',
    '^@/(.*)$': '<rootDir>/src/$1',
  },
  transformIgnorePatterns: [
    // `firebase`/`@firebase` ship untranspiled ESM and are imported by
    // src/lib/auth.tsx, so any test that requireActual's the auth module hits
    // "Unexpected token 'export'" from inside node_modules without them here.
    'node_modules/(?!((jest-)?react-native|@react-native(-community)?|expo(nent)?|@expo(nent)?/.*|@expo-google-fonts/.*|react-navigation|@react-navigation/.*|@sentry/react-native|native-base|react-native-svg|@react-native-google-signin/.*|firebase|@firebase/.*))',
  ],
  collectCoverageFrom: ['src/**/*.{ts,tsx}', '!src/**/*.d.ts'],
};
