import { DecimalPipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, inject, output, signal } from '@angular/core';
import { TranslocoDirective } from '@jsverse/transloco';
import {
  hasUngroundedItems,
  rescaleScannedItem,
  sumScannedMacros,
  type ScannedFoodItem,
} from '@macrolog/core';
import { PhotoMacrosService, toScannedItems } from '../../services/photo-macros.service';
import { MacroEstimate } from '../../models/macro-estimate';
import { TranslationService } from '../../services/translation.service';
import { SubscriptionService } from '../../services/subscription.service';
import { extractErrorCode } from '../../models/error-codes';

@Component({
  selector: 'app-photo-capture',
  standalone: true,
  imports: [TranslocoDirective, DecimalPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <ng-container *transloco="let t">
    <button type="button" (click)="photoInput.click()"
      [disabled]="photoStatus() === 'analyzing' || photosRemaining() === 0"
      [attr.aria-label]="t('photo.captureAria')"
      class="capture-btn">
      <span aria-hidden="true">📷</span>
      <span>{{ photoStatus() === 'analyzing' ? t('photo.analyzing') : t('photo.photo') }}</span>
    </button>
    @if (photosRemaining() !== null) {
      <!-- title attribute surfaces the "resets midnight UTC" detail
           on hover/long-press without bloating the caption. The 0-left
           state already says it explicitly. -->
      <span class="font-mono text-[10px] tracking-[0.08em] ml-1 align-middle"
        [style.color]="photosRemaining()! <= 2 ? 'var(--color-gold)' : 'var(--color-graphite)'"
        [attr.title]="t('photo.resetHint')">
        {{ photosRemaining() === 0 ? t('photo.outOfQuota') : t('photo.left', { n: photosRemaining() }) }}
      </span>
    }
    <input #photoInput type="file" accept="image/*" capture="environment"
      class="hidden" (change)="onPhotoCaptured($event)" />
    @if (photoStatus() === 'error') {
      <!-- Prominent error card so a photo-analysis failure doesn't get
           lost in the form scroll. Dismissible via the X. -->
      <div class="mt-2 specimen px-3 py-2 flex items-start gap-2 toast-in"
        role="alert"
        style="border-color: var(--color-blood)">
        <span class="crop-bl" style="border-color: var(--color-blood)"></span>
        <span class="crop-br" style="border-color: var(--color-blood)"></span>
        <span class="font-sans text-xs text-blood flex-1">{{ photoError() }}</span>
        <button type="button" (click)="photoStatus.set('idle'); photoError.set('')"
          [attr.aria-label]="t('photo.dismissAria')"
          class="text-blood text-base leading-none shrink-0">&times;</button>
      </div>
    }
    @if (lastConfidence() === 'low') {
      <p class="font-sans text-[11px] mt-1" style="color: var(--color-gold)">
        {{ t('photo.lowConfidence') }}
      </p>
    }
    <!-- Itemized review (ADR-0015 §1). The form is already filled from the
         summed totals, so this is a correction surface, not a gate: editing an
         item's grams rescales its macros and re-emits the new total. -->
    @if (items().length) {
      <div class="mt-2 flex flex-col gap-1">
        <p class="font-mono text-[10px] tracking-[0.08em] uppercase" style="color: var(--color-graphite)">
          {{ t('photo.items') }}
        </p>
        @for (item of items(); track $index) {
          <div class="flex items-center gap-2 specimen px-2 py-1">
            <span class="flex-1 min-w-0">
              <span class="block font-sans text-xs truncate">{{ item.name }}</span>
              <span class="block font-mono text-[10px]" style="color: var(--color-graphite)">
                {{ item.calories | number: '1.0-0' }} kcal ·
                {{ item.protein | number: '1.0-0' }}P ·
                {{ item.carbs | number: '1.0-0' }}C ·
                {{ item.fat | number: '1.0-0' }}F
              </span>
              @if (item.source === 'model') {
                <span class="block font-mono text-[10px]" style="color: var(--color-gold)">
                  {{ t('photo.sourceEstimate') }}
                </span>
              } @else if (item.matchedDescription) {
                <span class="block font-mono text-[10px] truncate" style="color: var(--color-graphite)">
                  {{ item.matchedDescription }}
                </span>
              }
            </span>
            <label class="flex items-center gap-1 shrink-0">
              <input type="number" min="0" inputmode="numeric"
                class="w-14 text-right font-mono text-xs bg-transparent border-b"
                style="border-color: var(--color-graphite)"
                [attr.aria-label]="t('photo.gramsAria', { name: item.name })"
                [value]="item.grams | number: '1.0-0'"
                (change)="onGramsChanged($index, $event)" />
              <span class="font-mono text-[10px]" style="color: var(--color-graphite)">g</span>
            </label>
            <button type="button" class="shrink-0 text-base leading-none"
              style="color: var(--color-graphite)"
              [attr.aria-label]="t('photo.removeItemAria', { name: item.name })"
              (click)="removeItem($index)">&times;</button>
          </div>
        }
        @if (hasEstimated()) {
          <p class="font-sans text-[11px]" style="color: var(--color-graphite)">
            {{ t('photo.estimateHint') }}
          </p>
        }
      </div>
    }
    </ng-container>
  `,
})
export class PhotoCaptureComponent {
  private readonly photoService = inject(PhotoMacrosService);
  private readonly translation = inject(TranslationService);
  private readonly subs = inject(SubscriptionService);

  readonly estimated = output<MacroEstimate>();

  protected readonly photoStatus = signal<'idle' | 'analyzing' | 'error'>('idle');
  protected readonly photoError = signal('');
  /** Server-reported remaining count. null = unlimited (paid/admin/comped)
      or not yet fetched. Sourced from SubscriptionService so the caption
      is visible BEFORE the first capture of the session — otherwise
      users only learn their quota after burning one. */
  protected readonly photosRemaining = computed(() => this.subs.photosRemaining());
  protected readonly lastConfidence = signal<'low' | 'medium' | 'high' | null>(null);

  /**
   * The itemized breakdown from the last scan. Empty before the first capture,
   * and cleared on a new one — a stale list beside a fresh estimate would be
   * worse than no list.
   */
  protected readonly items = signal<ScannedFoodItem[]>([]);
  /** True when any item's macros are the model's own guess rather than a
   *  database row — the case worth flagging, per ADR-0015 §1. */
  protected readonly hasEstimated = computed(() => hasUngroundedItems(this.items()));

  /** Pre-resize rejection threshold. Mobile cameras routinely emit 10-12 MB
      HEIC/JPEGs; anything past 15 MB is almost certainly a misuse (burst
      video frame, multi-exposure raw) and would stall the canvas decode on
      low-end devices. Server-side also caps base64 length after resize. */
  private static readonly MAX_FILE_BYTES = 15 * 1024 * 1024;

  protected async onPhotoCaptured(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;

    if (file.size > PhotoCaptureComponent.MAX_FILE_BYTES) {
      this.photoStatus.set('error');
      this.photoError.set(this.translation.t('photo.errorFileTooLarge'));
      input.value = '';
      return;
    }

    this.photoStatus.set('analyzing');
    this.photoError.set('');
    this.items.set([]);

    try {
      const base64 = await this.resizeAndEncode(file, 1920);
      const result = await this.photoService.analyze(base64);
      this.subs.decrementPhotosRemaining(result.photosRemaining);
      this.lastConfidence.set(result.confidence);
      this.items.set(toScannedItems(result));
      this.mealLabel = result.description;
      // Emit from the server's own totals rather than re-summing the items:
      // before any edit they are the same number, and the server's is the one
      // the user was just shown.
      this.estimated.emit({
        calories: result.calories,
        protein: result.protein,
        carbs: result.carbs ?? null,
        fat: result.fat ?? null,
        label: result.description,
      });
      this.photoStatus.set('idle');
    } catch (err) {
      this.photoStatus.set('error');
      const code = extractErrorCode(err);
      if (code) {
        const details = (err as { details?: Record<string, unknown> }).details ?? {};
        this.photoError.set(this.translation.tError(code, details));
      } else {
        this.photoError.set(err instanceof Error ? err.message : this.translation.t('photo.errorFallback'));
      }
    } finally {
      input.value = '';
    }
  }

  /** Label from the last scan, so a re-emit after an edit keeps naming the meal. */
  private mealLabel = '';

  /** Editing an item's portion rescales its macros — they are linear in grams —
   *  and re-emits the new whole-meal total into the form. */
  protected onGramsChanged(index: number, event: Event): void {
    const raw = Number((event.target as HTMLInputElement).value);
    const grams = Number.isFinite(raw) ? Math.max(0, raw) : 0;
    this.items.update((list) => list.map((it, i) => (i === index ? rescaleScannedItem(it, grams) : it)));
    this.emitTotals();
  }

  protected removeItem(index: number): void {
    this.items.update((list) => list.filter((_, i) => i !== index));
    this.emitTotals();
  }

  private emitTotals(): void {
    const total = sumScannedMacros(this.items());
    this.estimated.emit({
      calories: Math.round(total.calories),
      protein: Math.round(total.protein),
      carbs: Math.round(total.carbs),
      fat: Math.round(total.fat),
      label: this.mealLabel,
    });
  }

  private resizeAndEncode(file: File, maxDim: number): Promise<string> {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        URL.revokeObjectURL(img.src);
        let { width, height } = img;
        if (width > maxDim || height > maxDim) {
          const scale = maxDim / Math.max(width, height);
          width = Math.round(width * scale);
          height = Math.round(height * scale);
        }
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        if (!ctx) { reject(new Error('Canvas not supported')); return; }
        ctx.drawImage(img, 0, 0, width, height);
        const dataUrl = canvas.toDataURL('image/jpeg', 0.92);
        resolve(dataUrl.split(',')[1]);
      };
      img.onerror = () => {
        URL.revokeObjectURL(img.src);
        reject(new Error('Failed to load image'));
      };
      img.src = URL.createObjectURL(file);
    });
  }
}
