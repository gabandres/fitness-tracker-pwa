import { computed, signal } from '@angular/core';

/**
 * Between-set rest countdown for the workout session sheet. Plain class
 * (not injectable) — each sheet instance owns one, mirroring the sheet's
 * create-fresh-per-open lifecycle.
 *
 * The interface is the four members below; the interval handle, the
 * 1-second tick, the zero clamp, and the m:ss formatting are internal.
 */
export class RestTimer {
  private readonly _remaining = signal(0);
  private handle: ReturnType<typeof setInterval> | null = null;

  /** Seconds left. 0 means idle — the sheet hides the timer bar. */
  readonly remaining = this._remaining.asReadonly();

  /** `m:ss` display string for the current remaining time. */
  readonly label = computed(() => {
    const s = this._remaining();
    const m = Math.floor(s / 60);
    const sec = (s % 60).toString().padStart(2, '0');
    return `${m}:${sec}`;
  });

  /** (Re)start the countdown. A running timer is replaced, not stacked. */
  start(seconds: number): void {
    this.stop();
    this._remaining.set(seconds);
    this.handle = setInterval(() => {
      this._remaining.update((r) => Math.max(0, r - 1));
      if (this._remaining() === 0) this.stop();
    }, 1000);
  }

  /** Cancel and reset to idle. Safe to call when already idle; also the
      destroy hook — there is nothing else to clean up. */
  stop(): void {
    if (this.handle) {
      clearInterval(this.handle);
      this.handle = null;
    }
    this._remaining.set(0);
  }
}
