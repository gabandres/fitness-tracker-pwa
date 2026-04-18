import { ChangeDetectionStrategy, Component, computed, inject, output, signal } from '@angular/core';
import { TranslocoDirective } from '@jsverse/transloco';
import { PhotoMacrosService } from '../../services/photo-macros.service';
import { MacroEstimate } from '../../models/macro-estimate';
import { TranslationService } from '../../services/translation.service';
import { SubscriptionService } from '../../services/subscription.service';
import { extractErrorCode } from '../../models/error-codes';
import { UpsellCardComponent } from '../upsell-card/upsell-card.component';

@Component({
  selector: 'app-photo-capture',
  standalone: true,
  imports: [TranslocoDirective, UpsellCardComponent],
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
    <!-- Contextual upsell: renders only when the free user is out of photo
         quota for the day. UpsellCardComponent self-gates on isPaid. -->
    @if (photosRemaining() === 0) {
      <app-upsell-card context="photoQuota" />
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

    try {
      const base64 = await this.resizeAndEncode(file, 1920);
      const result = await this.photoService.analyze(base64);
      this.subs.decrementPhotosRemaining(result.photosRemaining);
      this.lastConfidence.set(result.confidence);
      this.estimated.emit({
        calories: result.calories,
        protein: result.protein,
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
