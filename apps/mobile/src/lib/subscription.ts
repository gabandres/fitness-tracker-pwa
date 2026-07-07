import { useCallback, useEffect, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useAuth } from '@/lib/auth';

const OVERRIDE_KEY = 'proPreview';

/**
 * Pro tier is NOT available in v1 — there is no IAP yet (see MOBILE_RELEASE).
 * While disabled: every gated feature is unlocked for everyone (`isPro` is
 * always true) and all purchase/upsell/testing surfaces are hidden. Shipping a
 * paywall with no purchasable product is an App Store rejection (Guideline
 * 2.1/3.1.1). Flip to `true` in v1.1 once StoreKit lands.
 */
export const PRO_ENABLED = false;

/**
 * Pro entitlement for the mobile app. Real source is `useAuth().isPro` (the
 * Stripe `stripeRole:paid` custom claim — so a web-Pro user is Pro on mobile
 * too). A persisted local `preview` flag lets the owner/testers toggle Pro ON
 * to try the gated features before native IAP exists. When native IAP is added
 * later, it just needs to flip the same entitlement (or set the claim).
 */
export function useSubscription(): {
  isPro: boolean;
  /** Local preview toggle (testing only) — ORs with the real entitlement. */
  proPreview: boolean;
  setProPreview: (on: boolean) => Promise<void>;
} {
  const { isPro: entitled } = useAuth();
  const [proPreview, setPreview] = useState(false);

  useEffect(() => {
    AsyncStorage.getItem(OVERRIDE_KEY).then((v) => setPreview(v === '1')).catch(() => {});
  }, []);

  const setProPreview = useCallback(async (on: boolean) => {
    setPreview(on);
    await AsyncStorage.setItem(OVERRIDE_KEY, on ? '1' : '0');
  }, []);

  // Pro disabled in v1 → everything unlocked for everyone.
  return { isPro: PRO_ENABLED ? entitled || proPreview : true, proPreview, setProPreview };
}
