import {
  ChangeDetectionStrategy, Component, inject, signal,
} from '@angular/core';
import { LucideAngularModule } from 'lucide-angular';
import { TranslocoDirective } from '@jsverse/transloco';
import { parseMealUtterance, resolveMealItem, pickResolutionHit, type ParsedFoodItem } from '@macrolog/core';
import { UiButton } from '../ui/button.component';
import { FoodSearchService } from '../../services/food-search.service';
import { EntryFormManager } from '../../services/entry-form-manager.service';
import { FitnessStore } from '../../services/fitness-store.service';
import { TranslationService } from '../../services/translation.service';
import { parseMealDraft } from '../../utils/meal-draft';

type Phase = 'input' | 'resolving' | 'review' | 'error';

/** One resolved-and-editable draft row. Macros come from the food database
 *  (never fabricated); the user edits them before committing. */
interface DraftRow {
  /** The food name the user typed — becomes the diary label. */
  food: string;
  quantity: number;
  /** Human-readable serving the macros were scaled from ("1 cup (158 g)"),
   *  or the matched DB name when unmatched-but-searched. */
  servingLabel: string;
  calories: number;
  protein: number | null;
  carbs: number | null;
  fat: number | null;
  /** True when the unit→serving mapping was a guess to double-check. */
  assumed: boolean;
  /** False when no database hit was found — the row is blank for the user
   *  to fill in manually rather than silently dropped. */
  matched: boolean;
}

// Minimal Web Speech typings (lib.dom lacks them in this TS config). Voice is
// a progressive enhancement: absent → the mic button is simply hidden.
interface SpeechRecognitionLike {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null;
  onend: (() => void) | null;
  onerror: (() => void) | null;
  start(): void;
  stop(): void;
}

/**
 * Natural-language ("conversational") meal logging (ADR-0013 text modality).
 *
 * The user types or speaks a plain-language meal ("2 eggs and a cup of white
 * rice"); a deterministic on-device parser (`@macrolog/core`) decomposes it
 * into `{qty, unit, food}` items — never guessing macros — then each food is
 * resolved through the existing `searchFoods`/`getFoodDetail` database and
 * scaled by `resolveMealItem`. The result is an EDITABLE draft the user
 * confirms with one "Add all", per the ADR trust rule: land on a reviewable
 * draft with visible assumptions, never a fake-precise silent auto-commit.
 *
 * Lives inside the entry-sheet as its own segment. Unlike the other segments
 * (which emit one MacroEstimate back to Manual), this adds N diary rows at
 * once, so it writes to the store directly and then closes the sheet.
 */
@Component({
  selector: 'app-meal-text',
  standalone: true,
  imports: [LucideAngularModule, TranslocoDirective, UiButton],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <ng-container *transloco="let t">
    @if (phase() !== 'review') {
      <div class="mb-3">
        <label for="meal-text-q" class="v2-field-label">{{ t('v2.mealText.label') }}</label>
        <div class="relative">
          <textarea
            id="meal-text-q"
            rows="2"
            autocomplete="off"
            spellcheck="false"
            class="v2-input"
            style="resize: none; padding-right: 2.75rem;"
            [placeholder]="t('v2.mealText.placeholder')"
            [value]="query()"
            (input)="onInput($event)"></textarea>
          @if (voiceSupported()) {
            <button type="button"
              class="absolute"
              style="right: 0.5rem; top: 0.5rem; padding: 0.375rem; border-radius: 999px; border: 1px solid var(--v2-rule); cursor: pointer;"
              [style.background]="listening() ? 'var(--v2-danger)' : 'var(--v2-paper)'"
              [style.color]="listening() ? '#fff' : 'var(--v2-ink-muted)'"
              (click)="toggleMic()"
              [attr.aria-label]="listening() ? t('v2.mealText.micListening') : t('v2.mealText.mic')">
              <lucide-icon [name]="listening() ? 'mic-off' : 'mic'" [size]="16"
                [class.animate-pulse]="listening()" />
            </button>
          }
        </div>
        <p class="v2-caption mt-1" style="color: var(--v2-ink-muted)">{{ t('v2.mealText.hint') }}</p>
      </div>

      @if (phase() === 'error') {
        <div role="alert" class="mb-3 p-3"
          style="background: var(--v2-paper-2); border: 1px solid var(--v2-danger); border-radius: var(--v2-radius-md);">
          <p class="v2-body" style="color: var(--v2-danger); font-size: 0.875rem;">{{ errorMsg() }}</p>
        </div>
      }

      <ui-button variant="primary" [block]="true"
        [disabled]="query().trim().length < 2 || phase() === 'resolving'"
        (click)="resolve()">
        @if (phase() === 'resolving') {
          <lucide-icon name="loader" [size]="16" class="animate-spin" />
          {{ t('v2.mealText.resolving') }}
        } @else {
          {{ t('v2.mealText.parse') }}
        }
      </ui-button>
    }

    <!-- Review + edit draft rows -->
    @if (phase() === 'review') {
      <p class="v2-caption mb-2" style="color: var(--v2-ink-muted)">{{ t('v2.mealText.reviewHint') }}</p>
      <ul class="space-y-2 mb-3">
        @for (row of rows(); track $index) {
          <li style="padding: var(--v2-space-3); background: var(--v2-paper-2); border: 1px solid var(--v2-rule); border-radius: var(--v2-radius-md);">
            <div class="flex items-start justify-between gap-2">
              <div class="min-w-0 flex-1">
                <div class="v2-body" style="font-weight: 600; color: var(--v2-ink); text-transform: capitalize;">
                  {{ row.food }}
                </div>
                <div class="v2-caption" style="color: var(--v2-ink-muted);">{{ row.servingLabel }}</div>
              </div>
              <button type="button"
                style="padding: 0.25rem; background: transparent; border: 0; cursor: pointer; color: var(--v2-ink-muted);"
                (click)="removeRow($index)" [attr.aria-label]="t('v2.mealText.removeAria')">
                <lucide-icon name="x" [size]="16" />
              </button>
            </div>

            @if (row.assumed) {
              <p class="v2-caption mt-1" style="color: var(--v2-warn, var(--v2-danger));">
                <lucide-icon name="alert-triangle" [size]="11" /> {{ t('v2.mealText.assumed') }}
              </p>
            } @else if (!row.matched) {
              <p class="v2-caption mt-1" style="color: var(--v2-warn, var(--v2-danger));">
                <lucide-icon name="alert-triangle" [size]="11" /> {{ t('v2.mealText.noMatch') }}
              </p>
            }

            <div class="grid grid-cols-4 gap-2 mt-2">
              <label class="v2-num" style="font-size: 0.75rem;">
                <span style="color: var(--v2-ink-muted);">{{ t('v2.mealText.kcalUnit') }}</span>
                <input type="number" inputmode="numeric" class="v2-input" style="padding: 0.35rem 0.4rem; text-align: center;"
                  [value]="row.calories" (input)="editRow($index, 'calories', $event)" />
              </label>
              <label class="v2-num" style="font-size: 0.75rem;">
                <span style="color: var(--v2-ink-muted);">{{ t('v2.mealText.proteinShort') }}</span>
                <input type="number" inputmode="decimal" class="v2-input" style="padding: 0.35rem 0.4rem; text-align: center;"
                  [value]="row.protein" (input)="editRow($index, 'protein', $event)" />
              </label>
              <label class="v2-num" style="font-size: 0.75rem;">
                <span style="color: var(--v2-ink-muted);">{{ t('v2.mealText.carbsShort') }}</span>
                <input type="number" inputmode="decimal" class="v2-input" style="padding: 0.35rem 0.4rem; text-align: center;"
                  [value]="row.carbs" (input)="editRow($index, 'carbs', $event)" />
              </label>
              <label class="v2-num" style="font-size: 0.75rem;">
                <span style="color: var(--v2-ink-muted);">{{ t('v2.mealText.fatShort') }}</span>
                <input type="number" inputmode="decimal" class="v2-input" style="padding: 0.35rem 0.4rem; text-align: center;"
                  [value]="row.fat" (input)="editRow($index, 'fat', $event)" />
              </label>
            </div>
          </li>
        }
      </ul>

      <div class="flex gap-2">
        <ui-button variant="ghost" (click)="startOver()">{{ t('v2.mealText.startOver') }}</ui-button>
        <ui-button variant="primary" [block]="true" [disabled]="rows().length === 0 || saving()"
          (click)="addAll()">
          {{ t('v2.mealText.addAll', { count: rows().length }) }}
        </ui-button>
      </div>
    }
    </ng-container>
  `,
})
export class MealTextComponent {
  private readonly foodSearch = inject(FoodSearchService);
  private readonly form = inject(EntryFormManager);
  private readonly store = inject(FitnessStore);
  private readonly translation = inject(TranslationService);

  protected readonly query = signal('');
  protected readonly phase = signal<Phase>('input');
  protected readonly rows = signal<DraftRow[]>([]);
  protected readonly errorMsg = signal('');
  protected readonly saving = signal(false);

  protected readonly listening = signal(false);
  protected readonly voiceSupported = signal(
    typeof window !== 'undefined' &&
    !!((window as unknown as Record<string, unknown>)['SpeechRecognition'] ||
       (window as unknown as Record<string, unknown>)['webkitSpeechRecognition']),
  );
  private recognition: SpeechRecognitionLike | null = null;

  protected onInput(e: Event): void {
    this.query.set((e.target as HTMLTextAreaElement).value);
    if (this.phase() === 'error') this.phase.set('input');
  }

  /** Parse the utterance, resolve each item through the food database in
   *  parallel, and land on the editable review list. */
  protected async resolve(): Promise<void> {
    const items = parseMealUtterance(this.query());
    if (items.length === 0) {
      this.errorMsg.set(this.translation.t('v2.mealText.noItems'));
      this.phase.set('error');
      return;
    }
    this.phase.set('resolving');
    try {
      const rows = await Promise.all(items.map((it) => this.resolveItem(it)));
      this.rows.set(rows);
      this.phase.set('review');
    } catch {
      this.errorMsg.set(this.translation.t('v2.mealText.errorSearch'));
      this.phase.set('error');
    }
  }

  /** Resolve one parsed item: search the DB, take the top hit, scale its
   *  serving. A miss (or a hit with no usable serving) yields a blank,
   *  clearly-flagged row rather than dropping the food. */
  private async resolveItem(item: ParsedFoodItem): Promise<DraftRow> {
    try {
      // Search wider (10) than we show so a USDA generic entry is in reach,
      // then auto-pick the best one — bare terms like "eggs" otherwise resolve
      // to a branded/high-fat product that scales into nonsense.
      const hits = await this.foodSearch.search(item.food, 10);
      const hit = pickResolutionHit(hits);
      if (!hit) return this.blankRow(item);
      const detail = await this.foodSearch.getDetail(hit.source, hit.id);
      const resolved = resolveMealItem(item, detail.servings);
      // A 0-calorie resolution means a degenerate DB entry (e.g. a milligram
      // "serving" with no macros) — show an honest "enter values" row instead
      // of a fake-precise zero, per the ADR trust rule.
      if (!resolved || resolved.calories <= 0) return this.blankRow(item);
      return {
        food: item.food,
        quantity: resolved.quantity,
        servingLabel: this.gramsLabel(resolved.grams, resolved.servingLabel),
        calories: resolved.calories,
        protein: resolved.protein,
        carbs: resolved.carbs,
        fat: resolved.fat,
        assumed: resolved.assumed,
        matched: true,
      };
    } catch {
      // A single food's lookup failing (rate limit, network) shouldn't sink
      // the whole meal — surface it as a fill-in-yourself row.
      return this.blankRow(item);
    }
  }

  private blankRow(item: ParsedFoodItem): DraftRow {
    return {
      food: item.food,
      quantity: item.quantity,
      servingLabel: this.gramsLabel(null, ''),
      calories: 0,
      protein: null,
      carbs: null,
      fat: null,
      assumed: false,
      matched: false,
    };
  }

  /** Compose the subtitle: "≈158 g · 1 cup (158 g)" with graceful fallbacks. */
  private gramsLabel(grams: number | null, servingLabel: string): string {
    const parts: string[] = [];
    if (grams != null) parts.push(`≈${grams} g`);
    if (servingLabel) parts.push(servingLabel);
    return parts.join(' · ');
  }

  protected editRow(i: number, field: 'calories' | 'protein' | 'carbs' | 'fat', e: Event): void {
    const raw = (e.target as HTMLInputElement).value.trim();
    const n = raw === '' ? null : Number(raw);
    const value = n != null && Number.isFinite(n) ? n : null;
    this.rows.update((rows) => {
      const next = [...rows];
      const row = { ...next[i] };
      if (field === 'calories') row.calories = value ?? 0;
      else row[field] = value;
      next[i] = row;
      return next;
    });
  }

  protected removeRow(i: number): void {
    this.rows.update((rows) => rows.filter((_, idx) => idx !== i));
  }

  protected startOver(): void {
    this.rows.set([]);
    this.phase.set('input');
  }

  /** Commit every row as its own diary entry, then close the sheet. Reuses
   *  `parseMealDraft` per row so date/label/coercion match manual entry. */
  protected async addAll(): Promise<void> {
    if (this.saving()) return;
    this.saving.set(true);
    try {
      for (const row of this.rows()) {
        const res = parseMealDraft({
          calories: row.calories,
          protein: row.protein,
          carbs: row.carbs,
          fat: row.fat,
          mealLabel: row.food,
          mealType: this.form.mealType(),
          dateKey: this.form.entryDate(),
        });
        if (res.ok) await this.store.addLog(res.draft.entry);
      }
      try { navigator.vibrate?.(20); } catch { /* ignore */ }
      this.form.cancel();
    } finally {
      this.saving.set(false);
    }
  }

  // ── Voice input (Web Speech API — progressive enhancement) ──────────
  protected toggleMic(): void {
    if (this.listening()) {
      this.recognition?.stop();
      return;
    }
    const w = window as unknown as Record<string, new () => SpeechRecognitionLike>;
    const Ctor = w['SpeechRecognition'] || w['webkitSpeechRecognition'];
    if (!Ctor) return;
    const rec = new Ctor();
    rec.lang = this.translation.language() === 'es-PR' ? 'es-US' : 'en-US';
    rec.interimResults = true;
    rec.continuous = false;
    rec.onresult = (ev) => {
      let transcript = '';
      for (let i = 0; i < ev.results.length; i++) transcript += ev.results[i][0].transcript;
      this.query.set(transcript);
      if (this.phase() === 'error') this.phase.set('input');
    };
    rec.onend = () => this.listening.set(false);
    rec.onerror = () => this.listening.set(false);
    this.recognition = rec;
    this.listening.set(true);
    rec.start();
  }
}
