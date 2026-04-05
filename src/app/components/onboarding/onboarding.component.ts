import { ChangeDetectionStrategy, Component, computed, inject, input, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import {
  FirebaseService,
  ActivityLevel,
  CutPace,
  ProfileFields,
  Sex,
} from '../../services/firebase.service';

type Status = 'idle' | 'saving' | 'error';

interface ActivityOption {
  value: ActivityLevel;
  label: string;
  blurb: string;
}

interface PaceOption {
  value: CutPace;
  label: string;
  blurb: string;
}

@Component({
  selector: 'app-onboarding',
  standalone: true,
  imports: [FormsModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section>
      <div class="specimen px-5 py-8 sm:px-7 sm:py-10 relative">
        <span class="crop-bl"></span><span class="crop-br"></span>

        <!-- Header -->
        <div class="flex items-center gap-3 mb-1">
          <span class="stamp-mark">{{ editMode() ? 'amend' : 'intake' }}</span>
          <span class="data-label">field form &middot; 001</span>
        </div>
        <h2 class="font-display text-3xl sm:text-4xl leading-[0.95] text-ink mt-3">
          {{ editMode() ? 'Amend your' : 'Before we' }}<br/>
          <em class="text-blood">{{ editMode() ? 'particulars.' : 'begin.' }}</em>
        </h2>
        <p class="caption mt-4 text-[11px] leading-relaxed">
          the calibration engine needs a baseline. five questions, kept on
          your record only. you can amend any of these later.
        </p>

        <form (ngSubmit)="submit()" class="mt-8 space-y-9">
          <!-- 1. Height (ft + in) -->
          <div>
            <label class="data-label block mb-2">i. height</label>
            <div class="flex items-baseline gap-4">
              <div class="flex items-baseline gap-2 flex-1">
                <input
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
                <span class="font-display italic text-graphite text-sm">ft</span>
              </div>
              <div class="flex items-baseline gap-2 flex-1">
                <input
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
                <span class="font-display italic text-graphite text-sm">in</span>
              </div>
            </div>
          </div>

          <!-- 2. Age -->
          <div>
            <label for="age" class="data-label block mb-2">ii. age</label>
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
              <span class="font-display italic text-graphite text-sm">years</span>
            </div>
          </div>

          <!-- 3. Biological sex -->
          <div>
            <label class="data-label block mb-2">iii. biological sex</label>
            <p class="caption text-[10px] mb-2">
              required by the mifflin-st jeor formula to estimate your baseline metabolic rate.
            </p>
            <div class="flex gap-3">
              @for (opt of sexOptions; track opt.value) {
                <button
                  type="button"
                  (click)="sex.set(opt.value)"
                  [class.selected]="sex() === opt.value"
                  class="radio-card flex-1"
                >
                  {{ opt.label }}
                </button>
              }
            </div>
          </div>

          <!-- 4. Activity level -->
          <div>
            <label class="data-label block mb-2">iv. activity level</label>
            <div class="space-y-2">
              @for (opt of activityOptions; track opt.value) {
                <button
                  type="button"
                  (click)="activityLevel.set(opt.value)"
                  [class.selected]="activityLevel() === opt.value"
                  class="radio-card w-full text-left"
                >
                  <div class="flex items-baseline justify-between gap-3">
                    <span class="font-mono text-xs tracking-[0.15em] uppercase text-ink">{{ opt.label }}</span>
                  </div>
                  <div class="font-display italic text-graphite text-[11px] mt-1 normal-case tracking-normal">
                    {{ opt.blurb }}
                  </div>
                </button>
              }
            </div>
          </div>

          <!-- 5. Cut pace -->
          <div>
            <label class="data-label block mb-2">v. cut pace</label>
            <p class="caption text-[10px] mb-2">
              how aggressively to run the deficit. faster is harder to sustain.
            </p>
            <div class="grid grid-cols-2 gap-2">
              @for (opt of paceOptions; track opt.value) {
                <button
                  type="button"
                  (click)="pace.set(opt.value)"
                  [class.selected]="pace() === opt.value"
                  class="radio-card"
                >
                  <div class="font-mono text-xs tracking-[0.15em] uppercase text-ink">{{ opt.label }}</div>
                  <div class="font-display italic text-graphite text-[10px] mt-0.5 normal-case tracking-normal">
                    {{ opt.blurb }}
                  </div>
                </button>
              }
            </div>
          </div>

          <!-- Optional: Goal weight -->
          <div>
            <label for="goalWeight" class="data-label block mb-2">
              vi. goal weight <span class="normal-case italic text-graphite tracking-normal text-[11px]">(optional)</span>
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
              <span class="font-display italic text-graphite text-sm">lbs</span>
            </div>
          </div>

          <!-- Submit -->
          <div class="pt-3">
            <button
              type="submit"
              [disabled]="!canSubmit() || status() === 'saving'"
              class="stamp-btn"
            >
              @if (status() === 'saving') {
                <span>filing…</span>
              } @else {
                <span>{{ editMode() ? 'save changes' : 'commit profile' }}</span>
              }
            </button>

            @if (editMode()) {
              <button
                type="button"
                (click)="cancelled.emit()"
                class="tag-btn w-full mt-3 justify-center"
              >
                cancel
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

  protected readonly sexOptions: { value: Sex; label: string }[] = [
    { value: 'male',   label: 'male'   },
    { value: 'female', label: 'female' },
  ];

  protected readonly activityOptions: ActivityOption[] = [
    { value: 'sedentary',   label: 'sedentary',   blurb: 'desk job, little or no exercise' },
    { value: 'light',       label: 'light',       blurb: 'light exercise 1–3 days/week' },
    { value: 'moderate',    label: 'moderate',    blurb: 'moderate exercise 3–5 days/week' },
    { value: 'active',      label: 'active',      blurb: 'hard exercise 6–7 days/week' },
    { value: 'very_active', label: 'very active', blurb: 'physical job or twice-daily training' },
  ];

  protected readonly paceOptions: PaceOption[] = [
    { value: 0.5, label: '0.5 lb / wk', blurb: 'leisurely'   },
    { value: 1.0, label: '1 lb / wk',   blurb: 'steady'      },
    { value: 1.5, label: '1.5 lb / wk', blurb: 'brisk'       },
    { value: 2.0, label: '2 lb / wk',   blurb: 'aggressive'  },
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
    if (!this.canSubmit()) return;

    const ft = Number(this.heightFt());
    const extra = Number(this.heightInExtra());
    const totalInches = ft * 12 + extra;

    if (totalInches < 40 || totalInches > 96) {
      this.status.set('error');
      this.errorMsg.set('Height must be between 3\'4" and 8\'.');
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
      this.errorMsg.set(err instanceof Error ? err.message : 'Failed to save profile.');
    }
  }
}
