import { defineConfig } from 'vitest/config';

// Rules-unit-testing drives the Firestore emulator; no jsdom needed.
export default defineConfig({
  test: {
    include: ['test/**/*.spec.ts'],
    // 60 s since 2026-11-19: on the ARM Windows PC the first emulator call of a
    // file takes 6–9 s, and 9 hook / first-test timeouts failed a suite whose
    // 1,309 tests all pass once given the time.
    testTimeout: 60_000,
    hookTimeout: 60_000,
    globals: false,
  },
});
