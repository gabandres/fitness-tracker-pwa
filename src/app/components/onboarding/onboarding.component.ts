import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  output,
  signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { LucideAngularModule } from 'lucide-angular';
import { TranslocoDirective } from '@jsverse/transloco';
import { FirebaseService } from '../../services/firebase.service';
import { TranslationService } from '../../services/translation.service';
import { AnalyticsService } from '../../services/analytics.service';
import { UiButton } from '../ui/button.component';
import { UiCard } from '../ui/card.component';
import {
  GoalDirection,
  WEIGHT_MIN_LB,
  WEIGHT_MAX_LB,
  computeKcal,
  computeProtein,
} from '../../utils/macro-heuristic';
import { consumeCalcPrefill } from '../../utils/calc-prefill';

type Step = 'weight' | 'goal' | 'targetWeight' | 'confirm';

const DEFAULT_SKIP_KCAL = 2000;
const DEFAULT_SKIP_PROTEIN = 120;

/** v2 2-question onboarding (Q10 of UX revamp v2). Two questions plus
 *  one conditional (target weight for lose/gain), then a confirm screen
 *  that shows the heuristic kcal + protein numbers. Skip → writes sane
 *  defaults (2000 kcal / 120 g) without a goal direction; user can set
 *  these later from settings.
 *
 *  Redo mode is detected from `profile.onboardingV2CompletedAt`: when
 *  present, the confirm screen shows "Current vs New" so the user can
 *  see what they're about to overwrite. */
@Component({
  selector: 'app-onboarding',
  standalone: true,
  imports: [FormsModule, LucideAngularModule, TranslocoDirective, UiButton, UiCard],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <ng-container *transloco="let t">
    <section class="max-w-[520px] mx-auto px-5 sm:px-6 py-10 min-h-screen flex flex-col justify-center">
      <header class="mb-8">
        <p class="v2-caption" style="color: var(--v2-accent);">
          {{ stepLabel() }}
        </p>
        <h1 class="v2-h1 mt-1">{{ stepTitle() }}</h1>
      </header>

      @if (step() === 'weight') {
        <form (submit)="submitWeight($event)" class="flex flex-col gap-4">
          <div>
            <label for="ob-weight" class="v2-caption block mb-2">
              {{ t('v2.onboarding.weightLabel') }}
            </label>
            <div class="flex items-baseline gap-3">
              <input
                id="ob-weight"
                name="weight"
                type="number"
                inputmode="decimal"
                min="60"
                max="700"
                step="1"
                autofocus
                [ngModel]="weightInput()"
                (ngModelChange)="weightInput.set($event)"
                class="grow text-3xl font-mono w-full"
                style="padding: var(--v2-space-3) var(--v2-space-4); background: var(--v2-paper-2); border: 1px solid var(--v2-rule); border-radius: var(--v2-radius-md); color: var(--v2-ink); min-height: var(--v2-tap-min);"
                [attr.aria-invalid]="!!weightError()"
                [attr.aria-describedby]="weightError() ? 'ob-weight-err' : null"
              />
              <span class="v2-body-soft">{{ t('v2.onboarding.lbs') }}</span>
            </div>
            @if (weightError(); as err) {
              <p id="ob-weight-err" class="v2-caption mt-2" role="alert" style="color: var(--v2-danger);">
                {{ err }}
              </p>
            }
          </div>
          <div class="mt-auto flex flex-col gap-2">
            <ui-button variant="primary" size="lg" [block]="true" type="submit">
              {{ t('v2.onboarding.next') }}
            </ui-button>
            <ui-button variant="ghost" size="md" [block]="true" type="button" (click)="skip()">
              {{ t('v2.onboarding.skip') }}
            </ui-button>
          </div>
        </form>
      }

      @if (step() === 'goal') {
        <div class="flex flex-col gap-3">
          @for (opt of goalOptions; track opt.value) {
            <button
              type="button"
              class="v2-card text-left p-4 border-2 transition-colors"
              [style.border-color]="goal() === opt.value ? 'var(--v2-accent)' : 'var(--v2-rule)'"
              (click)="selectGoal(opt.value)"
              [attr.aria-pressed]="goal() === opt.value">
              <div class="v2-h3">{{ t(opt.labelKey) }}</div>
              <div class="v2-caption mt-1">{{ t(opt.blurbKey) }}</div>
            </button>
          }
          <div class="mt-auto flex flex-col gap-2">
            <ui-button variant="primary" size="lg" [block]="true" [disabled]="!goal()" (click)="submitGoal()">
              {{ t('v2.onboarding.next') }}
            </ui-button>
            <ui-button variant="ghost" size="md" [block]="true" type="button" (click)="back()">
              {{ t('v2.onboarding.back') }}
            </ui-button>
          </div>
        </div>
      }

      @if (step() === 'targetWeight') {
        <form (submit)="submitTargetWeight($event)" class="flex flex-col gap-4">
          <div>
            <label for="ob-target" class="v2-caption block mb-2">
              {{ goal() === 'lose' ? t('v2.onboarding.targetLoseLabel') : t('v2.onboarding.targetGainLabel') }}
            </label>
            <div class="flex items-baseline gap-3">
              <input
                id="ob-target"
                name="target"
                type="number"
                inputmode="decimal"
                min="60"
                max="700"
                step="1"
                autofocus
                [ngModel]="targetInput()"
                (ngModelChange)="targetInput.set($event)"
                class="grow text-3xl font-mono w-full"
                style="padding: var(--v2-space-3) var(--v2-space-4); background: var(--v2-paper-2); border: 1px solid var(--v2-rule); border-radius: var(--v2-radius-md); color: var(--v2-ink); min-height: var(--v2-tap-min);"
                [attr.aria-invalid]="!!targetError()"
                [attr.aria-describedby]="targetError() ? 'ob-target-err' : null"
              />
              <span class="v2-body-soft">{{ t('v2.onboarding.lbs') }}</span>
            </div>
            @if (targetError(); as err) {
              <p id="ob-target-err" class="v2-caption mt-2" role="alert" style="color: var(--v2-danger);">
                {{ err }}
              </p>
            }
          </div>
          <div class="mt-auto flex flex-col gap-2">
            <ui-button variant="primary" size="lg" [block]="true" type="submit">
              {{ t('v2.onboarding.next') }}
            </ui-button>
            <ui-button variant="ghost" size="md" [block]="true" type="button" (click)="back()">
              {{ t('v2.onboarding.back') }}
            </ui-button>
          </div>
        </form>
      }

      @if (step() === 'confirm') {
        <div class="flex flex-col gap-4">
          <p class="v2-body-soft">
            {{ t('v2.onboarding.confirmBody') }}
          </p>

          <ui-card>
            <div class="flex items-center justify-between py-1">
              <span class="v2-caption">{{ t('v2.onboarding.kcalLabel') }}</span>
              <div class="text-right">
                @if (isRedo() && currentKcal() != null) {
                  <span class="v2-body-soft mr-2">{{ currentKcal() }} →</span>
                }
                <span class="v2-h3 font-mono">{{ computedKcal() }}</span>
              </div>
            </div>
            <hr class="v2-hr" style="margin: var(--v2-space-2) 0;" />
            <div class="flex items-center justify-between py-1">
              <span class="v2-caption">{{ t('v2.onboarding.proteinLabel') }}</span>
              <div class="text-right">
                @if (isRedo() && currentProtein() != null) {
                  <span class="v2-body-soft mr-2">{{ currentProtein() }} →</span>
                }
                <span class="v2-h3 font-mono">{{ computedProtein() }}{{ t('v2.onboarding.gramSuffix') }}</span>
              </div>
            </div>
          </ui-card>

          <p class="v2-caption">
            {{ t('v2.onboarding.editLater') }}
          </p>

          @if (saveError(); as err) {
            <p class="v2-caption" role="alert" style="color: var(--v2-danger);">{{ err }}</p>
          }

          <div class="mt-auto flex flex-col gap-2">
            <ui-button
              variant="primary"
              size="lg"
              [block]="true"
              [disabled]="saving()"
              (click)="confirm()">
              {{ saving() ? t('v2.onboarding.saving') : (isRedo() ? t('v2.onboarding.apply') : t('v2.onboarding.confirm')) }}
            </ui-button>
            @if (isRedo()) {
              <ui-button variant="secondary" size="md" [block]="true" type="button" (click)="cancel()">
                {{ t('v2.onboarding.keepCurrent') }}
              </ui-button>
            }
            <ui-button variant="ghost" size="md" [block]="true" type="button" (click)="back()">
              {{ t('v2.onboarding.back') }}
            </ui-button>
          </div>
        </div>
      }
    </section>
    </ng-container>
  `,
})
export class OnboardingComponent {
  private readonly fb = inject(FirebaseService);
  private readonly translation = inject(TranslationService);
  private readonly analytics = inject(AnalyticsService);

  readonly completed = output<void>();
  readonly cancelled = output<void>();

  protected readonly step = signal<Step>('weight');
  protected readonly weight = signal<number | null>(null);
  protected readonly goal = signal<GoalDirection | null>(null);
  protected readonly targetWeight = signal<number | null>(null);
  protected readonly weightInput = signal<string>('');
  protected readonly targetInput = signal<string>('');
  protected readonly weightError = signal<string | null>(null);
  protected readonly targetError = signal<string | null>(null);
  protected readonly saving = signal(false);
  protected readonly saveError = signal<string | null>(null);

  protected readonly goalOptions: { value: GoalDirection; labelKey: string; blurbKey: string }[] = [
    { value: 'lose', labelKey: 'v2.onboarding.goalLoseLabel', blurbKey: 'v2.onboarding.goalLoseBlurb' },
    { value: 'maintain', labelKey: 'v2.onboarding.goalMaintainLabel', blurbKey: 'v2.onboarding.goalMaintainBlurb' },
    { value: 'gain', labelKey: 'v2.onboarding.goalGainLabel', blurbKey: 'v2.onboarding.goalGainBlurb' },
  ];

  protected readonly isRedo = computed(
    () => this.fb.profile()?.onboardingV2CompletedAt != null,
  );

  protected readonly currentKcal = computed(() => this.fb.profile()?.manualCaloriesTarget ?? null);
  protected readonly currentProtein = computed(() => this.fb.profile()?.manualProteinTarget ?? null);

  protected readonly computedKcal = computed(() => {
    const w = this.weight();
    const g = this.goal();
    if (w == null || g == null) return 0;
    return computeKcal(w, g);
  });

  protected readonly computedProtein = computed(() => {
    const w = this.weight();
    const g = this.goal();
    if (w == null || g == null) return 0;
    return computeProtein(w);
  });

  constructor() {
    // In redo mode pre-fill weight from any prior value; goal direction
    // pre-fills on the goal step.
    const p = this.fb.profile();
    if (p?.targetWeightLbs != null) {
      this.targetWeight.set(p.targetWeightLbs);
      this.targetInput.set(String(p.targetWeightLbs));
    }
    if (p?.goalDirection) {
      this.goal.set(p.goalDirection);
    }

    // Funnel handoff: a user who came from /calculator or /macros has
    // already given us their weight + goal. Pre-fill those signals and
    // jump straight to the next step the user hasn't answered yet —
    // 'targetWeight' for lose/gain (still need a target) or 'confirm'
    // for maintain. Only applies on first-time onboarding; redo mode
    // ignores the prefill so the redo screen can show "Current → New".
    if (!this.isRedo()) {
      const prefill = consumeCalcPrefill();
      if (prefill) {
        this.weight.set(prefill.weight);
        this.weightInput.set(String(prefill.weight));
        this.goal.set(prefill.goal);
        this.step.set(prefill.goal === 'maintain' ? 'confirm' : 'targetWeight');
        this.analytics.track('onboarding_prefilled', { goal: prefill.goal });
      }
    }
  }

  protected stepLabel(): string {
    const map: Record<Step, string> = {
      weight: 'v2.onboarding.stepLabelWeight',
      goal: 'v2.onboarding.stepLabelGoal',
      targetWeight: 'v2.onboarding.stepLabelTargetWeight',
      confirm: 'v2.onboarding.stepLabelConfirm',
    };
    return this.translation.t(map[this.step()]);
  }

  protected stepTitle(): string {
    const map: Record<Step, string> = {
      weight: 'v2.onboarding.weightTitle',
      goal: 'v2.onboarding.goalTitle',
      targetWeight: 'v2.onboarding.targetTitle',
      confirm: 'v2.onboarding.confirmTitle',
    };
    return this.translation.t(map[this.step()]);
  }

  protected submitWeight(e: Event): void {
    e.preventDefault();
    const raw = parseFloat(this.weightInput());
    if (!Number.isFinite(raw) || raw < WEIGHT_MIN_LB || raw > WEIGHT_MAX_LB) {
      this.weightError.set(
        this.translation.t('v2.onboarding.weightOutOfRange', {
          min: WEIGHT_MIN_LB,
          max: WEIGHT_MAX_LB,
        }),
      );
      return;
    }
    this.weightError.set(null);
    this.weight.set(raw);
    this.step.set('goal');
  }

  protected selectGoal(g: GoalDirection): void {
    this.goal.set(g);
  }

  protected submitGoal(): void {
    const g = this.goal();
    if (!g) return;
    if (g === 'maintain') {
      this.targetWeight.set(null);
      this.step.set('confirm');
    } else {
      this.step.set('targetWeight');
    }
  }

  protected submitTargetWeight(e: Event): void {
    e.preventDefault();
    const raw = parseFloat(this.targetInput());
    if (!Number.isFinite(raw) || raw < WEIGHT_MIN_LB || raw > WEIGHT_MAX_LB) {
      this.targetError.set(
        this.translation.t('v2.onboarding.weightOutOfRange', {
          min: WEIGHT_MIN_LB,
          max: WEIGHT_MAX_LB,
        }),
      );
      return;
    }
    this.targetError.set(null);
    this.targetWeight.set(raw);
    this.step.set('confirm');
  }

  protected back(): void {
    const s = this.step();
    if (s === 'goal') this.step.set('weight');
    else if (s === 'targetWeight') this.step.set('goal');
    else if (s === 'confirm') {
      this.step.set(this.goal() === 'maintain' ? 'goal' : 'targetWeight');
    }
  }

  protected cancel(): void {
    this.cancelled.emit();
  }

  protected async confirm(): Promise<void> {
    const w = this.weight();
    const g = this.goal();
    if (w == null || g == null) return;
    this.saving.set(true);
    this.saveError.set(null);
    try {
      await this.fb.saveOnboardingV2({
        weightLbs: w,
        goalDirection: g,
        targetWeightLbs: g === 'maintain' ? undefined : this.targetWeight() ?? undefined,
        manualCaloriesTarget: this.computedKcal(),
        manualProteinTarget: this.computedProtein(),
      });
      this.completed.emit();
    } catch (err) {
      this.saveError.set(this.translation.t('v2.onboarding.saveError'));
      this.saving.set(false);
    }
  }

  protected async skip(): Promise<void> {
    this.saving.set(true);
    this.saveError.set(null);
    try {
      await this.fb.saveOnboardingV2({
        weightLbs: 0,
        goalDirection: 'maintain',
        manualCaloriesTarget: DEFAULT_SKIP_KCAL,
        manualProteinTarget: DEFAULT_SKIP_PROTEIN,
      });
      this.completed.emit();
    } catch (err) {
      this.saveError.set(this.translation.t('v2.onboarding.saveError'));
      this.saving.set(false);
    }
  }
}
