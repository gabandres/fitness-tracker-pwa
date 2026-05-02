import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  output,
  signal,
} from '@angular/core';
import { LucideAngularModule } from 'lucide-angular';
import { TranslocoDirective } from '@jsverse/transloco';
import { FitnessStore } from '../../services/fitness-store.service';
import { LEDGER_PORT } from '../../ledger/ports/ledger.port';
import { EntryFormManager } from '../../services/entry-form-manager.service';
import { TranslationService } from '../../services/translation.service';
import { PushNotificationService } from '../../services/push-notification.service';
import { FirebaseService } from '../../services/firebase.service';
import { AnalyticsService } from '../../services/analytics.service';
import { localDateKey } from '../../utils/date';
import { bcp47ForLang } from '../../utils/locale';
import { V2Button } from '../ui/button.component';
import { V2IconButton } from '../ui/icon-button.component';
import { V2Card } from '../ui/card.component';
import { V2Fab } from '../ui/fab.component';
import { V2DaySummary } from '../ui/day-summary.component';
import { V2FastingPill } from '../ui/fasting-pill.component';
import { V2RefineTargetsSheet } from '../refine-targets-sheet-v2/refine-targets-sheet-v2.component';

/**
 * v2 Today screen. Owns the today-only chrome (header, day-0 hero,
 * repeat-yesterday, undo-delete toast, FAB) and delegates the rings +
 * entries + water + exercise block to <v2-day-summary>, which is also
 * reused by day-detail-v2 for past days.
 */
@Component({
  selector: 'app-today-v2',
  standalone: true,
  imports: [
    LucideAngularModule,
    TranslocoDirective,
    V2Button,
    V2IconButton,
    V2Card,
    V2Fab,
    V2DaySummary,
    V2FastingPill,
    V2RefineTargetsSheet,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <ng-container *transloco="let t">
    <section class="max-w-[640px] mx-auto px-5 sm:px-6 pb-32 md:pb-28">
      <!-- Header -->
      <header class="flex items-start justify-between gap-4 pt-6 pb-2">
        <div>
          <h1 class="v2-h1 v2-h1--hero">{{ t('v2.today.title') }}</h1>
          <p class="v2-caption mt-0.5">{{ dateLabel() }}</p>
          @if (streak() >= 2) {
            <div class="flex items-center gap-1.5 mt-2 v2-caption" style="color: var(--v2-accent)">
              <lucide-icon name="flame" [size]="14" />
              <span>{{ t('v2.today.dayStreak', { n: streak() }) }}</span>
            </div>
          }
        </div>
        <div class="flex items-center gap-2 shrink-0">
          <v2-fasting-pill (bodyRequested)="bodyRequested.emit()" />
          <v2-icon-button
            icon="calendar"
            [ariaLabel]="t('v2.today.historyAria')"
            (click)="historyRequested.emit()" />
          <v2-icon-button
            icon="settings"
            [ariaLabel]="t('v2.today.settingsAria')"
            (click)="settingsRequested.emit()" />
        </div>
      </header>

      @if (showDay0Hero()) {
        <!-- Day 0 hero — replaces rings until first entry. -->
        <v2-card variant="accent" class="mt-6 block text-center">
          <h2 class="v2-h2">{{ t('v2.today.day0Title') }}</h2>
          <p class="v2-body-soft mt-2">
            {{ t('v2.today.day0Body') }}
          </p>
          <div class="mt-5">
            <v2-button variant="primary" size="lg" [block]="true" (click)="addFood()">
              <lucide-icon name="plus" [size]="18" />
              {{ t('v2.today.addFood') }}
            </v2-button>
          </div>
          <p class="v2-caption mt-4">
            {{ t('v2.today.day0Targets', { kcal: kcalTarget(), protein: proteinTargetG() }) }}
          </p>
        </v2-card>
      } @else {
        <v2-day-summary [dateKey]="todayKey()" />
      }

      <!-- Day-3 "Refine targets" coach card — surfaces once the user has
           ≥3 unique logged days and is still on the 2-Q heuristic. Tapping
           opens the full Mifflin-St Jeor sheet; saving the sheet stamps
           targetsRefinedAt and the card never returns. -->
      @if (showRefineCard()) {
        <v2-card class="mt-6 block">
          <h2 class="v2-h3">{{ t('v2.refineTargets.cardTitle') }}</h2>
          <p class="v2-body-soft mt-1.5">{{ t('v2.refineTargets.cardBody') }}</p>
          <div class="mt-3 flex gap-2">
            <v2-button variant="primary" size="md" (click)="openRefineSheet()">
              {{ t('v2.refineTargets.cardCta') }}
            </v2-button>
            <v2-button variant="ghost" size="md" (click)="dismissRefineCard()">
              {{ t('v2.refineTargets.cardDismiss') }}
            </v2-button>
          </div>
        </v2-card>
      }

      <!-- Repeat-yesterday — only when today is empty + yesterday has entries -->
      @if (canRepeatYesterday()) {
        <div class="mt-6">
          <v2-button variant="secondary" [block]="true" (click)="repeatYesterday()">
            <lucide-icon name="check" [size]="16" />
            {{ t('v2.today.repeatYesterday') }}
          </v2-button>
        </div>
      }

      <!-- iOS install hint — only iOS Safari, not already installed,
           not dismissed. Closes the iOS gap until we ship a native
           app: iOS web push requires the user to install to home
           screen first, which most users will never do without
           prompting. Step-by-step copy uses the actual Share / Add
           to Home Screen wording so non-technical users follow. -->
      @if (showIosInstall()) {
        <v2-card class="mt-6 block">
          <h2 class="v2-h3">{{ t('v2.today.iosInstallTitle') }}</h2>
          <p class="v2-body-soft mt-1.5">{{ t('v2.today.iosInstallBody') }}</p>
          <ol class="v2-body-soft mt-3" style="font-size: 0.875rem; padding-left: 1.25rem; list-style: decimal; line-height: 1.7;">
            <li>{{ t('v2.today.iosInstallStep1') }}</li>
            <li>{{ t('v2.today.iosInstallStep2') }}</li>
            <li>{{ t('v2.today.iosInstallStep3') }}</li>
          </ol>
          <div class="mt-3 flex gap-2">
            <v2-button variant="ghost" size="md" (click)="dismissIosInstall()">
              {{ t('v2.today.iosInstallDismiss') }}
            </v2-button>
          </div>
        </v2-card>
      }

      <!-- Post-first-entry push prompt — surfaces once after the user
           logs at least one meal, native notifications are supported,
           permission hasn't been answered yet, and the user hasn't
           already dismissed it locally. Single-tap enable: requests
           permission, saves token + a default 8 PM reminder hour. -->
      @if (showPushPrompt()) {
        <v2-card class="mt-6 block">
          <h2 class="v2-h3">{{ t('v2.today.pushPromptTitle') }}</h2>
          <p class="v2-body-soft mt-1.5">{{ t('v2.today.pushPromptBody') }}</p>
          <div class="mt-3 flex gap-2">
            <v2-button variant="primary" size="md" [disabled]="pushEnabling()" (click)="enablePush()">
              {{ pushEnabling() ? t('v2.today.pushPromptEnabling') : t('v2.today.pushPromptEnable') }}
            </v2-button>
            <v2-button variant="ghost" size="md" (click)="dismissPushPrompt()">
              {{ t('v2.today.pushPromptDismiss') }}
            </v2-button>
          </div>
          @if (pushError(); as e) {
            <p class="v2-caption mt-2" role="alert" style="color: var(--v2-danger);">{{ e }}</p>
          }
        </v2-card>
      }

      <!-- Undo-delete toast (auto-dismisses via store) -->
      @if (store.undoEntry(); as undo) {
        <div
          class="fixed left-1/2 -translate-x-1/2 z-40 flex items-center gap-3 px-4 py-2.5"
          style="bottom: calc(80px + env(safe-area-inset-bottom)); background: var(--v2-ink); color: var(--v2-paper); border-radius: var(--v2-radius-full); box-shadow: var(--v2-shadow-2);"
          role="status"
          aria-live="polite">
          <span class="v2-body" style="color: inherit;">
            {{ t('v2.today.deleted', { label: undo.mealLabel || t('v2.today.deletedFallback') }) }}
          </span>
          <button
            type="button"
            class="v2-btn v2-btn--sm"
            style="background: transparent; color: var(--v2-paper); border-color: rgba(255,255,255,0.3); font-weight: 600;"
            (click)="undoDelete()">
            {{ t('v2.today.undo') }}
          </button>
        </div>
      }
    </section>

    <!-- FAB — hidden on day 0 (in-card button is the only affordance). -->
    @if (!showDay0Hero()) {
      <v2-fab icon="plus" [ariaLabel]="t('v2.today.addFoodAria')" (click)="addFood()" />
    }

    <v2-refine-targets-sheet
      [open]="showRefineSheet()"
      (close)="showRefineSheet.set(false)" />
    </ng-container>
  `,
})
export class TodayV2Component {
  protected readonly store = inject(FitnessStore);
  protected readonly profile = inject(LEDGER_PORT);
  private readonly entryForm = inject(EntryFormManager);
  private readonly translation = inject(TranslationService);
  private readonly push = inject(PushNotificationService);
  private readonly fb = inject(FirebaseService);
  private readonly analytics = inject(AnalyticsService);

  readonly historyRequested = output<void>();
  readonly settingsRequested = output<void>();
  readonly bodyRequested = output<void>();

  protected readonly todayKey = signal(localDateKey(new Date()));

  protected readonly showDay0Hero = computed(
    () => this.store.logs().length === 0 && this.store.status() === 'ready',
  );

  protected readonly streak = computed(() => this.store.streak());
  protected readonly kcalTarget = computed(() => this.store.targetCalories());
  protected readonly proteinTargetG = computed(() => this.store.proteinTarget());

  protected readonly showRefineSheet = signal(false);
  /** Locally remembered "Not now" — kept in localStorage so the dismiss
   *  survives reloads without a Firestore round-trip. Saving the sheet
   *  stamps `targetsRefinedAt` server-side; that's the permanent latch. */
  private readonly REFINE_DISMISS_KEY = 'macrolog.refine-targets-dismissed';
  protected readonly refineDismissedLocal = signal(
    typeof localStorage !== 'undefined' && !!localStorage.getItem(this.REFINE_DISMISS_KEY),
  );

  protected readonly showRefineCard = computed(() => {
    const profile = this.store.profile();
    if (!profile) return false;
    // Only nudge users who came through the 2-Q heuristic and haven't
    // already refined. Anyone who opens this sheet flips
    // `targetsRefinedAt` and the card never returns.
    if (profile.targetsRefinedAt != null) return false;
    if (profile.manualCaloriesTarget == null) return false;
    if (this.refineDismissedLocal()) return false;
    // Need 3+ unique logged days. Read `allTimeLogs()` (full history for
    // Pro, 90-day window for free) rather than `logs()` (a 14-ROW cap):
    // a heavy logger with many entries per day can fill `logs()` with 2
    // calendar days, which would never trip the gate.
    const dayKeys = new Set(this.store.allTimeLogs().map((l) => localDateKey(l.date)));
    return dayKeys.size >= 3;
  });

  protected readonly canRepeatYesterday = computed(() => {
    const today = this.todayKey();
    const todayHas = this.store.logs().some((l) => localDateKey(l.date) === today);
    if (todayHas) return false;
    const y = new Date();
    y.setDate(y.getDate() - 1);
    const yKey = localDateKey(y);
    return this.store.logs().some((l) => localDateKey(l.date) === yKey);
  });

  protected readonly dateLabel = computed(() => {
    const d = new Date();
    const locale = bcp47ForLang(this.translation.language());
    return d.toLocaleDateString(locale, {
      weekday: 'long',
      month: 'long',
      day: 'numeric',
    });
  });

  protected addFood(): void {
    this.haptic(10);
    this.entryForm.startAdd();
  }

  protected openRefineSheet(): void {
    this.haptic(10);
    this.showRefineSheet.set(true);
  }

  protected dismissRefineCard(): void {
    this.haptic(10);
    try { localStorage.setItem(this.REFINE_DISMISS_KEY, '1'); } catch { /* ignore */ }
    this.refineDismissedLocal.set(true);
  }

  // ─── Post-first-entry push prompt ──────────────────────────────
  /** Local "No thanks" latch — survives reload so we don't badger
   *  users who declined. The browser's `denied` permission state is its
   *  own permanent latch; this one covers the "default" case where the
   *  user clicked Dismiss without ever opening the system dialog. */
  private readonly PUSH_DISMISS_KEY = 'macrolog.push-prompt-dismissed';
  protected readonly pushPromptDismissedLocal = signal(
    typeof localStorage !== 'undefined' && !!localStorage.getItem(this.PUSH_DISMISS_KEY),
  );
  protected readonly pushEnabling = signal(false);
  protected readonly pushError = signal<string | null>(null);
  /** Default reminder hour to set on opt-in (8 PM, matching the Firestore
   *  rules default). User can change this in Settings later. */
  private static readonly DEFAULT_REMINDER_HOUR = 20;

  protected readonly showPushPrompt = computed(() => {
    if (this.pushPromptDismissedLocal()) return false;
    if (this.store.logs().length === 0) return false;
    if (this.push.permission() !== 'default') return false;
    // Profile must be loaded — saveFcmToken / saveReminderHour will
    // throw if there's no signed-in uid yet.
    if (!this.store.profile()) return false;
    return true;
  });

  /** One-shot impression event so we can compute conversion against the
   *  enabled / denied actions. Without `_shown` there's no denominator
   *  in the funnel and the prompt's effectiveness can't be measured. */
  private pushPromptImpressionTracked = false;
  private readonly trackPushPromptImpression = effect(() => {
    if (!this.showPushPrompt()) return;
    if (this.pushPromptImpressionTracked) return;
    this.pushPromptImpressionTracked = true;
    this.analytics.track('push_prompt_shown');
  });

  protected async enablePush(): Promise<void> {
    if (this.pushEnabling()) return;
    this.haptic(10);
    this.pushEnabling.set(true);
    this.pushError.set(null);
    let stage: 'permission' | 'persist' = 'permission';
    try {
      const token = await this.push.requestPermissionAndGetToken();
      if (!token) {
        // User denied at the system prompt, or token retrieval failed.
        // Either way the prompt should not re-surface this session;
        // browser's denied state will cover future sessions.
        this.dismissPushPrompt();
        this.analytics.track('push_prompt_denied');
        return;
      }
      stage = 'persist';
      await Promise.all([
        this.fb.saveFcmToken(token),
        this.fb.saveReminderHour(TodayV2Component.DEFAULT_REMINDER_HOUR),
      ]);
      this.analytics.track('push_prompt_enabled');
      this.dismissPushPrompt();
    } catch (err) {
      // Two failure modes: requestPermissionAndGetToken throws (rare —
      // FCM service-worker registration / vapid key issue), or the
      // saveFcmToken / saveReminderHour writes throw after permission
      // was granted. The second case is worse: user has granted, no
      // token persisted, no FCM nudges will arrive. Log + send an
      // analytics breakdown so we can spot it in the wild.
      console.warn('[push] enable failed', err);
      this.analytics.track('push_prompt_error', { stage });
      this.pushError.set(this.translation.t('v2.today.pushPromptError'));
    } finally {
      this.pushEnabling.set(false);
    }
  }

  protected dismissPushPrompt(): void {
    this.haptic(10);
    try { localStorage.setItem(this.PUSH_DISMISS_KEY, '1'); } catch { /* ignore */ }
    this.pushPromptDismissedLocal.set(true);
  }

  // ─── iOS install hint ──────────────────────────────────────────
  /** Latch — clicked "Got it" once = never re-prompted on this device. */
  private readonly IOS_INSTALL_DISMISS_KEY = 'macrolog.ios-install-dismissed';
  protected readonly iosInstallDismissedLocal = signal(
    typeof localStorage !== 'undefined' && !!localStorage.getItem(this.IOS_INSTALL_DISMISS_KEY),
  );

  /** True when running on iOS Safari (not Chrome/Firefox-on-iOS, which
   *  wrap WebKit but don't allow add-to-home-screen) AND not already
   *  installed as a PWA AND not dismissed. The narrow gate — we want
   *  to nudge users who can install, not pollute Android/desktop with
   *  iOS-specific instructions. */
  protected readonly showIosInstall = computed(() => {
    if (this.iosInstallDismissedLocal()) return false;
    if (typeof window === 'undefined' || typeof navigator === 'undefined') return false;
    const ua = navigator.userAgent;
    // iOS device (iPhone / iPad / iPod). iPad on iOS 13+ reports as
    // Mac in UA, so also check maxTouchPoints — Macs return 0 even
    // with a touch bar, iPads return >0. False positive on Mac M-series
    // with touch bar mods is rare enough to ignore.
    const isIos = /iPhone|iPad|iPod/.test(ua) ||
      (/Macintosh/.test(ua) && (navigator as any).maxTouchPoints > 1);
    if (!isIos) return false;
    // Reject Chrome / Firefox on iOS (CriOS / FxiOS) — they can't
    // install to home screen, only Safari can.
    if (/CriOS|FxiOS|EdgiOS/.test(ua)) return false;
    // Already installed → no nudge.
    const standaloneMql = window.matchMedia('(display-mode: standalone)').matches;
    const standaloneLegacy = (navigator as any).standalone === true;
    if (standaloneMql || standaloneLegacy) return false;
    return true;
  });

  protected dismissIosInstall(): void {
    this.haptic(10);
    try { localStorage.setItem(this.IOS_INSTALL_DISMISS_KEY, '1'); } catch { /* ignore */ }
    this.iosInstallDismissedLocal.set(true);
    this.analytics.track('ios_install_dismissed');
  }

  /** One-shot impression event so we can measure how often this
   *  surfaces. Without `_shown` we can't compute conversion against
   *  the "user actually installed" signal (which doesn't exist as an
   *  event but is implicitly tracked by display-mode going standalone
   *  on subsequent visits — separate signal in store readiness). */
  private iosInstallImpressionTracked = false;
  private readonly trackIosInstallImpression = effect(() => {
    if (!this.showIosInstall()) return;
    if (this.iosInstallImpressionTracked) return;
    this.iosInstallImpressionTracked = true;
    this.analytics.track('ios_install_shown');
  });

  protected repeatYesterday(): void {
    this.haptic(30);
    void this.store.repeatYesterday();
  }

  protected undoDelete(): void {
    this.haptic(10);
    void this.store.undoDelete();
  }

  private haptic(ms: number): void {
    try {
      if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
      navigator.vibrate?.(ms);
    } catch { /* ignore */ }
  }
}
