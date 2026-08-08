import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Neither Firestore adapter may call `addDoc`.
 *
 * `addDoc` is not "setDoc with a random id" — it attaches a
 * `Precondition.exists(false)` to the mutation. When the Write stream drops
 * after the server commits but before the ack lands, the SDK replays the same
 * mutation against the same id, the precondition fails, and a create the user
 * watched succeed rejects with `already-exists`.
 *
 * That is Sentry IGNIA-MOBILE-6 (Android vc 13, 2026-08-07), whose breadcrumb
 * immediately before the throw is `WebChannelConnection RPC 'Write' stream …
 * transport errored`. Both adapters had it; both now mint the id client-side
 * and `setDoc`, which is idempotent under replay.
 *
 * The check is a text assertion on the source, in the same spirit as
 * `apps/mobile/src/__tests__/widget-no-memo.test.ts`: nothing else catches a
 * reintroduced `addDoc`. It typechecks, it bundles, every other test passes,
 * and the failure only appears on a real device with a real flaky connection.
 *
 * Both adapters are asserted from one file because the rule is a property of
 * the shared doc contract, not of either frontend.
 */

const REPO_ROOT = join(__dirname, '..', '..', '..', '..');

const ADAPTERS = [
  'src/app/ledger/infrastructure/firestore-ledger.core.ts',
  'apps/mobile/src/lib/ledger.ts',
];

describe('Firestore adapters create docs idempotently', () => {
  it.each(ADAPTERS)('%s does not call addDoc', (relPath) => {
    const src = readFileSync(join(REPO_ROOT, relPath), 'utf8');
    // Strip block comments — both files explain `addDoc` at length, and the
    // explanation is the point, so it must not trip its own guard.
    const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    expect(code).not.toMatch(/\baddDoc\b/);
  });

  it('finds the adapters it is meant to guard', () => {
    // A move or rename must fail loudly rather than make this suite vacuous.
    for (const relPath of ADAPTERS) {
      expect(readFileSync(join(REPO_ROOT, relPath), 'utf8')).toMatch(/setDoc/);
    }
  });
});
