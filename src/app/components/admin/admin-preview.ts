import { isDevMode } from '@angular/core';
import type { AdminDataService } from './admin-data.service';

/**
 * Dev-only preview seam: `ng serve` + `/admin?preview=1` renders the console
 * against fixture data with no sign-in and no Cloud Function calls, so the
 * layout can be driven in a browser (the `test-web-ui` skill) without the
 * owner's Google session. `isDevMode()` is false in every prod bundle, so
 * this can never open the console to anyone on ignia.fit.
 */
export function adminPreviewEnabled(): boolean {
  try {
    return isDevMode() && new URLSearchParams(window.location.search).get('preview') === '1';
  } catch { return false; }
}

function dayKeys(n: number): string[] {
  const out: string[] = [];
  const d = new Date();
  for (let i = n - 1; i >= 0; i--) {
    const day = new Date(d); day.setDate(d.getDate() - i);
    out.push(day.toISOString().slice(0, 10));
  }
  return out;
}

export function seedPreview(data: AdminDataService): void {
  const keys = dayKeys(30);
  const daily = keys.map((day, i) => {
    const active = 6 + Math.round(4 * Math.sin(i / 3)) + (i % 7 === 0 ? 3 : 0);
    return {
      day,
      activeUsers: active,
      platforms: { ios: Math.round(active * 0.55), android: Math.round(active * 0.45), ...(i < 3 ? { web: 1 } : {}) },
      events: { app_open: active * 3, log_added: active * 2 + (i % 5), photo_scan: i % 4, barcode_scan: i % 3, weight_logged: i % 6 === 0 ? 3 : 1, workout_finished: i % 5 === 0 ? 2 : 0, voice_log: i % 9 === 0 ? 1 : 0 },
    };
  });
  data.usage.set({
    from: keys[0], to: keys[29], days: 30, computedAt: new Date().toISOString(), daily,
    dau: daily[29].activeUsers, wau: 19, mau: 41, wauPrior: 15, usersInWindow: 41,
    eventTotals: daily.reduce((acc, d) => { for (const [k, v] of Object.entries(d.events)) acc[k] = (acc[k] ?? 0) + v; return acc; }, {} as Record<string, number>),
    platformTotals: { ios: 50, android: 51, web: 3 },
  });
  data.stats.set({
    totalUsers: 52, newUsers1d: 1, newUsers7d: 4, newUsers30d: 11, verifiedCount: 44, disabledCount: 1,
    providersBreakdown: { 'google.com': 31, 'apple.com': 12, password: 9 },
    active7d: 19, active30d: 41, activePaidSubs: 0, compedCount: 2, estimatedMRR: 0,
    profileCompletedCount: 39, onboardingV2CompletedCount: 39, usersWithFirstEntryCount: 33,
    signupsViaReferralCount: 3, referralRewardGrantedCount: 1, currentlyCompedCount: 2, firstEntryWithin24hCount: 21, firstEntryWithin72hCount: 26,
  });
  data.retention.set({
    windowDays: 120, activationThreshold: 3, usersExamined: 48, excludedSynthetic: 2, truncated: false,
    activatedTotal: 27, logsPerActivatedUserPerDay: 1.34, insufficientSample: true,
    cohorts: [
      { week: '2026-W33', size: 9, activated: 6, retained: {}, retainedActivated: { d1: { retained: 5, eligible: 6 }, d7: { retained: 3, eligible: 6 }, d30: { retained: 0, eligible: 0 } } },
      { week: '2026-W31', size: 12, activated: 8, retained: {}, retainedActivated: { d1: { retained: 7, eligible: 8 }, d7: { retained: 4, eligible: 8 }, d30: { retained: 2, eligible: 5 } } },
      { week: '2026-W29', size: 10, activated: 7, retained: {}, retainedActivated: { d1: { retained: 6, eligible: 7 }, d7: { retained: 3, eligible: 7 }, d30: { retained: 2, eligible: 7 } } },
    ],
  });
  data.retentionHistory.set(dayKeys(20).map((date, i) => ({ date, activatedTotal: 20 + i, logsPerActivatedUserPerDay: 1.2, d1: 0.8, d7: 0.35 + 0.01 * i, d30: 0.2 })));
  data.ceilings.set([
    { kind: 'photo', date: keys[29], used: 41, limit: 60, killed: false, killedReason: '', ratio: 0.68 },
    { kind: 'consultation', date: keys[29], used: 12, limit: 40, killed: false, killedReason: '', ratio: 0.3 },
  ]);
  data.heartbeatAgeMin.set(4);
  data.costModel.set({
    computedAt: new Date().toISOString(), pricesAsOf: '2026-08-30', month: keys[29].slice(0, 7), daysElapsed: 30, daysInMonth: 31,
    monthToDate: 0.93, projectedMonth: 0.96,
    byService: { 'Gemini API': 0.41, 'Secret Manager': 0.12, Firestore: 0.4, 'Cloud Run functions': 0, 'Cloud Scheduler': 0 },
    lines: [
      { service: 'Firestore', sku: 'Document reads', usage: 1_912_000, unit: 'reads', freeAllowance: 1_500_000, billableUsage: 640_000, unitPrice: 0.06, perUnit: '100k', cost: 0.384, note: 'free 50,000/day' },
      { service: 'Firestore', sku: 'Document writes', usage: 210_000, unit: 'writes', freeAllowance: 600_000, billableUsage: 9_000, unitPrice: 0.18, perUnit: '100k', cost: 0.016, note: 'free 20,000/day' },
      { service: 'Firestore', sku: 'Document deletes', usage: 3_100, unit: 'deletes', freeAllowance: 600_000, billableUsage: 0, unitPrice: 0.02, perUnit: '100k', cost: 0 },
      { service: 'Cloud Run functions', sku: 'Requests', usage: 41_200, unit: 'requests', freeAllowance: 2_000_000, billableUsage: 0, unitPrice: 0.4, perUnit: '1M', cost: 0 },
      { service: 'Cloud Run functions', sku: 'CPU time', usage: 22_400, unit: 'vCPU-s', freeAllowance: 180_000, billableUsage: 0, unitPrice: 0.000024, perUnit: 'vCPU-s', cost: 0 },
      { service: 'Cloud Run functions', sku: 'Memory time', usage: 11_200, unit: 'GiB-s', freeAllowance: 360_000, billableUsage: 0, unitPrice: 0.0000025, perUnit: 'GiB-s', cost: 0 },
      { service: 'Secret Manager', sku: 'Active secret versions', usage: 8, unit: 'versions', freeAllowance: 6, billableUsage: 2, unitPrice: 0.06, perUnit: 'version·month', cost: 0.12, note: 'free tier is per BILLING ACCOUNT — the other three projects share it' },
      { service: 'Cloud Scheduler', sku: 'Jobs', usage: 3, unit: 'jobs', freeAllowance: 3, billableUsage: 0, unitPrice: 0.1, perUnit: 'job·month', cost: 0 },
      { service: 'Gemini API', sku: 'gemini-3.5-flash-lite input', usage: 412_000, unit: 'tokens', freeAllowance: 0, billableUsage: 412_000, unitPrice: 0.3, perUnit: '1M', cost: 0.124 },
      { service: 'Gemini API', sku: 'gemini-3.5-flash-lite output (incl. thinking)', usage: 114_000, unit: 'tokens', freeAllowance: 0, billableUsage: 114_000, unitPrice: 2.5, perUnit: '1M', cost: 0.285 },
    ],
    perFunction: [
      { name: 'hourlytasks', requests: 720, instanceSeconds: 9_800, vcpuSeconds: 9_800, gibSeconds: 4_900 },
      { name: 'analyzephoto', requests: 221, instanceSeconds: 6_100, vcpuSeconds: 6_100, gibSeconds: 3_050 },
      { name: 'consultationstream', requests: 64, instanceSeconds: 2_400, vcpuSeconds: 2_400, gibSeconds: 600 },
      { name: 'searchfoods', requests: 3_900, instanceSeconds: 1_900, vcpuSeconds: 1_900, gibSeconds: 475 },
    ],
    ai: {
      kinds: { photo: { calls: 221, promptTokens: 380_000, outputTokens: 98_000, thoughtTokens: 0, images: 260 }, consultation: { calls: 64, promptTokens: 32_000, outputTokens: 16_000, thoughtTokens: 0, images: 0 } },
      models: [{ model: 'gemini-3.5-flash-lite', calls: 285, inputTokens: 412_000, outputTokens: 114_000, cost: 0.409, priceKnown: true }],
      byDay: Object.fromEntries(keys.map((k, i) => [k, 0.005 + (i % 5) * 0.004])),
    },
    firestoreByDay: { reads: {}, writes: {}, deletes: {} },
    warnings: [],
  });
  data.billing.set({ enabled: false, reason: 'no gcp_billing_export_v1_* table in the dataset yet — enable the standard export in Billing → Billing export' });
  data.costLedger.set([
    { id: 'apple-dev', label: 'Apple Developer Program', amountUsd: 99, cadence: 'yearly' },
    { id: 'play-dev', label: 'Google Play developer registration', amountUsd: 25, cadence: 'once' },
  ]);
  const mk = (i: number) => ({
    uid: `uid${i.toString().padStart(4, '0')}abcdefghijklmnop`, email: `person${i}@example.com`, displayName: i % 3 ? `Person ${i}` : '',
    emailVerified: i % 7 !== 0, disabled: i === 5, createdAt: new Date(Date.now() - i * 86_400_000 * 2).toISOString(),
    lastSignInAt: new Date(Date.now() - i * 3_600_000 * 5).toISOString(), providers: i % 2 ? ['google.com'] : ['apple.com', 'password'],
    admin: i === 0, profileCompleted: i % 6 !== 0, stripeRole: i === 3 ? 'paid' : null, preferredLocale: i % 4 ? 'en' : 'es-PR',
  });
  data.users.set(Array.from({ length: 24 }, (_, i) => mk(i)));
  data.activity.set(Array.from({ length: 12 }, (_, i) => ({
    type: i % 4 === 0 ? 'signup' as const : 'entry' as const, uid: mk(i).uid, email: mk(i).email,
    timestamp: new Date(Date.now() - i * 2_700_000).toISOString(), detail: i % 4 === 0 ? undefined : `Lunch · ${420 + i * 30} kcal`,
  })));
  data.feedback.set([
    { id: 'f1', uid: mk(2).uid, message: 'Love the water card. Could the Trends tab remember my last view?', category: 'idea', appVersion: '1.2.1', platform: 'ios', locale: 'en', createdAt: new Date(Date.now() - 3_600_000).toISOString() },
    { id: 'f2', uid: mk(7).uid, message: 'The fasting timer showed 0h after I reopened the app from the widget.', category: 'bug', appVersion: '1.2.1', platform: 'android', locale: 'es-PR', createdAt: new Date(Date.now() - 86_400_000).toISOString() },
  ]);
  data.audit.set([
    { id: 'a1', action: 'plan_override', adminUid: 'me', adminEmail: 'owner@example.com', targetEmail: mk(3).email, targetUid: mk(3).uid, details: { role: 'paid' }, timestamp: new Date(Date.now() - 7_200_000).toISOString() },
    { id: 'a2', action: 'spend_limit_set', adminUid: 'me', adminEmail: 'owner@example.com', details: { kind: 'photo', limit: 60 }, timestamp: new Date(Date.now() - 86_400_000).toISOString() },
  ]);
  data.lastLoadedAt.set(new Date());
}
