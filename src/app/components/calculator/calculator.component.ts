import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { TranslocoDirective } from '@jsverse/transloco';
import { TranslationService } from '../../services/translation.service';
import { AnalyticsService } from '../../services/analytics.service';
import { V2Button } from '../ui/button.component';
import { V2Card } from '../ui/card.component';
import {
  GoalDirection,
  WEIGHT_MIN_LB,
  WEIGHT_MAX_LB,
  computeKcal,
  computeProtein,
} from '../../utils/macro-heuristic';
import { setCalcPrefill } from '../../utils/calc-prefill';

/**
 * Public, unauthenticated macro calculator at /calculator. The same
 * heuristic that drives v2 onboarding (weight × {11/14/17} kcal,
 * weight × {1.0/0.9/0.8} g protein) — but rendered without sign-in so
 * organic search visitors get value before deciding to create an
 * account. CTA at the bottom links to /app for sign-up.
 *
 * SEO: this is the primary lead-magnet page, sat alongside the
 * programmatic /macros/:goal/:weight pages. The route is in
 * sitemap.xml and the H1 / description / canonical are wired
 * server-side via index.html defaults — Google's crawler executes JS
 * and picks up the title via setTitleKey on mount.
 */
@Component({
  selector: 'app-calculator',
  standalone: true,
  imports: [FormsModule, TranslocoDirective, V2Button, V2Card],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <ng-container *transloco="let t">
    <article class="max-w-[640px] mx-auto px-5 sm:px-6 pt-10 pb-16">
      <header class="mb-8">
        <p class="v2-caption" style="color: var(--v2-accent);">
          {{ t('calculator.eyebrow') }}
        </p>
        <h1 class="v2-h1 mt-1" style="font-size: clamp(2rem, 4.5vw, 3rem); line-height: 1.1;">
          {{ t('calculator.title') }}
        </h1>
        <p class="v2-body-soft mt-3">
          {{ t('calculator.intro') }}
        </p>
      </header>

      <form (submit)="onSubmit($event)" class="flex flex-col gap-5">
        <div>
          <label for="calc-weight" class="v2-caption block mb-2">
            {{ t('calculator.weightLabel') }}
          </label>
          <div class="flex items-baseline gap-3">
            <input
              id="calc-weight"
              name="weight"
              type="number"
              inputmode="decimal"
              [min]="WEIGHT_MIN_LB"
              [max]="WEIGHT_MAX_LB"
              step="1"
              required
              [ngModel]="weightInput()"
              (ngModelChange)="weightInput.set($event)"
              class="grow text-3xl font-mono w-full"
              style="padding: var(--v2-space-3) var(--v2-space-4); background: var(--v2-paper-2); border: 1px solid var(--v2-rule); border-radius: var(--v2-radius-md); color: var(--v2-ink); min-height: var(--v2-tap-min);"
              [attr.aria-invalid]="!!weightError()"
              [attr.aria-describedby]="weightError() ? 'calc-weight-err' : null"
            />
            <span class="v2-body-soft">{{ t('calculator.lbs') }}</span>
          </div>
          @if (weightError(); as err) {
            <p id="calc-weight-err" class="v2-caption mt-2" role="alert" style="color: var(--v2-danger);">
              {{ err }}
            </p>
          }
        </div>

        <div>
          <p class="v2-caption block mb-2">{{ t('calculator.goalLabel') }}</p>
          <div class="grid gap-2 sm:grid-cols-3">
            @for (opt of goalOptions; track opt.value) {
              <button
                type="button"
                class="text-left p-3 transition-colors"
                style="background: var(--v2-paper-2); border-radius: var(--v2-radius-md); border: 2px solid;"
                [style.border-color]="goal() === opt.value ? 'var(--v2-accent)' : 'var(--v2-rule)'"
                (click)="goal.set(opt.value)"
                [attr.aria-pressed]="goal() === opt.value">
                <div class="v2-body" style="font-weight: 600;">{{ t(opt.labelKey) }}</div>
              </button>
            }
          </div>
        </div>

        <v2-button variant="primary" size="lg" [block]="true" type="submit">
          {{ t('calculator.calculate') }}
        </v2-button>
      </form>

      @if (showResult()) {
        <section class="mt-8" aria-live="polite">
          <h2 class="v2-h2 mb-4">{{ t('calculator.resultTitle') }}</h2>
          <v2-card>
            <div class="flex items-center justify-between py-1">
              <span class="v2-caption">{{ t('calculator.kcalLabel') }}</span>
              <span class="v2-h3 font-mono">{{ kcal() }}</span>
            </div>
            <hr class="v2-hr" style="margin: var(--v2-space-2) 0;" />
            <div class="flex items-center justify-between py-1">
              <span class="v2-caption">{{ t('calculator.proteinLabel') }}</span>
              <span class="v2-h3 font-mono">{{ protein() }}{{ t('calculator.gramSuffix') }}</span>
            </div>
          </v2-card>

          <v2-card variant="accent" class="block mt-5 text-center">
            <h3 class="v2-h3">{{ t('calculator.ctaTitle') }}</h3>
            <p class="v2-body-soft mt-2">
              {{ t('calculator.ctaBody') }}
            </p>
            <div class="mt-5">
              <a href="/app" class="v2-btn v2-btn--primary v2-btn--lg" (click)="trackCtaClick()">
                {{ t('calculator.ctaButton') }}
              </a>
            </div>
            <p class="v2-caption mt-3">{{ t('calculator.ctaFinePrint') }}</p>
          </v2-card>
        </section>
      }

      <section class="mt-12">
        <h2 class="v2-h2 mb-3" style="font-size: 1.125rem;">{{ t('calculator.howTitle') }}</h2>
        <p class="v2-body-soft mb-2">{{ t('calculator.howBody') }}</p>
        <ul class="v2-body-soft list-disc pl-6 space-y-1 mt-3">
          <li>{{ t('calculator.howBullet1') }}</li>
          <li>{{ t('calculator.howBullet2') }}</li>
          <li>{{ t('calculator.howBullet3') }}</li>
        </ul>
        <p class="v2-caption mt-4">{{ t('calculator.disclaimer') }}</p>
      </section>
    </article>
    </ng-container>
  `,
})
export class CalculatorComponent {
  private readonly translation = inject(TranslationService);
  private readonly analytics = inject(AnalyticsService);
  /** Latch so reload + repeat-tap doesn't double-count the same intent.
   *  Cleared per page load only; users who genuinely close + reopen the
   *  tab will get re-counted, which is what the funnel cares about. */
  private calculatedTracked = false;

  protected readonly WEIGHT_MIN_LB = WEIGHT_MIN_LB;
  protected readonly WEIGHT_MAX_LB = WEIGHT_MAX_LB;

  protected readonly weightInput = signal<string>('');
  protected readonly goal = signal<GoalDirection>('maintain');
  protected readonly weightError = signal<string | null>(null);
  protected readonly weight = signal<number | null>(null);

  protected readonly goalOptions: { value: GoalDirection; labelKey: string }[] = [
    { value: 'lose', labelKey: 'calculator.goalLose' },
    { value: 'maintain', labelKey: 'calculator.goalMaintain' },
    { value: 'gain', labelKey: 'calculator.goalGain' },
  ];

  protected readonly showResult = computed(() => this.weight() != null);

  protected readonly kcal = computed(() => {
    const w = this.weight();
    return w != null ? computeKcal(w, this.goal()) : 0;
  });

  protected readonly protein = computed(() => {
    const w = this.weight();
    return w != null ? computeProtein(w, this.goal()) : 0;
  });

  constructor() {
    this.translation.setTitleKey('calculator.pageTitle');
  }

  protected onSubmit(e: Event): void {
    e.preventDefault();
    const raw = parseFloat(this.weightInput());
    if (!Number.isFinite(raw) || raw < WEIGHT_MIN_LB || raw > WEIGHT_MAX_LB) {
      this.weightError.set(
        this.translation.t('calculator.weightOutOfRange', {
          min: WEIGHT_MIN_LB,
          max: WEIGHT_MAX_LB,
        }),
      );
      this.weight.set(null);
      return;
    }
    this.weightError.set(null);
    this.weight.set(raw);
    if (!this.calculatedTracked) {
      this.calculatedTracked = true;
      this.analytics.track('calculator_calculated', { goal: this.goal() });
    }
  }

  protected trackCtaClick(): void {
    this.analytics.track('calculator_cta_signup', { goal: this.goal() });
    // Hand off the inputs to onboarding so the user doesn't re-enter
    // them after sign-up. consumeCalcPrefill in onboarding-v2 reads +
    // clears this on mount.
    const w = this.weight();
    if (w != null) setCalcPrefill(w, this.goal());
  }
}
