import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { TranslocoDirective } from '@jsverse/transloco';
import { Firestore, doc, getDoc, Timestamp } from '@angular/fire/firestore';
import { TranslationService } from '../../services/translation.service';

type Health = 'healthy' | 'degraded' | 'down' | 'unknown';
type FetchStatus = 'loading' | 'ready' | 'error';

/**
 * Public /status route — a lightweight dashboard showing whether the
 * backing services are alive. The signal is a Cloud Functions-written
 * heartbeat doc at `/status/heartbeat`. `statusPulse` runs every 5
 * minutes; we flag "healthy" under 10 min, "degraded" under 30 min,
 * "down" beyond that.
 *
 * The fact that this page renders at all proves hosting + client
 * fetch-to-Firestore work. The heartbeat specifically covers the
 * Cloud Functions scheduler + admin-SDK write path.
 */
@Component({
  selector: 'app-status',
  standalone: true,
  imports: [TranslocoDirective],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <ng-container *transloco="let t">
    <section class="max-w-[640px] mx-auto">
      <a href="/" class="caption text-xs underline decoration-dotted hover:text-blood">
        {{ t('status.backLink') }}
      </a>

      <div class="mt-6 flex items-center gap-3 mb-1">
        <span class="stamp-mark">{{ t('status.stamp') }}</span>
        <span class="data-label">{{ t('status.section') }}</span>
      </div>
      <h1 class="font-display text-4xl sm:text-5xl leading-[0.95] tracking-tight text-ink">
        {{ t('status.titleLead') }}<br/><em class="text-blood">{{ t('status.titleEm') }}</em>
      </h1>
      <p class="caption mt-3 text-xs">{{ t('status.subtitle') }}</p>

      <!-- Overall health summary -->
      <div class="mt-8 specimen px-5 py-5 relative"
        [style.border-color]="badgeColor()">
        <span class="crop-bl" [style.border-color]="badgeColor()"></span>
        <span class="crop-br" [style.border-color]="badgeColor()"></span>
        <div class="flex items-center gap-3">
          <span class="inline-block w-3 h-3 rounded-full"
            [style.background]="badgeColor()"
            aria-hidden="true"></span>
          <span class="font-display text-2xl" [style.color]="badgeColor()">
            {{ t('status.label.' + health()) }}
          </span>
        </div>
        <p class="caption mt-2 text-[11px] leading-relaxed">
          {{ t('status.summary.' + health()) }}
        </p>
      </div>

      <!-- Service checks -->
      <ul class="mt-6 space-y-0">
        <li class="flex items-center justify-between gap-3 py-3 border-b border-rule/40">
          <span class="font-sans text-sm text-ink">{{ t('status.service.hosting') }}</span>
          <span class="font-mono text-[11px] uppercase tracking-widest"
            style="color: var(--color-olive)">{{ t('status.state.up') }}</span>
        </li>
        <li class="flex items-center justify-between gap-3 py-3 border-b border-rule/40">
          <span class="font-sans text-sm text-ink">{{ t('status.service.firestore') }}</span>
          <span class="font-mono text-[11px] uppercase tracking-widest"
            [style.color]="fetchStatus() === 'ready' ? 'var(--color-olive)' : 'var(--color-blood)'">
            {{ fetchStatus() === 'ready' ? t('status.state.up') : t('status.state.unreachable') }}
          </span>
        </li>
        <li class="flex items-center justify-between gap-3 py-3 border-b border-rule/40">
          <span class="font-sans text-sm text-ink">{{ t('status.service.scheduler') }}</span>
          <span class="font-mono text-[11px] uppercase tracking-widest"
            [style.color]="badgeColor()">
            {{ t('status.label.' + health()) }}
          </span>
        </li>
      </ul>

      <!-- Last pulse timestamp -->
      @if (fetchStatus() === 'ready' && lastPulseAt()) {
        <p class="caption mt-6 text-[11px]">
          {{ t('status.lastPulse', { ago: ageLabel() }) }}
        </p>
      } @else if (fetchStatus() === 'error') {
        <p class="caption mt-6 text-[11px]" role="alert" style="color: var(--color-blood)">
          {{ t('status.fetchError') }}
        </p>
      }

      <p class="caption mt-6 text-[11px]">
        <a href="/changelog" class="underline decoration-dotted hover:text-blood">
          {{ t('status.changelogLink') }}
        </a>
      </p>
    </section>
    </ng-container>
  `,
})
export class StatusComponent {
  private readonly firestore = inject(Firestore);
  private readonly translation = inject(TranslationService);

  protected readonly fetchStatus = signal<FetchStatus>('loading');
  protected readonly lastPulseAt = signal<Date | null>(null);
  /** Recomputed on each fetch; not a live clock. The page is static
      enough that we don't need a timer updating "N min ago" every
      second — the fetched timestamp is what matters. */
  protected readonly health = computed<Health>(() => {
    if (this.fetchStatus() === 'error') return 'down';
    if (this.fetchStatus() !== 'ready') return 'unknown';
    const at = this.lastPulseAt();
    if (!at) return 'unknown';
    const ageMs = Date.now() - at.getTime();
    if (ageMs < 10 * 60 * 1000) return 'healthy';
    if (ageMs < 30 * 60 * 1000) return 'degraded';
    return 'down';
  });

  protected readonly badgeColor = computed(() => {
    switch (this.health()) {
      case 'healthy':  return 'var(--color-olive)';
      case 'degraded': return 'var(--color-gold)';
      case 'down':     return 'var(--color-blood)';
      default:         return 'var(--color-graphite)';
    }
  });

  protected readonly ageLabel = computed(() => {
    const at = this.lastPulseAt();
    if (!at) return '';
    const mins = Math.max(0, Math.round((Date.now() - at.getTime()) / 60_000));
    if (mins < 1) return this.translation.t('status.ago.now');
    if (mins === 1) return this.translation.t('status.ago.min');
    if (mins < 60) return this.translation.t('status.ago.mins', { n: mins });
    const hours = Math.round(mins / 60);
    if (hours === 1) return this.translation.t('status.ago.hour');
    return this.translation.t('status.ago.hours', { n: hours });
  });

  constructor() {
    this.load();
  }

  private async load(): Promise<void> {
    try {
      const ref = doc(this.firestore, 'status/heartbeat');
      const snap = await getDoc(ref);
      if (snap.exists()) {
        const data = snap.data() as { lastPulseAt?: Timestamp };
        if (data.lastPulseAt) this.lastPulseAt.set(data.lastPulseAt.toDate());
      }
      this.fetchStatus.set('ready');
    } catch (err) {
      console.error('Failed to load status heartbeat:', err);
      this.fetchStatus.set('error');
    }
  }
}
