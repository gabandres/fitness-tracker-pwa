import { ChangeDetectionStrategy, Component, inject, output } from '@angular/core';
import { MealPreset } from '../../services/firebase.service';
import { FitnessStore } from '../../services/fitness-store.service';
import { MacroEstimate } from '../../models/macro-estimate';

@Component({
  selector: 'app-preset-picker',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (store.presets().length > 0) {
      <div class="mb-4">
        <div class="data-label mb-1.5">quick add</div>
        <div class="flex flex-wrap gap-1.5">
          @for (p of store.presets(); track p.id) {
            <button type="button" (click)="pick(p)" class="tag-btn text-[11px] group relative">
              {{ p.name }}
              <span class="text-graphite-soft">{{ p.calories }}</span>
              <button type="button" (click)="remove(p, $event)"
                class="ml-1 opacity-0 group-hover:opacity-100 text-blood text-[11px] transition-opacity"
                title="Remove preset">✕</button>
            </button>
          }
        </div>
      </div>
    }
  `,
})
export class PresetPickerComponent {
  protected readonly store = inject(FitnessStore);

  readonly estimated = output<MacroEstimate>();

  protected pick(p: MealPreset): void {
    this.estimated.emit({
      calories: p.calories,
      protein: p.protein ?? null,
      label: p.name,
    });
  }

  protected async remove(p: MealPreset, event: Event): Promise<void> {
    event.stopPropagation();
    if (p.id) await this.store.deletePreset(p.id);
  }
}
