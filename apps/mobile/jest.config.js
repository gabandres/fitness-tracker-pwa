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
  // Jest's default is 5s, which is a generic number and not a budget anyone
  // chose for rendering React Native trees under `jest-expo`. On a contended
  // CI runner these suites take 27s wall-clock where they take 4s locally, and
  // on 2026-08-07 `entry-sheet-manual` timed out at 5s in CI having passed in
  // 391ms locally — a red main caused by runner load, not by the code under
  // test. 20s is still far below any real hang.
  testTimeout: 20000,
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
    //
    // `standard-navigation` joined the list in Expo SDK 57: expo-router 57
    // vendored react-navigation and now depends on that package instead, and it
    // ships untranspiled ESM. Every suite that `requireActual('expo-router')`
    // fails with "Cannot use import statement outside a module" without it —
    // four of them did on the SDK 57 bump.
    'node_modules/(?!((jest-)?react-native|@react-native(-community)?|expo(nent)?|@expo(nent)?/.*|@expo-google-fonts/.*|react-navigation|@react-navigation/.*|standard-navigation|@sentry/react-native|native-base|react-native-svg|@react-native-google-signin/.*|firebase|@firebase/.*))',
  ],
  collectCoverageFrom: ['src/**/*.{ts,tsx}', '!src/**/*.d.ts'],
};
