import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { TranslocoDirective } from '@jsverse/transloco';
import { TranslationService } from '../../services/translation.service';
import { V2Card } from '../ui/card.component';

@Component({
  selector: 'app-terms',
  standalone: true,
  imports: [TranslocoDirective, V2Card],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <ng-container *transloco="let t">
    <section class="max-w-[640px] mx-auto">
      @if (showAuthoritativeBanner()) {
        <v2-card variant="flat" class="block mb-4">
          <p class="v2-caption" style="color: var(--v2-accent);">
            {{ t('legal.authoritativeBanner') }}
          </p>
        </v2-card>
      }

      <a href="/" class="v2-caption" style="text-decoration: underline; text-decoration-style: dotted;">
        {{ t('terms.backLink') }}
      </a>

      <p class="v2-caption mt-6" style="text-transform: uppercase; letter-spacing: 0.08em;">
        {{ t('terms.section') }}
      </p>
      <h1 class="v2-h1 mt-1" style="font-size: 2.5rem; line-height: 1.05;">
        {{ t('terms.titleLead') }}
        <em style="color: var(--v2-accent); font-style: normal;">{{ t('terms.titleEm') }}</em>
      </h1>
      <p class="v2-caption mt-3">{{ t('terms.lastUpdated') }}</p>

      <div class="mt-8 v2-prose">
        <h2 class="v2-h2 mt-6 mb-2" style="color: var(--v2-accent);">{{ t('terms.dealHeading') }}</h2>
        <p>{{ t('terms.dealBody') }}</p>

        <h2 class="v2-h2 mt-6 mb-2" style="color: var(--v2-accent);">{{ t('terms.medHeading') }}</h2>
        <p>{{ t('terms.medBody') }}</p>

        <h2 class="v2-h2 mt-6 mb-2" style="color: var(--v2-accent);">{{ t('terms.dataHeading') }}</h2>
        <p [innerHTML]="t('terms.dataBody')"></p>

        <h2 class="v2-h2 mt-6 mb-2" style="color: var(--v2-accent);">{{ t('terms.availHeading') }}</h2>
        <p>{{ t('terms.availBody') }}</p>

        <h2 class="v2-h2 mt-6 mb-2" style="color: var(--v2-accent);">{{ t('terms.liabilityHeading') }}</h2>
        <p>{{ t('terms.liabilityBody') }}</p>

        <h2 class="v2-h2 mt-6 mb-2" id="subscriptions" style="color: var(--v2-accent);">{{ t('terms.subsHeading') }}</h2>
        <p [innerHTML]="t('terms.subsBody')"></p>

        <h2 class="v2-h2 mt-6 mb-2" id="refunds" style="color: var(--v2-accent);">{{ t('terms.refundsHeading') }}</h2>
        <p [innerHTML]="t('terms.refundsBody')"></p>

        <h2 class="v2-h2 mt-6 mb-2" style="color: var(--v2-accent);">{{ t('terms.contactHeading') }}</h2>
        <p [innerHTML]="t('terms.contactBody')"></p>
      </div>
    </section>
    </ng-container>
  `,
})
export class TermsComponent {
  private readonly translation = inject(TranslationService);
  protected readonly showAuthoritativeBanner = computed(
    () => this.translation.language() === 'es-PR',
  );
}
