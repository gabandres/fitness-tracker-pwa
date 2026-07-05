import {
  ChangeDetectionStrategy, Component,
  computed, effect, inject, input, output, signal,
} from '@angular/core';
import {
  computeProtein, clampProteinPerKg, DEFAULT_PROTEIN_G_PER_KG,
} from '../../utils/macro-heuristic';
import { TranslocoDirective } from '@jsverse/transloco';
import { LEDGER_PORT } from '../../ledger/ports/ledger.port';
import { FitnessStore } from '../../services/fitness-store.service';
import { PushNotificationService } from '../../services/push-notification.service';
import { SubscriptionService } from '../../services/subscription.service';
import { TranslationService } from '../../services/translation.service';
import { AppLang } from '../../i18n/transloco.providers';
import { ThemeChoice } from '../../utils/theme';
import { UiCard } from '../ui/card.component';
import { UiButton } from '../ui/button.component';

/**
 * Settings · preferences section — the Language, Reminders, Appearance
 * (travel + theme), and Units cards. Owns every preference toggle's
 * state; the sheet shell only forwards `themeChoice` down and
 * `themeSelect` up (theme application lives in the App shell).
 */
@Component({
  selector: 'app-settings-preferences-section',
  standalone: true,
  imports: [TranslocoDirective, UiCard, UiButton],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <ng-container *transloco="let t">
      <!-- Language -->
      <ui-card variant="default" class="block mb-3">
        <h3 class="v2-h3 mb-1">{{ t('settings.language.section') }}</h3>
        <p class="v2-caption mb-3">{{ t('settings.language.desc') }}</p>
        <div class="grid grid-cols-2 gap-1 p-1" style="background: var(--v2-paper-2); border-radius: var(--v2-radius-md);">
          <button type="button"
            [attr.aria-pressed]="translation.language() === 'en'"
            (click)="selectLanguage('en')"
            [style.background]="translation.language() === 'en' ? 'var(--v2-ink)' : 'transparent'"
            [style.color]="translation.language() === 'en' ? 'var(--v2-paper)' : 'var(--v2-ink)'"
            style="border: none; border-radius: var(--v2-radius-sm); min-height: var(--v2-tap-min); font-weight: 600; font-size: 0.875rem; cursor: pointer;">
            {{ t('settings.language.english') }}
          </button>
          <button type="button"
            [attr.aria-pressed]="translation.language() === 'es-PR'"
            (click)="selectLanguage('es-PR')"
            [style.background]="translation.language() === 'es-PR' ? 'var(--v2-ink)' : 'transparent'"
            [style.color]="translation.language() === 'es-PR' ? 'var(--v2-paper)' : 'var(--v2-ink)'"
            style="border: none; border-radius: var(--v2-radius-sm); min-height: var(--v2-tap-min); font-weight: 600; font-size: 0.875rem; cursor: pointer;">
            {{ t('settings.language.spanish') }}
          </button>
        </div>
        @if (showEsBetaBanner()) {
          <p class="v2-caption mt-3 v2-active-highlight" role="status"
             style="padding: 8px 12px; border-radius: var(--v2-radius-sm);">
            {{ t('legal.esBetaBanner') }}
          </p>
        }
      </ui-card>

      <!-- Reminders -->
      <ui-card variant="default" class="block mb-3">
        <h3 class="v2-h3 mb-2">{{ t('settings.reminders.section') }}</h3>

        <div class="flex items-start justify-between gap-3 mb-4">
          <div class="min-w-0">
            <div class="v2-body" style="font-weight: 500;">{{ t('settings.reminders.push') }}</div>
            <p class="v2-caption mt-0.5">
              @switch (pushService.permission()) {
                @case ('granted') { {{ t('settings.reminders.pushOn') }} }
                @case ('unsupported') { {{ t('settings.reminders.pushUnsupported') }} }
                @case ('denied') { {{ t('settings.reminders.pushDenied') }} }
                @default { {{ t('settings.reminders.pushDefault') }} }
              }
            </p>
          </div>
          @if (pushService.permission() === 'granted') {
            <span class="v2-num shrink-0"
              style="font-size: 0.6875rem; color: var(--v2-sage); padding: 4px 10px; background: var(--v2-sage-soft); border-radius: 999px;">
              {{ t('settings.reminders.pushOnBadge') }}
            </span>
          } @else if (pushService.permission() === 'default') {
            <ui-button variant="secondary" size="sm" (click)="enablePush()">
              {{ t('settings.reminders.pushEnable') }}
            </ui-button>
          }
        </div>

        <div class="flex items-center justify-between gap-3">
          <div>
            <div class="v2-body" style="font-weight: 500;">{{ t('settings.reminders.hour') }}</div>
            <p class="v2-caption">{{ t('settings.reminders.hourDesc') }}</p>
          </div>
          <div class="flex items-center gap-2 shrink-0" [attr.aria-label]="t('settings.reminders.hourAria')">
            <button type="button" (click)="setReminderHour((reminderHour() + 23) % 24)"
              [attr.aria-label]="t('settings.reminders.hour') + ' −'"
              style="width: 32px; height: 32px; border-radius: 999px; border: 1px solid var(--v2-rule); background: var(--v2-paper-2); color: var(--v2-ink); font-weight: 700; cursor: pointer;">−</button>
            <span class="v2-num" style="min-width: 64px; text-align: center; font-weight: 600; color: var(--v2-ink);">{{ formatHour(reminderHour()) }}</span>
            <button type="button" (click)="setReminderHour((reminderHour() + 1) % 24)"
              [attr.aria-label]="t('settings.reminders.hour') + ' +'"
              style="width: 32px; height: 32px; border-radius: 999px; border: 1px solid var(--v2-rule); background: var(--v2-paper-2); color: var(--v2-ink); font-weight: 700; cursor: pointer;">+</button>
          </div>
        </div>

        <p class="v2-caption mt-3">
          {{ t('settings.reminders.utcHint') }}
        </p>

        <div class="flex items-start justify-between gap-3 mt-4 pt-4"
          style="border-top: 1px solid var(--v2-rule);">
          <div class="min-w-0">
            <div class="v2-body" style="font-weight: 500;">{{ t('settings.reminders.weeklyDigest') }}</div>
            <p class="v2-caption mt-0.5">{{ t('settings.reminders.weeklyDigestDesc') }}</p>
          </div>
          <ui-button
            [variant]="weeklyDigestOptIn() ? 'primary' : 'ghost'"
            size="sm"
            (click)="toggleWeeklyDigest()"
            [disabled]="weeklyDigestBusy()"
            [ariaLabel]="weeklyDigestOptIn() ? t('settings.reminders.weeklyDigestAriaOff') : t('settings.reminders.weeklyDigestAriaOn')">
            {{ weeklyDigestOptIn() ? t('settings.reminders.weeklyDigestOn') : t('settings.reminders.weeklyDigestOff') }}
          </ui-button>
        </div>
      </ui-card>

      <!-- Appearance (Theme) — 3-option ink-fill segmented, mirrors mobile -->
      <ui-card variant="default" class="block mb-3">
        <h3 class="v2-h3 mb-3">{{ t('settings.modes.section') }}</h3>
        <div role="radiogroup" [attr.aria-label]="t('settings.modes.themeAriaGroup')"
             class="grid grid-cols-3 gap-1 p-1" style="background: var(--v2-paper-2); border-radius: var(--v2-radius-md);">
          @for (opt of themeOptions; track opt.value) {
            <button type="button" role="radio"
              [attr.aria-checked]="themeChoice() === opt.value"
              (click)="chooseTheme(opt.value)"
              [style.background]="themeChoice() === opt.value ? 'var(--v2-ink)' : 'transparent'"
              [style.color]="themeChoice() === opt.value ? 'var(--v2-paper)' : 'var(--v2-ink)'"
              style="border: none; border-radius: var(--v2-radius-sm); min-height: var(--v2-tap-min); font-weight: 600; font-size: 0.875rem; cursor: pointer;">
              {{ t(opt.labelKey) }}
            </button>
          }
        </div>
      </ui-card>

      <!-- Units (drives the food-search portion picker default). -->
      <ui-card variant="default" class="block mb-3">
        <h3 class="v2-h3 mb-1">{{ t('settings.units.section') }}</h3>
        <p class="v2-caption mb-3">{{ t('settings.units.desc') }}</p>
        <div role="radiogroup" [attr.aria-label]="t('settings.units.aria')"
             class="grid grid-cols-2 gap-1 p-1" style="background: var(--v2-paper-2); border-radius: var(--v2-radius-md);">
          <button type="button" role="radio"
            [attr.aria-checked]="unitSystem() === 'us'"
            (click)="chooseUnits('us')"
            [style.background]="unitSystem() === 'us' ? 'var(--v2-ink)' : 'transparent'"
            [style.color]="unitSystem() === 'us' ? 'var(--v2-paper)' : 'var(--v2-ink)'"
            style="border: none; border-radius: var(--v2-radius-sm); min-height: var(--v2-tap-min); font-weight: 600; font-size: 0.875rem; cursor: pointer;">
            {{ t('settings.units.us') }}
          </button>
          <button type="button" role="radio"
            [attr.aria-checked]="unitSystem() === 'metric'"
            (click)="chooseUnits('metric')"
            [style.background]="unitSystem() === 'metric' ? 'var(--v2-ink)' : 'transparent'"
            [style.color]="unitSystem() === 'metric' ? 'var(--v2-paper)' : 'var(--v2-ink)'"
            style="border: none; border-radius: var(--v2-radius-sm); min-height: var(--v2-tap-min); font-weight: 600; font-size: 0.875rem; cursor: pointer;">
            {{ t('settings.units.metric') }}
          </button>
        </div>
        @if (unitsError()) {
          <p class="v2-caption mt-2" role="alert" style="color: var(--v2-danger)">
            {{ t('settings.units.saveError') }}
          </p>
        }
      </ui-card>

      <!-- Protein target basis (g/kg). -->
      <ui-card variant="default" class="block mb-3">
        <h3 class="v2-h3 mb-1">{{ t('settings.protein.section') }}</h3>
        <p class="v2-caption mb-3">{{ t('settings.protein.desc') }}</p>
        <div class="flex items-center gap-3">
          <ui-button variant="ghost" size="sm"
            [disabled]="proteinBusy() || proteinPerKg() <= 1.6"
            [ariaLabel]="t('settings.protein.dec')"
            (click)="stepProtein(-0.1)">−</ui-button>
          <div class="text-center" style="flex: 1;">
            <span class="v2-h3 font-mono">{{ proteinPerKg().toFixed(1) }}</span>
            <span class="v2-caption"> g/kg</span>
            @if (proteinGrams() != null) {
              <div class="v2-caption">≈ {{ proteinGrams() }} g/day</div>
            }
          </div>
          <ui-button variant="ghost" size="sm"
            [disabled]="proteinBusy() || proteinPerKg() >= 2.2"
            [ariaLabel]="t('settings.protein.inc')"
            (click)="stepProtein(0.1)">+</ui-button>
        </div>
        @if (proteinError()) {
          <p class="v2-caption mt-2" role="alert" style="color: var(--v2-danger)">
            {{ t('settings.protein.saveError') }}
          </p>
        }
      </ui-card>

      <!-- Cut pace (lb/week) — continuous slider. Drives the measured-mode
           deficit; set lower for a lean cut, 0 = maintenance. -->
      <ui-card variant="default" class="block mb-3">
        <h3 class="v2-h3 mb-1">{{ t('settings.pace.section') }}</h3>
        <p class="v2-caption mb-3">{{ t('settings.pace.desc') }}</p>
        <div class="flex items-baseline justify-between mb-1">
          <span class="v2-h3 font-mono">{{ pace().toFixed(1) }}</span>
          <span class="v2-caption">{{ t('settings.pace.lbWeek') }}</span>
        </div>
        <input type="range" min="0" max="2" step="0.1" class="v2-range" style="width: 100%;"
          [value]="pace()" [attr.aria-label]="t('settings.pace.section')"
          (input)="onPaceInput($event)" (change)="savePace()" />
        <div class="flex justify-between v2-caption" style="font-size: 0.7rem;">
          <span>{{ t('settings.pace.maintain') }}</span>
          <span>2.0</span>
        </div>
        @if (paceError()) {
          <p class="v2-caption mt-2" role="alert" style="color: var(--v2-danger)">
            {{ t('settings.pace.saveError') }}
          </p>
        }
      </ui-card>

      <!-- Calorie floor (kcal) — safety clamp. The daily target never drops
           below this, even when a water-suppressed measured TDEE would push it
           lower. Default 1500. -->
      <ui-card variant="default" class="block mb-3">
        <h3 class="v2-h3 mb-1">{{ t('settings.calorieFloor.section') }}</h3>
        <p class="v2-caption mb-3">{{ t('settings.calorieFloor.desc') }}</p>
        <div class="flex items-center gap-3">
          <ui-button variant="ghost" size="sm"
            [disabled]="calorieFloorBusy() || calorieFloor() <= CALORIE_FLOOR_MIN"
            [ariaLabel]="t('settings.calorieFloor.dec')"
            (click)="stepCalorieFloor(-50)">−</ui-button>
          <div class="text-center" style="flex: 1;">
            <span class="v2-h3 font-mono">{{ calorieFloor() }}</span>
            <span class="v2-caption"> {{ t('settings.calorieFloor.unit') }}</span>
          </div>
          <ui-button variant="ghost" size="sm"
            [disabled]="calorieFloorBusy() || calorieFloor() >= CALORIE_FLOOR_MAX"
            [ariaLabel]="t('settings.calorieFloor.inc')"
            (click)="stepCalorieFloor(50)">+</ui-button>
        </div>
        @if (calorieFloorError()) {
          <p class="v2-caption mt-2" role="alert" style="color: var(--v2-danger)">
            {{ t('settings.calorieFloor.saveError') }}
          </p>
        }
      </ui-card>
    </ng-container>
  `,
})
export class SettingsPreferencesSectionComponent {
  protected readonly firebase = inject(LEDGER_PORT);
  protected readonly store = inject(FitnessStore);
  protected readonly pushService = inject(PushNotificationService);
  protected readonly subs = inject(SubscriptionService);
  protected readonly translation = inject(TranslationService);

  readonly themeChoice = input.required<ThemeChoice>();
  readonly themeSelect = output<ThemeChoice>();

  protected readonly isPaid = computed(() => this.subs.isPaid());
  protected readonly reminderHours = Array.from({ length: 24 }, (_, i) => i);
  protected readonly reminderHour = computed(() => (this.firebase.profile() as any)?.reminderHour ?? 20);
  protected readonly showEsBetaBanner = computed(() => this.translation.language() === 'es-PR');

  // Mobile ships three themes only: System / Light / Dark. The Pro palettes
  // (sepia/graphite/oxblood) + travel mode were web-only and are dropped.
  protected readonly themeOptions: ReadonlyArray<{
    value: ThemeChoice; labelKey: string;
  }> = [
    { value: 'auto',  labelKey: 'settings.modes.themeAuto' },
    { value: 'light', labelKey: 'settings.modes.themeLightOpt' },
    { value: 'dark',  labelKey: 'settings.modes.themeDarkOpt' },
  ];

  protected chooseTheme(v: ThemeChoice): void { this.themeSelect.emit(v); }
  protected selectLanguage(lang: AppLang): void { this.translation.setLanguage(lang); }

  protected async enablePush(): Promise<void> {
    const token = await this.pushService.requestPermissionAndGetToken();
    if (token) await this.firebase.saveFcmToken(token);
  }

  protected async setReminderHour(hour: number): Promise<void> {
    await this.firebase.saveReminderHour(hour);
  }

  protected formatHour(h: number): string {
    if (h === 0) return '12 AM';
    if (h < 12) return `${h} AM`;
    if (h === 12) return '12 PM';
    return `${h - 12} PM`;
  }

  // ─── Weekly digest opt-in ───────────────────────────────────
  protected readonly weeklyDigestOptIn = computed<boolean>(() => {
    const profile = this.firebase.profile() as { weeklyDigestOptIn?: boolean } | null;
    return profile?.weeklyDigestOptIn === true;
  });
  protected readonly weeklyDigestBusy = signal(false);

  protected async toggleWeeklyDigest(): Promise<void> {
    if (this.weeklyDigestBusy()) return;
    this.weeklyDigestBusy.set(true);
    try {
      await this.firebase.setWeeklyDigestOptIn(!this.weeklyDigestOptIn());
    } finally {
      this.weeklyDigestBusy.set(false);
    }
  }

  // ─── Unit system (food-search portion picker default) ───────
  protected readonly unitSystem = computed<'us' | 'metric'>(() => {
    const profile = this.firebase.profile() as { unitSystem?: 'us' | 'metric' } | null;
    return profile?.unitSystem ?? 'us';
  });
  protected readonly unitsBusy = signal(false);
  protected readonly unitsError = signal(false);

  protected async chooseUnits(system: 'us' | 'metric'): Promise<void> {
    if (this.unitSystem() === system || this.unitsBusy()) return;
    this.unitsBusy.set(true);
    this.unitsError.set(false);
    try {
      await this.firebase.setUnitSystem(system);
    } catch (err) {
      // Silent failure would leave the radio looking unresponsive —
      // surface it so the user can retry or check connectivity.
      console.error('setUnitSystem failed:', err);
      this.unitsError.set(true);
    } finally {
      this.unitsBusy.set(false);
    }
  }

  // ─── Protein basis (g/kg) ───────────────────────────────────
  /** Local editing copy, seeded from the profile and re-synced whenever it
   *  loads/changes (unless the user is mid-edit). Stepping persists each
   *  change via setProteinPerKg. */
  protected readonly proteinPerKg = signal<number>(DEFAULT_PROTEIN_G_PER_KG);
  protected readonly proteinBusy = signal(false);
  protected readonly proteinError = signal(false);

  // ─── Cut pace (lb/week) ─────────────────────────────────────
  /** Local slider copy, seeded from the profile and re-synced on load
   *  (unless mid-drag). Persisted on release via setTargetPace. */
  protected readonly pace = signal<number>(1.0);
  protected readonly paceBusy = signal(false);
  protected readonly paceError = signal(false);

  // ─── Calorie floor (kcal safety clamp) ──────────────────────
  /** Local stepper copy, seeded from the profile (default 1500 when unset)
   *  and re-synced on load unless mid-edit. Persisted per step via
   *  saveCalorieFloor. Bounds keep it in a medically-sane band. */
  protected readonly CALORIE_FLOOR_MIN = 1200;
  protected readonly CALORIE_FLOOR_MAX = 3000;
  protected readonly DEFAULT_CALORIE_FLOOR = 1500;
  protected readonly calorieFloor = signal<number>(this.DEFAULT_CALORIE_FLOOR);
  protected readonly calorieFloorBusy = signal(false);
  protected readonly calorieFloorError = signal(false);

  protected readonly proteinGrams = computed(() => {
    const w = this.store.currentWeight();
    return w ? computeProtein(w, this.proteinPerKg()) : null;
  });

  constructor() {
    effect(() => {
      const stored = (this.firebase.profile() as { proteinPerKg?: number } | null)?.proteinPerKg;
      if (!this.proteinBusy() && stored != null) this.proteinPerKg.set(stored);
    });
    effect(() => {
      const stored = (this.firebase.profile() as { targetPaceLbsPerWeek?: number } | null)?.targetPaceLbsPerWeek;
      if (!this.paceBusy() && stored != null) this.pace.set(stored);
    });
    effect(() => {
      const stored = (this.firebase.profile() as { calorieFloor?: number } | null)?.calorieFloor;
      if (!this.calorieFloorBusy()) this.calorieFloor.set(stored ?? this.DEFAULT_CALORIE_FLOOR);
    });
  }

  protected onPaceInput(e: Event): void {
    this.paceBusy.set(true); // hold profile re-sync while dragging
    this.pace.set(Number((e.target as HTMLInputElement).value));
  }

  /** Persist on slider release (the `change` event) so we write once, not
   *  on every drag tick. */
  protected async savePace(): Promise<void> {
    this.paceError.set(false);
    try {
      await this.firebase.setTargetPace(this.pace());
    } catch (err) {
      console.error('setTargetPace failed:', err);
      this.paceError.set(true);
    } finally {
      this.paceBusy.set(false);
    }
  }

  protected async stepProtein(delta: number): Promise<void> {
    if (this.proteinBusy()) return;
    const next = clampProteinPerKg(Math.round((this.proteinPerKg() + delta) * 10) / 10);
    if (next === this.proteinPerKg()) return;
    this.proteinPerKg.set(next);
    this.proteinBusy.set(true);
    this.proteinError.set(false);
    try {
      await this.firebase.setProteinPerKg(next);
    } catch (err) {
      console.error('setProteinPerKg failed:', err);
      this.proteinError.set(true);
    } finally {
      this.proteinBusy.set(false);
    }
  }

  protected async stepCalorieFloor(delta: number): Promise<void> {
    if (this.calorieFloorBusy()) return;
    const next = Math.max(
      this.CALORIE_FLOOR_MIN,
      Math.min(this.CALORIE_FLOOR_MAX, this.calorieFloor() + delta),
    );
    if (next === this.calorieFloor()) return;
    this.calorieFloor.set(next);
    this.calorieFloorBusy.set(true);
    this.calorieFloorError.set(false);
    try {
      await this.firebase.saveCalorieFloor(next);
    } catch (err) {
      console.error('saveCalorieFloor failed:', err);
      this.calorieFloorError.set(true);
    } finally {
      this.calorieFloorBusy.set(false);
    }
  }
}
