import { ChangeDetectionStrategy, Component, computed, inject, signal, OnInit } from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { TranslocoDirective } from '@jsverse/transloco';
import { Firestore, doc, getDoc, Timestamp } from '@angular/fire/firestore';
import { UiCard } from '../ui/card.component';

interface PublicProfile {
  slug: string;
  displayName: string;
  startWeight: number | null;
  currentWeight: number | null;
  totalChange: number | null;
  goalWeight: number | null;
  startedAt: Timestamp | null;
}

type FetchStatus = 'loading' | 'ready' | 'notFound' | 'error';

/**
 * Public profile page at `/u/<slug>`. Reads the `publicProfiles/{slug}`
 * mirror written by the `onUserUpdateMirrorPublicProfile` trigger. No
 * auth required — Firestore rules allow anonymous read on this collection.
 *
 * The page is intentionally minimal: a transformation card with start →
 * current → goal weights and a CTA to the calculator/landing. Designed
 * for sharing in fitness Discords / subreddits as social proof.
 */
@Component({
  selector: 'app-public-profile',
  standalone: true,
  imports: [DecimalPipe, TranslocoDirective, UiCard],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <ng-container *transloco="let t">
    <section class="max-w-[640px] mx-auto px-5 sm:px-6 py-10">
      <a href="/" class="v2-caption" style="text-decoration: underline; text-decoration-style: dotted;">
        ← Ignia
      </a>

      @if (status() === 'loading') {
        <p class="v2-caption mt-12">{{ t('publicProfile.loading') }}</p>
      } @else if (status() === 'notFound') {
        <h1 class="v2-h1 mt-12">{{ t('publicProfile.notFoundTitle') }}</h1>
        <p class="v2-body mt-3">{{ t('publicProfile.notFoundBody') }}</p>
        <a href="/" class="v2-btn v2-btn--primary mt-6 inline-flex">
          {{ t('publicProfile.notFoundCta') }}
        </a>
      } @else if (status() === 'error') {
        <p class="v2-body mt-12" role="alert">{{ t('publicProfile.errorBody') }}</p>
      } @else if (profile(); as p) {
        <p class="v2-caption mt-8" style="text-transform: uppercase; letter-spacing: 0.08em;">
          {{ t('publicProfile.section') }}
        </p>
        <h1 class="v2-h1 v2-display mt-1">
          {{ headline() }}
        </h1>
        <p class="v2-caption mt-3">{{ subtitle() }}</p>

        <ui-card variant="default" class="block mt-8">
          <div class="grid grid-cols-3 gap-4 text-center">
            <div>
              <p class="v2-caption">{{ t('publicProfile.start') }}</p>
              <p class="v2-h2 mt-1">{{ p.startWeight != null ? (p.startWeight | number: '1.0-1') : '—' }}</p>
              <p class="v2-caption">lb</p>
            </div>
            <div>
              <p class="v2-caption">{{ t('publicProfile.current') }}</p>
              <p class="v2-h2 mt-1" style="color: var(--v2-accent);">
                {{ p.currentWeight != null ? (p.currentWeight | number: '1.0-1') : '—' }}
              </p>
              <p class="v2-caption">lb</p>
            </div>
            <div>
              <p class="v2-caption">{{ t('publicProfile.goal') }}</p>
              <p class="v2-h2 mt-1">{{ p.goalWeight != null ? (p.goalWeight | number: '1.0-1') : '—' }}</p>
              <p class="v2-caption">lb</p>
            </div>
          </div>
          @if (weeksTracked() != null) {
            <p class="v2-caption mt-4 text-center">
              {{ t('publicProfile.weeksTracked', { n: weeksTracked() }) }}
            </p>
          }
        </ui-card>

        <div class="mt-10">
          <h2 class="v2-h2">{{ t('publicProfile.ctaTitle') }}</h2>
          <p class="v2-body mt-2">{{ t('publicProfile.ctaBody') }}</p>
          <a href="/calculator" class="v2-btn v2-btn--primary mt-4 inline-flex">
            {{ t('publicProfile.ctaButton') }}
          </a>
        </div>
      }
    </section>
    </ng-container>
  `,
  styles: [
    `:host ::ng-deep .v2-h2 { font-size: 1.5rem; }`,
  ],
})
export class PublicProfileComponent implements OnInit {
  private readonly firestore = inject(Firestore);

  protected readonly status = signal<FetchStatus>('loading');
  protected readonly profile = signal<PublicProfile | null>(null);

  protected readonly headline = computed(() => {
    const p = this.profile();
    if (!p) return '';
    if (p.totalChange != null && p.totalChange < 0) {
      return `${p.displayName} lost ${Math.abs(p.totalChange).toFixed(1)} lb`;
    }
    if (p.totalChange != null && p.totalChange > 0) {
      return `${p.displayName} gained ${Math.abs(p.totalChange).toFixed(1)} lb`;
    }
    return `${p.displayName}'s progress`;
  });

  protected readonly subtitle = computed(() => {
    const p = this.profile();
    if (!p?.startedAt) return '';
    const started = p.startedAt.toDate();
    return `Tracking since ${started.toLocaleDateString(undefined, { month: 'short', year: 'numeric' })}`;
  });

  protected readonly weeksTracked = computed(() => {
    const p = this.profile();
    if (!p?.startedAt) return null;
    const days = (Date.now() - p.startedAt.toMillis()) / (24 * 60 * 60 * 1000);
    return Math.max(1, Math.round(days / 7));
  });

  ngOnInit(): void {
    void this.load();
  }

  private slugFromUrl(): string | null {
    const m = /^\/u\/([a-z0-9-]+)\/?$/.exec(window.location.pathname.toLowerCase());
    return m ? m[1] : null;
  }

  private async load(): Promise<void> {
    const slug = this.slugFromUrl();
    if (!slug) {
      this.status.set('notFound');
      return;
    }
    try {
      const ref = doc(this.firestore, 'publicProfiles', slug);
      const snap = await getDoc(ref);
      if (!snap.exists()) {
        this.status.set('notFound');
        return;
      }
      const data = snap.data() as Partial<PublicProfile>;
      this.profile.set({
        slug,
        displayName: data.displayName || 'Ignia user',
        startWeight: data.startWeight ?? null,
        currentWeight: data.currentWeight ?? null,
        totalChange: data.totalChange ?? null,
        goalWeight: data.goalWeight ?? null,
        startedAt: (data.startedAt as Timestamp | undefined) ?? null,
      });
      this.status.set('ready');
    } catch (err) {
      console.error('PublicProfile load failed', err);
      this.status.set('error');
    }
  }
}
