import { Injectable, signal } from '@angular/core';

/**
 * Coordinates "open the Subscribe card" requests from deep child components
 * (photo-capture, entry-form, dashboard export) up to the App shell which
 * owns `showSettings`. Exposing a shared signal avoids passing callbacks
 * through every template layer.
 *
 * A single integer counter is used instead of a boolean so repeat clicks
 * still fire — consumers listen via `effect()` on `requestOpenCount` and
 * respond by toggling the settings sheet open and scrolling to the
 * `#settings-subscription` anchor.
 */
@Injectable({ providedIn: 'root' })
export class UpsellService {
  private readonly _openCount = signal(0);
  readonly requestOpenCount = this._openCount.asReadonly();

  /**
   * Ask the App shell to open the Subscribe card. Optional `source` is
   * logged so future telemetry can attribute conversions to the trigger
   * (photo quota, preset cap, CSV export, etc.).
   */
  openSubscribe(source: string): void {
    console.log(`[upsell] open Subscribe from ${source}`);
    this._openCount.update((n) => n + 1);
  }
}
