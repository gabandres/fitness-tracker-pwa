import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import { LucideAngularModule } from 'lucide-angular';
import { FitnessStore } from '../../services/fitness-store.service';
import { localDateKey } from '../../utils/date';
import { V2Sheet } from './sheet.component';
import { V2Button } from './button.component';

/**
 * v2 Weight log sheet. Mirrors the entry-sheet-v2 pattern:
 * native `<form>` with `(submit)`, kcal-style validation, haptics.
 *
 * The "Take photo" button is intentionally disabled in Week 5 — body-
 * photo storage doesn't exist in the data layer yet. Wired up in
 * Week 6 alongside the Firebase Storage path + security rules.
 */
@Component({
  selector: 'v2-weight-sheet',
  standalone: true,
  imports: [LucideAngularModule, V2Sheet, V2Button],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (open()) {
      <v2-sheet labelledBy="weight-sheet-title" (close)="onClose()">
        <h2 id="weight-sheet-title" class="v2-h2 mb-1">Log weight</h2>
        <p class="v2-caption mb-4">{{ dateLabel() }}</p>

        <form class="space-y-4" (submit)="save($event)" novalidate>
          <div>
            <label for="ws-weight" class="v2-caption block mb-1.5"
              style="text-transform: uppercase; letter-spacing: 0.08em;">
              Weight (lb) *
            </label>
            <input
              id="ws-weight"
              type="number"
              inputmode="decimal"
              step="0.1"
              min="0"
              required
              class="v2-field v2-field--num"
              [class.v2-field--error]="error()"
              placeholder="0.0"
              [attr.aria-invalid]="error() ? 'true' : null"
              [attr.aria-describedby]="error() ? 'ws-weight-err' : null"
              [value]="weightInput() ?? ''"
              (input)="onInput($event)" />
            @if (error()) {
              <p id="ws-weight-err" class="v2-caption mt-1" role="alert" style="color: var(--v2-danger)">
                {{ error() }}
              </p>
            }
          </div>

          <v2-button
            variant="secondary"
            [block]="true"
            [disabled]="true"
            ariaLabel="Take photo (coming soon)">
            <span title="Coming in v2.0">
              <lucide-icon name="camera" [size]="16" />
              Take photo
              <span class="v2-caption" style="margin-left: 8px; opacity: 0.7;">Soon</span>
            </span>
          </v2-button>

          <div class="flex gap-2 pt-2">
            <v2-button variant="ghost" (click)="onClose()">Cancel</v2-button>
            <v2-button
              type="submit"
              variant="primary"
              [block]="true"
              [disabled]="saving()">
              @if (saving()) { Saving… } @else { Save }
            </v2-button>
          </div>
        </form>
      </v2-sheet>
    }
  `,
})
export class V2WeightSheet {
  private readonly store = inject(FitnessStore);

  readonly open = input<boolean>(false);
  readonly dateKey = input<string>(localDateKey(new Date()));

  readonly close = output<void>();
  readonly saved = output<number>();

  protected readonly weightInput = signal<number | null>(null);
  protected readonly error = signal<string | null>(null);
  protected readonly saving = signal(false);

  protected readonly dateLabel = computed(() => {
    const k = this.dateKey();
    if (k === localDateKey(new Date())) return 'Today';
    const [y, m, d] = k.split('-').map(Number);
    return new Date(y, m - 1, d).toLocaleDateString('en-US', {
      weekday: 'long', month: 'long', day: 'numeric',
    });
  });

  constructor() {
    // Pre-fill the input when the sheet opens, using whatever's logged
    // for the target day (or empty if none). Reset state on close so a
    // re-open starts clean.
    effect(() => {
      if (this.open()) {
        const existing = this.store.dailyWeights()[this.dateKey()];
        this.weightInput.set(existing ?? null);
        this.error.set(null);
        this.saving.set(false);
      }
    });
  }

  protected onInput(e: Event): void {
    const v = (e.target as HTMLInputElement).value;
    if (v === '') {
      this.weightInput.set(null);
    } else {
      const n = Number(v);
      this.weightInput.set(Number.isNaN(n) ? null : n);
    }
    if (this.error()) this.error.set(null);
  }

  protected async save(e: Event): Promise<void> {
    e.preventDefault();
    const w = this.weightInput();
    if (w == null || w <= 0) {
      this.error.set('Enter a weight greater than 0.');
      this.haptic(50);
      return;
    }
    this.haptic(30);
    this.saving.set(true);
    try {
      await this.store.setDailyWeight(this.dateKey(), w);
      this.saved.emit(w);
      this.close.emit();
    } catch (err) {
      this.error.set(err instanceof Error ? err.message : 'Could not save weight.');
    } finally {
      this.saving.set(false);
    }
  }

  protected onClose(): void {
    this.close.emit();
  }

  private haptic(ms: number): void {
    try {
      if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
      navigator.vibrate?.(ms);
    } catch { /* ignore */ }
  }
}
