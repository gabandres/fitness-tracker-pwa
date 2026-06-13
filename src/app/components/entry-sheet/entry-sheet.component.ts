import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  signal,
} from '@angular/core';
import { LucideAngularModule } from 'lucide-angular';
import { TranslocoDirective } from '@jsverse/transloco';
import { EntryFormManager } from '../../services/entry-form-manager.service';
import { FitnessStore } from '../../services/fitness-store.service';
import { parseNumericInput } from '../../utils/meal-draft';
import type { MacroEstimate } from '../../models/macro-estimate';
import { MEAL_TYPES, type MealType } from '../../services/firebase.service';
import { UiSheet } from '../ui/sheet.component';
import { UiButton } from '../ui/button.component';
import { PhotoCaptureComponent } from '../photo-capture/photo-capture.component';
import { BarcodeScannerComponent } from '../barcode-scanner/barcode-scanner.component';
import { PresetPickerComponent } from '../preset-picker/preset-picker.component';
import { RecentEntriesComponent } from '../recent-entries/recent-entries.component';
import { RecipeBuilderComponent } from '../recipe-builder/recipe-builder.component';
import { FoodSearchComponent } from '../food-search/food-search.component';

type Segment = 'manual' | 'search' | 'photo' | 'barcode';

/**
 * v2 Entry sheet — unified Manual / Photo / Barcode in one bottom-sheet.
 *
 * Renders only when `entryForm.mode() !== 'view'`. The parent app
 * mounts this component once at the v2 root and lets the sheet manage
 * its own lifecycle via the entry-form-manager state machine.
 *
 * Manual is the canonical input surface — Photo and Barcode populate
 * the manual fields via `entryForm.applyEstimate()` and switch the
 * segment back to Manual so the user reviews + saves explicitly.
 */
@Component({
  selector: 'app-entry-sheet',
  standalone: true,
  imports: [
    LucideAngularModule,
    TranslocoDirective,
    UiSheet,
    UiButton,
    PhotoCaptureComponent,
    BarcodeScannerComponent,
    PresetPickerComponent,
    RecentEntriesComponent,
    RecipeBuilderComponent,
    FoodSearchComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <ng-container *transloco="let t">
    @if (open()) {
      <ui-sheet labelledBy="entry-sheet-title" (close)="cancel()">
        <h2 id="entry-sheet-title" class="v2-h2 mb-1">
          {{ form.mode() === 'edit' ? t('v2.entrySheet.editTitle') : t('v2.entrySheet.addTitle') }}
        </h2>
        <p class="v2-caption mb-4">
          @if (form.mode() === 'edit') { {{ t('v2.entrySheet.editSubtitle') }} }
          @else { {{ t('v2.entrySheet.addSubtitle') }} }
        </p>

        <!-- Segmented control. Hidden in edit mode (no point switching to
             photo/barcode when you're correcting an existing entry). -->
        @if (form.mode() === 'add') {
          <div
            role="tablist"
            [attr.aria-label]="t('v2.entrySheet.modeAria')"
            class="grid grid-cols-4 gap-1 p-1 mb-4"
            style="background: var(--v2-paper-2); border-radius: var(--v2-radius-md);">
            @for (s of segments; track s.id) {
              <button
                type="button"
                role="tab"
                [id]="'seg-' + s.id"
                [attr.aria-selected]="segment() === s.id"
                [attr.aria-controls]="'panel-' + s.id"
                [class]="segment() === s.id ? 'v2-btn v2-btn--sm v2-btn--primary' : 'v2-btn v2-btn--sm v2-btn--ghost'"
                (click)="setSegment(s.id)">
                <lucide-icon [name]="s.icon" [size]="14" />
                {{ t(s.labelKey) }}
              </button>
            }
          </div>
        }

        <!-- Manual segment -->
        @if (segment() === 'manual' || form.mode() === 'edit') {
          <div role="tabpanel" id="panel-manual" aria-labelledby="seg-manual">
            @if (form.mode() === 'add') {
              <!-- Quick-fill row: recent entries + saved presets. The
                   editorial chrome inside these is a Week 6 polish item;
                   functionality is intact. -->
              <app-recent-entries (estimated)="apply($event)" />
              <app-preset-picker (estimated)="apply($event)" />

              @if (showRecipeBuilder()) {
                <div class="mb-4">
                  <app-recipe-builder
                    (estimated)="apply($event)"
                    (closed)="showRecipeBuilder.set(false)" />
                </div>
              } @else {
                <div class="mb-4">
                  <ui-button variant="ghost" size="sm" (click)="showRecipeBuilder.set(true)">
                    <lucide-icon name="chef-hat" [size]="14" />
                    {{ t('v2.recipe.openButton') }}
                  </ui-button>
                </div>
              }
            }

            <form
              class="mt-4 space-y-4"
              (submit)="save($event)"
              novalidate>
              <div>
                <label for="es-label" class="v2-caption block mb-1.5" style="text-transform: uppercase; letter-spacing: 0.08em;">
                  {{ t('v2.entrySheet.mealLabel') }}
                </label>
                <input
                  id="es-label"
                  type="text"
                  maxlength="100"
                  class="w-full"
                  style="padding: var(--v2-space-3) var(--v2-space-4); background: var(--v2-paper-2); border: 1px solid var(--v2-rule); border-radius: var(--v2-radius-md); font-family: var(--v2-font-sans); font-size: 1rem; color: var(--v2-ink); min-height: var(--v2-tap-min);"
                  [placeholder]="t('v2.entrySheet.mealPlaceholder')"
                  [value]="form.mealLabel()"
                  (input)="form.mealLabel.set($any($event.target).value)" />
              </div>

              <!-- Diary slot chips. Tapping the active chip clears the
                   slot (entry lands in the "other" bucket) so legacy
                   rows can be edited without being forced into one. -->
              <div role="group" [attr.aria-label]="t('entry.mealTypeAria')" class="flex flex-wrap gap-1.5">
                @for (mt of mealTypes; track mt) {
                  <button
                    type="button"
                    [class]="form.mealType() === mt ? 'v2-btn v2-btn--sm v2-btn--primary' : 'v2-btn v2-btn--sm v2-btn--ghost'"
                    [attr.aria-pressed]="form.mealType() === mt"
                    (click)="toggleMealType(mt)">
                    {{ t('entry.mealType.' + mt) }}
                  </button>
                }
              </div>

              <div class="grid grid-cols-2 gap-3">
                <div>
                  <label for="es-kcal" class="v2-caption block mb-1.5" style="text-transform: uppercase; letter-spacing: 0.08em;">
                    {{ t('v2.entrySheet.calories') }}
                  </label>
                  <input
                    id="es-kcal"
                    type="number"
                    inputmode="numeric"
                    step="1"
                    min="0"
                    required
                    class="v2-num w-full"
                    [class.v2-input-error]="kcalError()"
                    style="padding: var(--v2-space-3) var(--v2-space-4); background: var(--v2-paper-2); border: 1px solid var(--v2-rule); border-radius: var(--v2-radius-md); font-size: 1.125rem; font-weight: 600; color: var(--v2-ink); min-height: var(--v2-tap-min);"
                    placeholder="0"
                    [attr.aria-invalid]="kcalError() ? 'true' : null"
                    [attr.aria-describedby]="kcalError() ? 'es-kcal-err' : null"
                    [value]="form.calories() ?? ''"
                    (input)="onKcalInput($event)" />
                  @if (kcalError()) {
                    <p id="es-kcal-err" class="v2-caption mt-1" role="alert" style="color: var(--v2-danger)">
                      {{ t('v2.entrySheet.caloriesRequired') }}
                    </p>
                  }
                </div>
                <div>
                  <label for="es-protein" class="v2-caption block mb-1.5" style="text-transform: uppercase; letter-spacing: 0.08em;">
                    {{ t('v2.entrySheet.protein') }}
                  </label>
                  <input
                    id="es-protein"
                    type="number"
                    inputmode="numeric"
                    step="1"
                    min="0"
                    class="v2-num w-full"
                    style="padding: var(--v2-space-3) var(--v2-space-4); background: var(--v2-paper-2); border: 1px solid var(--v2-rule); border-radius: var(--v2-radius-md); font-size: 1.125rem; font-weight: 600; color: var(--v2-ink); min-height: var(--v2-tap-min);"
                    placeholder="0"
                    [value]="form.protein() ?? ''"
                    (input)="onProteinInput($event)" />
                </div>
              </div>

              <div class="grid grid-cols-2 gap-3">
                <div>
                  <label for="es-carbs" class="v2-caption block mb-1.5" style="text-transform: uppercase; letter-spacing: 0.08em;">
                    {{ t('entry.carbs') }}
                  </label>
                  <input
                    id="es-carbs"
                    type="number"
                    inputmode="numeric"
                    step="1"
                    min="0"
                    class="v2-num w-full"
                    style="padding: var(--v2-space-3) var(--v2-space-4); background: var(--v2-paper-2); border: 1px solid var(--v2-rule); border-radius: var(--v2-radius-md); font-size: 1.125rem; font-weight: 600; color: var(--v2-ink); min-height: var(--v2-tap-min);"
                    placeholder="0"
                    [value]="form.carbs() ?? ''"
                    (input)="onCarbsInput($event)" />
                </div>
                <div>
                  <label for="es-fat" class="v2-caption block mb-1.5" style="text-transform: uppercase; letter-spacing: 0.08em;">
                    {{ t('entry.fat') }}
                  </label>
                  <input
                    id="es-fat"
                    type="number"
                    inputmode="numeric"
                    step="1"
                    min="0"
                    class="v2-num w-full"
                    style="padding: var(--v2-space-3) var(--v2-space-4); background: var(--v2-paper-2); border: 1px solid var(--v2-rule); border-radius: var(--v2-radius-md); font-size: 1.125rem; font-weight: 600; color: var(--v2-ink); min-height: var(--v2-tap-min);"
                    placeholder="0"
                    [value]="form.fat() ?? ''"
                    (input)="onFatInput($event)" />
                </div>
              </div>

              <!-- Date is hidden by default (entries default to today /
                   addingForDay). Show it only in edit mode or when
                   adding for a non-today day. -->
              @if (form.mode() === 'edit' || form.addingForDay() != null) {
                <div>
                  <label for="es-date" class="v2-caption block mb-1.5" style="text-transform: uppercase; letter-spacing: 0.08em;">
                    {{ t('v2.entrySheet.date') }}
                  </label>
                  <input
                    id="es-date"
                    type="date"
                    class="w-full"
                    style="padding: var(--v2-space-3) var(--v2-space-4); background: var(--v2-paper-2); border: 1px solid var(--v2-rule); border-radius: var(--v2-radius-md); font-family: var(--v2-font-sans); color: var(--v2-ink); min-height: var(--v2-tap-min);"
                    [value]="form.entryDate()"
                    (input)="form.entryDate.set($any($event.target).value)" />
                </div>
              }

              <!-- Save / Cancel / Delete row -->
              <div class="flex gap-2 pt-2">
                @if (form.mode() === 'edit') {
                  <ui-button variant="destructive" (click)="deleteEntry()">
                    <lucide-icon name="trash-2" [size]="16" />
                    {{ t('v2.entrySheet.delete') }}
                  </ui-button>
                }
                <ui-button variant="ghost" (click)="cancel()">{{ t('v2.entrySheet.cancel') }}</ui-button>
                <ui-button
                  type="submit"
                  variant="primary"
                  [block]="true"
                  [disabled]="form.status() === 'saving'">
                  @if (form.status() === 'saving') { {{ t('v2.entrySheet.saving') }} }
                  @else if (form.status() === 'saved') { {{ t('v2.entrySheet.saved') }} }
                  @else { {{ t('v2.entrySheet.save') }} }
                </ui-button>
              </div>

              @if (form.errorMsg()) {
                <p class="v2-caption" role="alert" style="color: var(--v2-danger)">
                  {{ form.errorMsg() }}
                </p>
              }
            </form>

            <!-- Save-as-preset sub-flow (post-save). -->
            @if (form.status() === 'saved' && form.mode() === 'add') {
              <div class="mt-5 pt-4" style="border-top: 1px solid var(--v2-rule)">
                @if (!form.savingPreset()) {
                  <ui-button variant="ghost" size="sm" (click)="form.promptSavePreset()">
                    <lucide-icon name="sparkles" [size]="14" />
                    {{ t('v2.entrySheet.saveAsPreset') }}
                  </ui-button>
                } @else {
                  <div class="flex gap-2 items-center">
                    <input
                      type="text"
                      maxlength="60"
                      class="flex-1"
                      style="padding: var(--v2-space-2) var(--v2-space-3); background: var(--v2-paper-2); border: 1px solid var(--v2-rule); border-radius: var(--v2-radius-sm); font-family: var(--v2-font-sans); color: var(--v2-ink);"
                      [placeholder]="t('v2.entrySheet.presetName')"
                      [value]="form.presetName()"
                      (input)="form.presetName.set($any($event.target).value)" />
                    <ui-button
                      variant="primary"
                      size="sm"
                      (click)="form.confirmSavePreset()"
                      [disabled]="!form.presetName().trim()">
                      {{ t('v2.entrySheet.savePreset') }}
                    </ui-button>
                  </div>
                }
              </div>
            }
          </div>
        }

        <!-- Search segment (USDA FoodData Central food database) -->
        @if (segment() === 'search' && form.mode() === 'add') {
          <div role="tabpanel" id="panel-search" aria-labelledby="seg-search">
            <app-food-search (estimated)="apply($event)" />
          </div>
        }

        <!-- Photo segment -->
        @if (segment() === 'photo' && form.mode() === 'add') {
          <div role="tabpanel" id="panel-photo" aria-labelledby="seg-photo">
            <app-photo-capture (estimated)="apply($event)" />
          </div>
        }

        <!-- Barcode segment -->
        @if (segment() === 'barcode' && form.mode() === 'add') {
          <div role="tabpanel" id="panel-barcode" aria-labelledby="seg-barcode">
            <app-barcode-scanner (estimated)="apply($event)" />
          </div>
        }
      </ui-sheet>
    }
    </ng-container>
  `,
})
export class EntrySheetComponent {
  protected readonly form = inject(EntryFormManager);
  private readonly store = inject(FitnessStore);

  protected readonly open = computed(() => this.form.mode() !== 'view');

  protected readonly segment = signal<Segment>('manual');
  protected readonly kcalError = signal(false);
  protected readonly showRecipeBuilder = signal(false);

  protected readonly mealTypes = MEAL_TYPES;

  protected readonly segments: { id: Segment; labelKey: string; icon: string }[] = [
    { id: 'manual', labelKey: 'v2.entrySheet.segManual', icon: 'type' },
    { id: 'search', labelKey: 'v2.entrySheet.segSearch', icon: 'search' },
    { id: 'photo', labelKey: 'v2.entrySheet.segPhoto', icon: 'image' },
    { id: 'barcode', labelKey: 'v2.entrySheet.segBarcode', icon: 'scan-line' },
  ];

  constructor() {
    // Reset segment to Manual whenever the sheet closes — next open
    // should always start on Manual regardless of where the previous
    // session ended (matches the "Manual is canonical" model).
    effect(() => {
      if (this.form.mode() === 'view') {
        this.segment.set('manual');
        this.kcalError.set(false);
        this.showRecipeBuilder.set(false);
      }
    });

    // Clear validation flag when the user starts typing a valid value.
    effect(() => {
      if (parseNumericInput(this.form.calories()) != null) {
        this.kcalError.set(false);
      }
    });
  }

  protected setSegment(s: Segment): void {
    this.haptic(10);
    this.segment.set(s);
  }

  protected toggleMealType(mt: MealType): void {
    this.haptic(10);
    this.form.mealType.set(this.form.mealType() === mt ? null : mt);
  }

  protected apply(est: MacroEstimate): void {
    this.form.applyEstimate(est);
    // Photo + barcode populate manual fields and bounce back to manual
    // so the user can review/edit before saving.
    if (this.segment() !== 'manual') this.segment.set('manual');
  }

  protected onKcalInput(e: Event): void {
    this.form.calories.set(parseNumericInput((e.target as HTMLInputElement).value));
  }

  protected onProteinInput(e: Event): void {
    this.form.protein.set(parseNumericInput((e.target as HTMLInputElement).value));
  }

  protected onCarbsInput(e: Event): void {
    this.form.carbs.set(parseNumericInput((e.target as HTMLInputElement).value));
  }

  protected onFatInput(e: Event): void {
    this.form.fat.set(parseNumericInput((e.target as HTMLInputElement).value));
  }

  protected save(e: Event): void {
    e.preventDefault();
    // Gate on the same parser submit() uses, so the inline kcal-error
    // visual and the actual save can never disagree on what's valid.
    if (!this.form.currentDraft().ok) {
      this.kcalError.set(true);
      this.haptic(50);
      return;
    }
    this.kcalError.set(false);
    this.haptic(30);
    void this.form.submit();
  }

  protected deleteEntry(): void {
    const target = this.form.editTarget();
    if (!target?.id) return;
    this.haptic(50);
    void this.store.deleteLog(target.id);
    this.form.cancel();
  }

  protected cancel(): void {
    this.form.cancel();
  }

  private haptic(ms: number): void {
    try {
      if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
      navigator.vibrate?.(ms);
    } catch { /* ignore */ }
  }
}
