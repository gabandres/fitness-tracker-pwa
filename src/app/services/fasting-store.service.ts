import { Injectable, Signal, computed, inject } from '@angular/core';
import { LEDGER_PORT } from '../ledger/ports/ledger.port';

/**
 * Owns fasting state: start time, active boolean, and start/end mutations.
 * Profile is read through the LEDGER_PORT (the canonical profile signal),
 * so this store stays passive — no internal mutable state beyond what the
 * adapter caches.
 *
 * Extracted from FitnessStore so the fasting UI surface (fasting pill,
 * body card) can depend on a thin, focused service rather than the
 * full-app god service.
 */
@Injectable({ providedIn: 'root' })
export class FastingStore {
  private readonly fb = inject(LEDGER_PORT);

  /** The fasting start time, or null if not fasting. Trust the port: the
   *  profile-mapper already converts `fastStartedAt` Timestamp→Date, so no
   *  Timestamp ever reaches here (CONTEXT.md → "Date type at the seam"). */
  readonly fastStartedAt: Signal<Date | null> = computed(
    () => this.fb.profile()?.fastStartedAt ?? null,
  );

  readonly isFasting: Signal<boolean> = computed(() => this.fastStartedAt() !== null);

  async startFast(startedAt?: Date): Promise<void> {
    await this.fb.startFast(startedAt);
  }

  async breakFast(): Promise<void> {
    await this.fb.breakFast();
  }
}
