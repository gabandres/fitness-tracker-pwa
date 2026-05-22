import { ChangeDetectionStrategy, Component } from '@angular/core';
import { TranslocoDirective } from '@jsverse/transloco';
import { UiCard } from '../ui/card.component';

/**
 * Rendered whenever `detectRoute()` sees a path it doesn't recognize.
 * Visitors land on a calm warm-minimal surface with two ways back into
 * the app rather than a hard browser-default 404.
 */
@Component({
  selector: 'app-not-found',
  standalone: true,
  imports: [TranslocoDirective, UiCard],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <ng-container *transloco="let t">
    <section class="py-16">
      <ui-card variant="default" class="block text-center max-w-[540px] mx-auto">
        <p class="v2-caption" style="text-transform: uppercase; letter-spacing: 0.08em;">
          {{ t('notFound.stamp') }}
        </p>
        <h1 class="v2-h1 mt-3" style="font-size: 3rem; line-height: 1.05;">
          {{ t('notFound.titleLead') }}
          <span style="color: var(--v2-accent);">{{ t('notFound.titleEm') }}</span>
        </h1>
        <p class="v2-body-soft mt-4">{{ t('notFound.body') }}</p>
        <div class="mt-6 flex items-center justify-center gap-3 flex-wrap">
          <a href="/" class="v2-btn v2-btn--primary">{{ t('notFound.home') }}</a>
          <a href="/changelog" class="v2-btn v2-btn--ghost">{{ t('notFound.changelog') }}</a>
        </div>
      </ui-card>
    </section>
    </ng-container>
  `,
})
export class NotFoundComponent {}
