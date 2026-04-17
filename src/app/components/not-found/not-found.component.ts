import { ChangeDetectionStrategy, Component } from '@angular/core';
import { TranslocoDirective } from '@jsverse/transloco';

/**
 * Rendered whenever `detectRoute()` sees a path it doesn't recognize.
 * Keeps the "Personal Calibration Log" aesthetic so the 404 doesn't feel
 * like an abandoned surface — the user still sees the same typography
 * and can click back into the app.
 */
@Component({
  selector: 'app-not-found',
  standalone: true,
  imports: [TranslocoDirective],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <ng-container *transloco="let t">
    <section class="py-16">
      <div class="specimen px-6 py-10 text-center max-w-[540px] mx-auto">
        <span class="crop-bl"></span><span class="crop-br"></span>
        <span class="stamp-mark">{{ t('notFound.stamp') }}</span>
        <h1 class="font-display text-5xl sm:text-6xl leading-[0.95] tracking-tight text-ink mt-4">
          {{ t('notFound.titleLead') }}<br/>
          <em class="text-blood">{{ t('notFound.titleEm') }}</em>
        </h1>
        <p class="font-sans text-sm text-ink-soft mt-4 leading-relaxed">
          {{ t('notFound.body') }}
        </p>
        <div class="mt-6 flex items-center justify-center gap-3 flex-wrap">
          <a href="/" class="stamp-btn">{{ t('notFound.home') }}</a>
          <a href="/changelog" class="tag-btn">{{ t('notFound.changelog') }}</a>
        </div>
      </div>
    </section>
    </ng-container>
  `,
})
export class NotFoundComponent {}
