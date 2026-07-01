import { useCallback, useEffect, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useAuth } from '@/lib/auth';

const OVERRIDE_KEY = 'proPreview';

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

  return { isPro: entitled || proPreview, proPreview, setProPreview };
}
