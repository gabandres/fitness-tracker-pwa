import Constants, { ExecutionEnvironment } from 'expo-constants';
import { Platform } from 'react-native';
import type { PurchasesStoreProduct } from 'react-native-purchases';

/**
 * RevenueCat tip jar (App Review 3.1.1 — tips tied to a digital app must use
 * In-App Purchase, not an external link). iOS uses these consumable IAPs;
 * Android keeps the external ignia.fit/support link (Play permits it), so this
 * module is iOS-only.
 *
 * `react-native-purchases` is a native module: it does NOT exist in Expo Go and
 * would throw on import there. Every entry point below early-returns via
 * {@link isTipIapAvailable} BEFORE the lazy `require`, so importing this file is
 * safe in Expo Go — the native code is only touched inside a real dev/prod
 * build on iOS.
 */

/**
 * RevenueCat public iOS SDK key (starts `appl_…`). This is a publishable client
 * key, safe to commit like the Firebase apiKey (ADR-0002) — it only fetches
 * products and validates receipts; it grants nothing on its own.
 * TODO(owner): paste the real key from RevenueCat → Project → API keys → Apple.
 */
const REVENUECAT_IOS_KEY = 'appl_REPLACE_ME';

/**
 * Consumable tip products, small → large (also the display order). Create each
 * in App Store Connect as a **Consumable** IAP with these exact product IDs,
 * then import them into RevenueCat (Products) so pricing resolves.
 */
export const TIP_PRODUCT_IDS = [
  'fit.ignia.tip.small',
  'fit.ignia.tip.medium',
  'fit.ignia.tip.large',
] as const;

/** IAP tips only exist in a native iOS build — never Expo Go, never Android. */
export function isTipIapAvailable(): boolean {
  return (
    Platform.OS === 'ios' &&
    Constants.executionEnvironment !== ExecutionEnvironment.StoreClient
  );
}

// Lazy require so Expo Go (which lacks the native module) never loads it.
let rcMod: typeof import('react-native-purchases') | null = null;
function rc(): typeof import('react-native-purchases') {
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- lazy on purpose: Expo Go lacks this native module and would crash on a static import.
  if (!rcMod) rcMod = require('react-native-purchases');
  return rcMod!;
}

let configured = false;
function ensureConfigured(): void {
  if (configured) return;
  const { default: Purchases, LOG_LEVEL } = rc();
  if (__DEV__) Purchases.setLogLevel(LOG_LEVEL.WARN);
  Purchases.configure({ apiKey: REVENUECAT_IOS_KEY });
  configured = true;
}

/** Priced, localized tip products in small→large order. `[]` when unavailable. */
export async function getTipProducts(): Promise<PurchasesStoreProduct[]> {
  if (!isTipIapAvailable()) return [];
  ensureConfigured();
  const { default: Purchases, PRODUCT_CATEGORY } = rc();
  const products = await Purchases.getProducts(
    [...TIP_PRODUCT_IDS],
    PRODUCT_CATEGORY.NON_SUBSCRIPTION,
  );
  const order = (id: string) => TIP_PRODUCT_IDS.indexOf(id as (typeof TIP_PRODUCT_IDS)[number]);
  return products.sort((a, b) => order(a.identifier) - order(b.identifier));
}

export type TipResult = 'success' | 'cancelled' | 'error';

/** Buy a tip. Consumables unlock nothing — RevenueCat finishes the transaction. */
export async function purchaseTip(product: PurchasesStoreProduct): Promise<TipResult> {
  if (!isTipIapAvailable()) return 'error';
  ensureConfigured();
  try {
    await rc().default.purchaseStoreProduct(product);
    return 'success';
  } catch (e) {
    return (e as { userCancelled?: boolean })?.userCancelled ? 'cancelled' : 'error';
  }
}
