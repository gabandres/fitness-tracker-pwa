import { Injectable, inject } from '@angular/core';
import {
  type UsageCounts,
  type UsageEvent,
  addUsageCount,
  hasUsageCounts,
  calendarDateKey,
} from '@macrolog/core';
import { LEDGER_PORT } from '../ledger/ports/ledger.port';
import * as Sentry from '@sentry/angular';
import { environment } from '../../environments/environment';

/**
 * Zero-cost analytics today, future-proof for Plausible.
 *
 * Why this shape:
 *   - No budget for a dedicated analytics product yet — we're already
 *     paying for Sentry, so every event doubles as a breadcrumb on the
 *     current Sentry session. A later crash report ships with the trail
 *     of paywall views / trial attempts that preceded it, which is
 *     surprisingly useful funnel data for free.
 *   - `console.info` emits in all environments so you can spot-check
 *     event wiring with DevTools open; the tag `[analytics]` makes it
 *     easy to filter.
 *   - Plausible integration is wired but gated on
 *     `environment.analytics.plausibleEnabled`. Flip the flag once
 *     budget allows and events start shipping with no other change.
 *
 * Event catalogue (keep in sync with future Plausible goals):
 *   paywall_shown     — {source: 'photo' | 'preset' | 'csv' | 'chart'}
 *   paywall_click     — {source: ...}
 *   trial_started     — {cadence: 'monthly' | 'annual', trialDays}
 *   trial_cancelled   — {cadence, reason?}   (future)
 *   export_clicked    — {tier: 'free' | 'paid'}
 *   repeat_yesterday  — {count}
 *
 * All methods are fire-and-forget; failures are swallowed so analytics
 * outages never interrupt the user.
 */
@Injectable({ providedIn: 'root' })
export class AnalyticsService {
  private readonly plausibleEnabled = Boolean(
    environment.analytics?.plausibleEnabled &&
      environment.analytics?.plausibleDomain &&
      environment.analytics?.plausibleEndpoint,
  );
  private readonly plausibleDomain = environment.analytics?.plausibleDomain ?? '';
  private readonly plausibleEndpoint = environment.analytics?.plausibleEndpoint ?? '';

  /**
   * Emit a `pageview` to Plausible. Without this the Plausible dashboard
   * shows custom events but zero traffic and can't compute conversion
   * rates against a denominator. Fires once per app boot — the SPA is
   * effectively a single route from Plausible's perspective (auth gate +
   * tab switches don't change the URL).
   */
  pageview(): void {
    if (!this.plausibleEnabled) return;
    try {
      fetch(this.plausibleEndpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'pageview',
          url: window.location.href,
          domain: this.plausibleDomain,
        }),
        keepalive: true,
      }).catch(() => { /* analytics must never surface to the user */ });
    } catch { /* ignore */ }
  }

  /**
   * Send a single event. Use snake_case names. `props` values are
   * stringified; pass numbers / booleans directly and they'll be coerced
   * for Plausible (which only accepts string values).
   */
  track(name: string, props?: Record<string, string | number | boolean>): void {
    const stringProps = props
      ? Object.fromEntries(Object.entries(props).map(([k, v]) => [k, String(v)]))
      : undefined;

    // 1. Console breadcrumb — visible to the developer in any environment.
    console.info('[analytics]', name, stringProps ?? '');

    // 2. Sentry breadcrumb — attaches to the next captured error so we
    //    can see the funnel steps that preceded a crash. Category makes
    //    them easy to filter in the Sentry issue view.
    try {
      Sentry.addBreadcrumb({
        category: 'analytics',
        message: name,
        level: 'info',
        data: stringProps,
      });
    } catch {
      // Sentry may not be initialized (empty DSN in dev); ignore.
    }

    // 3. Plausible — only when explicitly enabled via env. Uses the
    //    events API so we don't need to load the Plausible JS bundle.
    if (this.plausibleEnabled) {
      try {
        const payload = {
          name,
          url: window.location.href,
          domain: this.plausibleDomain,
          props: stringProps,
        };
        fetch(this.plausibleEndpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
          keepalive: true,
        }).catch(() => { /* analytics must never surface to the user */ });
      } catch {
        // Defensive — malformed payload shouldn't bubble.
      }
    }
  }

  /** Convenience wrapper used when an upsell card is rendered. */
  paywallShown(source: 'photo' | 'preset' | 'csv' | 'chart'): void {
    this.track('paywall_shown', { source });
  }

  /** The user tapped the CTA inside an upsell card. */
  paywallClick(source: 'photo' | 'preset' | 'csv' | 'chart'): void {
    this.track('paywall_click', { source });
  }

  // ─── Usage counters (the half that survives a session) ─────────
  //
  // Everything above is a breadcrumb: it reaches a console, a Sentry event, and
  // Plausible if it is ever turned on. None of it answers "did this person come
  // back on day 3", because none of it is stored anywhere we can query.
  //
  // `count()` does. It buffers into the same per-user-per-day document the Expo
  // app writes (`@macrolog/core/usage-events`), so retention and the signup
  // funnel are one Firestore query across both platforms rather than two
  // analytics products. Deliberately NOT merged with `track()` above: that one
  // takes free-form names and props, and this one must stay a closed catalogue
  // of counters — the rules enforce the difference.

  private readonly ledger = inject(LEDGER_PORT);
  private buffer: UsageCounts = {};
  private bufferDay = calendarDateKey(new Date());
  private flushTimer: ReturnType<typeof setInterval> | null = null;

  /**
   * Record one usage event. Cheap and synchronous — it touches an object.
   *
   * Buffered rather than written per event, for the same two reasons as mobile:
   * a write per tap is a network call on the hot path, and it is a billable
   * write per tap. See `analytics.ts` in the Expo app.
   */
  count(event: UsageEvent, n = 1): void {
    const today = calendarDateKey(new Date());
    if (today !== this.bufferDay) {
      void this.flushCounts();
      this.bufferDay = today;
    }
    this.buffer = addUsageCount(this.buffer, event, n);
    this.startFlushTimer();
  }

  /**
   * Write the buffer out. Never throws, never rejects.
   *
   * `pagehide` is the important caller — it is the only event that reliably
   * fires on a mobile browser tab being closed or backgrounded, which is where
   * most sessions actually end. `visibilitychange` alone misses a straight
   * close, and `beforeunload` is unreliable on iOS Safari.
   */
  async flushCounts(): Promise<void> {
    if (!hasUsageCounts(this.buffer)) return;
    const sending = this.buffer;
    const day = this.bufferDay;
    this.buffer = {};
    try {
      await this.ledger.recordUsage(day, sending);
    } catch {
      // Restore, unless the day has rolled — stale counts do not belong in
      // today's document.
      if (day === this.bufferDay) {
        for (const [event, n] of Object.entries(sending)) {
          this.buffer = addUsageCount(this.buffer, event as UsageEvent, n as number);
        }
      }
    }
  }

  private startFlushTimer(): void {
    if (this.flushTimer != null) return;
    this.flushTimer = setInterval(() => void this.flushCounts(), USAGE_FLUSH_INTERVAL_MS);
    window.addEventListener('pagehide', () => void this.flushCounts());
  }
}

/** Matches the Expo app's cadence — one or two writes an hour on an active
 *  session, and a crash costs at most this much. */
const USAGE_FLUSH_INTERVAL_MS = 5 * 60 * 1000;
