import {
  ChangeDetectionStrategy, Component, computed, effect, inject, output, signal,
} from '@angular/core';
import { LucideAngularModule } from 'lucide-angular';
import { TranslocoDirective } from '@jsverse/transloco';
import { sortServings } from '@macrolog/core';
import { UiButton } from '../ui/button.component';
import { FoodSearchService, FoodSearchHit, FoodDetail, ServingOption } from '../../services/food-search.service';
import { FirebaseService } from '../../services/firebase.service';
import { TranslationService } from '../../services/translation.service';
import { extractErrorCode, ErrorCode } from '../../models/error-codes';
import { MacroEstimate } from '../../models/macro-estimate';

type Phase = 'idle' | 'searching' | 'results' | 'detail-loading' | 'portion-pick' | 'error';

/**
 * Global food database search panel. Sits inside the entry-sheet "search"
 * segment. Flow:
 *
 *   1. User types ≥2 chars → debounced 350ms → searchFoods CF.
 *   2. Result list rendered with brand subtitle + dataType chip.
 *   3. Tap result → getFoodDetail CF → swap to portion picker.
 *   4. Portion picker: tap a serving, optionally adjust × multiplier.
 *      Apply → emits MacroEstimate (calories/protein/label) which the
 *      entry-sheet bounces back to the manual segment for review.
 *
 * The portion list is sorted by the user's unit preference:
 *   - 'us' (default): household measures (cup/tbsp/oz/piece) first,
 *     per-100g row pushed to the bottom.
 *   - 'metric': per-100g row first.
 *
 * Errors are typed via ErrorCode so the user gets a real message instead
 * of "Internal server error". FOOD_API_NOT_CONFIGURED specifically tells
 * the user the admin hasn't set the FDC key yet — the only path out of
 * that is operator action, so we don't dress it up as retryable.
 */
@Component({
  selector: 'app-food-search',
  standalone: true,
  imports: [LucideAngularModule, TranslocoDirective, UiButton],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <ng-container *transloco="let t">
    <!-- Search header -->
    @if (phase() !== 'portion-pick' && phase() !== 'detail-loading') {
      <div class="mb-3">
        <label for="food-search-q" class="v2-field-label">
          {{ t('v2.foodSearch.label') }}
        </label>
        <div class="relative">
          <input
            id="food-search-q"
            type="search"
            autocomplete="off"
            spellcheck="false"
            class="v2-input"
            style="padding-right: 2.5rem;"
            [placeholder]="t('v2.foodSearch.placeholder')"
            [value]="query()"
            (input)="onQueryInput($event)" />
          @if (phase() === 'searching') {
            <span class="absolute" style="right: 0.75rem; top: 50%; transform: translateY(-50%);"
              [attr.aria-label]="t('v2.foodSearch.searching')">
              <lucide-icon name="loader" [size]="16" class="animate-spin" />
            </span>
          } @else if (query().length > 0) {
            <button type="button"
              class="absolute"
              style="right: 0.5rem; top: 50%; transform: translateY(-50%); padding: 0.25rem; background: transparent; border: 0; cursor: pointer; color: var(--v2-ink-muted);"
              (click)="clearQuery()"
              [attr.aria-label]="t('v2.foodSearch.clear')">
              <lucide-icon name="x" [size]="16" />
            </button>
          }
        </div>
        <p class="v2-caption mt-1" style="color: var(--v2-ink-muted)">
          {{ t('v2.foodSearch.hint') }}
        </p>
      </div>
    }

    <!-- Error -->
    @if (phase() === 'error') {
      <div role="alert"
        class="mb-3 p-3"
        style="background: var(--v2-paper-2); border: 1px solid var(--v2-danger); border-radius: var(--v2-radius-md);">
        <p class="v2-body" style="color: var(--v2-danger); font-size: 0.875rem;">
          {{ errorMsg() }}
        </p>
      </div>
    }

    <!-- Empty state (no query yet) -->
    @if (phase() === 'idle' && query().length === 0) {
      <div class="text-center" style="padding: var(--v2-space-6) 0;">
        <div class="mb-3" style="color: var(--v2-ink-muted);">
          <lucide-icon name="search" [size]="32" />
        </div>
        <p class="v2-caption" style="color: var(--v2-ink-muted);">
          {{ t('v2.foodSearch.idle') }}
        </p>
      </div>
    }

    <!-- No results -->
    @if (phase() === 'results' && hits().length === 0) {
      <div class="text-center" style="padding: var(--v2-space-5) 0;">
        <p class="v2-caption" style="color: var(--v2-ink-muted);">
          {{ t('v2.foodSearch.noResults', { q: query() }) }}
        </p>
      </div>
    }

    <!-- Result list -->
    @if (phase() === 'results' && hits().length > 0) {
      <ul role="listbox" class="space-y-1"
        [attr.aria-label]="t('v2.foodSearch.resultsAria')">
        @for (h of hits(); track h.source + h.id) {
          <li>
            <button type="button"
              role="option"
              class="w-full text-left"
              style="padding: var(--v2-space-3) var(--v2-space-3); background: var(--v2-paper-2); border: 1px solid var(--v2-rule); border-radius: var(--v2-radius-sm); min-height: var(--v2-tap-min); cursor: pointer; transition: background 120ms;"
              (click)="openDetail(h)">
              <div class="flex items-start justify-between gap-2">
                <div class="min-w-0 flex-1">
                  <div class="v2-body" style="font-weight: 500; line-height: 1.3; color: var(--v2-ink);">
                    {{ h.description }}
                  </div>
                  @if (h.brand) {
                    <div class="v2-caption mt-0.5" style="color: var(--v2-ink-muted);">
                      {{ h.brand }}
                    </div>
                  }
                </div>
                @if (h.dataType) {
                  <span class="v2-num shrink-0"
                    style="font-size: 0.625rem; padding: 2px 6px; background: var(--v2-paper); border: 1px solid var(--v2-rule); border-radius: 999px; color: var(--v2-ink-muted); text-transform: uppercase; letter-spacing: 0.05em; white-space: nowrap;">
                    {{ dataTypeShort(h.dataType) }}
                  </span>
                }
              </div>
            </button>
          </li>
        }
      </ul>
    }

    <!-- Detail loading -->
    @if (phase() === 'detail-loading') {
      <div class="text-center" style="padding: var(--v2-space-6) 0;">
        <lucide-icon name="loader" [size]="20" class="animate-spin" />
        <p class="v2-caption mt-2" style="color: var(--v2-ink-muted);">
          {{ t('v2.foodSearch.loadingDetail') }}
        </p>
      </div>
    }

    <!-- Portion picker -->
    @if (phase() === 'portion-pick' && detail(); as d) {
      <div class="mb-3">
        <button type="button"
          (click)="backToResults()"
          class="v2-caption inline-flex items-center gap-1"
          style="background: transparent; border: 0; padding: 0; color: var(--v2-ink-muted); cursor: pointer; text-transform: uppercase; letter-spacing: 0.08em;"
          [attr.aria-label]="t('v2.foodSearch.backAria')">
          <lucide-icon name="chevron-left" [size]="12" />
          {{ t('v2.foodSearch.back') }}
        </button>
        <h3 class="v2-h3 mt-1.5" style="line-height: 1.25;">
          {{ d.description }}
        </h3>
        @if (d.brand) {
          <p class="v2-caption" style="color: var(--v2-ink-muted);">{{ d.brand }}</p>
        }
      </div>

      <!-- Multiplier -->
      <div class="flex items-center justify-between gap-3 mb-3 p-2.5"
        style="background: var(--v2-paper-2); border: 1px solid var(--v2-rule); border-radius: var(--v2-radius-md);">
        <span class="v2-caption" style="text-transform: uppercase; letter-spacing: 0.08em;">
          {{ t('v2.foodSearch.multiplier') }}
        </span>
        <div class="flex items-center gap-2">
          <button type="button"
            (click)="decMultiplier()"
            [disabled]="multiplier() <= 0.25"
            [attr.aria-label]="t('v2.foodSearch.decAria')"
            class="v2-num"
            style="min-width: 2rem; min-height: 2rem; background: var(--v2-paper); border: 1px solid var(--v2-rule); border-radius: var(--v2-radius-sm); cursor: pointer; color: var(--v2-ink); font-weight: 600;">−</button>
          <span class="v2-num" style="min-width: 2.5rem; text-align: center; font-weight: 600; font-size: 1rem; color: var(--v2-ink);">
            {{ multiplierLabel() }}×
          </span>
          <button type="button"
            (click)="incMultiplier()"
            [attr.aria-label]="t('v2.foodSearch.incAria')"
            class="v2-num"
            style="min-width: 2rem; min-height: 2rem; background: var(--v2-paper); border: 1px solid var(--v2-rule); border-radius: var(--v2-radius-sm); cursor: pointer; color: var(--v2-ink); font-weight: 600;">+</button>
        </div>
      </div>

      <p class="v2-field-label">
        {{ t('v2.foodSearch.servingLabel') }}
      </p>
      <ul role="radiogroup" class="space-y-1 mb-3"
        [attr.aria-label]="t('v2.foodSearch.servingAria')">
        @for (s of sortedServings(); track s.label) {
          <li>
            <button type="button"
              role="radio"
              [attr.aria-checked]="selectedServingKey() === s.label"
              class="w-full text-left"
              [class.v2-active-highlight]="selectedServingKey() === s.label"
              [style.padding]="'var(--v2-space-3)'"
              [style.background]="selectedServingKey() === s.label ? null : 'var(--v2-paper-2)'"
              [style.border]="'1px solid var(--v2-rule)'"
              [style.borderRadius]="'var(--v2-radius-sm)'"
              [style.cursor]="'pointer'"
              [style.minHeight]="'var(--v2-tap-min)'"
              (click)="selectServing(s)">
              <div class="flex items-baseline justify-between gap-2">
                <span class="v2-body" style="font-weight: 500; color: var(--v2-ink);">
                  {{ s.label }}
                </span>
                <span class="v2-num" style="font-size: 0.875rem; color: var(--v2-ink-muted); white-space: nowrap;">
                  {{ adjustedKcal(s) }} {{ t('v2.foodSearch.kcalUnit') }}
                  · {{ adjustedProtein(s) }}{{ t('v2.foodSearch.proteinUnit') }}
                </span>
              </div>
            </button>
          </li>
        }
      </ul>

      <div class="flex gap-2">
        <ui-button variant="ghost" (click)="backToResults()">{{ t('v2.foodSearch.cancel') }}</ui-button>
        <ui-button
          variant="primary"
          [block]="true"
          [disabled]="!selectedServing()"
          (click)="applySelection()">
          {{ t('v2.foodSearch.apply') }}
        </ui-button>
      </div>
    }
    </ng-container>
  `,
})
export class FoodSearchComponent {
  private readonly foodSearch = inject(FoodSearchService);
  private readonly firebase = inject(FirebaseService);
  private readonly translation = inject(TranslationService);

  readonly estimated = output<MacroEstimate>();

  protected readonly query = signal('');
  protected readonly phase = signal<Phase>('idle');
  protected readonly hits = signal<FoodSearchHit[]>([]);
  protected readonly detail = signal<FoodDetail | null>(null);
  protected readonly errorMsg = signal('');

  protected readonly selectedServing = signal<ServingOption | null>(null);
  /** Tracks selection by label since ServingOption refs are immutable
   *  per render — comparing labels keeps the radio-checked state stable
   *  across reorders. */
  protected readonly selectedServingKey = computed(() => this.selectedServing()?.label ?? '');
  protected readonly multiplier = signal(1);

  private debounceHandle: ReturnType<typeof setTimeout> | null = null;
  /** Generation counters — incremented on every new search/detail
   *  request. Each in-flight call captures the gen at start-time and
   *  bails if a newer call has arrived. Without these, slow responses
   *  for older queries can overwrite the fresh state the user is
   *  actually looking at.
   *
   *  `clearQuery` and `backToResults` also bump `searchGen` so an
   *  in-flight search can't restore phase=results after the user has
   *  navigated away. */
  private searchGen = 0;
  private detailGen = 0;

  /** Sort the serving list by user unit preference. 'metric' floats the
   *  per-100g row to the top so grams-thinkers see the canonical row
   *  first. 'us' (default) demotes per-100g to the bottom so the
   *  cup/tbsp/oz household measures lead. */
  protected readonly sortedServings = computed(() => {
    const d = this.detail();
    if (!d) return [];
    const unit = this.firebase.profile()?.unitSystem === 'metric' ? 'metric' : 'us';
    return sortServings(d.servings, unit);
  });

  constructor() {
    // Auto-select the first serving whenever the detail loads. Without
    // this the Apply button stays disabled until the user taps a row;
    // pre-selecting the natural default ("1 cup" for US, "100 g" for
    // metric) cuts one tap from the common path.
    effect(() => {
      const list = this.sortedServings();
      if (list.length > 0 && !this.selectedServing()) {
        this.selectedServing.set(list[0]);
      }
    });
  }

  protected onQueryInput(e: Event): void {
    const v = (e.target as HTMLInputElement).value;
    this.query.set(v);
    this.errorMsg.set('');
    if (this.debounceHandle) clearTimeout(this.debounceHandle);

    const trimmed = v.trim();
    if (trimmed.length < 2) {
      this.phase.set('idle');
      this.hits.set([]);
      return;
    }
    this.phase.set('searching');
    this.debounceHandle = setTimeout(() => this.runSearch(trimmed), 350);
  }

  protected clearQuery(): void {
    if (this.debounceHandle) {
      clearTimeout(this.debounceHandle);
      this.debounceHandle = null;
    }
    // Bump the generation so any in-flight runSearch response from the
    // prior query lands as stale and is discarded — without this, a
    // late response would re-set phase to 'results' after the user
    // already cleared.
    this.searchGen++;
    this.query.set('');
    this.hits.set([]);
    this.phase.set('idle');
    this.errorMsg.set('');
  }

  private async runSearch(q: string): Promise<void> {
    const gen = ++this.searchGen;
    try {
      const hits = await this.foodSearch.search(q);
      if (gen !== this.searchGen) return; // stale response, newer query in flight
      this.hits.set(hits);
      this.phase.set('results');
    } catch (err) {
      if (gen !== this.searchGen) return;
      this.handleError(err);
    }
  }

  protected async openDetail(hit: FoodSearchHit): Promise<void> {
    const gen = ++this.detailGen;
    this.phase.set('detail-loading');
    this.detail.set(null);
    this.selectedServing.set(null);
    this.multiplier.set(1);
    try {
      const detail = await this.foodSearch.getDetail(hit.source, hit.id);
      // Stale-response guard — newer detail tap arrived first.
      if (gen !== this.detailGen) return;
      // Spread-copy so we don't mutate a possibly-shared (cached) ref.
      // Brand fallback: search hits sometimes carry the brand while the
      // detail endpoint returns it under a different field or empty.
      const enriched = !detail.brand && hit.brand
        ? { ...detail, brand: hit.brand }
        : detail;
      this.detail.set(enriched);
      this.phase.set('portion-pick');
    } catch (err) {
      if (gen !== this.detailGen) return;
      this.handleError(err);
    }
  }

  protected backToResults(): void {
    // Bump detailGen so an in-flight detail load can't snap us back into
    // portion-pick after the user has already navigated away.
    this.detailGen++;
    this.detail.set(null);
    this.selectedServing.set(null);
    this.phase.set(this.hits().length > 0 ? 'results' : 'idle');
  }

  protected selectServing(s: ServingOption): void {
    this.selectedServing.set(s);
  }

  protected incMultiplier(): void {
    const m = this.multiplier();
    // 0.25 steps up to 4×, then whole steps. Beyond 12 the value gets
    // silly and indicates the user should have picked a bigger serving;
    // hard-cap there to prevent accidental 50× macro entries.
    if (m < 4) this.multiplier.set(Math.min(4, m + 0.25));
    else this.multiplier.set(Math.min(12, m + 1));
  }

  protected decMultiplier(): void {
    const m = this.multiplier();
    if (m <= 4) this.multiplier.set(Math.max(0.25, m - 0.25));
    else this.multiplier.set(Math.max(0.25, m - 1));
  }

  protected multiplierLabel(): string {
    // Number coercion of `toFixed(2)` strips trailing zeros uniformly
    // (1 → "1", 0.75 → "0.75", 1.5 → "1.5") without the brittle two-step
    // regex previously used.
    return String(Number(this.multiplier().toFixed(2)));
  }

  protected adjustedKcal(s: ServingOption): number {
    return Math.round(s.kcal * this.multiplier());
  }

  protected adjustedProtein(s: ServingOption): number {
    return Math.round(s.protein * this.multiplier());
  }

  protected applySelection(): void {
    const s = this.selectedServing();
    const d = this.detail();
    if (!s || !d) return;
    const m = this.multiplier();
    const labelBase = d.brand ? `${d.brand} • ${d.description}` : d.description;
    const portionLabel = m === 1 ? s.label : `${this.multiplierLabel()}× ${s.label}`;
    // Combined label kept inside the 100-char mealLabel cap. Truncate
    // the description first since the portion is the more useful tail.
    const labelMax = 100;
    const tail = ` — ${portionLabel}`;
    const head = labelBase.slice(0, Math.max(0, labelMax - tail.length));
    const label = `${head}${tail}`.slice(0, labelMax);

    this.estimated.emit({
      calories: Math.round(s.kcal * m),
      protein: Math.round(s.protein * m),
      // Older detail-cache entries predate the macro expansion — emit
      // null (leave the form field untouched) rather than a fake 0.
      carbs: s.carbs != null ? Math.round(s.carbs * m) : null,
      fat: s.fat != null ? Math.round(s.fat * m) : null,
      label,
      // Food-library context (ADR-0013): a searched food saves grams-first
      // (the picked portion × multiplier) as `source:'text'` — no barcode
      // stored even for OFF hits, keeping scan-dedup semantics clean.
      serving: {
        grams: Math.round(s.grams * m),
        source: 'text',
        name: labelBase.slice(0, 100),
        ...(d.brand ? { brand: d.brand } : {}),
      },
    });

    // Reset the picker so the next entry session starts fresh.
    this.query.set('');
    this.hits.set([]);
    this.detail.set(null);
    this.selectedServing.set(null);
    this.multiplier.set(1);
    this.phase.set('idle');
  }

  /** Compress the source/dataType for the chip — "Survey (FNDDS)" is too
   *  wide, and OFF hits are tagged so users see the branded-DB provenance. */
  protected dataTypeShort(dt: string): string {
    if (dt.includes('FNDDS')) return 'FNDDS';
    if (dt === 'Branded') return 'Brand';
    if (dt === 'SR Legacy') return 'SR';
    if (dt === 'Foundation') return 'Fnd';
    if (dt === 'OFF') return 'OFF';
    return dt;
  }

  private handleError(err: unknown): void {
    const code = extractErrorCode(err);
    let msg: string;
    switch (code) {
      case ErrorCode.FOOD_API_NOT_CONFIGURED:
        msg = this.translation.t('v2.foodSearch.errorNotConfigured');
        break;
      case ErrorCode.FOOD_NOT_FOUND:
        msg = this.translation.t('v2.foodSearch.errorNotFound');
        break;
      case ErrorCode.FOOD_NO_NUTRITION:
        msg = this.translation.t('v2.foodSearch.errorNoNutrition');
        break;
      case ErrorCode.RATE_LIMITED:
        msg = this.translation.t('v2.foodSearch.errorRateLimited');
        break;
      case ErrorCode.UNAUTHENTICATED:
        msg = this.translation.t('v2.foodSearch.errorUnauth');
        break;
      default:
        msg = this.translation.t('v2.foodSearch.errorGeneric');
    }
    this.errorMsg.set(msg);
    this.phase.set('error');
  }
}
