// Moved to @macrolog/core (shared with the Expo app — see docs/adr/0012).
// This shim keeps existing `utils/cluster-groups` imports working. The core
// version is generic over the set shape, so callers keep their exact element
// type (session sets, template planned-sets, bare `{ kind }` seeds).
export * from '@macrolog/core/cluster-groups';
