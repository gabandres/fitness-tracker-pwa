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

  /** The fasting start time, or null if not fasting. */
  readonly fastStartedAt: Signal<Date | null> = computed(() => {
    const p = this.fb.profile();
    if (!p) return null;
    const raw = (p as any).fastStartedAt;
    if (!raw) return null;
    // Could be a Firestore Timestamp or a Date depending on how it was read.
    return raw instanceof Date ? raw : raw.toDate?.() ?? null;
  });

  readonly isFasting: Signal<boolean> = computed(() => this.fastStartedAt() !== null);

  async startFast(startedAt?: Date): Promise<void> {
    await this.fb.startFast(startedAt);
  }

  async breakFast(): Promise<void> {
    await this.fb.breakFast();
  }
}
