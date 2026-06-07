import {
  ChangeDetectionStrategy, Component,
  computed, inject, input, output, signal,
} from '@angular/core';
import { TranslocoDirective } from '@jsverse/transloco';
import { LucideAngularModule } from 'lucide-angular';
import { SwUpdate } from '@angular/service-worker';
import { CallableGateway } from '../../services/callable.gateway';
import { AuthService } from '../../services/auth.service';
import { LEDGER_PORT } from '../../ledger/ports/ledger.port';
import { FitnessStore } from '../../services/fitness-store.service';
import { PushNotificationService } from '../../services/push-notification.service';
import { SubscriptionService } from '../../services/subscription.service';
import { TranslationService } from '../../services/translation.service';
import { AppLang } from '../../i18n/transloco.providers';
import { SubscribeComponent } from '../subscribe/subscribe.component';
import { ThemeChoice } from '../../utils/theme';
import { buildReferralLink } from '../../utils/referral';
import { share } from '../../utils/share';
import { buildCsv, downloadCsv } from '../../utils/csv-export';
import { AnalyticsService } from '../../services/analytics.service';
import { UiSheet } from '../ui/sheet.component';
import { UiCard } from '../ui/card.component';
import { UiButton } from '../ui/button.component';

/**
 * v2 Settings sheet (Q20). Single scrollable list inside `<ui-sheet>`,
 * sections rendered as `<ui-card>`s. Same logic as v1 — push reminders,
 * language, theme, travel mode, webhook, history, feedback, legal —
 * with warm-minimal chrome, native form-style controls, and
 * `<app-subscribe>` rendered inline inside the Subscription section.
 *
 */
@Component({
  selector: 'app-settings-sheet',
  standalone: true,
  imports: [
    TranslocoDirective,
    LucideAngularModule,
    UiSheet,
    UiCard,
    UiButton,
    SubscribeComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <ng-container *transloco="let t">
    <ui-sheet labelledBy="settings-v2-title" (close)="requestClose()">
      <h2 id="settings-v2-title" class="v2-h1 mb-1">{{ t('settings.titleLead') }}</h2>
      <p class="v2-caption mb-5">{{ t('settings.sectionLabel') }}</p>

      @if (auth.user(); as u) {

      <!-- Profile -->
      <ui-card variant="default" id="settings-profile" class="block mb-3">
        <h3 class="v2-h3 mb-2">{{ t('settings.profile.section') }}</h3>
        <p class="v2-caption mb-3">
          {{ t('settings.profile.signedInAs') }}
          <span class="v2-num" style="color: var(--v2-ink); font-size: 0.8125rem;">{{ u.email }}</span>
        </p>
        <div class="flex flex-wrap gap-2">
          <ui-button variant="secondary" size="sm" (click)="onRedoOnboarding()">
            <lucide-icon name="pencil" [size]="14" />
            {{ t('settings.profile.redoOnboarding') }}
          </ui-button>
          <ui-button variant="ghost" size="sm" (click)="signOut()">
            {{ t('settings.profile.signOut') }}
          </ui-button>
        </div>
      </ui-card>

      <!-- Language -->
      <ui-card variant="default" class="block mb-3">
        <h3 class="v2-h3 mb-1">{{ t('settings.language.section') }}</h3>
        <p class="v2-caption mb-3">{{ t('settings.language.desc') }}</p>
        <div class="flex gap-2">
          <ui-button
            [variant]="translation.language() === 'en' ? 'primary' : 'ghost'"
            size="sm"
            (click)="selectLanguage('en')">
            {{ t('settings.language.english') }}
          </ui-button>
          <ui-button
            [variant]="translation.language() === 'es-PR' ? 'primary' : 'ghost'"
            size="sm"
            (click)="selectLanguage('es-PR')">
            {{ t('settings.language.spanish') }}
          </ui-button>
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

      <!-- Appearance (Theme + Travel) -->
      <ui-card variant="default" class="block mb-3">
        <h3 class="v2-h3 mb-3">{{ t('settings.modes.section') }}</h3>

        <div class="flex items-start justify-between gap-3 mb-4">
          <div class="min-w-0">
            <div class="v2-body" style="font-weight: 500;">{{ t('settings.modes.travel') }}</div>
            <p class="v2-caption mt-0.5">{{ t('settings.modes.travelDesc') }}</p>
          </div>
          <ui-button
            [variant]="store.travelMode() ? 'primary' : 'ghost'"
            size="sm"
            (click)="store.toggleTravelMode()"
            [ariaLabel]="store.travelMode() ? t('settings.modes.travelAriaOff') : t('settings.modes.travelAriaOn')">
            {{ store.travelMode() ? t('settings.modes.travelOn') : t('settings.modes.travelOff') }}
          </ui-button>
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
      </ui-card>

      <!-- Units (drives the food-search portion picker default). -->
      <ui-card variant="default" class="block mb-3">
        <h3 class="v2-h3 mb-2">{{ t('settings.units.section') }}</h3>
        <p class="v2-caption mb-3">{{ t('settings.units.desc') }}</p>
        <div role="radiogroup" [attr.aria-label]="t('settings.units.aria')"
             class="grid grid-cols-2 gap-2">
          <button type="button" role="radio"
            [attr.aria-checked]="unitSystem() === 'us'"
            (click)="chooseUnits('us')"
            class="flex flex-col items-start gap-0.5 p-3 rounded-md transition"
            [style.background]="unitSystem() === 'us' ? 'var(--v2-accent-soft)' : 'var(--v2-paper-2)'"
            [style.border]="'1px solid ' + (unitSystem() === 'us' ? 'var(--v2-accent)' : 'var(--v2-rule)')"
            style="min-height: var(--v2-tap-min); cursor: pointer; font-family: var(--v2-font-sans); color: var(--v2-ink);">
            <span class="v2-body" style="font-weight: 600;">{{ t('settings.units.us') }}</span>
            <span class="v2-caption">{{ t('settings.units.usDesc') }}</span>
          </button>
          <button type="button" role="radio"
            [attr.aria-checked]="unitSystem() === 'metric'"
            (click)="chooseUnits('metric')"
            class="flex flex-col items-start gap-0.5 p-3 rounded-md transition"
            [style.background]="unitSystem() === 'metric' ? 'var(--v2-accent-soft)' : 'var(--v2-paper-2)'"
            [style.border]="'1px solid ' + (unitSystem() === 'metric' ? 'var(--v2-accent)' : 'var(--v2-rule)')"
            style="min-height: var(--v2-tap-min); cursor: pointer; font-family: var(--v2-font-sans); color: var(--v2-ink);">
            <span class="v2-body" style="font-weight: 600;">{{ t('settings.units.metric') }}</span>
            <span class="v2-caption">{{ t('settings.units.metricDesc') }}</span>
          </button>
        </div>
        @if (unitsError()) {
          <p class="v2-caption mt-2" role="alert" style="color: var(--v2-danger)">
            {{ t('settings.units.saveError') }}
          </p>
        }
      </ui-card>

      <!-- Subscription -->
      <ui-card variant="default" id="settings-subscription" class="block mb-3">
        <h3 class="v2-h3 mb-3">{{ t('settings.subscription.section') }}</h3>
        <app-subscribe />
      </ui-card>

      <!-- Refer a friend -->
      @if (referralLink(); as link) {
        <ui-card variant="default" class="block mb-3">
          <h3 class="v2-h3 mb-2">{{ t('settings.referral.section') }}</h3>
          <p class="v2-body-soft mb-3" style="font-size: 0.875rem;">
            {{ t('settings.referral.body') }}
          </p>
          <div style="padding: 10px 12px; background: var(--v2-paper-2); border: 1px solid var(--v2-rule); border-radius: var(--v2-radius-sm); margin-bottom: 8px;">
            <div class="v2-num" style="font-size: 0.75rem; word-break: break-all; user-select: all; color: var(--v2-ink);">
              {{ link }}
            </div>
          </div>
          <div class="flex flex-wrap gap-2">
            <ui-button variant="secondary" size="sm" (click)="copyReferralLink()">
              {{ referralCopied() ? t('settings.referral.copied') : t('settings.referral.copy') }}
            </ui-button>
            <ui-button variant="ghost" size="sm" (click)="shareReferral()">
              {{ t('settings.referral.share') }}
            </ui-button>
          </div>
          @if (referralRewardActive(); as until) {
            <p class="v2-caption mt-3" style="color: var(--v2-sage);">
              {{ t('settings.referral.rewardActive', { date: until }) }}
            </p>
          }
        </ui-card>
      }

      <!-- Public profile -->
      <ui-card variant="default" class="block mb-3">
        <h3 class="v2-h3 mb-2">{{ t('publicProfileSettings.title') }}</h3>
        <p class="v2-body-soft mb-3" style="font-size: 0.875rem;">
          {{ t('publicProfileSettings.body') }}
        </p>
        @if (publicSlug(); as slug) {
          <p class="v2-caption mb-2">{{ t('publicProfileSettings.linkLabel') }}</p>
          <a [href]="'/u/' + slug" target="_blank" rel="noopener"
             style="display: block; padding: 10px 12px; background: var(--v2-paper-2); border: 1px solid var(--v2-rule); border-radius: var(--v2-radius-sm); margin-bottom: 8px; text-decoration: none;">
            <span class="v2-num" style="font-size: 0.75rem; color: var(--v2-ink); word-break: break-all;">
              macrolog.app/u/{{ slug }}
            </span>
          </a>
        }
        <label class="v2-caption" style="display: block; margin-bottom: 4px;">
          {{ t('publicProfileSettings.slugLabel') }}
        </label>
        <input type="text"
          [value]="slugInput()"
          (input)="onSlugInput($event)"
          [placeholder]="t('publicProfileSettings.slugPlaceholder')"
          autocomplete="off"
          spellcheck="false"
          maxlength="30"
          style="width: 100%; padding: 8px 10px; background: var(--v2-paper); border: 1px solid var(--v2-rule); border-radius: var(--v2-radius-sm); color: var(--v2-ink); font-size: 0.875rem;" />
        <p class="v2-caption mt-1 mb-3">{{ t('publicProfileSettings.slugHelp') }}</p>
        <label class="v2-caption" style="display: block; margin-bottom: 4px;">
          {{ t('publicProfileSettings.displayNameLabel') }}
        </label>
        <input type="text"
          [value]="publicDisplayNameInput()"
          (input)="onDisplayNameInput($event)"
          [placeholder]="t('publicProfileSettings.displayNamePlaceholder')"
          maxlength="40"
          style="width: 100%; padding: 8px 10px; background: var(--v2-paper); border: 1px solid var(--v2-rule); border-radius: var(--v2-radius-sm); color: var(--v2-ink); font-size: 0.875rem;" />
        <div class="flex flex-wrap gap-2 mt-3">
          <ui-button variant="primary" size="sm" (click)="claimSlug()" [disabled]="publicBusy() || !slugInput()">
            @if (publicBusy()) {
              {{ t('publicProfileSettings.claimingState') }}
            } @else if (publicSlug()) {
              {{ t('publicProfileSettings.updateButton') }}
            } @else {
              {{ t('publicProfileSettings.claimButton') }}
            }
          </ui-button>
          @if (publicSlug()) {
            <ui-button variant="ghost" size="sm" (click)="releaseSlug()" [disabled]="publicBusy()">
              {{ publicBusy() ? t('publicProfileSettings.releasingState') : t('publicProfileSettings.releaseButton') }}
            </ui-button>
          }
        </div>
        @if (publicError(); as err) {
          <p class="v2-caption mt-2" role="alert" style="color: var(--v2-danger);">{{ err }}</p>
        }
      </ui-card>

      <!-- Data -->
      <ui-card variant="default" class="block mb-3">
        <h3 class="v2-h3 mb-3">{{ t('settings.data.section') }}</h3>

        <div class="mb-4">
          <div class="flex items-start justify-between gap-3 mb-2">
            <div class="min-w-0">
              <div class="v2-body" style="font-weight: 500;">{{ t('settings.data.webhook') }}</div>
              <p class="v2-caption mt-0.5">{{ t('settings.data.webhookDesc') }}</p>
            </div>
            <ui-button variant="ghost" size="sm"
              (click)="showWebhook.set(!showWebhook())"
              [ariaLabel]="showWebhook() ? t('settings.data.webhookHide') : t('settings.data.webhookShow')">
              {{ showWebhook() ? t('settings.data.webhookHide') : t('settings.data.webhookShow') }}
            </ui-button>
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
                  <ui-button variant="secondary" size="sm" (click)="copyWebhookKey()">
                    {{ webhookCopied() ? t('settings.data.webhookCopied') : t('settings.data.webhookCopy') }}
                  </ui-button>
                  <ui-button variant="ghost" size="sm" (click)="store.revokeWebhookApiKey()">
                    {{ t('settings.data.webhookRevoke') }}
                  </ui-button>
                  @if (webhookCopied()) {
                    <span class="sr-only" role="status" aria-live="polite">
                      {{ t('settings.data.webhookCopiedAria') }}
                    </span>
                  }
                </div>
              } @else {
                <p class="v2-caption mb-3">{{ t('settings.data.webhookGenerateHint') }}</p>
                <ui-button variant="secondary" size="sm" (click)="store.generateWebhookApiKey()">
                  {{ t('settings.data.webhookGenerate') }}
                </ui-button>
              }
            </div>
          }
        </div>

        <div class="flex items-center justify-between gap-3 mb-4">
          <div class="min-w-0">
            <div class="v2-body" style="font-weight: 500;">{{ t('settings.data.export') }}</div>
            <p class="v2-caption mt-0.5">{{ t('settings.data.exportDesc') }}</p>
            @if (exportError()) {
              <p class="v2-caption mt-1" role="status" aria-live="polite" style="color: var(--v2-danger);">
                {{ t('settings.data.exportError') }}
              </p>
            }
          </div>
          <ui-button variant="secondary" size="sm" (click)="exportData()" [disabled]="exporting()">
            <lucide-icon name="download" [size]="14" />
            {{ exporting() ? t('settings.data.exportPreparing') : t('settings.data.exportButton') }}
          </ui-button>
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
      </ui-card>

      <!-- Feedback -->
      <ui-card variant="default" class="block mb-3">
        <h3 class="v2-h3 mb-2">{{ t('settings.feedback.section') }}</h3>
        <div class="flex items-center justify-between gap-3">
          <div class="min-w-0">
            <div class="v2-body" style="font-weight: 500;">{{ t('settings.feedback.label') }}</div>
            <p class="v2-caption mt-0.5">{{ t('settings.feedback.desc') }}</p>
          </div>
          <ui-button variant="secondary" size="sm" (click)="sendFeedback()"
            [ariaLabel]="t('settings.feedback.aria')">
            {{ t('settings.feedback.send') }}
          </ui-button>
        </div>
      </ui-card>

      <!-- About / Updates -->
      <ui-card variant="default" class="block mb-3">
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
            @if (updateAvailable()) {
              <!-- Inline reload — the global SwUpdate dialog renders
                   behind this sheet (same z-stack), so an in-sheet
                   action is the only way the user can discover the
                   update without first closing settings. Activates
                   the SW + reloads. -->
              <div class="mt-2">
                <ui-button variant="primary" size="sm" (click)="reloadForUpdate()">
                  {{ t('v2.settings.reloadNow') }}
                </ui-button>
              </div>
            }
          </div>
          <ui-button variant="secondary" size="sm" (click)="checkForUpdate()" [disabled]="checkingUpdate()">
            <lucide-icon name="check" [size]="14" />
            {{ checkingUpdate() ? t('v2.settings.checking') : t('v2.settings.checkForUpdates') }}
          </ui-button>
        </div>
      </ui-card>

      <!-- Legal -->
      <ui-card variant="flat" class="block mb-3">
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
      </ui-card>

      } @else {
        <p class="v2-caption">{{ t('settings.signInFirst') }}</p>
      }
    </ui-sheet>
    </ng-container>
  `,
})
export class SettingsSheetComponent {
  protected readonly auth = inject(AuthService);
  protected readonly firebase = inject(LEDGER_PORT);
  private readonly callables = inject(CallableGateway);
  protected readonly store = inject(FitnessStore);
  protected readonly pushService = inject(PushNotificationService);
  protected readonly subs = inject(SubscriptionService);
  protected readonly translation = inject(TranslationService);
  private readonly analytics = inject(AnalyticsService);
  private readonly swUpdate = inject(SwUpdate);

  readonly darkMode = input.required<boolean>();
  readonly themeChoice = input.required<ThemeChoice>();

  readonly close = output<void>();
  readonly redoOnboarding = output<void>();
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
  /** Latched when the manual check installs a new version. Drives the
   *  inline Reload button — kept separate from updateMsg so the
   *  message can clear without hiding the affordance. */
  protected readonly updateAvailable = signal(false);

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
        this.updateAvailable.set(true);
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

  /** Inline reload from the settings sheet. activateUpdate swaps the
   *  waiting SW into control; location.reload then loads the fresh
   *  shell. Try/finally so a thrown activateUpdate (rare but possible
   *  with no waiting worker) still triggers the reload — at worst the
   *  user reloads against the same version. */
  protected async reloadForUpdate(): Promise<void> {
    try { await this.swUpdate.activateUpdate(); }
    finally { document.location.reload(); }
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

  // Escape handling lives in <ui-sheet>; no override needed.

  protected requestClose(): void { this.close.emit(); }
  protected onRedoOnboarding(): void {
    this.redoOnboarding.emit();
    this.requestClose();
  }
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

  // ─── CSV export ──────────────────────────────────────────────
  protected readonly exporting = signal(false);
  protected readonly exportError = signal(false);

  protected async exportData(): Promise<void> {
    if (this.exporting()) return;
    this.exporting.set(true);
    this.exportError.set(false);
    try {
      const [logs, measurements, dailyWeights, dailyWater, workoutSessions] = await Promise.all([
        this.firebase.getRecentLogs(9999),
        this.firebase.getRecentMeasurements(9999),
        this.firebase.getDailyWeights(),
        this.firebase.getDailyWater(),
        this.firebase.getAllSessions(),
      ]);
      const csv = buildCsv({ logs, measurements, dailyWeights, dailyWater, workoutSessions });
      const stamp = new Date().toISOString().slice(0, 10);
      downloadCsv(`macrolog-export-${stamp}.csv`, csv);
      this.analytics.track('data_export_csv', {
        rows: logs.length + measurements.length + workoutSessions.length,
      });
    } catch {
      this.exportError.set(true);
    } finally {
      this.exporting.set(false);
    }
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

  // ─── Refer a friend ──────────────────────────────────────────
  protected readonly referralCopied = signal(false);
  private referralCopyTimer: ReturnType<typeof setTimeout> | null = null;

  protected readonly referralLink = computed(() => {
    const uid = this.auth.user()?.uid;
    return uid ? buildReferralLink(uid) : null;
  });

  /** Server-stamped reward expiry — when present and in the future,
   *  the user is currently inside their bonus window from a referral
   *  conversion. Surfaced as a positive confirmation under the share
   *  controls so users see the loop actually paid out. */
  protected readonly referralRewardActive = computed<string | null>(() => {
    // `compedUntil` crosses the ledger seam as a domain `Date` (never a
    // Firestore Timestamp) — see CONTEXT.md "Date type at the seam".
    const t = this.firebase.profile()?.compedUntil;
    if (!t) return null;
    const ms = t.getTime();
    if (ms <= Date.now()) return null;
    return new Date(ms).toLocaleDateString(undefined, {
      year: 'numeric', month: 'short', day: 'numeric',
    });
  });

  protected async copyReferralLink(): Promise<void> {
    const link = this.referralLink();
    if (!link) return;
    try {
      await navigator.clipboard.writeText(link);
      this.referralCopied.set(true);
      this.analytics.track('referral_copied');
      if (this.referralCopyTimer) clearTimeout(this.referralCopyTimer);
      this.referralCopyTimer = setTimeout(() => this.referralCopied.set(false), 2000);
    } catch { /* clipboard rejected — silent */ }
  }

  protected async shareReferral(): Promise<void> {
    const link = this.referralLink();
    if (!link) return;
    const channel = await share({
      title: this.translation.t('settings.referral.shareTitle'),
      text: this.translation.t('settings.referral.shareText'),
      url: link,
    });
    this.analytics.track('referral_shared', { channel });
    if (channel === 'clipboard') {
      this.referralCopied.set(true);
      if (this.referralCopyTimer) clearTimeout(this.referralCopyTimer);
      this.referralCopyTimer = setTimeout(() => this.referralCopied.set(false), 2000);
    }
  }

  // ─── Weekly digest opt-in ───────────────────────────────────
  protected readonly weeklyDigestOptIn = computed<boolean>(() => {
    const profile = this.firebase.profile() as { weeklyDigestOptIn?: boolean } | null;
    return profile?.weeklyDigestOptIn === true;
  });

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

  // ─── Public profile (/u/<slug>) ─────────────────────────────
  protected readonly publicSlug = computed<string | null>(() => {
    const profile = this.firebase.profile() as { publicSlug?: string; publicProfileEnabled?: boolean } | null;
    return profile?.publicProfileEnabled && profile.publicSlug ? profile.publicSlug : null;
  });
  protected readonly publicDisplayNameStored = computed<string>(() => {
    const profile = this.firebase.profile() as { publicDisplayName?: string } | null;
    return profile?.publicDisplayName ?? '';
  });
  protected readonly slugInput = signal<string>('');
  protected readonly publicDisplayNameInput = signal<string>('');
  protected readonly publicBusy = signal(false);
  protected readonly publicError = signal<string | null>(null);

  /** Seed the inputs from the stored profile when the sheet opens. */
  private seededPublicProfile = false;
  private seedPublicProfileInputs(): void {
    if (this.seededPublicProfile) return;
    const slug = this.publicSlug();
    if (slug != null) this.slugInput.set(slug);
    const dn = this.publicDisplayNameStored();
    if (dn) this.publicDisplayNameInput.set(dn);
    this.seededPublicProfile = true;
  }

  protected onSlugInput(ev: Event): void {
    this.seedPublicProfileInputs();
    const v = (ev.target as HTMLInputElement).value
      .toLowerCase()
      .replace(/[^a-z0-9-]/g, '')
      .slice(0, 30);
    this.slugInput.set(v);
    if (this.publicError()) this.publicError.set(null);
  }

  protected onDisplayNameInput(ev: Event): void {
    this.seedPublicProfileInputs();
    this.publicDisplayNameInput.set((ev.target as HTMLInputElement).value.slice(0, 40));
  }

  protected async claimSlug(): Promise<void> {
    const slug = this.slugInput().trim();
    if (!slug || this.publicBusy()) return;
    this.publicBusy.set(true);
    this.publicError.set(null);
    try {
      await this.callables.call<{ slug: string; displayName?: string }, { slug: string }>(
        'claimPublicSlug',
        { slug, displayName: this.publicDisplayNameInput().trim() || undefined },
      );
      // Profile snapshot listener will re-render the link once Firestore syncs.
    } catch (err) {
      const code = (err as { code?: string })?.code ?? '';
      if (code === 'functions/already-exists') {
        this.publicError.set(this.translation.t('publicProfileSettings.errorTaken'));
      } else if (code === 'functions/invalid-argument') {
        // Could be reserved or format — message string distinguishes.
        const msg = (err as { message?: string })?.message ?? '';
        this.publicError.set(msg.includes('reserved')
          ? this.translation.t('publicProfileSettings.errorReserved')
          : this.translation.t('publicProfileSettings.errorFormat'));
      } else {
        this.publicError.set((err as Error)?.message ?? 'unknown error');
      }
    } finally {
      this.publicBusy.set(false);
    }
  }

  protected async releaseSlug(): Promise<void> {
    if (this.publicBusy()) return;
    this.publicBusy.set(true);
    this.publicError.set(null);
    try {
      await this.callables.call<Record<string, never>, { released: boolean }>('releasePublicSlug', {});
      this.slugInput.set('');
      this.publicDisplayNameInput.set('');
      this.seededPublicProfile = false;
    } catch (err) {
      this.publicError.set((err as Error)?.message ?? 'unknown error');
    } finally {
      this.publicBusy.set(false);
    }
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
