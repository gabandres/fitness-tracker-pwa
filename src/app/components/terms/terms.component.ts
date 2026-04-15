import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { TranslocoDirective } from '@jsverse/transloco';
import { TranslationService } from '../../services/translation.service';

@Component({
  selector: 'app-terms',
  standalone: true,
  imports: [TranslocoDirective],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <ng-container *transloco="let t">
    <section class="max-w-[640px] mx-auto">
      @if (showAuthoritativeBanner()) {
        <div class="mb-4 specimen px-3 py-2" style="border-color: var(--color-gold)">
          <span class="crop-bl" style="border-color: var(--color-gold)"></span>
          <span class="crop-br" style="border-color: var(--color-gold)"></span>
          <p class="caption text-[11px]" style="color: var(--color-gold)">
            {{ t('legal.authoritativeBanner') }}
          </p>
        </div>
      }

      <a href="/" class="caption text-xs underline decoration-dotted hover:text-blood">
        {{ t('terms.backLink') }}
      </a>

      <div class="mt-6 flex items-center gap-3 mb-1">
        <span class="stamp-mark">{{ t('terms.stamp') }}</span>
        <span class="data-label">{{ t('terms.section') }}</span>
      </div>
      <h1 class="font-display text-4xl sm:text-5xl leading-[0.95] tracking-tight text-ink">
        {{ t('terms.titleLead') }}<br/><em class="text-blood">{{ t('terms.titleEm') }}</em>
      </h1>
      <p class="caption mt-3 text-xs">{{ t('terms.lastUpdated') }}</p>

      <div class="mt-8 prose-field text-ink leading-relaxed">
        <h2 class="font-display italic text-2xl text-blood mt-6 mb-2">{{ t('terms.dealHeading') }}</h2>
        <p>{{ t('terms.dealBody') }}</p>

        <h2 class="font-display italic text-2xl text-blood mt-6 mb-2">{{ t('terms.medHeading') }}</h2>
        <p>{{ t('terms.medBody') }}</p>

        <h2 class="font-display italic text-2xl text-blood mt-6 mb-2">{{ t('terms.dataHeading') }}</h2>
        <p [innerHTML]="t('terms.dataBody')"></p>

        <h2 class="font-display italic text-2xl text-blood mt-6 mb-2">{{ t('terms.availHeading') }}</h2>
        <p>{{ t('terms.availBody') }}</p>

        <h2 class="font-display italic text-2xl text-blood mt-6 mb-2">{{ t('terms.liabilityHeading') }}</h2>
        <p>{{ t('terms.liabilityBody') }}</p>

        <h2 class="font-display italic text-2xl text-blood mt-6 mb-2">{{ t('terms.contactHeading') }}</h2>
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
