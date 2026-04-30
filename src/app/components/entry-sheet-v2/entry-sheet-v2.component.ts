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
import type { MacroEstimate } from '../../models/macro-estimate';
import { V2Sheet } from '../ui/sheet.component';
import { V2Button } from '../ui/button.component';
import { PhotoCaptureComponent } from '../photo-capture/photo-capture.component';
import { BarcodeScannerComponent } from '../barcode-scanner/barcode-scanner.component';
import { PresetPickerComponent } from '../preset-picker/preset-picker.component';
import { RecentEntriesComponent } from '../recent-entries/recent-entries.component';

type Segment = 'manual' | 'photo' | 'barcode';

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
  selector: 'app-entry-sheet-v2',
  standalone: true,
  imports: [
    LucideAngularModule,
    TranslocoDirective,
    V2Sheet,
    V2Button,
    PhotoCaptureComponent,
    BarcodeScannerComponent,
    PresetPickerComponent,
    RecentEntriesComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <ng-container *transloco="let t">
    @if (open()) {
      <v2-sheet labelledBy="entry-sheet-title" (close)="cancel()">
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
            class="grid grid-cols-3 gap-1 p-1 mb-4"
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
                  <v2-button variant="destructive" (click)="deleteEntry()">
                    <lucide-icon name="trash-2" [size]="16" />
                    {{ t('v2.entrySheet.delete') }}
                  </v2-button>
                }
                <v2-button variant="ghost" (click)="cancel()">{{ t('v2.entrySheet.cancel') }}</v2-button>
                <v2-button
                  type="submit"
                  variant="primary"
                  [block]="true"
                  [disabled]="form.status() === 'saving'">
                  @if (form.status() === 'saving') { {{ t('v2.entrySheet.saving') }} }
                  @else if (form.status() === 'saved') { {{ t('v2.entrySheet.saved') }} }
                  @else { {{ t('v2.entrySheet.save') }} }
                </v2-button>
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
                  <v2-button variant="ghost" size="sm" (click)="form.promptSavePreset()">
                    <lucide-icon name="sparkles" [size]="14" />
                    {{ t('v2.entrySheet.saveAsPreset') }}
                  </v2-button>
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
                    <v2-button
                      variant="primary"
                      size="sm"
                      (click)="form.confirmSavePreset()"
                      [disabled]="!form.presetName().trim()">
                      {{ t('v2.entrySheet.savePreset') }}
                    </v2-button>
                  </div>
                }
              </div>
            }
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
      </v2-sheet>
    }
    </ng-container>
  `,
})
export class EntrySheetV2Component {
  protected readonly form = inject(EntryFormManager);
  private readonly store = inject(FitnessStore);

  protected readonly open = computed(() => this.form.mode() !== 'view');

  protected readonly segment = signal<Segment>('manual');
  protected readonly kcalError = signal(false);

  protected readonly segments: { id: Segment; labelKey: string; icon: string }[] = [
    { id: 'manual', labelKey: 'v2.entrySheet.segManual', icon: 'type' },
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
      }
    });

    // Clear validation flag when the user starts typing a value.
    effect(() => {
      const c = this.form.calories();
      if (c != null && !Number.isNaN(Number(c))) {
        this.kcalError.set(false);
      }
    });
  }

  protected setSegment(s: Segment): void {
    this.haptic(10);
    this.segment.set(s);
  }

  protected apply(est: MacroEstimate): void {
    this.form.applyEstimate(est);
    // Photo + barcode populate manual fields and bounce back to manual
    // so the user can review/edit before saving.
    if (this.segment() !== 'manual') this.segment.set('manual');
  }

  protected onKcalInput(e: Event): void {
    const v = (e.target as HTMLInputElement).value;
    if (v === '') {
      this.form.calories.set(null);
    } else {
      const n = Number(v);
      this.form.calories.set(Number.isNaN(n) ? null : n);
    }
  }

  protected onProteinInput(e: Event): void {
    const v = (e.target as HTMLInputElement).value;
    if (v === '') {
      this.form.protein.set(null);
    } else {
      const n = Number(v);
      this.form.protein.set(Number.isNaN(n) ? null : n);
    }
  }

  protected save(e: Event): void {
    e.preventDefault();
    const c = this.form.calories();
    if (c == null || Number.isNaN(Number(c))) {
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
