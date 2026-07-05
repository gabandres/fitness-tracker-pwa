/**
 * Recursively drop `undefined`-valued keys from an object/array tree.
 *
 * Firestore rejects `undefined` when the client has not set
 * `ignoreUndefinedProperties` (this app deliberately does not), so every
 * document is run through this before a write. Both frontends' Firestore
 * adapters (`FirestoreLedgerCore` in the PWA, `ledger.ts` in the Expo app)
 * share this single source so their write-path pruning can never drift —
 * previously the mobile copy guarded only the SDK `Timestamp` and would have
 * silently flattened a plain `Date` to `{}` (see docs/adr/0012).
 *
 * `packages/core` must stay dependency-free (ADR-0012), so it cannot import
 * the `firebase/firestore` `Timestamp` type. `Date` — a built-in — is always
 * treated as an opaque leaf. Each edge injects an `isOpaque` predicate to also
 * treat its SDK sentinel (`Timestamp`) as a leaf, e.g.
 * `pruneUndefined(data, (v) => v instanceof Timestamp)`.
 *
 * @param value    the tree to prune
 * @param isOpaque returns `true` for objects that must be kept whole (not
 *                 descended into) — typically SDK sentinels like `Timestamp`.
 *                 `Date` is always opaque regardless of this predicate.
 */
export function pruneUndefined<T>(value: T, isOpaque?: (v: object) => boolean): T {
  if (Array.isArray(value)) {
    return value.map((v) => pruneUndefined(v, isOpaque)) as unknown as T;
  }
  if (
    value !== null &&
    typeof value === 'object' &&
    !(value instanceof Date) &&
    !(isOpaque?.(value) ?? false)
  ) {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (v !== undefined) out[k] = pruneUndefined(v, isOpaque);
    }
    return out as T;
  }
  return value;
}
