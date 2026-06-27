import { Injectable, Signal, computed, inject, signal } from '@angular/core';
import { LEDGER_PORT } from '../ledger/ports/ledger.port';
import { Measurement } from './firebase.service';
import { isStorableWeight, WEIGHT_ABS_MIN_LB, WEIGHT_ABS_MAX_LB } from '../utils/weight-validation';

/**
 * Owns body-metric state: daily weights map, daily water map, and the
 * measurements list. Hydration is coordinated by FitnessStore (see
 * `hydrate()` / `clear()`) so a single sign-in effect drives load
 * lifecycle for all stores — matches the existing FitnessStore pattern.
 *
 * FitnessStore still reads `dailyWeights()` from here for `goalProgress`
 * (derivations stay on the hub).
 */
@Injectable({ providedIn: 'root' })
export class BodyMetricStore {
  private readonly fb = inject(LEDGER_PORT);

  private readonly _measurements = signal<Measurement[]>([]);
  private readonly _dailyWeights = signal<Record<string, number>>({});
  private readonly _dailyWater = signal<Record<string, number>>({});

  readonly measurements: Signal<Measurement[]> = this._measurements.asReadonly();
  readonly dailyWeights: Signal<Record<string, number>> = this._dailyWeights.asReadonly();
  readonly dailyWater: Signal<Record<string, number>> = this._dailyWater.asReadonly();

  readonly latestMeasurement: Signal<Measurement | null> = computed(() => this._measurements()[0] ?? null);
  readonly previousMeasurement: Signal<Measurement | null> = computed(() => this._measurements()[1] ?? null);

  readonly measurementDeltas: Signal<{ waist?: number; chest?: number; bicep?: number; hip?: number; neck?: number } | null> = computed(() => {
    const latest = this.latestMeasurement();
    const prev = this.previousMeasurement();
    if (!latest || !prev) return null;
    const delta = (a?: number, b?: number) => (a != null && b != null) ? +(a - b).toFixed(1) : undefined;
    return { waist: delta(latest.waist, prev.waist), chest: delta(latest.chest, prev.chest), bicep: delta(latest.bicep, prev.bicep), hip: delta(latest.hip, prev.hip), neck: delta(latest.neck, prev.neck) };
  });

  /** Bulk-load all body-metric collections. Called from FitnessStore._load(). */
  hydrate(input: { measurements: Measurement[]; dailyWeights: Record<string, number>; dailyWater: Record<string, number> }): void {
    this._measurements.set(input.measurements);
    this._dailyWeights.set(input.dailyWeights);
    this._dailyWater.set(input.dailyWater);
  }

  /** Reset to empty on sign-out. */
  clear(): void {
    this._measurements.set([]);
    this._dailyWeights.set({});
    this._dailyWater.set({});
  }

  /** Absolute sanity backstop on every write path (manual log, CSV import,
   *  workout-finish mirror): an out-of-range weight is corrupt data that
   *  would skew the measured-TDEE regression, so it's rejected here rather
   *  than persisted. The UI enforces a tighter range + delta confirm. */
  async setDailyWeight(dateKey: string, weight: number): Promise<void> {
    if (!isStorableWeight(weight)) {
      throw new RangeError(
        `Weight ${weight} lb is outside the storable range ${WEIGHT_ABS_MIN_LB}-${WEIGHT_ABS_MAX_LB} lb.`,
      );
    }
    await this.fb.setDailyWeight(dateKey, weight);
    this._dailyWeights.update((prev) => ({ ...prev, [dateKey]: weight }));
  }

  /** Overwrite the water intake total for a specific day (US fluid ounces). */
  async setDailyWater(dateKey: string, flOz: number): Promise<void> {
    const clamped = Math.max(0, Math.min(676, Math.round(flOz)));
    await this.fb.setDailyWater(dateKey, clamped);
    this._dailyWater.update((prev) => ({ ...prev, [dateKey]: clamped }));
  }

  /** Increment water intake for a specific day by `deltaOz` (fl oz).
      Computes the next total client-side from the current signal value —
      no transactional read/modify/write since a single-user app doesn't
      have concurrent writers for the same day. */
  async addWater(dateKey: string, deltaOz: number): Promise<void> {
    const current = this._dailyWater()[dateKey] ?? 0;
    await this.setDailyWater(dateKey, current + deltaOz);
  }

  async addMeasurement(entry: Omit<Measurement, 'id' | 'date'>): Promise<void> {
    // Server stamps the doc with its own now(); new Date() here is close
    // enough for the newest-first cache until the next hydrate.
    const id = await this.fb.addMeasurement(entry);
    this._measurements.set([{ ...entry, id, date: new Date() }, ...this._measurements()]);
  }

  async deleteMeasurement(id: string): Promise<void> {
    await this.fb.deleteMeasurement(id);
    this._measurements.set(await this.fb.getRecentMeasurements());
  }
}
