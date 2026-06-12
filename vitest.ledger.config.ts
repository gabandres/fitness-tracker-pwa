import { defineConfig } from 'vitest/config';

// Emulator arm of the ledger contract (issue #6 phase 3). Plain node —
// FirestoreLedgerCore is framework-free, so no Angular TestBed/jsdom is
// involved. Run via `npm run test:ledger`, never by `ng test` (which only
// picks up `*.spec.ts`).
export default defineConfig({
  resolve: {
    alias: {
      // The core imports '@angular/fire/firestore' so the APP bundle uses
      // one SDK copy (mixing copies throws "Expected first argument to
      // doc() …" against the injected instance). Here we map it back to
      // the plain SDK so the node test process stays Angular-free.
      '@angular/fire/firestore': 'firebase/firestore',
    },
  },
  test: {
    include: ['src/app/ledger/infrastructure/*.emulator.test.ts'],
    environment: 'node',
    testTimeout: 20_000,
    globals: false,
  },
});
