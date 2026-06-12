import { defineConfig } from 'vitest/config';

// Emulator arm of the ledger contract (issue #6 phase 3). Plain node —
// FirestoreLedgerCore is framework-free, so no Angular TestBed/jsdom is
// involved. Run via `npm run test:ledger`, never by `ng test` (which only
// picks up `*.spec.ts`).
export default defineConfig({
  test: {
    include: ['src/app/ledger/infrastructure/*.emulator.test.ts'],
    environment: 'node',
    testTimeout: 20_000,
    globals: false,
  },
});
