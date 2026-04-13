import { ChangeDetectionStrategy, Component, output } from '@angular/core';
import { MacroEstimate } from '../../models/macro-estimate';

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

const STARTERS: StarterFood[] = [
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

@Component({
  selector: 'app-starter-foods',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="specimen px-4 py-4 slide-down">
      <span class="crop-bl"></span><span class="crop-br"></span>
      <div class="flex items-center gap-2 mb-3">
        <span class="stamp-mark" style="transform: rotate(0deg)">start</span>
        <span class="data-label">try one of these</span>
      </div>
      <p class="caption text-[11px] mb-3 leading-relaxed">
        tap any food to log it — you can edit the number before saving.
        there's no food database, so these rough-but-reasonable estimates
        are a way to skip the "what do i type?" moment on day one.
      </p>

      <div class="flex flex-wrap gap-1.5">
        @for (food of foods; track food.label) {
          <button type="button"
            (click)="picked.emit({ calories: food.calories, protein: food.protein, label: food.label })"
            class="tag-btn text-[11px]"
            [attr.aria-label]="'Log ' + food.label + ', ' + food.calories + ' calories, ' + food.protein + ' grams protein'">
            {{ food.label }}
            <span class="text-graphite-soft ml-1 font-mono tabular-nums">{{ food.calories }}</span>
          </button>
        }
      </div>
    </div>
  `,
})
export class StarterFoodsComponent {
  readonly picked = output<MacroEstimate>();
  protected readonly foods = STARTERS;
}
