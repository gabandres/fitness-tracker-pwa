import {
  ChangeDetectionStrategy,
  Component,
  OnDestroy,
  OnInit,
  computed,
  inject,
  output,
  signal,
} from '@angular/core';
import { LucideAngularModule } from 'lucide-angular';
import { FastingStore } from '../../services/fasting-store.service';
import { TranslationService } from '../../services/translation.service';

/**
 * Header chip that appears across all v2 surfaces while a fast is in
 * progress. Self-gates on `store.isFasting()` — renders nothing when
 * idle, so callers can mount it unconditionally.
 *
 * The minute-resolution ticker uses a 30s interval (cheaper than 1s
 * and the elapsed display only shows hours+minutes anyway). Cleared
 * in `ngOnDestroy` so route swaps don't leak handles.
 */
@Component({
  selector: 'ui-fasting-pill',
  standalone: true,
  imports: [LucideAngularModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (store.isFasting() && elapsedLabel(); as label) {
      <button
        type="button"
        class="v2-fasting-pill"
        [attr.aria-label]="ariaLabel(label)"
        (click)="bodyRequested.emit()">
        <lucide-icon name="timer" [size]="14" />
        <span>{{ label }}</span>
      </button>
    }
  `,
})
export class UiFastingPill implements OnInit, OnDestroy {
  protected readonly store = inject(FastingStore);
  private readonly translation = inject(TranslationService);

  readonly bodyRequested = output<void>();

  private readonly tick = signal(0);
  private intervalId: ReturnType<typeof setInterval> | null = null;

  protected ariaLabel(label: string): string {
    return this.translation.t('v2.fastingPill.aria', { label });
  }

  protected readonly elapsedLabel = computed<string | null>(() => {
    this.tick();
    const start = this.store.fastStartedAt();
    if (!start) return null;
    const ms = Date.now() - start.getTime();
    if (ms < 0) return null;
    const totalMin = Math.floor(ms / 60000);
    const h = Math.floor(totalMin / 60);
    const m = totalMin % 60;
    return `${h}h ${m.toString().padStart(2, '0')}m`;
  });

  ngOnInit(): void {
    this.intervalId = setInterval(() => this.tick.update((n) => n + 1), 30_000);
  }

  ngOnDestroy(): void {
    if (this.intervalId !== null) clearInterval(this.intervalId);
  }
}
