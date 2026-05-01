import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { TranslocoDirective } from '@jsverse/transloco';
import { Firestore, doc, getDoc, Timestamp } from '@angular/fire/firestore';
import { TranslationService } from '../../services/translation.service';
import { V2Card } from '../ui/card.component';

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
  imports: [TranslocoDirective, V2Card],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <ng-container *transloco="let t">
    <section class="max-w-[640px] mx-auto">
      <a href="/" class="v2-caption" style="text-decoration: underline; text-decoration-style: dotted;">
        {{ t('status.backLink') }}
      </a>

      <p class="v2-caption mt-6" style="text-transform: uppercase; letter-spacing: 0.08em;">
        {{ t('status.section') }}
      </p>
      <h1 class="v2-h1 mt-1" style="font-size: 2.5rem; line-height: 1.05;">
        {{ t('status.titleLead') }}
        <span style="color: var(--v2-accent);">{{ t('status.titleEm') }}</span>
      </h1>
      <p class="v2-caption mt-3">{{ t('status.subtitle') }}</p>

      <!-- Overall health summary -->
      <v2-card variant="default" class="block mt-8" [style.border-color]="badgeColor()">
        <div class="flex items-center gap-3">
          <span class="inline-block w-3 h-3 rounded-full"
            [style.background]="badgeColor()"
            aria-hidden="true"></span>
          <span class="v2-h2" [style.color]="badgeColor()">
            {{ t('status.label.' + health()) }}
          </span>
        </div>
        <p class="v2-caption mt-2">
          {{ t('status.summary.' + health()) }}
        </p>
      </v2-card>

      <!-- Service checks -->
      <ul class="mt-6">
        <li class="flex items-center justify-between gap-3 py-3"
          style="border-bottom: 1px solid var(--v2-rule);">
          <span class="v2-body">{{ t('status.service.hosting') }}</span>
          <span class="v2-num" style="font-size: 0.6875rem; text-transform: uppercase; letter-spacing: 0.12em; color: var(--v2-sage); font-weight: 600;">
            {{ t('status.state.up') }}
          </span>
        </li>
        <li class="flex items-center justify-between gap-3 py-3"
          style="border-bottom: 1px solid var(--v2-rule);">
          <span class="v2-body">{{ t('status.service.firestore') }}</span>
          <span class="v2-num" style="font-size: 0.6875rem; text-transform: uppercase; letter-spacing: 0.12em; font-weight: 600;"
            [style.color]="fetchStatus() === 'ready' ? 'var(--v2-sage)' : 'var(--v2-danger)'">
            {{ fetchStatus() === 'ready' ? t('status.state.up') : t('status.state.unreachable') }}
          </span>
        </li>
        <li class="flex items-center justify-between gap-3 py-3"
          style="border-bottom: 1px solid var(--v2-rule);">
          <span class="v2-body">{{ t('status.service.scheduler') }}</span>
          <span class="v2-num" style="font-size: 0.6875rem; text-transform: uppercase; letter-spacing: 0.12em; font-weight: 600;"
            [style.color]="badgeColor()">
            {{ t('status.label.' + health()) }}
          </span>
        </li>
      </ul>

      <!-- Last pulse timestamp -->
      @if (fetchStatus() === 'ready' && lastPulseAt()) {
        <p class="v2-caption mt-6">
          {{ t('status.lastPulse', { ago: ageLabel() }) }}
        </p>
      } @else if (fetchStatus() === 'error') {
        <p class="v2-caption mt-6" role="alert" style="color: var(--v2-danger);">
          {{ t('status.fetchError') }}
        </p>
      }

      <p class="v2-caption mt-6">
        <a href="/changelog" style="text-decoration: underline; text-decoration-style: dotted;">
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
      case 'healthy':  return 'var(--v2-sage)';
      case 'degraded': return 'var(--v2-accent)';
      case 'down':     return 'var(--v2-danger)';
      default:         return 'var(--v2-ink-muted)';
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
