import {
  ChangeDetectionStrategy, Component, computed, output, signal,
} from '@angular/core';
import { TranslocoDirective } from '@jsverse/transloco';
import { LucideAngularModule } from 'lucide-angular';
import { MacroEstimate } from '../../models/macro-estimate';
import { V2Button } from '../ui/button.component';

interface Ingredient {
  name: string;
  calories: number | null;
  protein: number | null;
}

/**
 * Inline recipe calculator. Lets the user list ingredients (name +
 * kcal + optional protein) and a serving count, then emits a
 * MacroEstimate equal to one serving's totals. The host (entry-sheet-v2)
 * applies it to the manual form so the user can tweak / save / save-as-
 * preset through the existing flows.
 *
 * Deliberately stateless beyond the open form — recipes themselves are
 * not persisted as their own collection in this MVP. Saving a recipe
 * for reuse goes through the existing "save as preset" affordance after
 * Apply -> Save.
 */
@Component({
  selector: 'app-recipe-builder',
  standalone: true,
  imports: [TranslocoDirective, LucideAngularModule, V2Button],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <ng-container *transloco="let t">
    <div style="padding: 12px; background: var(--v2-paper-2); border: 1px solid var(--v2-rule); border-radius: var(--v2-radius-md);">
      <div class="flex items-center justify-between mb-3">
        <div>
          <div class="v2-body" style="font-weight: 500;">{{ t('v2.recipe.title') }}</div>
          <p class="v2-caption mt-0.5">{{ t('v2.recipe.desc') }}</p>
        </div>
        <v2-button variant="ghost" size="sm" (click)="closed.emit()" [ariaLabel]="t('v2.recipe.closeAria')">
          <lucide-icon name="x" [size]="14" />
        </v2-button>
      </div>

      <label class="v2-caption block mb-1.5" style="text-transform: uppercase; letter-spacing: 0.08em;">
        {{ t('v2.recipe.recipeName') }}
      </label>
      <input
        type="text"
        maxlength="60"
        class="w-full mb-3"
        style="padding: var(--v2-space-2) var(--v2-space-3); background: var(--v2-paper); border: 1px solid var(--v2-rule); border-radius: var(--v2-radius-sm); font-family: var(--v2-font-sans); color: var(--v2-ink); min-height: var(--v2-tap-min);"
        [placeholder]="t('v2.recipe.namePlaceholder')"
        [value]="recipeName()"
        (input)="recipeName.set($any($event.target).value)" />

      <label class="v2-caption block mb-1.5" style="text-transform: uppercase; letter-spacing: 0.08em;">
        {{ t('v2.recipe.ingredients') }}
      </label>
      @for (ing of ingredients(); track $index) {
        <div class="grid mb-2" style="grid-template-columns: 1fr 70px 70px 32px; gap: 6px; align-items: center;">
          <input
            type="text"
            maxlength="60"
            [value]="ing.name"
            (input)="updateIngredient($index, 'name', $any($event.target).value)"
            [placeholder]="t('v2.recipe.ingredientName')"
            style="padding: 6px 8px; background: var(--v2-paper); border: 1px solid var(--v2-rule); border-radius: var(--v2-radius-sm); font-size: 0.875rem; color: var(--v2-ink);" />
          <input
            type="number"
            inputmode="numeric"
            min="0"
            class="v2-num"
            [value]="ing.calories ?? ''"
            (input)="updateIngredient($index, 'calories', $any($event.target).value)"
            [placeholder]="t('v2.recipe.kcal')"
            [attr.aria-label]="t('v2.recipe.kcalAria')"
            style="padding: 6px 8px; background: var(--v2-paper); border: 1px solid var(--v2-rule); border-radius: var(--v2-radius-sm); font-size: 0.875rem; color: var(--v2-ink); text-align: right;" />
          <input
            type="number"
            inputmode="numeric"
            min="0"
            class="v2-num"
            [value]="ing.protein ?? ''"
            (input)="updateIngredient($index, 'protein', $any($event.target).value)"
            [placeholder]="t('v2.recipe.protein')"
            [attr.aria-label]="t('v2.recipe.proteinAria')"
            style="padding: 6px 8px; background: var(--v2-paper); border: 1px solid var(--v2-rule); border-radius: var(--v2-radius-sm); font-size: 0.875rem; color: var(--v2-ink); text-align: right;" />
          <button
            type="button"
            (click)="removeIngredient($index)"
            [attr.aria-label]="t('v2.recipe.removeRowAria')"
            [disabled]="ingredients().length === 1"
            style="min-height: 32px; min-width: 32px; display: flex; align-items: center; justify-content: center; background: transparent; border: 1px solid var(--v2-rule); border-radius: var(--v2-radius-sm); color: var(--v2-ink-muted); cursor: pointer;"
            [style.opacity]="ingredients().length === 1 ? 0.3 : 1">
            <lucide-icon name="x" [size]="14" />
          </button>
        </div>
      }

      <v2-button variant="ghost" size="sm" (click)="addIngredient()">
        <lucide-icon name="plus" [size]="14" />
        {{ t('v2.recipe.addIngredient') }}
      </v2-button>

      <div class="grid grid-cols-2 gap-3 mt-4 pt-3" style="border-top: 1px solid var(--v2-rule);">
        <div>
          <label for="recipe-servings" class="v2-caption block mb-1.5" style="text-transform: uppercase; letter-spacing: 0.08em;">
            {{ t('v2.recipe.servings') }}
          </label>
          <input
            id="recipe-servings"
            type="number"
            inputmode="numeric"
            min="1"
            step="1"
            class="v2-num w-full"
            style="padding: var(--v2-space-2) var(--v2-space-3); background: var(--v2-paper); border: 1px solid var(--v2-rule); border-radius: var(--v2-radius-sm); font-size: 1rem; font-weight: 600; color: var(--v2-ink); min-height: var(--v2-tap-min);"
            [value]="servings() ?? ''"
            (input)="onServingsInput($event)" />
        </div>
        <div style="align-self: end;">
          <p class="v2-caption" style="text-transform: uppercase; letter-spacing: 0.08em; margin-bottom: 4px;">
            {{ t('v2.recipe.perServing') }}
          </p>
          <p class="v2-num" style="font-size: 1rem; color: var(--v2-ink); font-weight: 600;">
            {{ perServingKcal() }} kcal
            @if (perServingProtein() != null) {
              <span class="v2-caption" style="font-weight: 400;">
                · {{ perServingProtein() }}{{ t('v2.recipe.proteinUnit') }}
              </span>
            }
          </p>
        </div>
      </div>

      <div class="mt-3">
        <v2-button
          variant="primary"
          size="md"
          [block]="true"
          (click)="apply()"
          [disabled]="!canApply()">
          {{ t('v2.recipe.useThis') }}
        </v2-button>
      </div>
    </div>
    </ng-container>
  `,
})
export class RecipeBuilderComponent {
  readonly estimated = output<MacroEstimate>();
  readonly closed = output<void>();

  protected readonly recipeName = signal('');
  protected readonly servings = signal<number | null>(1);
  protected readonly ingredients = signal<Ingredient[]>([
    { name: '', calories: null, protein: null },
    { name: '', calories: null, protein: null },
  ]);

  protected readonly totalKcal = computed(() =>
    this.ingredients().reduce((sum, i) => sum + (i.calories ?? 0), 0));

  protected readonly totalProtein = computed(() => {
    let any = false;
    let sum = 0;
    for (const i of this.ingredients()) {
      if (i.protein != null) { any = true; sum += i.protein; }
    }
    return any ? sum : null;
  });

  protected readonly perServingKcal = computed(() => {
    const s = this.servings();
    if (!s || s <= 0) return 0;
    return Math.round(this.totalKcal() / s);
  });

  protected readonly perServingProtein = computed<number | null>(() => {
    const tp = this.totalProtein();
    const s = this.servings();
    if (tp == null || !s || s <= 0) return null;
    return Math.round(tp / s);
  });

  protected readonly canApply = computed(() => {
    const s = this.servings();
    return this.totalKcal() > 0 && s != null && s > 0;
  });

  protected addIngredient(): void {
    this.ingredients.update((list) => [...list, { name: '', calories: null, protein: null }]);
  }

  protected removeIngredient(idx: number): void {
    this.ingredients.update((list) =>
      list.length <= 1 ? list : list.filter((_, i) => i !== idx));
  }

  protected updateIngredient(idx: number, field: keyof Ingredient, raw: string): void {
    this.ingredients.update((list) =>
      list.map((ing, i) => {
        if (i !== idx) return ing;
        if (field === 'name') return { ...ing, name: raw };
        const n = raw === '' ? null : Number(raw);
        return { ...ing, [field]: Number.isFinite(n as number) ? n : null };
      }));
  }

  protected onServingsInput(e: Event): void {
    const v = (e.target as HTMLInputElement).value;
    if (v === '') { this.servings.set(null); return; }
    const n = Number(v);
    this.servings.set(Number.isFinite(n) && n > 0 ? Math.floor(n) : null);
  }

  protected apply(): void {
    if (!this.canApply()) return;
    this.estimated.emit({
      calories: this.perServingKcal(),
      protein: this.perServingProtein(),
      label: this.recipeName().trim(),
    });
    this.closed.emit();
  }
}
