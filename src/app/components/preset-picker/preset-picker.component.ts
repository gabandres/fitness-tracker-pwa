import { ChangeDetectionStrategy, Component, computed, inject, output, signal } from '@angular/core';
import { TranslocoDirective } from '@jsverse/transloco';
import { MealPreset } from '../../services/firebase.service';
import { FitnessStore } from '../../services/fitness-store.service';
import { MacroEstimate } from '../../models/macro-estimate';

/**
 * Quick-add chip row backed by user-saved presets. Two states:
 *
 *   - View mode (default): tap a chip → emits a MacroEstimate that
 *     pre-fills the entry form.
 *   - Manage mode: triggered by the "Manage" button next to the header.
 *     Every chip gets a visible ✕; tapping ✕ deletes the preset. Tap
 *     becomes deletion in manage mode rather than the dual-action
 *     inner-button trick that worked on desktop hover but was
 *     unreachable on touch devices.
 *
 * Manage mode auto-exits when the list empties so the user isn't left
 * staring at an empty row with a "Done" button.
 */
@Component({
  selector: 'app-preset-picker',
  standalone: true,
  imports: [TranslocoDirective],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <ng-container *transloco="let t">
      <div class="mb-4">
        <div class="flex items-baseline justify-between mb-1.5">
          <div class="data-label">{{ t('preset.quickAdd') }}</div>
          @if (store.presets().length > 0) {
            <button type="button" (click)="toggleManage()"
              class="font-mono text-[10px] tracking-[0.08em] uppercase"
              style="min-height: var(--v2-tap-min); display: inline-flex; align-items: center; padding: 0 6px; margin-block: -12px;"
              [style.color]="manage() ? 'var(--color-blood)' : 'var(--color-graphite-soft)'"
              [attr.aria-pressed]="manage()">
              {{ manage() ? t('preset.done') : t('preset.manage') }}
            </button>
          }
        </div>
        @if (store.presets().length > 0) {
          <div class="flex flex-wrap gap-1.5">
            @for (p of store.presets(); track p.id) {
              @if (manage()) {
                <button type="button" (click)="remove(p)"
                  [attr.aria-label]="t('preset.removeAria', { name: p.name })"
                  class="tag-btn text-[11px] inline-flex items-center gap-1.5"
                  style="border-color: var(--color-blood); color: var(--color-blood);">
                  <span aria-hidden="true">✕</span>
                  <span>{{ p.name }}</span>
                  <span class="text-graphite-soft">{{ p.calories }}</span>
                </button>
              } @else {
                <button type="button" (click)="pick(p)" class="tag-btn text-[11px]">
                  {{ p.name }}
                  <span class="text-graphite-soft">{{ p.calories }}</span>
                </button>
              }
            }
          </div>
        } @else {
          <!-- Empty state — tells the user where presets come from so
               they're not left guessing after they delete their last
               one. Low-noise caption, not a full specimen card. -->
          <p class="caption text-[11px] leading-relaxed">{{ t('preset.empty') }}</p>
        }
      </div>
    </ng-container>
  `,
})
export class PresetPickerComponent {
  protected readonly store = inject(FitnessStore);

  readonly estimated = output<MacroEstimate>();

  /** Manage mode toggles ✕ deletion onto every chip and turns the row
   *  header link into "Done". Auto-collapses when the list empties. */
  protected readonly manage = signal(false);

  protected readonly _autoExit = computed(() => {
    if (this.manage() && this.store.presets().length === 0) {
      this.manage.set(false);
    }
    return null;
  });

  protected toggleManage(): void {
    this.manage.update((v) => !v);
  }

  protected pick(p: MealPreset): void {
    this.estimated.emit({
      calories: p.calories,
      protein: p.protein ?? null,
      carbs: p.carbs ?? null,
      fat: p.fat ?? null,
      label: p.name,
    });
  }

  protected async remove(p: MealPreset): Promise<void> {
    if (!p.id) return;
    await this.store.deletePreset(p.id);
  }
}
