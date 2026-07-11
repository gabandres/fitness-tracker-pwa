import {
  ChangeDetectionStrategy, Component, inject, output, signal,
} from '@angular/core';
import { TranslocoDirective } from '@jsverse/transloco';
import { LucideAngularModule } from 'lucide-angular';
import { parseRecipeFromHtml, type ParsedRecipe } from '@macrolog/core';
import { CallableGateway } from '../../services/callable.gateway';
import { TranslationService } from '../../services/translation.service';
import { extractErrorCode } from '../../models/error-codes';
import type { MacroEstimate } from '../../models/macro-estimate';
import { UiButton } from '../ui/button.component';

/**
 * Recipe-URL import. Paste a recipe link → a hardened Cloud Function fetches
 * the page and returns its JSON-LD → the shared core parser (`parseRecipeFromHtml`)
 * turns it into an editable per-serving draft. When the page publishes a
 * nutrition block, one serving is emitted as a MacroEstimate so the host
 * entry sheet prefills the manual form for review/save (same path as the
 * recipe builder). Pages without nutrition surface a friendly "no data" note.
 */
@Component({
  selector: 'app-recipe-import',
  standalone: true,
  imports: [TranslocoDirective, LucideAngularModule, UiButton],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <ng-container *transloco="let t">
    <div style="padding: 12px; background: var(--v2-paper-2); border: 1px solid var(--v2-rule); border-radius: var(--v2-radius-md);">
      <div class="flex items-center justify-between mb-3">
        <div>
          <div class="v2-body" style="font-weight: 500;">{{ t('v2.recipeImport.title') }}</div>
          <p class="v2-caption mt-0.5">{{ t('v2.recipeImport.desc') }}</p>
        </div>
        <ui-button variant="ghost" size="sm" (click)="closed.emit()" [ariaLabel]="t('v2.recipeImport.closeAria')">
          <lucide-icon name="x" [size]="14" />
        </ui-button>
      </div>

      <div class="flex gap-2">
        <input
          type="url"
          inputmode="url"
          maxlength="2048"
          class="flex-1"
          style="padding: var(--v2-space-2) var(--v2-space-3); background: var(--v2-paper); border: 1px solid var(--v2-rule); border-radius: var(--v2-radius-sm); font-family: var(--v2-font-sans); color: var(--v2-ink); min-height: var(--v2-tap-min);"
          [placeholder]="t('v2.recipeImport.urlPlaceholder')"
          [attr.aria-label]="t('v2.recipeImport.urlLabel')"
          [value]="url()"
          (input)="onUrlInput($event)"
          (keydown.enter)="fetch()" />
        <ui-button variant="secondary" size="md" (click)="fetch()" [disabled]="loading() || !url().trim()">
          @if (loading()) { {{ t('v2.recipeImport.fetching') }} }
          @else { {{ t('v2.recipeImport.fetch') }} }
        </ui-button>
      </div>

      @if (error()) {
        <p class="v2-caption mt-2" role="alert" style="color: var(--v2-danger);">{{ error() }}</p>
      }

      @if (result(); as r) {
        <div class="v2-card mt-3 p-3" style="background: var(--v2-paper);">
          <div class="v2-body" style="font-weight: 600;">{{ r.name || t('v2.recipeImport.untitled') }}</div>
          <p class="v2-caption mt-0.5">
            {{ perServingKcal() }} kcal
            @if (perServingProtein() != null) {
              · {{ perServingProtein() }}{{ t('v2.recipeImport.proteinUnit') }}
            }
            {{ t('v2.recipeImport.perServing') }}
            @if (r.servings) { · {{ t('v2.recipeImport.servings', { n: r.servings }) }} }
          </p>
          @if (r.ingredients.length) {
            <p class="v2-caption mt-1" style="color: var(--v2-faint);">
              {{ t('v2.recipeImport.ingredientCount', { n: r.ingredients.length }) }}
            </p>
          }
          <div class="mt-3">
            <ui-button variant="primary" size="md" [block]="true" (click)="apply()" [disabled]="!canApply()">
              {{ t('v2.recipeImport.useThis') }}
            </ui-button>
          </div>
        </div>
      }
    </div>
    </ng-container>
  `,
})
export class RecipeImportComponent {
  private readonly callables = inject(CallableGateway);
  private readonly translation = inject(TranslationService);

  readonly estimated = output<MacroEstimate>();
  readonly closed = output<void>();

  protected readonly url = signal('');
  protected readonly loading = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly result = signal<ParsedRecipe | null>(null);

  protected onUrlInput(e: Event): void {
    this.url.set((e.target as HTMLInputElement).value);
    if (this.error()) this.error.set(null);
  }

  protected perServingKcal(): number {
    return this.result()?.perServing?.calories ?? 0;
  }

  protected perServingProtein(): number | null {
    return this.result()?.perServing?.protein ?? null;
  }

  /** Only importable when the page gave us at least a per-serving calorie
   *  number — that's what the manual form needs. */
  protected canApply(): boolean {
    return this.perServingKcal() > 0;
  }

  protected async fetch(): Promise<void> {
    const url = this.url().trim();
    if (!url || this.loading()) return;
    this.loading.set(true);
    this.error.set(null);
    this.result.set(null);
    try {
      const { html } = await this.callables.call<{ url: string }, { html: string }>(
        'importRecipe', { url },
      );
      const parsed = parseRecipeFromHtml(html);
      if (!parsed || parsed.perServing?.calories == null) {
        this.error.set(this.translation.t('v2.recipeImport.noNutrition'));
        return;
      }
      this.result.set(parsed);
    } catch (err) {
      const code = extractErrorCode(err);
      const key = code === 'RECIPE_URL_INVALID' ? 'v2.recipeImport.errInvalidUrl'
        : code === 'RECIPE_NOT_FOUND' ? 'v2.recipeImport.noNutrition'
        : code === 'RATE_LIMITED' ? 'v2.recipeImport.errRateLimited'
        : 'v2.recipeImport.errFetch';
      this.error.set(this.translation.t(key));
    } finally {
      this.loading.set(false);
    }
  }

  protected apply(): void {
    const r = this.result();
    if (!r || !this.canApply()) return;
    this.estimated.emit({
      calories: this.perServingKcal(),
      protein: this.perServingProtein(),
      label: r.name.trim(),
    });
    this.closed.emit();
  }
}
