import {
  ChangeDetectionStrategy, Component,
  computed, inject, input, output, signal,
} from '@angular/core';
import { TranslocoDirective } from '@jsverse/transloco';
import { LucideAngularModule } from 'lucide-angular';
import { SwUpdate } from '@angular/service-worker';
import { AuthService } from '../../services/auth.service';
import { LEDGER_PORT } from '../../ledger/ports/ledger.port';
import { FitnessStore } from '../../services/fitness-store.service';
import { PushNotificationService } from '../../services/push-notification.service';
import { SubscriptionService } from '../../services/subscription.service';
import { TranslationService } from '../../services/translation.service';
import { AppLang } from '../../i18n/transloco.providers';
import { SubscribeComponent } from '../subscribe/subscribe.component';
import { ThemeChoice } from '../../utils/theme';
import { V2Sheet } from '../ui/sheet.component';
import { V2Card } from '../ui/card.component';
import { V2Button } from '../ui/button.component';

/**
 * v2 Settings sheet (Q20). Single scrollable list inside `<v2-sheet>`,
 * sections rendered as `<v2-card>`s. Same logic as v1 — push reminders,
 * language, theme, travel mode, webhook, history, feedback, legal —
 * with warm-minimal chrome, native form-style controls, and
 * `<app-subscribe>` rendered inline inside the Subscription section.
 *
 * The v1 component (`settings-sheet`) stays in the bundle as an escape
 * hatch behind `?ui=v1` for one release.
 */
@Component({
  selector: 'app-settings-sheet-v2',
  standalone: true,
  imports: [
    TranslocoDirective,
    LucideAngularModule,
    V2Sheet,
    V2Card,
    V2Button,
    SubscribeComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <ng-container *transloco="let t">
    <v2-sheet labelledBy="settings-v2-title" (close)="requestClose()">
      <h2 id="settings-v2-title" class="v2-h1 mb-1">{{ t('settings.titleLead') }}</h2>
      <p class="v2-caption mb-5">{{ t('settings.sectionLabel') }}</p>

      @if (auth.user(); as u) {

      <!-- Profile -->
      <v2-card variant="default" id="settings-profile" class="block mb-3">
        <h3 class="v2-h3 mb-2">{{ t('settings.profile.section') }}</h3>
        <p class="v2-caption mb-3">
          {{ t('settings.profile.signedInAs') }}
          <span class="v2-num" style="color: var(--v2-ink); font-size: 0.8125rem;">{{ u.email }}</span>
        </p>
        <div class="flex flex-wrap gap-2">
          <v2-button variant="secondary" size="sm" (click)="onEditProfile()">
            <lucide-icon name="pencil" [size]="14" />
            {{ t('settings.profile.edit') }}
          </v2-button>
          <v2-button variant="ghost" size="sm" (click)="signOut()">
            {{ t('settings.profile.signOut') }}
          </v2-button>
        </div>
      </v2-card>

      <!-- Language -->
      <v2-card variant="default" class="block mb-3">
        <h3 class="v2-h3 mb-1">{{ t('settings.language.section') }}</h3>
        <p class="v2-caption mb-3">{{ t('settings.language.desc') }}</p>
        <div class="flex gap-2">
          <v2-button
            [variant]="translation.language() === 'en' ? 'primary' : 'ghost'"
            size="sm"
            (click)="selectLanguage('en')">
            {{ t('settings.language.english') }}
          </v2-button>
          <v2-button
            [variant]="translation.language() === 'es-PR' ? 'primary' : 'ghost'"
            size="sm"
            (click)="selectLanguage('es-PR')">
            {{ t('settings.language.spanish') }}
          </v2-button>
        </div>
        @if (showEsBetaBanner()) {
          <p class="v2-caption mt-3" role="status"
             style="padding: 8px 12px; background: var(--v2-paper-2); border-radius: var(--v2-radius-sm); border-left: 3px solid var(--v2-accent);">
            {{ t('legal.esBetaBanner') }}
          </p>
        }
      </v2-card>

      <!-- Reminders -->
      <v2-card variant="default" class="block mb-3">
        <h3 class="v2-h3 mb-3">{{ t('settings.reminders.section') }}</h3>

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
            <v2-button variant="secondary" size="sm" (click)="enablePush()">
              {{ t('settings.reminders.pushEnable') }}
            </v2-button>
          }
        </div>

        <div class="flex items-center justify-between gap-3">
          <div>
            <div class="v2-body" style="font-weight: 500;">{{ t('settings.reminders.hour') }}</div>
            <p class="v2-caption">{{ t('settings.reminders.hourDesc') }}</p>
          </div>
          <select
            [value]="reminderHour()"
            (change)="setReminderHour(+$any($event.target).value)"
            [attr.aria-label]="t('settings.reminders.hourAria')"
            class="v2-field"
            style="min-width: 110px; width: auto;">
            @for (h of reminderHours; track h) {
              <option [value]="h" [selected]="h === reminderHour()">{{ formatHour(h) }}</option>
            }
          </select>
        </div>

        <p class="v2-caption mt-3" style="opacity: 0.75;">
          {{ t('settings.reminders.utcHint') }}
        </p>
      </v2-card>

      <!-- Appearance (Theme + Travel) -->
      <v2-card variant="default" class="block mb-3">
        <h3 class="v2-h3 mb-3">{{ t('settings.modes.section') }}</h3>

        <div class="flex items-start justify-between gap-3 mb-4">
          <div class="min-w-0">
            <div class="v2-body" style="font-weight: 500;">{{ t('settings.modes.travel') }}</div>
            <p class="v2-caption mt-0.5">{{ t('settings.modes.travelDesc') }}</p>
          </div>
          <v2-button
            [variant]="store.travelMode() ? 'primary' : 'ghost'"
            size="sm"
            (click)="store.toggleTravelMode()"
            [ariaLabel]="store.travelMode() ? t('settings.modes.travelAriaOff') : t('settings.modes.travelAriaOn')">
            {{ store.travelMode() ? t('settings.modes.travelOn') : t('settings.modes.travelOff') }}
          </v2-button>
        </div>

        <div class="flex items-start justify-between gap-3 mb-3">
          <div>
            <div class="v2-body" style="font-weight: 500;">{{ t('settings.modes.theme') }}</div>
            <p class="v2-caption">{{ t('settings.modes.themeDesc') }}</p>
          </div>
          @if (!isPaid()) {
            <span class="v2-num shrink-0"
              style="font-size: 0.625rem; padding: 3px 8px; background: var(--v2-paper-2); border: 1px solid var(--v2-rule); border-radius: 999px; color: var(--v2-ink-muted); text-transform: uppercase; letter-spacing: 0.06em;">
              {{ t('settings.modes.themeProBadge') }}
            </span>
          }
        </div>

        <div role="radiogroup" [attr.aria-label]="t('settings.modes.themeAriaGroup')"
             class="grid grid-cols-3 gap-2">
          @for (opt of themeOptions; track opt.value) {
            <button type="button" role="radio"
              [attr.aria-checked]="themeChoice() === opt.value"
              [disabled]="opt.pro && !isPaid()"
              (click)="chooseTheme(opt.value)"
              class="flex flex-col items-center gap-1.5 p-2.5 rounded-md transition"
              [class.opacity-50]="opt.pro && !isPaid()"
              [style.background]="themeChoice() === opt.value ? 'var(--v2-accent-soft)' : 'var(--v2-paper-2)'"
              [style.border]="'1px solid ' + (themeChoice() === opt.value ? 'var(--v2-accent)' : 'var(--v2-rule)')"
              style="min-height: var(--v2-tap-min); cursor: pointer; font-family: var(--v2-font-sans); font-size: 0.75rem; color: var(--v2-ink);">
              <span class="inline-block w-6 h-4 rounded-sm" style="border: 1px solid var(--v2-rule);"
                [style.background]="opt.swatch"></span>
              <span>{{ t(opt.labelKey) }}</span>
              @if (opt.pro && !isPaid()) {
                <span class="v2-caption" style="font-size: 0.625rem; opacity: 0.7;">{{ t('v2.settings.themeProBadge') }}</span>
              }
            </button>
          }
        </div>
      </v2-card>

      <!-- Subscription -->
      <v2-card variant="default" id="settings-subscription" class="block mb-3">
        <h3 class="v2-h3 mb-3">{{ t('settings.subscription.section') }}</h3>
        <app-subscribe />
      </v2-card>

      <!-- Data -->
      <v2-card variant="default" class="block mb-3">
        <h3 class="v2-h3 mb-3">{{ t('settings.data.section') }}</h3>

        <div class="mb-4">
          <div class="flex items-start justify-between gap-3 mb-2">
            <div class="min-w-0">
              <div class="v2-body" style="font-weight: 500;">{{ t('settings.data.webhook') }}</div>
              <p class="v2-caption mt-0.5">{{ t('settings.data.webhookDesc') }}</p>
            </div>
            <v2-button variant="ghost" size="sm"
              (click)="showWebhook.set(!showWebhook())"
              [ariaLabel]="showWebhook() ? t('settings.data.webhookHide') : t('settings.data.webhookShow')">
              {{ showWebhook() ? t('settings.data.webhookHide') : t('settings.data.webhookShow') }}
            </v2-button>
          </div>
          @if (showWebhook()) {
            <div style="padding: 12px; background: var(--v2-paper-2); border-radius: var(--v2-radius-sm); border: 1px solid var(--v2-rule);">
              @if (store.webhookApiKey(); as key) {
                <div class="v2-num"
                  style="font-size: 0.75rem; padding: 8px; background: var(--v2-paper); border-radius: var(--v2-radius-sm); word-break: break-all; user-select: all;">
                  {{ key }}
                </div>
                <p class="v2-caption mt-2">
                  {{ t('settings.data.webhookEndpoint') }}
                  <span class="v2-num" style="font-size: 0.75rem;">{{ webhookUrl }}</span>
                </p>
                <div class="mt-3 flex flex-wrap gap-2">
                  <v2-button variant="secondary" size="sm" (click)="copyWebhookKey()">
                    {{ webhookCopied() ? t('settings.data.webhookCopied') : t('settings.data.webhookCopy') }}
                  </v2-button>
                  <v2-button variant="ghost" size="sm" (click)="store.revokeWebhookApiKey()">
                    {{ t('settings.data.webhookRevoke') }}
                  </v2-button>
                  @if (webhookCopied()) {
                    <span class="sr-only" role="status" aria-live="polite">
                      {{ t('settings.data.webhookCopiedAria') }}
                    </span>
                  }
                </div>
              } @else {
                <p class="v2-caption mb-3">{{ t('settings.data.webhookGenerateHint') }}</p>
                <v2-button variant="secondary" size="sm" (click)="store.generateWebhookApiKey()">
                  {{ t('settings.data.webhookGenerate') }}
                </v2-button>
              }
            </div>
          }
        </div>

        <div class="flex items-center justify-between gap-3">
          <div>
            <div class="v2-body" style="font-weight: 500;">{{ t('settings.data.delete') }}</div>
            <p class="v2-caption">{{ t('settings.data.deleteDesc') }}</p>
          </div>
          <a href="/privacy#delete"
            class="v2-btn v2-btn--sm v2-btn--ghost"
            style="color: var(--v2-danger);">
            {{ t('settings.data.deleteManage') }}
          </a>
        </div>
      </v2-card>

      <!-- Feedback -->
      <v2-card variant="default" class="block mb-3">
        <h3 class="v2-h3 mb-2">{{ t('settings.feedback.section') }}</h3>
        <div class="flex items-center justify-between gap-3">
          <div class="min-w-0">
            <div class="v2-body" style="font-weight: 500;">{{ t('settings.feedback.label') }}</div>
            <p class="v2-caption mt-0.5">{{ t('settings.feedback.desc') }}</p>
          </div>
          <v2-button variant="secondary" size="sm" (click)="sendFeedback()"
            [ariaLabel]="t('settings.feedback.aria')">
            {{ t('settings.feedback.send') }}
          </v2-button>
        </div>
      </v2-card>

      <!-- About / Updates -->
      <v2-card variant="default" class="block mb-3">
        <h3 class="v2-h3 mb-3">{{ t('v2.settings.about') }}</h3>
        <div class="flex items-start justify-between gap-3 mb-2">
          <div class="min-w-0">
            <div class="v2-body" style="font-weight: 500;">{{ t('v2.settings.appVersion') }}</div>
            <p class="v2-caption mt-0.5">
              {{ t('v2.settings.build') }} <span class="v2-num" style="color: var(--v2-ink); font-size: 0.75rem;">{{ buildLabel() }}</span>
            </p>
            @if (updateMsg(); as msg) {
              <p class="v2-caption mt-1" role="status" aria-live="polite"
                [style.color]="msg.tone === 'sage' ? 'var(--v2-sage)' : msg.tone === 'accent' ? 'var(--v2-accent)' : 'var(--v2-ink-muted)'">
                {{ msg.text }}
              </p>
            }
          </div>
          <v2-button variant="secondary" size="sm" (click)="checkForUpdate()" [disabled]="checkingUpdate()">
            <lucide-icon name="check" [size]="14" />
            {{ checkingUpdate() ? t('v2.settings.checking') : t('v2.settings.checkForUpdates') }}
          </v2-button>
        </div>
      </v2-card>

      <!-- Legal -->
      <v2-card variant="flat" class="block mb-3">
        <h3 class="v2-h3 mb-2">{{ t('settings.legal.section') }}</h3>
        <p class="v2-caption">
          <a href="/privacy" style="text-decoration: underline; text-decoration-style: dotted;">{{ t('settings.legal.privacy') }}</a>
          &middot;
          <a href="/terms" style="text-decoration: underline; text-decoration-style: dotted;">{{ t('settings.legal.terms') }}</a>
          &middot;
          <a href="/changelog" style="text-decoration: underline; text-decoration-style: dotted;">{{ t('v2.settings.changelog') }}</a>
          &middot;
          <a href="mailto:gabrielandresbermudez&#64;gmail.com" style="text-decoration: underline; text-decoration-style: dotted;">{{ t('settings.legal.contact') }}</a>
        </p>
      </v2-card>

      } @else {
        <p class="v2-caption">{{ t('settings.signInFirst') }}</p>
      }
    </v2-sheet>
    </ng-container>
  `,
})
export class SettingsSheetV2Component {
  protected readonly auth = inject(AuthService);
  protected readonly firebase = inject(LEDGER_PORT);
  protected readonly store = inject(FitnessStore);
  protected readonly pushService = inject(PushNotificationService);
  protected readonly subs = inject(SubscriptionService);
  protected readonly translation = inject(TranslationService);
  private readonly swUpdate = inject(SwUpdate);

  readonly darkMode = input.required<boolean>();
  readonly themeChoice = input.required<ThemeChoice>();

  readonly close = output<void>();
  readonly editProfile = output<void>();
  readonly themeSelect = output<ThemeChoice>();

  protected readonly isPaid = computed(() => this.subs.isPaid());
  protected readonly showWebhook = signal(false);
  protected readonly webhookCopied = signal(false);
  protected readonly reminderHours = Array.from({ length: 24 }, (_, i) => i);
  protected readonly reminderHour = computed(() => (this.firebase.profile() as any)?.reminderHour ?? 20);
  protected readonly webhookUrl = 'https://us-central1-fitness-tracker-gb-1775407101.cloudfunctions.net/logWebhook';

  protected readonly showEsBetaBanner = computed(() => this.translation.language() === 'es-PR');

  protected readonly checkingUpdate = signal(false);
  protected readonly updateMsg = signal<{ text: string; tone: 'sage' | 'accent' | 'muted' } | null>(null);

  /** Show abbreviated build SHA, or "dev" in non-prod builds. The
   *  global is injected at build time by `scripts/sentry-release.mjs`. */
  protected readonly buildLabel = computed(() => {
    const v = (globalThis as unknown as { __MACROLOG_RELEASE__?: string }).__MACROLOG_RELEASE__;
    if (!v) return 'dev';
    return v.length > 8 ? v.substring(0, 8) : v;
  });

  /** Manual update check from the settings sheet. The 60s background
   *  poll usually catches new versions, but this is the explicit
   *  affordance for users on long-lived tabs. Banner from app.ts
   *  fires automatically on VERSION_READY. */
  protected async checkForUpdate(): Promise<void> {
    if (this.checkingUpdate()) return;
    this.checkingUpdate.set(true);
    this.updateMsg.set(null);
    try {
      if (!this.swUpdate.isEnabled) {
        this.updateMsg.set({ text: this.translation.t('v2.settings.updateUnavailable'), tone: 'muted' });
        return;
      }
      const found = await this.swUpdate.checkForUpdate();
      if (found) {
        this.updateMsg.set({ text: this.translation.t('v2.settings.updateFound'), tone: 'accent' });
      } else {
        this.updateMsg.set({ text: this.translation.t('v2.settings.updateLatest'), tone: 'sage' });
      }
    } catch (err) {
      this.updateMsg.set({
        text: err instanceof Error ? err.message : this.translation.t('v2.settings.updateError'),
        tone: 'muted',
      });
    } finally {
      this.checkingUpdate.set(false);
    }
  }

  protected readonly themeOptions: ReadonlyArray<{
    value: ThemeChoice; labelKey: string; swatch: string; pro: boolean;
  }> = [
    { value: 'auto',         labelKey: 'settings.modes.themeAuto',     swatch: 'linear-gradient(90deg, #faf7f2 50%, #1c1915 50%)', pro: false },
    { value: 'light',        labelKey: 'settings.modes.themeLightOpt', swatch: '#faf7f2', pro: false },
    { value: 'dark',         labelKey: 'settings.modes.themeDarkOpt',  swatch: '#1c1915', pro: false },
    { value: 'sepia',        labelKey: 'settings.modes.themeSepia',    swatch: '#efe6d2', pro: true  },
    { value: 'graphite',     labelKey: 'settings.modes.themeGraphite', swatch: '#e8e6e2', pro: true  },
    { value: 'oxblood-dark', labelKey: 'settings.modes.themeOxblood',  swatch: '#1a1010', pro: true  },
  ];

  private webhookCopyTimer: ReturnType<typeof setTimeout> | null = null;

  // Escape handling lives in <v2-sheet>; no override needed.

  protected requestClose(): void { this.close.emit(); }
  protected onEditProfile(): void { this.editProfile.emit(); this.requestClose(); }
  protected chooseTheme(v: ThemeChoice): void { this.themeSelect.emit(v); }
  protected selectLanguage(lang: AppLang): void { this.translation.setLanguage(lang); }

  protected async signOut(): Promise<void> {
    await this.auth.signOut();
    this.requestClose();
  }

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

  protected async copyWebhookKey(): Promise<void> {
    const key = this.store.webhookApiKey();
    if (!key) return;
    try {
      await navigator.clipboard.writeText(key);
      this.webhookCopied.set(true);
      if (this.webhookCopyTimer) clearTimeout(this.webhookCopyTimer);
      this.webhookCopyTimer = setTimeout(() => this.webhookCopied.set(false), 2000);
    } catch { /* clipboard rejected — silent */ }
  }

  protected sendFeedback(): void {
    const subject = this.translation.t('settings.feedback.emailSubject');
    const whatHappened = this.translation.t('settings.feedback.whatHappened');
    const expected = this.translation.t('settings.feedback.expected');
    const build = (globalThis as unknown as { __MACROLOG_RELEASE__?: string }).__MACROLOG_RELEASE__ ?? 'dev';
    const body = [
      whatHappened, '', '', expected, '', '',
      '---',
      `Build: ${build}`,
      `Path : ${window.location.pathname}`,
      `Agent: ${navigator.userAgent}`,
      `Time : ${new Date().toISOString()}`,
    ].join('\n');
    const href = `mailto:gabrielandresbermudez@gmail.com?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
    window.location.href = href;
    this.requestClose();
  }
}
