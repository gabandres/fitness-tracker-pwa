import { ChangeDetectionStrategy, Component, computed, inject, output } from '@angular/core';
import { TranslocoDirective } from '@jsverse/transloco';
import { MacroEstimate } from '../../models/macro-estimate';
import { TranslationService } from '../../services/translation.service';
import { FitnessStore } from '../../services/fitness-store.service';

/**
 * Cold-start helper. Rendered only when the user has zero logs.
 *
 * Users hitting Macro Log for the first time often don't know what to log
 * — there's no food database, and the barcode scanner only helps with
 * packaged goods. This component puts ~18 common foods one tap away so
 * they can land their first meal in seconds, without the "what do I type?"
 * friction that kills first-session retention.
 *
 * Each tap emits a MacroEstimate that the parent funnels into the same
 * applyEstimate() path that barcode + photo-capture use — so the full
 * entry form still opens, values are editable, and the user learns how
 * the entry flow works.
 */
interface StarterFood {
  label: string;
  calories: number;
  protein: number;
  group: 'drinks' | 'breakfast' | 'protein' | 'carbs' | 'fast' | 'latin';
}

export const STARTER_FOODS_EN: StarterFood[] = [
  // drinks
  { label: 'Coffee, black',            calories: 5,   protein: 0,  group: 'drinks' },
  { label: 'Latte, tall (12oz)',       calories: 150, protein: 6,  group: 'drinks' },
  // breakfast
  { label: 'Oatmeal, 1 cup cooked',    calories: 150, protein: 5,  group: 'breakfast' },
  { label: 'Eggs, 2 large',            calories: 140, protein: 12, group: 'breakfast' },
  { label: 'Greek yogurt, 1 cup',      calories: 150, protein: 20, group: 'breakfast' },
  // protein
  { label: 'Chicken breast, 6oz',      calories: 280, protein: 54, group: 'protein' },
  { label: 'Salmon, 6oz grilled',      calories: 340, protein: 40, group: 'protein' },
  { label: 'Ground beef 90/10, 4oz',   calories: 220, protein: 24, group: 'protein' },
  // carbs / sides
  { label: 'White rice, 1 cup',        calories: 205, protein: 4,  group: 'carbs' },
  { label: 'Sweet potato, medium',     calories: 105, protein: 2,  group: 'carbs' },
  { label: 'Banana',                   calories: 105, protein: 1,  group: 'carbs' },
  { label: 'Apple',                    calories: 95,  protein: 0,  group: 'carbs' },
  // fast-food
  { label: 'Chipotle chicken bowl',    calories: 700, protein: 55, group: 'fast' },
  { label: 'Big Mac',                  calories: 550, protein: 25, group: 'fast' },
  { label: 'Cheese pizza, 1 slice',    calories: 285, protein: 12, group: 'fast' },
  // latin / pr staples (match Gemini prompt)
  { label: 'Pernil, 3oz',              calories: 260, protein: 20, group: 'latin' },
  { label: 'Tostones, 2 pieces',       calories: 160, protein: 1,  group: 'latin' },
  { label: 'Mofongo, 1 serving',       calories: 380, protein: 4,  group: 'latin' },
];

/**
 * Puerto Rican starter foods for the es-PR locale. Labels are in Spanish
 * and the list leans PR-local: Medalla, avena Quaker, sorullitos, arroz
 * con gandules replace generic US items. Macros unchanged from EN list
 * where the food is the same; the swapped items carry their own macros.
 */
export const STARTER_FOODS_ES_PR: StarterFood[] = [
  // drinks
  { label: 'Café negro',                calories: 5,   protein: 0,  group: 'drinks' },
  { label: 'Café con leche',            calories: 120, protein: 6,  group: 'drinks' },
  { label: 'Medalla Light, lata',       calories: 95,  protein: 1,  group: 'drinks' },
  // breakfast
  { label: 'Avena Quaker, 1 taza',      calories: 150, protein: 5,  group: 'breakfast' },
  { label: 'Huevos, 2 grandes',         calories: 140, protein: 12, group: 'breakfast' },
  { label: 'Yogur griego, 1 taza',      calories: 150, protein: 20, group: 'breakfast' },
  // protein
  { label: 'Pechuga de pollo, 6oz',     calories: 280, protein: 54, group: 'protein' },
  { label: 'Salmón a la plancha, 6oz',  calories: 340, protein: 40, group: 'protein' },
  { label: 'Carne molida 90/10, 4oz',   calories: 220, protein: 24, group: 'protein' },
  // carbs / sides
  { label: 'Arroz blanco, 1 taza',      calories: 205, protein: 4,  group: 'carbs' },
  { label: 'Batata, mediana',           calories: 105, protein: 2,  group: 'carbs' },
  { label: 'Guineo',                    calories: 105, protein: 1,  group: 'carbs' },
  { label: 'Manzana',                   calories: 95,  protein: 0,  group: 'carbs' },
  // latin / pr staples
  { label: 'Pernil, 3oz',               calories: 260, protein: 20, group: 'latin' },
  { label: 'Tostones, 2 piezas',        calories: 160, protein: 1,  group: 'latin' },
  { label: 'Mofongo, 1 porción',        calories: 380, protein: 4,  group: 'latin' },
  { label: 'Arroz con gandules, 1 taza',calories: 220, protein: 5,  group: 'latin' },
  { label: 'Sorullitos, 3 piezas',      calories: 200, protein: 3,  group: 'latin' },
];

@Component({
  selector: 'app-starter-foods',
  standalone: true,
  imports: [TranslocoDirective],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <ng-container *transloco="let t">
    <div class="specimen px-4 py-4 slide-down">
      <span class="crop-bl"></span><span class="crop-br"></span>
      <div class="flex items-center gap-2 mb-3">
        <span class="stamp-mark" style="transform: rotate(0deg)">{{ t('starter.stamp') }}</span>
        <span class="data-label">{{ t('starter.section') }}</span>
      </div>
      <p class="caption text-[11px] mb-3 leading-relaxed">
        {{ t('starter.caption') }}
      </p>

      <div class="flex flex-wrap gap-1.5">
        @for (food of foods(); track food.label) {
          <button type="button"
            (click)="picked.emit({ calories: food.calories, protein: food.protein, label: food.label })"
            class="tag-btn text-[11px]"
            [attr.aria-label]="t('starter.logAria', { label: food.label, calories: food.calories, protein: food.protein })">
            {{ food.label }}
            <span class="text-graphite-soft ml-1 font-mono tabular-nums">{{ food.calories }}</span>
          </button>
        }
      </div>
    </div>
    </ng-container>
  `,
})
export class StarterFoodsComponent {
  private readonly translation = inject(TranslationService);
  private readonly store = inject(FitnessStore);
  readonly picked = output<MacroEstimate>();

  /**
   * Foods are re-ordered by the user's onboarding goal so the most useful
   * options surface first:
   *   cut (targetPaceLbsPerWeek > 0) → lean protein + low-cal first
   *   bulk (targetPaceLbsPerWeek < 0) → denser carbs + calorie-heavy first
   *   maintain / travel mode / unset  → original order preserved
   * The underlying list is untouched — this is a stable sort by priority
   * weight so relative order inside each tier stays natural.
   */
  protected readonly foods = computed<StarterFood[]>(() => {
    const base = this.translation.language() === 'es-PR' ? STARTER_FOODS_ES_PR : STARTER_FOODS_EN;
    const pace = this.store.profile()?.targetPaceLbsPerWeek ?? 0;
    const travel = this.store.travelMode();
    if (travel || pace === 0) return base;

    const weight = (f: StarterFood): number => {
      if (pace > 0) {
        // Cut: high protein-per-calorie first, then lowest calorie items.
        const ratio = f.protein / Math.max(1, f.calories);
        return 1000 - Math.round(ratio * 1000);
      }
      // Bulk: higher-calorie calorie-dense items first.
      return 1000 - f.calories;
    };
    return base.map((f, i) => ({ f, i, w: weight(f) }))
      .sort((a, b) => a.w - b.w || a.i - b.i)
      .map(({ f }) => f);
  });
}
