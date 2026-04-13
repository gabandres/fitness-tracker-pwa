import { ChangeDetectionStrategy, Component, inject, output, signal } from '@angular/core';
import { PhotoMacrosService } from '../../services/photo-macros.service';
import { MacroEstimate } from '../../models/macro-estimate';

@Component({
  selector: 'app-photo-capture',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <button type="button" (click)="photoInput.click()"
      [disabled]="photoStatus() === 'analyzing' || photosRemaining() === 0"
      aria-label="Snap a photo of your meal to estimate calories"
      class="capture-btn">
      <span aria-hidden="true">📷</span>
      <span>{{ photoStatus() === 'analyzing' ? 'analyzing…' : 'photo' }}</span>
    </button>
    @if (photosRemaining() !== null) {
      <span class="font-mono text-[10px] tracking-[0.08em] ml-1 align-middle"
        [style.color]="photosRemaining()! <= 2 ? 'var(--color-gold)' : 'var(--color-graphite)'">
        {{ photosRemaining() }} left
      </span>
    }
    <input #photoInput type="file" accept="image/*" capture="environment"
      class="hidden" (change)="onPhotoCaptured($event)" />
    @if (photoStatus() === 'error') {
      <!-- Prominent error card so a photo-analysis failure doesn't get
           lost in the form scroll. Dismissible via the X. -->
      <div class="mt-2 specimen px-3 py-2 flex items-start gap-2"
        role="status" aria-live="polite"
        style="border-color: var(--color-blood)">
        <span class="crop-bl" style="border-color: var(--color-blood)"></span>
        <span class="crop-br" style="border-color: var(--color-blood)"></span>
        <span class="font-sans text-xs text-blood flex-1">{{ photoError() }}</span>
        <button type="button" (click)="photoStatus.set('idle'); photoError.set('')"
          aria-label="Dismiss photo error"
          class="text-blood text-base leading-none shrink-0">&times;</button>
      </div>
    }
    @if (lastConfidence() === 'low') {
      <p class="font-sans text-[11px] mt-1" style="color: var(--color-gold)">
        &#9888; low confidence &mdash; verify estimate
      </p>
    }
  `,
})
export class PhotoCaptureComponent {
  private readonly photoService = inject(PhotoMacrosService);

  readonly estimated = output<MacroEstimate>();

  protected readonly photoStatus = signal<'idle' | 'analyzing' | 'error'>('idle');
  protected readonly photoError = signal('');
  protected readonly photosRemaining = signal<number | null>(null);
  protected readonly lastConfidence = signal<'low' | 'medium' | 'high' | null>(null);

  protected async onPhotoCaptured(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;

    this.photoStatus.set('analyzing');
    this.photoError.set('');

    try {
      const base64 = await this.resizeAndEncode(file, 1024);
      const result = await this.photoService.analyze(base64);
      this.photosRemaining.set(result.photosRemaining);
      this.lastConfidence.set(result.confidence);
      this.estimated.emit({
        calories: result.calories,
        protein: result.protein,
        label: result.description,
      });
      this.photoStatus.set('idle');
    } catch (err) {
      this.photoStatus.set('error');
      this.photoError.set(err instanceof Error ? err.message : 'Photo analysis failed.');
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
        const dataUrl = canvas.toDataURL('image/jpeg', 0.8);
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
