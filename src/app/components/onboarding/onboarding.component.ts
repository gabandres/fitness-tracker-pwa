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

        <!-- Reassurance block: why we ask, what we do / don't do -->
        <div class="mt-4 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-graphite font-sans">
          <span>{{ t('onboarding.reassurePrivate') }}</span>
          <span>{{ t('onboarding.reassureNoSelling') }}</span>
          <span>{{ t('onboarding.reassureEditable') }}</span>
        </div>

        <form (ngSubmit)="submit()" class="mt-8 space-y-9">
          <!-- 1. Height (ft + in) -->
          <div>
            <label class="data-label block mb-2">
              {{ t('onboarding.heightLabel') }} <span class="text-blood" [attr.aria-label]="t('onboarding.required')">*</span>
            </label>
            <div class="flex items-baseline gap-4">
              <div class="flex items-baseline gap-2 flex-1">
                <input
                  #heightFtInput
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
                  class="field-input w-20 text-center"
                  required
                />
                <span class="font-display italic text-graphite text-sm">{{ t('onboarding.inches') }}</span>
              </div>
            </div>
          </div>

          <!-- 2. Age -->
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

          <!-- 3. Biological sex -->
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
                  type="button"
                  (click)="sex.set(opt.value)"
                  [class.selected]="sex() === opt.value"
                  class="radio-card flex-1"
                >
                  {{ t(opt.labelKey) }}
                </button>
              }
            </div>
          </div>

          <!-- 4. Activity level -->
          <div>
            <label class="data-label block mb-2">
              {{ t('onboarding.activityLabel') }} <span class="text-blood" [attr.aria-label]="t('onboarding.required')">*</span>
            </label>
            <div class="space-y-2">
              @for (opt of activityOptions; track opt.value) {
                <button
                  type="button"
                  (click)="activityLevel.set(opt.value)"
                  [class.selected]="activityLevel() === opt.value"
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

          <!-- 5. Weekly fat-loss target (a.k.a. cut pace) -->
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
                  type="button"
                  (click)="pace.set(opt.value)"
                  [class.selected]="pace() === opt.value"
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

          <!-- Optional: Goal weight -->
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

          <!-- Submit -->
          <div class="pt-3">
            <!-- Button stays enabled even on incomplete forms so tapping
                 submit triggers focusFirstInvalid() and lands the user on
                 the missing field. Saving state still disables to block
                 double-submit. -->
            <button
              type="submit"
              [disabled]="status() === 'saving'"
              class="stamp-btn"
            >
              @if (status() === 'saving') {
                <span>{{ t('onboarding.saving') }}</span>
              } @else {
                <span>{{ editMode() ? t('onboarding.saveChanges') : t('onboarding.commitProfile') }}</span>
              }
            </button>

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

  protected readonly status = signal<Status>('idle');
  protected readonly errorMsg = signal('');

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

  protected readonly canSubmit = computed(() =>
    this.heightFt() != null &&
    this.heightInExtra() != null &&
    this.age() != null &&
    this.sex() !== null &&
    this.activityLevel() !== null &&
    this.pace() !== null,
  );

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
    if (!this.canSubmit()) {
      // Focus the first empty required field so the user sees what's missing.
      this.focusFirstInvalid();
      return;
    }

    const ft = Number(this.heightFt());
    const extra = Number(this.heightInExtra());
    const totalInches = ft * 12 + extra;

    if (totalInches < 40 || totalInches > 96) {
      this.status.set('error');
      this.errorMsg.set(this.translation.t('onboarding.errorHeightRange'));
      // Focus the height ft input so keyboard + screen-reader users
      // immediately land on the offending field.
      queueMicrotask(() => {
        (document.getElementById('heightFt') as HTMLInputElement | null)?.focus();
      });
      return;
    }

    const fields: ProfileFields = {
      heightIn: totalInches,
      age: Number(this.age()),
      sex: this.sex()!,
      activityLevel: this.activityLevel()!,
      targetPaceLbsPerWeek: this.pace()!,
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

  /** Focus the first required field that's still empty, so the user
      immediately sees what's missing after tapping submit. */
  private focusFirstInvalid(): void {
    queueMicrotask(() => {
      const order: { signalEmpty: boolean; selector: string }[] = [
        { signalEmpty: this.heightFt() == null,      selector: '#heightFt' },
        { signalEmpty: this.heightInExtra() == null, selector: '#heightInExtra' },
        { signalEmpty: this.age() == null,           selector: '#age' },
        // For radio-card fields, focus the first option button so keyboard
        // users can Tab/arrow through choices.
        { signalEmpty: this.sex() === null,           selector: '.radio-card' },
        { signalEmpty: this.activityLevel() === null, selector: '.radio-card' },
        { signalEmpty: this.pace() === null,          selector: '.radio-card' },
      ];
      for (const { signalEmpty, selector } of order) {
        if (!signalEmpty) continue;
        const el = document.querySelector<HTMLElement>(selector);
        el?.focus();
        el?.scrollIntoView({ block: 'center', behavior: 'smooth' });
        return;
      }
    });
  }
}
