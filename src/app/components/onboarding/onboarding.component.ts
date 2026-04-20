import { ChangeDetectionStrategy, Component, computed, inject, input, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { TranslocoDirective } from '@jsverse/transloco';
import {
  FirebaseService,
  ActivityLevel,
  CutPace,
  ProfileFields,
  Sex,
} from '../../services/firebase.service';
import { TranslationService } from '../../services/translation.service';

type Status = 'idle' | 'saving' | 'error';
type OnboardingStepId = 1 | 2 | 3;

interface ActivityOption {
  value: ActivityLevel;
  labelKey: string;
  blurbKey: string;
}

interface PaceOption {
  value: CutPace;
  labelKey: string;
  blurbKey: string;
}

interface OnboardingStep {
  id: OnboardingStepId;
  titleKey: string;
  bodyKey: string;
  focusSelector: string;
}

const ONBOARDING_STEPS: readonly OnboardingStep[] = [
  {
    id: 1,
    titleKey: 'onboarding.stepIdentityTitle',
    bodyKey: 'onboarding.stepIdentityBody',
    focusSelector: '#heightFt',
  },
  {
    id: 2,
    titleKey: 'onboarding.stepActivityTitle',
    bodyKey: 'onboarding.stepActivityBody',
    focusSelector: '#activity-sedentary',
  },
  {
    id: 3,
    titleKey: 'onboarding.stepTargetTitle',
    bodyKey: 'onboarding.stepTargetBody',
    focusSelector: '#pace-05',
  },
];

@Component({
  selector: 'app-onboarding',
  standalone: true,
  imports: [FormsModule, TranslocoDirective],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <ng-container *transloco="let t">
    <section>
      <div class="specimen px-5 py-8 sm:px-7 sm:py-10 relative">
        <span class="crop-bl"></span><span class="crop-br"></span>

        <!-- Header -->
        <div class="flex items-center gap-3 mb-1">
          <span class="stamp-mark">{{ editMode() ? t('onboarding.stampAmend') : t('onboarding.stampIntake') }}</span>
          <span class="data-label">{{ t('onboarding.sectionLabel') }}</span>
        </div>
        <h2 class="font-display text-3xl sm:text-4xl leading-[0.95] text-ink mt-3">
          {{ editMode() ? t('onboarding.titleLeadEdit') : t('onboarding.titleLeadNew') }}<br/>
          <em class="text-blood">{{ editMode() ? t('onboarding.titleEmEdit') : t('onboarding.titleEmNew') }}</em>
        </h2>
        <p class="caption mt-4 text-[11px] leading-relaxed">
          {{ t('onboarding.blurb') }}
        </p>

        <!-- Reassurance block: why we ask, what we do / don't do.
             Trailing link points to /privacy so these claims have
             proof, not just copy. -->
        <div class="mt-4 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-graphite font-sans">
          <span>{{ t('onboarding.reassurePrivate') }}</span>
          <span>{{ t('onboarding.reassureNoSelling') }}</span>
          <span>{{ t('onboarding.reassureEditable') }}</span>
          <a href="/privacy" target="_blank" rel="noopener"
            class="underline decoration-dotted hover:text-blood">{{ t('onboarding.reassureDetails') }}</a>
        </div>

        <!-- 3-step guided flow -->
        <div class="mt-6">
          <div class="flex items-center justify-between gap-3">
            <span class="data-label">{{ t('onboarding.progressLabel', { current: currentStep(), total: steps.length }) }}</span>
            <span class="caption text-[11px]">{{ t(currentStepMeta().titleKey) }}</span>
          </div>

          <div class="grid grid-cols-3 gap-2 mt-3" role="list" [attr.aria-label]="t('onboarding.progressAria')">
            @for (step of steps; track step.id) {
              <div
                role="listitem"
                class="step-card"
                [class.step-card--active]="step.id === currentStep()"
                [class.step-card--complete]="step.id < currentStep()"
                [attr.aria-current]="step.id === currentStep() ? 'step' : null"
              >
                <div class="font-mono text-[10px] tracking-[0.14em] uppercase">{{ t('onboarding.stepNumber', { n: step.id }) }}</div>
                <div class="font-sans text-sm mt-1">{{ t(step.titleKey) }}</div>
              </div>
            }
          </div>

          <div class="specimen px-4 py-3 mt-3">
            <span class="crop-bl"></span><span class="crop-br"></span>
            <div class="flex items-center gap-2 mb-1">
              <span class="stamp-mark" style="transform: rotate(0deg)">{{ t('onboarding.stepStamp') }}</span>
              <span class="data-label">{{ t(currentStepMeta().titleKey) }}</span>
            </div>
            <p class="font-sans text-sm text-ink leading-relaxed">
              {{ t(currentStepMeta().bodyKey) }}
            </p>
          </div>
        </div>

        <form (ngSubmit)="submit()" class="mt-8 space-y-9">
          @switch (currentStep()) {
            @case (1) {
              <!-- Step 1: identity -->
              <p class="caption text-[11px] mb-4" style="color: var(--color-graphite)">
                {{ t('onboarding.notMedicalAdvice') }}
              </p>
              <div>
                <label class="data-label block mb-2">
                  {{ t('onboarding.heightLabel') }} <span class="text-blood" [attr.aria-label]="t('onboarding.required')">*</span>
                </label>
                <div class="flex items-baseline gap-4">
                  <div class="flex items-baseline gap-2 flex-1">
                    <input
                      id="heightFt"
                      type="number"
                      min="4"
                      max="8"
                      step="1"
                      inputmode="numeric"
                      [ngModel]="heightFt()"
                      (ngModelChange)="heightFt.set($event)"
                      name="heightFt"
                      placeholder="5"
                      [attr.aria-label]="t('onboarding.heightFeetAria')"
                      class="field-input w-20 text-center"
                      required
                    />
                    <span class="font-display italic text-graphite text-sm">{{ t('onboarding.ft') }}</span>
                  </div>
                  <div class="flex items-baseline gap-2 flex-1">
                    <input
                      id="heightInExtra"
                      type="number"
                      min="0"
                      max="11"
                      step="1"
                      inputmode="numeric"
                      [ngModel]="heightInExtra()"
                      (ngModelChange)="heightInExtra.set($event)"
                      name="heightInExtra"
                      placeholder="10"
                      [attr.aria-label]="t('onboarding.heightInchesAria')"
                      class="field-input w-20 text-center"
                      required
                    />
                    <span class="font-display italic text-graphite text-sm">{{ t('onboarding.inches') }}</span>
                  </div>
                </div>
              </div>

              <div>
                <label for="age" class="data-label block mb-2">
                  {{ t('onboarding.ageLabel') }} <span class="text-blood" [attr.aria-label]="t('onboarding.required')">*</span>
                </label>
                <div class="flex items-baseline gap-3">
                  <input
                    id="age"
                    name="age"
                    type="number"
                    min="13"
                    max="120"
                    step="1"
                    inputmode="numeric"
                    [ngModel]="age()"
                    (ngModelChange)="age.set($event)"
                    placeholder="32"
                    class="field-input w-28"
                    required
                  />
                  <span class="font-display italic text-graphite text-sm">{{ t('onboarding.years') }}</span>
                </div>
              </div>

              <div>
                <label class="data-label block mb-2">
                  {{ t('onboarding.sexLabel') }} <span class="text-blood" [attr.aria-label]="t('onboarding.required')">*</span>
                </label>
                <p class="caption text-xs mb-2">
                  {{ t('onboarding.sexCaption') }}
                </p>
                <div class="flex gap-3">
                  @for (opt of sexOptions; track opt.value) {
                    <button
                      [id]="'sex-' + opt.value"
                      type="button"
                      (click)="sex.set(opt.value)"
                      [class.selected]="sex() === opt.value"
                      [attr.aria-pressed]="sex() === opt.value"
                      class="radio-card flex-1"
                    >
                      {{ t(opt.labelKey) }}
                    </button>
                  }
                </div>
              </div>

              @if (!ageAlreadyConfirmed()) {
                <div>
                  <label class="flex items-start gap-3 cursor-pointer">
                    <input
                      id="ageGate"
                      type="checkbox"
                      name="ageGate"
                      [checked]="ageGate()"
                      (change)="ageGate.set($any($event.target).checked)"
                      class="mt-1"
                      required
                    />
                    <span class="flex-1">
                      <span class="font-mono text-xs tracking-[0.08em] text-ink">
                        {{ t('onboarding.ageGateLabel') }} <span class="text-blood" [attr.aria-label]="t('onboarding.required')">*</span>
                      </span>
                      <span class="caption block text-[11px] mt-1">
                        {{ t('onboarding.ageGateCaption') }}
                      </span>
                    </span>
                  </label>
                </div>
              }
            }

            @case (2) {
              <!-- Step 2: activity -->
              <div>
                <label class="data-label block mb-2">
                  {{ t('onboarding.activityLabel') }} <span class="text-blood" [attr.aria-label]="t('onboarding.required')">*</span>
                </label>
                <div class="space-y-2">
                  @for (opt of activityOptions; track opt.value) {
                    <button
                      [id]="'activity-' + opt.value"
                      type="button"
                      (click)="activityLevel.set(opt.value)"
                      [class.selected]="activityLevel() === opt.value"
                      [attr.aria-pressed]="activityLevel() === opt.value"
                      class="radio-card w-full text-left"
                    >
                      <div class="flex items-baseline justify-between gap-3">
                        <span class="font-mono text-xs tracking-[0.15em] uppercase text-ink">{{ t(opt.labelKey) }}</span>
                      </div>
                      <div class="font-display italic text-graphite text-[11px] mt-1 normal-case tracking-normal">
                        {{ t(opt.blurbKey) }}
                      </div>
                    </button>
                  }
                </div>
              </div>
            }

            @case (3) {
              <!-- Step 3: target -->
              <div>
                <label class="data-label block mb-2">
                  {{ t('onboarding.paceLabel') }} <span class="text-blood" [attr.aria-label]="t('onboarding.required')">*</span>
                  <span class="normal-case italic text-graphite tracking-normal text-[11px]">{{ t('onboarding.paceHint') }}</span>
                </label>
                <p class="caption text-xs mb-2">
                  {{ t('onboarding.paceCaption') }}
                </p>
                <div class="grid grid-cols-2 gap-2">
                  @for (opt of paceOptions; track opt.value) {
                    <button
                      [id]="'pace-' + paceId(opt.value)"
                      type="button"
                      (click)="pace.set(opt.value)"
                      [class.selected]="pace() === opt.value"
                      [attr.aria-pressed]="pace() === opt.value"
                      class="radio-card"
                    >
                      <div class="font-mono text-xs tracking-[0.15em] uppercase text-ink">{{ t(opt.labelKey) }}</div>
                      <div class="font-display italic text-graphite text-xs mt-0.5 normal-case tracking-normal">
                        {{ t(opt.blurbKey) }}
                      </div>
                    </button>
                  }
                </div>
              </div>

              <div>
                <label for="goalWeight" class="data-label block mb-2">
                  {{ t('onboarding.goalLabel') }}
                  <span class="inline-block ml-1 px-2 py-0.5 text-[10px] normal-case tracking-normal italic rounded-full"
                    style="background: var(--color-paper-deep); color: var(--color-graphite); border: 1px solid var(--color-rule);">
                    {{ t('onboarding.skipIfNone') }}
                  </span>
                </label>
                <div class="flex items-baseline gap-3">
                  <input
                    id="goalWeight"
                    name="goalWeight"
                    type="number"
                    min="50"
                    max="999"
                    step="0.1"
                    inputmode="decimal"
                    [ngModel]="goalWeight()"
                    (ngModelChange)="goalWeight.set($event)"
                    placeholder="170"
                    class="field-input w-28"
                  />
                  <span class="font-display italic text-graphite text-sm">{{ t('onboarding.lbs') }}</span>
                </div>
              </div>
            }
          }

          <!-- Submit -->
          <div class="pt-3">
            <div class="flex flex-col sm:flex-row gap-2">
              @if (currentStep() > 1) {
                <button
                  type="button"
                  (click)="previousStep()"
                  class="tag-btn justify-center sm:min-w-28"
                >
                  {{ t('onboarding.back') }}
                </button>
              }

              <button
                type="submit"
                [disabled]="status() === 'saving'"
                class="stamp-btn sm:flex-1"
              >
                @if (status() === 'saving') {
                  <span>{{ t('onboarding.saving') }}</span>
                } @else if (isFinalStep()) {
                  <span>{{ editMode() ? t('onboarding.saveChanges') : t('onboarding.commitProfile') }}</span>
                } @else {
                  <span>{{ t('onboarding.continue') }}</span>
                }
              </button>
            </div>

            @if (editMode()) {
              <button
                type="button"
                (click)="cancelled.emit()"
                class="tag-btn w-full mt-3 justify-center"
              >
                {{ t('onboarding.cancel') }}
              </button>
            }

            @if (status() === 'error') {
              <p class="font-mono text-[11px] text-blood mt-4 leading-relaxed">
                ✕ {{ errorMsg() }}
              </p>
            }
          </div>
        </form>
      </div>
    </section>
    </ng-container>
  `,
  styles: [`
    .radio-card {
      padding: 10px 14px;
      background: transparent;
      border: 1px solid var(--color-rule);
      font-family: var(--font-mono);
      font-size: 0.75rem;
      letter-spacing: 0.08em;
      text-transform: uppercase;
      color: var(--color-ink);
      cursor: pointer;
      transition: all 180ms ease;
    }
    .radio-card:hover {
      background: rgba(26, 22, 18, 0.04);
    }
    .radio-card.selected {
      background: var(--color-ink);
      color: var(--color-paper);
      border-color: var(--color-ink);
      box-shadow: 2px 2px 0 0 var(--color-blood);
    }
    .radio-card.selected .text-graphite {
      color: var(--color-aged) !important;
    }
    .radio-card.selected .text-ink {
      color: var(--color-paper) !important;
    }
    .step-card {
      padding: 10px 12px;
      border: 1px solid var(--color-rule);
      background: transparent;
      color: var(--color-graphite);
      transition: all 180ms ease;
    }
    .step-card--active {
      border-color: var(--color-blood);
      background: rgba(111, 26, 16, 0.05);
      color: var(--color-ink);
      box-shadow: 2px 2px 0 0 var(--color-blood);
    }
    .step-card--complete {
      border-color: var(--color-olive);
      color: var(--color-ink);
    }
  `],
})
export class OnboardingComponent {
  private readonly firebase = inject(FirebaseService);
  private readonly translation = inject(TranslationService);

  /** When true, we're editing an existing profile rather than creating one. */
  readonly editMode = input(false);
  readonly cancelled = output<void>();
  readonly saved = output<void>();

  // ── Form state ──────────────────────────────────────────────
  protected readonly heightFt = signal<number | null>(null);
  protected readonly heightInExtra = signal<number | null>(null);
  protected readonly age = signal<number | null>(null);
  protected readonly sex = signal<Sex | null>(null);
  protected readonly activityLevel = signal<ActivityLevel | null>(null);
  protected readonly pace = signal<CutPace | null>(null);
  protected readonly goalWeight = signal<number | null>(null);
  protected readonly ageGate = signal<boolean>(false);
  protected readonly ageAlreadyConfirmed = computed(
    () => this.firebase.profile()?.ageConfirmedAt != null,
  );

  protected readonly status = signal<Status>('idle');
  protected readonly errorMsg = signal('');
  protected readonly steps = ONBOARDING_STEPS;
  protected readonly currentStep = signal<OnboardingStepId>(1);
  protected readonly isFinalStep = computed(() => this.currentStep() === this.steps.length);
  protected readonly currentStepMeta = computed(() => this.steps[this.currentStep() - 1]);

  protected readonly sexOptions: { value: Sex; labelKey: string }[] = [
    { value: 'male',   labelKey: 'onboarding.sexMale'   },
    { value: 'female', labelKey: 'onboarding.sexFemale' },
  ];

  protected readonly activityOptions: ActivityOption[] = [
    { value: 'sedentary',   labelKey: 'onboarding.activitySedentary',   blurbKey: 'onboarding.activitySedentaryBlurb'   },
    { value: 'light',       labelKey: 'onboarding.activityLight',       blurbKey: 'onboarding.activityLightBlurb'       },
    { value: 'moderate',    labelKey: 'onboarding.activityModerate',    blurbKey: 'onboarding.activityModerateBlurb'    },
    { value: 'active',      labelKey: 'onboarding.activityActive',      blurbKey: 'onboarding.activityActiveBlurb'      },
    { value: 'very_active', labelKey: 'onboarding.activityVeryActive',  blurbKey: 'onboarding.activityVeryActiveBlurb'  },
  ];

  protected readonly paceOptions: PaceOption[] = [
    { value: 0.5, labelKey: 'onboarding.pace05', blurbKey: 'onboarding.pace05Blurb' },
    { value: 1.0, labelKey: 'onboarding.pace10', blurbKey: 'onboarding.pace10Blurb' },
    { value: 1.5, labelKey: 'onboarding.pace15', blurbKey: 'onboarding.pace15Blurb' },
    { value: 2.0, labelKey: 'onboarding.pace20', blurbKey: 'onboarding.pace20Blurb' },
  ];

  constructor() {
    // When editing, prefill from the currently-loaded profile.
    const existing = this.firebase.profile();
    if (existing?.profileCompleted) {
      if (existing.heightIn != null) {
        this.heightFt.set(Math.floor(existing.heightIn / 12));
        this.heightInExtra.set(existing.heightIn % 12);
      }
      if (existing.age != null) this.age.set(existing.age);
      if (existing.sex != null) this.sex.set(existing.sex);
      if (existing.activityLevel != null) this.activityLevel.set(existing.activityLevel);
      if (existing.targetPaceLbsPerWeek != null) this.pace.set(existing.targetPaceLbsPerWeek);
      if (existing.goalWeightLbs != null) this.goalWeight.set(existing.goalWeightLbs);
    }
  }

  protected async submit(): Promise<void> {
    this.status.set('idle');
    this.errorMsg.set('');

    if (!this.validateStep(this.currentStep())) {
      return;
    }

    if (!this.isFinalStep()) {
      this.goToStep((this.currentStep() + 1) as OnboardingStepId);
      return;
    }

    const ft = Number(this.heightFt());
    const extra = Number(this.heightInExtra());
    const totalInches = ft * 12 + extra;

    const fields: ProfileFields = {
      heightIn: totalInches,
      age: Number(this.age()),
      sex: this.sex()!,
      activityLevel: this.activityLevel()!,
      targetPaceLbsPerWeek: this.pace()!,
      ageConfirmed: this.ageGate(),
      preferredLocale: this.translation.language(),
    };
    const gw = this.goalWeight();
    if (gw != null && !Number.isNaN(Number(gw))) {
      fields.goalWeightLbs = Number(gw);
    }

    this.status.set('saving');
    try {
      await this.firebase.saveProfile(fields);
      this.saved.emit();
    } catch (err) {
      this.status.set('error');
      this.errorMsg.set(err instanceof Error ? err.message : this.translation.t('onboarding.errorFailedToSaveProfile'));
    }
  }

  protected previousStep(): void {
    if (this.currentStep() === 1) return;
    this.goToStep((this.currentStep() - 1) as OnboardingStepId);
  }

  protected paceId(value: CutPace): string {
    return String(value).replace('.', '');
  }

  private goToStep(step: OnboardingStepId): void {
    this.currentStep.set(step);
    this.status.set('idle');
    this.errorMsg.set('');
    this.focusSelector(this.steps[step - 1]?.focusSelector ?? '#heightFt');
  }

  private validateStep(step: OnboardingStepId): boolean {
    switch (step) {
      case 1: {
        const missing = [
          { invalid: this.heightFt() == null, selector: '#heightFt' },
          { invalid: this.heightInExtra() == null, selector: '#heightInExtra' },
          { invalid: this.age() == null, selector: '#age' },
          { invalid: this.sex() === null, selector: '#sex-male' },
        ];
        for (const field of missing) {
          if (!field.invalid) continue;
          this.focusSelector(field.selector);
          return false;
        }

        const totalInches = Number(this.heightFt()) * 12 + Number(this.heightInExtra());
        if (totalInches < 40 || totalInches > 96) {
          this.status.set('error');
          this.errorMsg.set(this.translation.t('onboarding.errorHeightRange'));
          this.focusSelector('#heightFt');
          return false;
        }
        if (!this.ageAlreadyConfirmed() && !this.ageGate()) {
          this.status.set('error');
          this.errorMsg.set(this.translation.t('onboarding.errorAgeGate'));
          this.focusSelector('#ageGate');
          return false;
        }
        return true;
      }

      case 2:
        if (this.activityLevel() === null) {
          this.focusSelector('#activity-sedentary');
          return false;
        }
        return true;

      case 3:
        if (this.pace() === null) {
          this.focusSelector('#pace-05');
          return false;
        }
        return true;
    }
  }

  private focusSelector(selector: string): void {
    queueMicrotask(() => {
      const el = document.querySelector<HTMLElement>(selector);
      el?.focus();
      el?.scrollIntoView({ block: 'center', behavior: 'smooth' });
    });
  }
}
