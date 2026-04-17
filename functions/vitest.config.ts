import { defineConfig } from 'vitest/config';

// Rules-unit-testing drives the Firestore emulator; no jsdom needed.
export default defineConfig({
  test: {
    include: ['test/**/*.spec.ts'],
    testTimeout: 20_000,
    globals: false,
  },
});
