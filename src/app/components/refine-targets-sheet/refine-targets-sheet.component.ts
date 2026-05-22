import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import { LucideAngularModule } from 'lucide-angular';
import { TranslocoDirective } from '@jsverse/transloco';
import { FirebaseService, ActivityLevel, CutPace, Sex } from '../../services/firebase.service';
import { FitnessStore } from '../../services/fitness-store.service';
import { TdeeCalculatorService } from '../../services/tdee-calculator.service';
import { TranslationService } from '../../services/translation.service';
import { V2Sheet } from '../ui/sheet.component';
import { V2Button } from '../ui/button.component';

/**
 * Day-3 "Refine targets" sheet. Collects the missing Mifflin-St Jeor
 * inputs (sex, age, height, activity, pace) so the TDEE formula chain
 * can replace the 2-Q-onboarding heuristic. Saving clears
 * `manualCaloriesTarget` + `manualProteinTarget` and stamps
 * `targetsRefinedAt` — see FirebaseService.saveRefinedTargets.
 */
@Component({
  selector: 'v2-refine-targets-sheet',
  standalone: true,
  imports: [LucideAngularModule, TranslocoDirective, V2Sheet, V2Button],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <ng-container *transloco="let t">
    @if (open()) {
      <v2-sheet labelledBy="refine-sheet-title" (close)="onClose()">
        <h2 id="refine-sheet-title" class="v2-h2 mb-1">{{ t('v2.refineTargets.title') }}</h2>
        <p class="v2-caption mb-4">{{ t('v2.refineTargets.subtitle') }}</p>

        <form class="space-y-5" (submit)="save($event)" novalidate>
          <!-- Sex -->
          <div>
            <span class="v2-caption block mb-1.5"
              style="text-transform: uppercase; letter-spacing: 0.08em;">
              {{ t('v2.refineTargets.sex') }}
            </span>
            <div class="grid grid-cols-2 gap-2">
              @for (opt of sexOptions; track opt.value) {
                <button
                  type="button"
                  class="v2-card text-left p-3 border-2"
                  [style.border-color]="sex() === opt.value ? 'var(--v2-accent)' : 'var(--v2-rule)'"
                  [attr.aria-pressed]="sex() === opt.value"
                  (click)="sex.set(opt.value)">
                  <span class="v2-body">{{ t(opt.labelKey) }}</span>
                </button>
              }
            </div>
          </div>

          <!-- Age + Height -->
          <div class="grid grid-cols-2 gap-3">
            <div>
              <label for="rt-age" class="v2-caption block mb-1.5"
                style="text-transform: uppercase; letter-spacing: 0.08em;">
                {{ t('v2.refineTargets.age') }}
              </label>
              <input
                id="rt-age"
                type="number"
                inputmode="numeric"
                min="13"
                max="120"
                step="1"
                class="v2-field v2-field--num"
                [class.v2-field--error]="errors().age"
                [value]="ageInput() ?? ''"
                (input)="onAgeInput($event)" />
            </div>
            <div>
              <span class="v2-caption block mb-1.5"
                style="text-transform: uppercase; letter-spacing: 0.08em;">
                {{ t('v2.refineTargets.height') }}
              </span>
              <div class="flex gap-2">
                <input
                  type="number"
                  inputmode="numeric"
                  min="3"
                  max="8"
                  step="1"
                  class="v2-field v2-field--num"
                  [class.v2-field--error]="errors().height"
                  [attr.aria-label]="t('v2.refineTargets.heightFt')"
                  [value]="heightFt() ?? ''"
                  (input)="onHeightFtInput($event)" />
                <input
                  type="number"
                  inputmode="numeric"
                  min="0"
                  max="11"
                  step="1"
                  class="v2-field v2-field--num"
                  [class.v2-field--error]="errors().height"
                  [attr.aria-label]="t('v2.refineTargets.heightIn')"
                  [value]="heightInExtra() ?? ''"
                  (input)="onHeightInInput($event)" />
              </div>
            </div>
          </div>

          <!-- Activity level -->
          <div>
            <span class="v2-caption block mb-1.5"
              style="text-transform: uppercase; letter-spacing: 0.08em;">
              {{ t('v2.refineTargets.activity') }}
            </span>
            <div class="flex flex-col gap-2">
              @for (opt of activityOptions; track opt.value) {
                <button
                  type="button"
                  class="v2-card text-left p-3 border-2"
                  [style.border-color]="activity() === opt.value ? 'var(--v2-accent)' : 'var(--v2-rule)'"
                  [attr.aria-pressed]="activity() === opt.value"
                  (click)="activity.set(opt.value)">
                  <div class="v2-body">{{ t(opt.labelKey) }}</div>
                  <div class="v2-caption" style="margin-top: 2px;">{{ t(opt.blurbKey) }}</div>
                </button>
              }
            </div>
          </div>

          <!-- Pace -->
          <div>
            <span class="v2-caption block mb-1.5"
              style="text-transform: uppercase; letter-spacing: 0.08em;">
              {{ t('v2.refineTargets.pace') }}
            </span>
            <div class="grid grid-cols-5 gap-1.5">
              @for (opt of paceOptions; track opt) {
                <button
                  type="button"
                  class="v2-card text-center p-2 border-2"
                  [style.border-color]="pace() === opt ? 'var(--v2-accent)' : 'var(--v2-rule)'"
                  [attr.aria-pressed]="pace() === opt"
                  (click)="pace.set(opt)">
                  <span class="v2-body font-mono">{{ opt }}</span>
                  <div class="v2-caption">{{ t('v2.refineTargets.lbWeek') }}</div>
                </button>
              }
            </div>
          </div>

          <!-- Preview kcal target -->
          @if (previewKcal() != null) {
            <div class="v2-card flex items-center justify-between p-3" style="background: var(--v2-paper-2);">
              <span class="v2-caption">{{ t('v2.refineTargets.previewLabel') }}</span>
              <span class="v2-h3 font-mono">{{ previewKcal() }}</span>
            </div>
          }

          @if (saveError()) {
            <p class="v2-caption" role="alert" style="color: var(--v2-danger);">{{ saveError() }}</p>
          }

          <div class="flex gap-2 pt-2">
            <v2-button variant="ghost" type="button" (click)="onClose()">
              {{ t('v2.refineTargets.cancel') }}
            </v2-button>
            <v2-button
              type="submit"
              variant="primary"
              [block]="true"
              [disabled]="saving() || !isValid()">
              @if (saving()) { {{ t('v2.refineTargets.saving') }} }
              @else { {{ t('v2.refineTargets.save') }} }
            </v2-button>
          </div>
        </form>
      </v2-sheet>
    }
    </ng-container>
  `,
})
export class V2RefineTargetsSheet {
  private readonly fb = inject(FirebaseService);
  private readonly store = inject(FitnessStore);
  private readonly calc = inject(TdeeCalculatorService);
  private readonly translation = inject(TranslationService);

  readonly open = input<boolean>(false);
  readonly close = output<void>();
  readonly saved = output<void>();

  protected readonly sexOptions: { value: Sex; labelKey: string }[] = [
    { value: 'female', labelKey: 'v2.refineTargets.sexFemale' },
    { value: 'male', labelKey: 'v2.refineTargets.sexMale' },
  ];

  protected readonly activityOptions: { value: ActivityLevel; labelKey: string; blurbKey: string }[] = [
    { value: 'sedentary',   labelKey: 'v2.refineTargets.actSedentaryLabel',   blurbKey: 'v2.refineTargets.actSedentaryBlurb' },
    { value: 'light',       labelKey: 'v2.refineTargets.actLightLabel',       blurbKey: 'v2.refineTargets.actLightBlurb' },
    { value: 'moderate',    labelKey: 'v2.refineTargets.actModerateLabel',    blurbKey: 'v2.refineTargets.actModerateBlurb' },
    { value: 'active',      labelKey: 'v2.refineTargets.actActiveLabel',      blurbKey: 'v2.refineTargets.actActiveBlurb' },
    { value: 'very_active', labelKey: 'v2.refineTargets.actVeryActiveLabel',  blurbKey: 'v2.refineTargets.actVeryActiveBlurb' },
  ];

  protected readonly paceOptions: CutPace[] = [0, 0.5, 1.0, 1.5, 2.0];

  protected readonly sex = signal<Sex | null>(null);
  protected readonly ageInput = signal<number | null>(null);
  protected readonly heightFt = signal<number | null>(null);
  protected readonly heightInExtra = signal<number | null>(null);
  protected readonly activity = signal<ActivityLevel | null>(null);
  protected readonly pace = signal<CutPace | null>(null);
  protected readonly saving = signal(false);
  protected readonly saveError = signal<string | null>(null);

  protected readonly heightIn = computed(() => {
    const ft = this.heightFt();
    const inExtra = this.heightInExtra();
    if (ft == null) return null;
    return ft * 12 + (inExtra ?? 0);
  });

  protected readonly errors = computed(() => {
    const age = this.ageInput();
    const h = this.heightIn();
    return {
      age: age == null || age < 13 || age > 120,
      height: h == null || h < 40 || h > 96,
    };
  });

  protected readonly isValid = computed(() => {
    const e = this.errors();
    return this.sex() != null
      && !e.age
      && !e.height
      && this.activity() != null
      && this.pace() != null;
  });

  protected readonly previewKcal = computed(() => {
    if (!this.isValid()) return null;
    const w = this.store.currentWeight() ?? this.fb.profile()?.targetWeightLbs ?? null;
    if (w == null) return null;
    const result = this.calc.calculate([], {
      heightIn: this.heightIn()!,
      age: this.ageInput()!,
      sex: this.sex()!,
      activityLevel: this.activity()!,
      targetPaceLbsPerWeek: this.pace()!,
      goalWeightLbs: w,
    } as any);
    return result.newDailyTarget;
  });

  constructor() {
    // Reset form to current profile state every time the sheet opens
    // — the user may have entered partial data on a previous open.
    effect(() => {
      if (!this.open()) return;
      const p = this.fb.profile();
      this.sex.set((p?.sex as Sex | undefined) ?? null);
      this.ageInput.set(p?.age ?? null);
      const h = p?.heightIn;
      if (h != null) {
        this.heightFt.set(Math.floor(h / 12));
        this.heightInExtra.set(h % 12);
      } else {
        this.heightFt.set(null);
        this.heightInExtra.set(null);
      }
      this.activity.set((p?.activityLevel as ActivityLevel | undefined) ?? null);
      this.pace.set((p?.targetPaceLbsPerWeek as CutPace | undefined) ?? null);
      this.saving.set(false);
      this.saveError.set(null);
    });
  }

  protected onAgeInput(e: Event): void {
    const v = (e.target as HTMLInputElement).value;
    const n = v === '' ? null : Number(v);
    this.ageInput.set(Number.isFinite(n as number) ? (n as number) : null);
  }

  protected onHeightFtInput(e: Event): void {
    const v = (e.target as HTMLInputElement).value;
    const n = v === '' ? null : Number(v);
    this.heightFt.set(Number.isFinite(n as number) ? (n as number) : null);
  }

  protected onHeightInInput(e: Event): void {
    const v = (e.target as HTMLInputElement).value;
    const n = v === '' ? null : Number(v);
    this.heightInExtra.set(Number.isFinite(n as number) ? (n as number) : null);
  }

  protected async save(e: Event): Promise<void> {
    e.preventDefault();
    if (!this.isValid()) return;
    this.haptic(30);
    this.saving.set(true);
    this.saveError.set(null);
    try {
      await this.fb.saveRefinedTargets({
        heightIn: this.heightIn()!,
        age: this.ageInput()!,
        sex: this.sex()!,
        activityLevel: this.activity()!,
        targetPaceLbsPerWeek: this.pace()!,
      });
      this.saved.emit();
      this.close.emit();
    } catch {
      this.saveError.set(this.translation.t('v2.refineTargets.saveError'));
      this.saving.set(false);
    }
  }

  protected onClose(): void {
    this.close.emit();
  }

  private haptic(ms: number): void {
    try {
      if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
      navigator.vibrate?.(ms);
    } catch { /* ignore */ }
  }
}
