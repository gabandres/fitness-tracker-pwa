import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { TranslocoDirective } from '@jsverse/transloco';
import { EntryFormManager } from '../../services/entry-form-manager.service';
import { UpsellCardComponent } from '../upsell-card/upsell-card.component';
import { BarcodeScannerComponent } from '../barcode-scanner/barcode-scanner.component';

@Component({
  selector: 'app-entry-form',
  standalone: true,
  imports: [FormsModule, TranslocoDirective, UpsellCardComponent, BarcodeScannerComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <ng-container *transloco="let t">
    <form (ngSubmit)="form.submit()" class="space-y-3">
      <!-- Date + Label row -->
      <div class="grid grid-cols-2 gap-3">
        <div>
          <label class="data-label block mb-1">{{ t('entry.date') }}</label>
          <input type="date"
            [ngModel]="form.entryDate()" (ngModelChange)="form.entryDate.set($event)"
            name="entryDate"
            class="field-input text-sm" />
        </div>
        <div>
          <label class="data-label block mb-1">
            {{ t('entry.label') }} <span class="normal-case italic text-graphite-soft tracking-normal text-[11px]">{{ t('entry.optional') }}</span>
          </label>
          <input type="text" maxlength="100"
            [ngModel]="form.mealLabel()" (ngModelChange)="form.mealLabel.set($event)"
            name="mealLabel" [attr.placeholder]="t('entry.labelPlaceholder')"
            class="field-input text-sm" />
        </div>
      </div>

      <div class="grid grid-cols-2 gap-3">
        <!-- Calories (required). Compact barcode trigger sits inline so
             scanning a packaged item populates calories + protein without
             the user having to scroll back to the capture row. -->
        <div>
          <label class="data-label block mb-1">{{ t('entry.calories') }}</label>
          <div class="flex items-baseline gap-1">
            <input type="number" step="1" inputmode="numeric" required
              [ngModel]="form.calories()" (ngModelChange)="form.calories.set($event)"
              name="calories" [attr.placeholder]="t('entry.caloriesPlaceholder')" class="field-input text-base" />
            <span class="font-display italic text-graphite text-xs">{{ t('entry.kcal') }}</span>
            <app-barcode-scanner [compact]="true" (estimated)="form.applyEstimate($event)" />
          </div>
        </div>
        <!-- Protein -->
        <div>
          <label class="data-label block mb-1">
            {{ t('entry.protein') }} <span class="normal-case italic text-graphite-soft tracking-normal text-[11px]">{{ t('entry.optional') }}</span>
          </label>
          <div class="flex items-baseline gap-1">
            <input type="number" step="1" inputmode="numeric"
              [ngModel]="form.protein()" (ngModelChange)="form.protein.set($event)"
              name="protein" [attr.placeholder]="t('entry.proteinPlaceholder')" class="field-input text-base" />
            <span class="font-display italic text-graphite text-xs">{{ t('entry.grams') }}</span>
          </div>
        </div>
      </div>

      <div>
        <label class="data-label block mb-1">{{ t('entry.training') }}</label>
        <button type="button" (click)="form.exerciseDone.set(!form.exerciseDone())"
          [class.selected]="form.exerciseDone()" class="radio-card w-full text-center py-1.5">
          <span class="font-sans text-xs tracking-[0.1em] uppercase">
            {{ form.exerciseDone() ? '●' : '○' }} {{ t('entry.exercise') }}
          </span>
        </button>
      </div>

      <div class="flex gap-2 pt-1">
        <button type="submit" [disabled]="form.status() === 'saving'" class="stamp-btn flex-1">
          {{ form.status() === 'saving' ? t('entry.saving') : form.mode() === 'edit' ? t('entry.save') : t('entry.commit') }}
        </button>
        @if (form.mode() === 'edit') {
          <button type="button" (click)="form.deleteEntry()" class="tag-btn text-blood border-blood/40 hover:bg-blood hover:text-paper">
            {{ t('entry.delete') }}
          </button>
        }
        <button type="button" (click)="form.cancel()" class="tag-btn">{{ t('entry.cancel') }}</button>
      </div>

      @if (form.status() === 'saved') {
        <div class="flex items-center gap-2">
          <span class="stamp-mark" style="transform: rotate(0deg)">{{ t('entry.savedStamp') }}</span>
          <span class="caption text-[11px]">{{ t('entry.savedCaption') }}</span>
          @if (form.mode() === 'add' && !form.savingPreset()) {
            <button type="button" (click)="form.promptSavePreset()"
              class="tag-btn text-[11px] ml-auto">{{ t('entry.saveAsPreset') }}</button>
          }
        </div>
        @if (form.savingPreset()) {
          <div class="flex items-center gap-2 mt-2">
            <input type="text" [value]="form.presetName()"
              (input)="form.presetName.set($any($event.target).value)"
              [attr.placeholder]="t('entry.presetNamePlaceholder')" class="field-input text-sm flex-1" />
            <button type="button" (click)="form.confirmSavePreset()" class="tag-btn">{{ t('entry.save') }}</button>
          </div>
        }
      }
      @if (form.status() === 'error') {
        <p class="font-sans text-xs text-blood">✕ {{ form.errorMsg() }}</p>
      }
      <!-- Contextual upsell when a free user hits the 10-preset cap. -->
      @if (form.presetLimitHit()) {
        <app-upsell-card context="presetLimit" />
      }
    </form>
    </ng-container>
  `,
})
export class EntryFormComponent {
  protected readonly form = inject(EntryFormManager);
}
