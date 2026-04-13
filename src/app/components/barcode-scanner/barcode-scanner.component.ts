import {
  ChangeDetectionStrategy, Component, ElementRef, inject,
  OnDestroy, output, signal, viewChild,
} from '@angular/core';
import { BarcodeService } from '../../services/barcode.service';
import { MacroEstimate } from '../../models/macro-estimate';

@Component({
  selector: 'app-barcode-scanner',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (isSupported()) {
      <button type="button" (click)="startScan()"
        [disabled]="scanning()"
        aria-label="Scan a barcode to fill this entry"
        class="capture-btn">
        <span aria-hidden="true">⊟</span>
        <span>{{ scanning() ? 'scanning…' : 'barcode' }}</span>
      </button>
    }
    @if (error()) {
      <p class="font-sans text-xs text-blood mt-1">✕ {{ error() }}</p>
    }

    @if (showOverlay()) {
      <div class="fixed inset-0 z-50 bg-ink/95 flex flex-col items-center justify-center">
        <div class="data-label mb-3 text-paper">point at a barcode</div>
        <video #barcodeVideo autoplay playsinline
          class="w-full max-w-xs aspect-[3/4] object-cover border border-rule/40"></video>
        <div class="mt-4 flex gap-3">
          <button type="button" (click)="cancelScan()" class="tag-btn text-paper border-paper/40">
            cancel
          </button>
        </div>
        @if (error()) {
          <p class="font-sans text-xs text-blood mt-3">{{ error() }}</p>
        }
      </div>
    }
  `,
})
export class BarcodeScannerComponent implements OnDestroy {
  private readonly barcodeService = inject(BarcodeService);

  readonly estimated = output<MacroEstimate>();

  protected readonly isSupported = signal(this.barcodeService.isSupported());
  protected readonly scanning = signal(false);
  protected readonly error = signal('');
  protected readonly showOverlay = signal(false);
  private readonly videoRef = viewChild<ElementRef<HTMLVideoElement>>('barcodeVideo');
  private cameraStream: MediaStream | null = null;

  protected async startScan(): Promise<void> {
    this.showOverlay.set(true);
    this.scanning.set(true);
    this.error.set('');

    try {
      this.cameraStream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment' },
      });

      await new Promise((r) => setTimeout(r, 100));
      const videoEl = this.videoRef()?.nativeElement;
      if (!videoEl) { this.cancelScan(); return; }
      videoEl.srcObject = this.cameraStream;

      const barcode = await this.barcodeService.scanFromStream(videoEl);
      this.cancelScan();

      const result = await this.barcodeService.lookupProduct(barcode);
      this.estimated.emit({
        calories: result.calories,
        protein: result.protein,
        label: result.productName,
      });
    } catch (err) {
      this.cancelScan();
      this.error.set(err instanceof Error ? err.message : 'Scan failed.');
    }
  }

  protected cancelScan(): void {
    this.stopCameraStream();
    this.showOverlay.set(false);
    this.scanning.set(false);
  }

  private stopCameraStream(): void {
    if (this.cameraStream) {
      this.cameraStream.getTracks().forEach((t) => t.stop());
      this.cameraStream = null;
    }
  }

  ngOnDestroy(): void {
    this.stopCameraStream();
  }
}
