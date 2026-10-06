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

/**
 * Regions that weigh people in pounds. Liberia and Myanmar are the textbook
 * pair beside the US; Puerto Rico is US-customary for body weight (the scale
 * at the pharmacy reads pounds), and the es-PR audience is why it is named.
 */
const US_CUSTOMARY_REGIONS = new Set(['US', 'LR', 'MM', 'PR']);

/**
 * A BCP-47 tag → the unit system a NEW user should be asked in.
 *
 * Only the first-run path uses this (onboarding, before anything is stored).
 * `useUnitSystem` above is untouched: an existing profile with no field still
 * reads `'us'`, because that is what every account predating the field was
 * shown and it must not flip under them.
 *
 * Order: an explicit `-u-ms-` measurement extension wins; then the region
 * subtag; then, with no region at all, the language — English and Spanish
 * stay `'us'` (the historical default, and the es-PR audience), anything else
 * is metric.
 */
export function unitSystemForLocale(tag: string | null | undefined): UnitSystem {
  if (!tag) return 'us';
  const parts = tag.replace(/_/g, '-').split('-');
  const u = parts.findIndex((p) => p.toLowerCase() === 'u');
  if (u > 0) {
    const ms = parts.findIndex((p, i) => i > u && p.toLowerCase() === 'ms');
    const v = ms > 0 ? parts[ms + 1]?.toLowerCase() : undefined;
    if (v === 'metric') return 'metric';
    if (v === 'ussystem') return 'us';
  }
  for (const p of parts.slice(1)) {
    if (p.length === 1) break; // an extension singleton: no region before it
    if (/^[A-Za-z]{2}$/.test(p) || /^\d{3}$/.test(p)) {
      return US_CUSTOMARY_REGIONS.has(p.toUpperCase()) ? 'us' : 'metric';
    }
  }
  const lang = parts[0].toLowerCase();
  return lang === 'en' || lang === 'es' ? 'us' : 'metric';
}

/**
 * The phone's own answer, read the way `i18n/registry.ts` reads the device
 * language: `Intl` under Hermes is the device locale on both platforms and is
 * pure JS, so this ships over an EAS Update (`expo-localization` would cost a
 * build). Any failure is the historical `'us'`.
 */
export function deviceUnitSystem(): UnitSystem {
  try {
    return unitSystemForLocale(Intl.DateTimeFormat().resolvedOptions().locale);
  } catch {
    return 'us';
  }
}
