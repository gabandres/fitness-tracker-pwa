import { ChangeDetectionStrategy, Component, computed, inject, output, signal } from '@angular/core';
import { TranslocoDirective } from '@jsverse/transloco';
import { scaleCustomFood } from '@macrolog/core';
import { CustomFood } from '../../services/firebase.service';
import { FitnessStore } from '../../services/fitness-store.service';
import { MacroEstimate } from '../../models/macro-estimate';

/**
 * Quick-add chip row backed by the user's saved food library (My Foods,
 * ADR-0013). Sibling of {@link PresetPickerComponent}; same two-state model:
 *
 *   - View mode (default): tap a chip → emits the food's one-serving macros
 *     as a MacroEstimate that pre-fills the entry form (re-log a saved food).
 *   - Manage mode: every chip gets a ✕ that deletes the CustomFood.
 *
 * Manage mode auto-exits when the list empties. Unlike presets, My Foods is
 * free + uncapped, so there is no limit affordance here.
 */
@Component({
  selector: 'app-my-foods-picker',
  standalone: true,
  imports: [TranslocoDirective],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <ng-container *transloco="let t">
      @if (store.customFoods().length > 0) {
        <div class="mb-4">
          <div class="flex items-baseline justify-between mb-1.5">
            <div class="data-label">{{ t('myFoods.quickAdd') }}</div>
            <button type="button" (click)="toggleManage()"
              class="font-mono text-[10px] tracking-[0.08em] uppercase"
              style="min-height: var(--v2-tap-min); display: inline-flex; align-items: center; padding: 0 6px; margin-block: -12px;"
              [style.color]="manage() ? 'var(--color-blood)' : 'var(--color-graphite-soft)'"
              [attr.aria-pressed]="manage()">
              {{ manage() ? t('myFoods.done') : t('myFoods.manage') }}
            </button>
          </div>
          <div class="flex flex-wrap gap-1.5">
            @for (f of store.customFoods(); track f.id) {
              @if (manage()) {
                <button type="button" (click)="remove(f)"
                  [attr.aria-label]="t('myFoods.removeAria', { name: f.name })"
                  class="tag-btn text-[11px] inline-flex items-center gap-1.5"
                  style="border-color: var(--color-blood); color: var(--color-blood);">
                  <span aria-hidden="true">✕</span>
                  <span>{{ f.name }}</span>
                  <span class="text-graphite-soft">{{ perServingKcal(f) }}</span>
                </button>
              } @else {
                <button type="button" (click)="pick(f)" class="tag-btn text-[11px]">
                  {{ f.name }}
                  <span class="text-graphite-soft">{{ perServingKcal(f) }}</span>
                </button>
              }
            }
          </div>
        </div>
      }
    </ng-container>
  `,
})
export class MyFoodsPickerComponent {
  protected readonly store = inject(FitnessStore);

  readonly estimated = output<MacroEstimate>();

  protected readonly manage = signal(false);

  protected readonly _autoExit = computed(() => {
    if (this.manage() && this.store.customFoods().length === 0) {
      this.manage.set(false);
    }
    return null;
  });

  /** kcal for one serving — what a single tap logs. */
  protected perServingKcal(f: CustomFood): number {
    return scaleCustomFood(f, 1).calories;
  }

  protected toggleManage(): void {
    this.manage.update((v) => !v);
  }

  /** Re-log one serving of the saved food. */
  protected pick(f: CustomFood): void {
    const m = scaleCustomFood(f, 1);
    this.estimated.emit({
      calories: m.calories,
      protein: m.protein ?? null,
      carbs: m.carbs ?? null,
      fat: m.fat ?? null,
      label: f.name,
    });
  }

  protected async remove(f: CustomFood): Promise<void> {
    if (!f.id) return;
    await this.store.deleteCustomFood(f.id);
  }
}
