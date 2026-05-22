import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  HostListener,
  OnDestroy,
  OnInit,
  inject,
  input,
  output,
  viewChild,
} from '@angular/core';
import { LucideAngularModule } from 'lucide-angular';

/**
 * Bottom-sheet on mobile, centered modal on desktop.
 * Dismiss: backdrop tap, swipe-down (mobile), Escape, or close button.
 *
 * Usage:
 *   <ui-sheet (close)="onClose()" [labelledBy]="'sheet-title'">
 *     <h2 id="sheet-title">…</h2>
 *     …content…
 *   </ui-sheet>
 */
@Component({
  selector: 'ui-sheet',
  standalone: true,
  imports: [LucideAngularModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div
      class="v2-sheet-backdrop"
      role="dialog"
      aria-modal="true"
      [attr.aria-labelledby]="labelledBy() || null"
      (click)="onBackdrop($event)">
      <div
        #panel
        class="v2-sheet"
        (click)="$event.stopPropagation()"
        (touchstart)="onTouchStart($event)"
        (touchmove)="onTouchMove($event)"
        (touchend)="onTouchEnd()">
        <div class="v2-sheet-handle" aria-hidden="true"></div>
        <div class="flex justify-end -mt-2 mb-2 md:mb-1">
          <button
            type="button"
            class="v2-icon-btn"
            (click)="close.emit()"
            aria-label="Close">
            <lucide-icon name="x" [size]="20" />
          </button>
        </div>
        <ng-content />
      </div>
    </div>
  `,
})
export class UiSheet implements OnInit, OnDestroy {
  private readonly host = inject(ElementRef<HTMLElement>);

  readonly labelledBy = input<string | null>(null);
  readonly close = output<void>();

  protected readonly panelRef = viewChild<ElementRef<HTMLDivElement>>('panel');

  private touchStartY = 0;
  private touchDeltaY = 0;
  private prevOverflow = '';

  ngOnInit(): void {
    this.prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
  }

  ngOnDestroy(): void {
    document.body.style.overflow = this.prevOverflow;
  }

  @HostListener('document:keydown.escape')
  onEscape(): void {
    this.close.emit();
  }

  protected onBackdrop(e: MouseEvent): void {
    if (e.target === e.currentTarget) this.close.emit();
  }

  protected onTouchStart(e: TouchEvent): void {
    this.touchStartY = e.touches[0].clientY;
    this.touchDeltaY = 0;
  }

  protected onTouchMove(e: TouchEvent): void {
    const dy = e.touches[0].clientY - this.touchStartY;
    // Only react to downward drags from the top of the sheet's scroll position.
    const panel = this.panelRef()?.nativeElement;
    if (!panel || panel.scrollTop > 0) return;
    if (dy > 0) {
      this.touchDeltaY = dy;
      panel.style.transform = `translateY(${dy}px)`;
      panel.style.transition = 'none';
    }
  }

  protected onTouchEnd(): void {
    const panel = this.panelRef()?.nativeElement;
    if (!panel) return;
    panel.style.transition = '';
    if (this.touchDeltaY > 100) {
      this.close.emit();
    } else {
      panel.style.transform = '';
    }
    this.touchDeltaY = 0;
  }
}
