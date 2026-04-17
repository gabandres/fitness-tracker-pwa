import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { TranslocoDirective } from '@jsverse/transloco';
import { AuthService } from '../../services/auth.service';
import { TranslationService } from '../../services/translation.service';

type Status = 'idle' | 'signing' | 'error';

/**
 * Public marketing surface at `/`. Shows when the user is not signed
 * in and the path is the site root — any other combination falls
 * through to the sign-in / onboarding / app flow in app.ts.
 *
 * Structure (scroll top → bottom):
 *   1. Hero — the one question the app answers
 *   2. Product proof — three capture paths, measured TDEE, AI coach
 *   3. Privacy pledge — the "no ads / no selling" promise
 *   4. Pricing — free vs Pro, $3/mo
 *   5. Sign-in CTA + legal footer
 *
 * Aesthetic reuses the "Personal Calibration Log" primitives (specimen
 * frames, stamp marks, ruler edges, crop marks) so a first-time visitor
 * gets the product's voice before ever logging in.
 */
@Component({
  selector: 'app-landing',
  standalone: true,
  imports: [TranslocoDirective],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <ng-container *transloco="let t">
    <article class="space-y-16 pb-8">
      <!-- ── 1. Hero ──────────────────────────────────────────────── -->
      <section class="ink-in">
        <div class="flex items-baseline gap-2 mb-4">
          <span class="monogram">M·L</span>
          <span class="caption">{{ t('landing.calibrationLogNo') }}</span>
        </div>
        <h1 class="font-display text-5xl sm:text-6xl lg:text-7xl leading-[0.95] tracking-tight text-ink">
          {{ t('landing.heroLead') }}<br/>
          <em class="text-blood">{{ t('landing.heroEm') }}</em>
        </h1>
        <p class="mt-6 font-sans text-lg text-ink-soft max-w-2xl leading-relaxed">
          {{ t('landing.heroSub') }}
        </p>

        <div class="mt-8 flex flex-wrap items-center gap-3">
          <button type="button" (click)="signIn()"
            [disabled]="status() === 'signing'"
            class="stamp-btn">
            <svg viewBox="0 0 24 24" class="w-4 h-4 shrink-0" aria-hidden="true" fill="currentColor">
              <path d="M12.48 10.92v3.28h7.84c-.24 1.84-.853 3.187-1.787 4.133-1.147 1.147-2.933 2.4-6.053 2.4-4.827 0-8.6-3.893-8.6-8.72s3.773-8.72 8.6-8.72c2.6 0 4.507 1.027 5.907 2.347l2.307-2.307C18.747 1.44 16.133 0 12.48 0 5.867 0 .307 5.387.307 12s5.56 12 12.173 12c3.573 0 6.267-1.173 8.373-3.36 2.16-2.16 2.84-5.213 2.84-7.667 0-.76-.053-1.467-.173-2.053H12.48z"/>
            </svg>
            {{ status() === 'signing' ? t('landing.signingIn') : t('landing.startLogging') }}
          </button>
          <a href="#pricing" class="tag-btn">{{ t('landing.seePricing') }}</a>
        </div>

        @if (status() === 'error') {
          <p class="font-mono text-[11px] text-blood mt-4 leading-relaxed">✕ {{ errorMsg() }}</p>
        }

        <div class="ruler-edge mt-10">
          @for (_ of ticks; track $index) { <span></span> }
        </div>
      </section>

      <!-- ── 2. Product proof — three capture paths + TDEE + AI ──── -->
      <section class="ink-in delay-1">
        <div class="rule"><span>{{ t('landing.whatItDoesRule') }}</span></div>
        <div class="mt-6 grid gap-5 sm:grid-cols-3">
          <div class="specimen px-4 py-5">
            <span class="crop-bl"></span><span class="crop-br"></span>
            <span class="stamp-mark">{{ t('landing.proofCaptureStamp') }}</span>
            <h2 class="font-display text-xl text-ink mt-3">{{ t('landing.proofCaptureTitle') }}</h2>
            <p class="font-sans text-sm text-ink-soft mt-2 leading-relaxed">{{ t('landing.proofCaptureBody') }}</p>
          </div>
          <div class="specimen px-4 py-5">
            <span class="crop-bl"></span><span class="crop-br"></span>
            <span class="stamp-mark">{{ t('landing.proofTdeeStamp') }}</span>
            <h2 class="font-display text-xl text-ink mt-3">{{ t('landing.proofTdeeTitle') }}</h2>
            <p class="font-sans text-sm text-ink-soft mt-2 leading-relaxed">{{ t('landing.proofTdeeBody') }}</p>
          </div>
          <div class="specimen px-4 py-5">
            <span class="crop-bl"></span><span class="crop-br"></span>
            <span class="stamp-mark">{{ t('landing.proofCoachStamp') }}</span>
            <h2 class="font-display text-xl text-ink mt-3">{{ t('landing.proofCoachTitle') }}</h2>
            <p class="font-sans text-sm text-ink-soft mt-2 leading-relaxed">{{ t('landing.proofCoachBody') }}</p>
          </div>
        </div>
      </section>

      <!-- ── 3. Privacy pledge ───────────────────────────────────── -->
      <section class="ink-in delay-2">
        <div class="specimen px-6 py-8">
          <span class="crop-bl"></span><span class="crop-br"></span>
          <div class="flex items-center gap-3 mb-3">
            <span class="stamp-mark" style="transform: rotate(0deg)">{{ t('landing.privacyStamp') }}</span>
            <span class="data-label">{{ t('landing.privacyLabel') }}</span>
          </div>
          <h2 class="font-display text-3xl sm:text-4xl leading-[0.95] text-ink">
            {{ t('landing.privacyLead') }}<br/>
            <em class="text-blood">{{ t('landing.privacyEm') }}</em>
          </h2>
          <p class="font-sans text-sm text-ink-soft mt-4 leading-relaxed max-w-2xl">
            {{ t('landing.privacyBody') }}
          </p>
          <p class="caption mt-4">
            <a href="/privacy" class="underline decoration-dotted hover:text-blood">{{ t('landing.privacyLink') }}</a>
            &nbsp;·&nbsp;
            <a href="/terms" class="underline decoration-dotted hover:text-blood">{{ t('landing.termsLink') }}</a>
          </p>
        </div>
      </section>

      <!-- ── 4. Pricing ───────────────────────────────────────────── -->
      <section id="pricing" class="ink-in delay-3">
        <div class="rule"><span>{{ t('landing.pricingRule') }}</span></div>
        <div class="mt-6 grid gap-5 sm:grid-cols-2">
          <div class="specimen px-5 py-6">
            <span class="crop-bl"></span><span class="crop-br"></span>
            <div class="flex items-baseline justify-between gap-3">
              <span class="stamp-mark">{{ t('landing.freeStamp') }}</span>
              <span class="font-display text-4xl text-ink">{{ t('landing.freePrice') }}</span>
            </div>
            <p class="font-sans text-sm text-ink-soft mt-3">{{ t('landing.freeBody') }}</p>
            <ul class="font-sans text-[13px] text-graphite mt-3 space-y-1">
              <li>{{ t('landing.freeF1') }}</li>
              <li>{{ t('landing.freeF2') }}</li>
              <li>{{ t('landing.freeF3') }}</li>
              <li>{{ t('landing.freeF4') }}</li>
            </ul>
          </div>
          <div class="specimen px-5 py-6" style="border-color: var(--color-blood)">
            <span class="crop-bl" style="border-color: var(--color-blood)"></span>
            <span class="crop-br" style="border-color: var(--color-blood)"></span>
            <div class="flex items-baseline justify-between gap-3">
              <span class="stamp-mark" style="border-color: var(--color-blood); color: var(--color-blood)">{{ t('landing.proStamp') }}</span>
              <span class="font-display text-4xl text-blood">{{ t('landing.proPrice') }}</span>
            </div>
            <p class="font-sans text-sm text-ink-soft mt-3">{{ t('landing.proBody') }}</p>
            <ul class="font-sans text-[13px] text-graphite mt-3 space-y-1">
              <li>{{ t('landing.proF1') }}</li>
              <li>{{ t('landing.proF2') }}</li>
              <li>{{ t('landing.proF3') }}</li>
              <li>{{ t('landing.proF4') }}</li>
              <li>{{ t('landing.proF5') }}</li>
            </ul>
          </div>
        </div>
        <p class="caption mt-4 text-[11px]">{{ t('landing.pricingFinePrint') }}</p>
      </section>

      <!-- ── 5. Final CTA ─────────────────────────────────────────── -->
      <section class="ink-in delay-4">
        <div class="specimen px-6 py-8 text-center" style="background: var(--color-paper-deep)">
          <span class="crop-bl"></span><span class="crop-br"></span>
          <h2 class="font-display text-3xl sm:text-4xl text-ink leading-[0.95]">
            {{ t('landing.ctaLead') }}<br/>
            <em class="text-blood">{{ t('landing.ctaEm') }}</em>
          </h2>
          <div class="mt-6 flex justify-center">
            <button type="button" (click)="signIn()"
              [disabled]="status() === 'signing'"
              class="stamp-btn">
              {{ status() === 'signing' ? t('landing.signingIn') : t('landing.startLoggingCta') }}
            </button>
          </div>
          <p class="caption mt-4 text-[11px]">{{ t('landing.ctaFinePrint') }}</p>
        </div>
      </section>
    </article>
    </ng-container>
  `,
})
export class LandingComponent {
  private readonly auth = inject(AuthService);
  private readonly translation = inject(TranslationService);

  protected readonly status = signal<Status>('idle');
  protected readonly errorMsg = signal('');
  protected readonly ticks = Array.from({ length: 45 });

  protected async signIn(): Promise<void> {
    this.status.set('signing');
    this.errorMsg.set('');
    try {
      await this.auth.signInWithGoogle();
    } catch (err: unknown) {
      const code = (err as { code?: string })?.code;
      if (code === 'auth/popup-closed-by-user' || code === 'auth/cancelled-popup-request') {
        this.status.set('idle');
        return;
      }
      this.status.set('error');
      this.errorMsg.set(err instanceof Error ? err.message : this.translation.t('signin.errorFallback'));
    }
  }
}
