import { Injectable } from '@angular/core';
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
}
