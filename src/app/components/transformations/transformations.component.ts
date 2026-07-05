import { ChangeDetectionStrategy, Component, inject, signal, OnInit } from '@angular/core';
import { TranslocoDirective } from '@jsverse/transloco';
import {
  Firestore, collection, query, orderBy, limit, getDocs, Timestamp,
} from '@angular/fire/firestore';
import { UiCard } from '../ui/card.component';

interface PublicProfileSummary {
  slug: string;
  displayName: string;
  startWeight: number | null;
  currentWeight: number | null;
  totalChange: number | null;
  startedAt: Timestamp | null;
}

type FetchStatus = 'loading' | 'ready' | 'error';

/**
 * `/transformations` — public gallery of opted-in profiles, ordered by
 * most recent update. Each tile is a brag-card linking to `/u/<slug>`.
 * Self-perpetuating SEO surface: every new public profile boosts the
 * page's social proof + every visitor who clicks a tile sees the OG
 * image embed land in their next share.
 *
 * Firestore rules allow anonymous read on `publicProfiles`, so this
 * page works without sign-in. Limit is hard-capped at 50 — pagination
 * via lastDocSnapshot can come later if the gallery actually grows
 * past one screenful.
 */
@Component({
  selector: 'app-transformations',
  standalone: true,
  imports: [TranslocoDirective, UiCard],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <ng-container *transloco="let t">
    <section class="max-w-[1100px] mx-auto px-5 sm:px-6 py-10">
      <a href="/" class="v2-caption" style="text-decoration: underline; text-decoration-style: dotted;">
        ← Ignia
      </a>
      <p class="v2-caption mt-8" style="text-transform: uppercase; letter-spacing: 0.08em;">
        {{ t('transformations.section') }}
      </p>
      <h1 class="v2-h1 v2-display mt-1">
        {{ t('transformations.titleLead') }}
        <span style="color: var(--v2-accent);">{{ t('transformations.titleEm') }}</span>
      </h1>
      <p class="v2-body mt-3" style="max-width: 60ch;">{{ t('transformations.subtitle') }}</p>

      @if (status() === 'loading') {
        <p class="v2-caption mt-12">{{ t('transformations.loading') }}</p>
      } @else if (status() === 'error') {
        <p class="v2-body mt-12" role="alert">{{ t('transformations.error') }}</p>
      } @else if (profiles().length === 0) {
        <p class="v2-body mt-12">{{ t('transformations.empty') }}</p>
      } @else {
        <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 mt-8">
          @for (p of profiles(); track p.slug) {
            <a [href]="'/u/' + p.slug" class="block" style="text-decoration: none;">
              <ui-card variant="default" class="block h-full">
                <p class="v2-caption" style="text-transform: uppercase; letter-spacing: 0.08em;">
                  {{ headlineFor(p) }}
                </p>
                <h2 class="v2-h2 mt-1" style="font-size: 1.5rem;">{{ p.displayName }}</h2>
                <div class="grid grid-cols-2 gap-3 mt-4">
                  <div>
                    <p class="v2-caption">{{ t('transformations.start') }}</p>
                    <p class="v2-h2" style="font-size: 1.25rem;">{{ fmtWeight(p.startWeight) }} lb</p>
                  </div>
                  <div>
                    <p class="v2-caption">{{ t('transformations.current') }}</p>
                    <p class="v2-h2" style="font-size: 1.25rem; color: var(--v2-accent);">
                      {{ fmtWeight(p.currentWeight) }} lb
                    </p>
                  </div>
                </div>
                @if (p.startedAt) {
                  <p class="v2-caption mt-3">{{ subtitleFor(p) }}</p>
                }
              </ui-card>
            </a>
          }
        </div>
      }

      <div class="mt-12 pt-8" style="border-top: 1px solid var(--v2-rule);">
        <h2 class="v2-h2">{{ t('transformations.ctaTitle') }}</h2>
        <p class="v2-body mt-2">{{ t('transformations.ctaBody') }}</p>
        <a href="/calculator" class="v2-btn v2-btn--primary mt-4 inline-flex">
          {{ t('transformations.ctaButton') }}
        </a>
      </div>
    </section>
    </ng-container>
  `,
})
export class TransformationsComponent implements OnInit {
  private readonly firestore = inject(Firestore);

  protected readonly status = signal<FetchStatus>('loading');
  protected readonly profiles = signal<PublicProfileSummary[]>([]);

  ngOnInit(): void {
    void this.load();
  }

  private async load(): Promise<void> {
    try {
      const ref = collection(this.firestore, 'publicProfiles');
      const q = query(ref, orderBy('updatedAt', 'desc'), limit(50));
      const snap = await getDocs(q);
      const items: PublicProfileSummary[] = snap.docs.map((d) => {
        const data = d.data() as Partial<PublicProfileSummary>;
        return {
          slug: d.id,
          displayName: data.displayName || 'Ignia user',
          startWeight: data.startWeight ?? null,
          currentWeight: data.currentWeight ?? null,
          totalChange: data.totalChange ?? null,
          startedAt: (data.startedAt as Timestamp | undefined) ?? null,
        };
      });
      this.profiles.set(items);
      this.status.set('ready');
      this.injectJsonLd(items);
    } catch (err) {
      console.error('TransformationsComponent load failed', err);
      this.status.set('error');
    }
  }

  private injectJsonLd(items: PublicProfileSummary[]): void {
    if (typeof document === 'undefined') return;
    const existing = document.getElementById('transformations-jsonld');
    if (existing) existing.remove();
    const ld = {
      '@context': 'https://schema.org',
      '@type': 'CollectionPage',
      name: 'Transformations · Ignia',
      url: 'https://macrolog.web.app/transformations',
      description: 'Real users tracking calories, protein, and weight with Ignia.',
      hasPart: items.slice(0, 20).map((p) => ({
        '@type': 'Person',
        name: p.displayName,
        url: `https://macrolog.web.app/u/${p.slug}`,
      })),
    };
    const script = document.createElement('script');
    script.id = 'transformations-jsonld';
    script.type = 'application/ld+json';
    script.textContent = JSON.stringify(ld);
    document.head.appendChild(script);
  }

  protected fmtWeight(w: number | null): string {
    if (w == null) return '—';
    return w.toFixed(1);
  }

  protected headlineFor(p: PublicProfileSummary): string {
    if (p.totalChange != null && p.totalChange < 0) {
      return `Lost ${Math.abs(p.totalChange).toFixed(1)} lb`;
    }
    if (p.totalChange != null && p.totalChange > 0) {
      return `Gained ${Math.abs(p.totalChange).toFixed(1)} lb`;
    }
    return 'Progress';
  }

  protected subtitleFor(p: PublicProfileSummary): string {
    if (!p.startedAt) return '';
    const months = (Date.now() - p.startedAt.toMillis()) / (30 * 24 * 60 * 60 * 1000);
    if (months < 1) return 'Tracking < 1 month';
    if (months < 12) return `Tracking ${Math.round(months)} months`;
    return `Tracking ${Math.round(months / 12)} year${months > 24 ? 's' : ''}`;
  }
}
