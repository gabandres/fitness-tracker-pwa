/**
 * Dev-only Firestore-listener lifecycle counter — to diagnose battery/network
 * drain from `onSnapshot` subscriptions WITHOUT an EAS build (runs in Expo Go).
 *
 * Wrap a screen's unsub array: `return trackSubs('Today', unsubs)`. On attach it
 * logs the label + live total; on detach it logs the drop. Watch the console
 * while switching tabs:
 *   - GOOD (focus-gated): total rises when a tab focuses, falls when it blurs,
 *     staying bounded to the visible tab (e.g. hovers ~3–7).
 *   - BAD (leaky): total only ever climbs as you visit tabs and never falls —
 *     every tab's listeners stay live at once, keeping the radio awake.
 *
 * A no-op passthrough in production (`__DEV__` false) — zero shipping cost.
 */
type Unsub = () => void;

let active = 0;
const byLabel: Record<string, number> = {};

export function trackSubs(label: string, unsubs: Unsub[]): Unsub {
  const stopAll = () => unsubs.forEach((u) => u());
  if (!__DEV__) return stopAll;

  const n = unsubs.length;
  active += n;
  byLabel[label] = (byLabel[label] ?? 0) + n;
  console.log(`[subs] +${n} ${label} → ${active} active`, { ...byLabel });

  let stopped = false;
  return () => {
    stopAll();
    if (stopped) return;
    stopped = true;
    active -= n;
    byLabel[label] = Math.max(0, (byLabel[label] ?? n) - n);
    console.log(`[subs] -${n} ${label} → ${active} active`, { ...byLabel });
  };
}
