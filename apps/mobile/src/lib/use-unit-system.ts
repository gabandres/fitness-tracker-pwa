import type { UnitSystem } from '@macrolog/core';
import { useAuth } from '@/lib/auth';

/**
 * The signed-in profile's unit system, with the historical default applied
 * once instead of at every call site.
 *
 * `undefined` reads as `'us'` — that is every account predating the field, and
 * it must not silently become metric. `useToday` already derived this inline
 * for the food portion picker; body weight needed the same answer on four more
 * screens (UX_AUDIT F3), and four more copies of `profile?.unitSystem ===
 * 'metric' ? 'metric' : 'us'` is how one of them eventually disagrees.
 */
export function useUnitSystem(): UnitSystem {
  const { profile } = useAuth();
  return profile?.unitSystem === 'metric' ? 'metric' : 'us';
}
