import {
  AfterViewInit, ChangeDetectionStrategy, Component, ElementRef, HostListener,
  computed, inject, input, output, signal, viewChild,
} from '@angular/core';
import { TranslocoDirective } from '@jsverse/transloco';
import { AuthService } from '../../services/auth.service';
import { LEDGER_PORT } from '../../ledger/ports/ledger.port';
import { FitnessStore } from '../../services/fitness-store.service';
import { PushNotificationService } from '../../services/push-notification.service';
import { SubscriptionService } from '../../services/subscription.service';
import { TranslationService } from '../../services/translation.service';
import { AppLang } from '../../i18n/transloco.providers';
import { SubscribeComponent } from '../subscribe/subscribe.component';
import { HistorySheetComponent } from '../history-sheet/history-sheet.component';
import { ThemeChoice } from '../../utils/theme';

/**
 * All-in-one settings sheet. Replaces the grab-bag of inline links that
 * used to live in the footer. Opens as a slide-in panel from the right
 * on desktop, full-screen on mobile.
 *
 * Sections are grouped by user concern:
 *   - Profile:     edit, sign out
 *   - Reminders:   push permission, daily reminder hour
 *   - Language:    English / Español (PR) toggle
 *   - Data:        Apple Shortcuts webhook, export, delete account (→ /privacy)
 *   - Modes:       travel mode, theme (dark/light)
 *   - Subscription: the Subscribe card (voluntary, conditional on Stripe config)
 *
 * Closing: backdrop click, the X button, or Escape. Focus is pulled to
 * the close button on open; `role="dialog"` + `aria-modal="true"` tell
 * assistive tech that the sheet is modal.
 */
@Component({
  selector: 'app-settings-sheet',
  standalone: true,
  imports: [SubscribeComponent, HistorySheetComponent, TranslocoDirective],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <ng-container *transloco="let t">
    <div class="fixed inset-0 z-40 bg-ink/40 backdrop-blur-sm ink-in"
      (click)="requestClose()"
      aria-hidden="true"></div>

    <aside class="fixed inset-y-0 right-0 z-50 w-full sm:max-w-md
        overflow-y-auto settings-slide"
      role="dialog" aria-modal="true" aria-labelledby="settings-title"
      style="background: var(--color-paper);"
      (click)="$event.stopPropagation()">
      <div class="px-5 py-6 sm:px-7">
        <!-- Header -->
        <div class="flex items-start justify-between gap-3 mb-6">
          <div>
            <div class="flex items-center gap-3 mb-1">
              <span class="stamp-mark" style="transform: rotate(0deg)">{{ t('settings.menuStamp') }}</span>
              <span class="data-label">{{ t('settings.sectionLabel') }}</span>
            </div>
            <h2 id="settings-title" class="font-display text-3xl leading-[0.95] text-ink mt-2">
              {{ t('settings.titleLead') }}<br/><em class="text-blood">{{ t('settings.titleEm') }}</em>
            </h2>
          </div>
          <button type="button" (click)="requestClose()"
            [attr.aria-label]="t('settings.close')"
            class="tag-btn text-sm shrink-0"
            #closeBtn>&times;</button>
        </div>

        @if (auth.user(); as u) {

        <!-- Section TOC — sticky chip row at top of the sheet body so
             users on mobile can jump to a section without scrolling past
             6 others. Uses anchor hrefs + CSS scroll-margin on the
             targets so the landing position clears the header. -->
        <nav class="sticky top-0 z-10 -mx-2 px-2 py-2 mb-5 flex flex-wrap gap-1.5"
             style="background: var(--color-paper); border-bottom: 1px solid var(--color-rule-soft)"
             [attr.aria-label]="t('settings.tocAria')">
          <!-- Buttons, not <a href="#...">, because a hash link overwrites
               the browser URL path (e.g. /app → /#settings-subscription),
               which kicks the user out of the gated /app route and closes
               the settings sheet with them. jumpTo() uses scrollIntoView
               with no URL mutation so the drawer stays open. -->
          <button type="button" (click)="jumpTo('settings-profile')" class="tag-btn text-[10px]">{{ t('settings.profile.section') }}</button>
          <button type="button" (click)="jumpTo('settings-language')" class="tag-btn text-[10px]">{{ t('settings.language.section') }}</button>
          <button type="button" (click)="jumpTo('settings-reminders')" class="tag-btn text-[10px]">{{ t('settings.reminders.section') }}</button>
          <button type="button" (click)="jumpTo('settings-modes')" class="tag-btn text-[10px]">{{ t('settings.modes.section') }}</button>
          <button type="button" (click)="jumpTo('settings-data')" class="tag-btn text-[10px]">{{ t('settings.data.section') }}</button>
          <button type="button" (click)="jumpTo('settings-subscription')" class="tag-btn text-[10px]">{{ t('settings.subscription.section') }}</button>
          <button type="button" (click)="jumpTo('settings-feedback')" class="tag-btn text-[10px]">{{ t('settings.feedback.section') }}</button>
          <button type="button" (click)="jumpTo('settings-legal')" class="tag-btn text-[10px]">{{ t('settings.legal.section') }}</button>
        </nav>

        <!-- ─── Profile ───────────────────────────────────────── -->
        <section id="settings-profile" class="mb-7 scroll-mt-16">
          <div class="data-label mb-3">{{ t('settings.profile.section') }}</div>
          <p class="font-sans text-xs text-graphite mb-3">
            {{ t('settings.profile.signedInAs') }} <span class="text-ink font-medium">{{ u.email }}</span>
          </p>
          <div class="flex flex-wrap gap-2">
            <button type="button" (click)="editProfile.emit(); requestClose()"
              class="tag-btn text-[11px]">
              {{ t('settings.profile.edit') }}
            </button>
            <button type="button" (click)="signOut()"
              class="tag-btn text-[11px] text-blood border-blood/40">
              {{ t('settings.profile.signOut') }}
            </button>
          </div>
        </section>

        <!-- ─── Language ──────────────────────────────────────── -->
        <section id="settings-language" class="mb-7 scroll-mt-16">
          <div class="data-label mb-3">{{ t('settings.language.section') }}</div>
          <div class="flex items-center justify-between gap-3 mb-2">
            <div class="min-w-0">
              <div class="font-sans text-sm text-ink">{{ t('settings.language.label') }}</div>
              <p class="caption text-[11px] leading-relaxed mt-0.5">
                {{ t('settings.language.desc') }}
              </p>
            </div>
            <div class="flex gap-2 shrink-0">
              <button type="button" (click)="selectLanguage('en')"
                [attr.aria-pressed]="translation.language() === 'en'"
                class="tag-btn text-[11px]"
                [style.border-color]="translation.language() === 'en' ? 'var(--color-blood)' : ''"
                [style.color]="translation.language() === 'en' ? 'var(--color-blood)' : ''">
                {{ t('settings.language.english') }}
              </button>
              <button type="button" (click)="selectLanguage('es-PR')"
                [attr.aria-pressed]="translation.language() === 'es-PR'"
                class="tag-btn text-[11px]"
                [style.border-color]="translation.language() === 'es-PR' ? 'var(--color-blood)' : ''"
                [style.color]="translation.language() === 'es-PR' ? 'var(--color-blood)' : ''">
                {{ t('settings.language.spanish') }}
              </button>
            </div>
          </div>
          @if (showEsBetaBanner()) {
            <p class="specimen px-3 py-2 text-[11px] leading-relaxed mt-2"
               role="status"
               style="border-color: var(--color-gold); color: var(--color-ink);">
              {{ t('legal.esBetaBanner') }}
            </p>
          }
        </section>

        <!-- ─── Reminders ─────────────────────────────────────── -->
        <section id="settings-reminders" class="mb-7 scroll-mt-16">
          <div class="data-label mb-3">{{ t('settings.reminders.section') }}</div>

          <!-- Push notifications -->
          <div class="flex items-center justify-between gap-3 mb-3">
            <div class="min-w-0">
              <div class="font-sans text-sm text-ink">{{ t('settings.reminders.push') }}</div>
              <p class="caption text-[11px] leading-relaxed mt-0.5">
                @if (pushService.permission() === 'granted') {
                  {{ t('settings.reminders.pushOn') }}
                } @else if (pushService.permission() === 'unsupported') {
                  {{ t('settings.reminders.pushUnsupported') }}
                } @else if (pushService.permission() === 'denied') {
                  {{ t('settings.reminders.pushDenied') }}
                } @else {
                  {{ t('settings.reminders.pushDefault') }}
                }
              </p>
            </div>
            @if (pushService.permission() === 'granted') {
              <span class="stamp-mark shrink-0"
                style="transform: rotate(0deg); border-color: var(--color-olive); color: var(--color-olive)">
                {{ t('settings.reminders.pushOnBadge') }}
              </span>
            } @else if (pushService.permission() === 'default') {
              <button type="button" (click)="enablePush()"
                class="tag-btn text-[11px] shrink-0">
                {{ t('settings.reminders.pushEnable') }}
              </button>
            }
          </div>

          <!-- Reminder hour dropdown -->
          <div class="flex items-center justify-between gap-3">
            <div>
              <div class="font-sans text-sm text-ink">{{ t('settings.reminders.hour') }}</div>
              <p class="caption text-[11px]">{{ t('settings.reminders.hourDesc') }}</p>
            </div>
            <select
              [value]="reminderHour()"
              (change)="setReminderHour(+$any($event.target).value)"
              [attr.aria-label]="t('settings.reminders.hourAria')"
              class="bg-transparent text-ink font-sans text-sm border-b border-rule cursor-pointer px-2 py-1">
              @for (h of reminderHours; track h) {
                <option [value]="h" [selected]="h === reminderHour()">{{ formatHour(h) }}</option>
              }
            </select>
          </div>

          <p class="caption text-[11px] leading-relaxed mt-4" style="color: var(--color-graphite)">
            {{ t('settings.reminders.utcHint') }}
          </p>
        </section>

        <!-- ─── Modes ─────────────────────────────────────────── -->
        <section id="settings-modes" class="mb-7 scroll-mt-16">
          <div class="data-label mb-3">{{ t('settings.modes.section') }}</div>

          <!-- Travel mode -->
          <div class="flex items-center justify-between gap-3 mb-3">
            <div class="min-w-0">
              <div class="font-sans text-sm text-ink">{{ t('settings.modes.travel') }}</div>
              <p class="caption text-[11px] leading-relaxed mt-0.5">
                {{ t('settings.modes.travelDesc') }}
              </p>
            </div>
            <button type="button" (click)="store.toggleTravelMode()"
              [attr.aria-pressed]="store.travelMode()"
              [attr.aria-label]="store.travelMode() ? t('settings.modes.travelAriaOff') : t('settings.modes.travelAriaOn')"
              class="tag-btn text-[11px] shrink-0"
              [style.border-color]="store.travelMode() ? 'var(--color-gold)' : ''"
              [style.color]="store.travelMode() ? 'var(--color-gold)' : ''">
              {{ store.travelMode() ? t('settings.modes.travelOn') : t('settings.modes.travelOff') }}
            </button>
          </div>

          <!-- Theme -->
          <div>
            <div class="flex items-start justify-between gap-3 mb-2">
              <div>
                <div class="font-sans text-sm text-ink">{{ t('settings.modes.theme') }}</div>
                <p class="caption text-[11px]">{{ t('settings.modes.themeDesc') }}</p>
              </div>
              @if (!isPaid()) {
                <span class="font-mono text-[9px] tracking-widest uppercase text-graphite border border-rule/60 px-1.5 py-0.5 shrink-0">
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
                  class="tag-btn text-[11px] py-2 flex flex-col items-center gap-1"
                  [class.border-blood]="themeChoice() === opt.value"
                  [class.text-blood]="themeChoice() === opt.value"
                  [class.opacity-50]="opt.pro && !isPaid()">
                  <span class="inline-block w-6 h-4 border border-rule/60"
                    [style.background]="opt.swatch"></span>
                  <span>{{ t(opt.labelKey) }}</span>
                </button>
              }
            </div>
          </div>
        </section>

        <!-- ─── Data ──────────────────────────────────────────── -->
        <section id="settings-data" class="mb-7 scroll-mt-16">
          <div class="data-label mb-3">{{ t('settings.data.section') }}</div>

          <!-- Apple Shortcuts webhook -->
          <div class="mb-4">
            <div class="flex items-center justify-between gap-3 mb-2">
              <div class="min-w-0">
                <div class="font-sans text-sm text-ink">{{ t('settings.data.webhook') }}</div>
                <p class="caption text-[11px] leading-relaxed mt-0.5">
                  {{ t('settings.data.webhookDesc') }}
                </p>
              </div>
              <button type="button" (click)="showWebhook.set(!showWebhook())"
                [attr.aria-expanded]="showWebhook()"
                class="tag-btn text-[11px] shrink-0">
                {{ showWebhook() ? t('settings.data.webhookHide') : t('settings.data.webhookShow') }}
              </button>
            </div>
            @if (showWebhook()) {
              <div class="specimen px-3 py-3 slide-down mt-2">
                <span class="crop-bl"></span><span class="crop-br"></span>
                @if (store.webhookApiKey(); as key) {
                  <div class="font-mono text-xs text-ink bg-paper-deep px-2 py-1.5 break-all select-all">
                    {{ key }}
                  </div>
                  <p class="caption text-[11px] mt-2">
                    {{ t('settings.data.webhookEndpoint') }} <span class="font-mono text-ink not-italic text-[11px]">{{ webhookUrl }}</span>
                  </p>
                  <div class="mt-2 flex gap-2 items-center">
                    <button type="button" (click)="copyWebhookKey()"
                      class="tag-btn text-[11px]">
                      {{ webhookCopied() ? t('settings.data.webhookCopied') : t('settings.data.webhookCopy') }}
                    </button>
                    <button type="button" (click)="store.revokeWebhookApiKey()"
                      class="tag-btn text-[11px] text-blood border-blood/40">{{ t('settings.data.webhookRevoke') }}</button>
                    @if (webhookCopied()) {
                      <!-- Live-region confirmation so screen readers announce
                           the copy succeeded; the visible button label change
                           above covers sighted users. -->
                      <span class="sr-only" role="status" aria-live="polite">
                        {{ t('settings.data.webhookCopiedAria') }}
                      </span>
                    }
                  </div>
                } @else {
                  <p class="caption text-[11px] mb-2">
                    {{ t('settings.data.webhookGenerateHint') }}
                  </p>
                  <button type="button" (click)="store.generateWebhookApiKey()"
                    class="tag-btn text-[11px]">
                    {{ t('settings.data.webhookGenerate') }}
                  </button>
                }
              </div>
            }
          </div>

          <!-- Account deletion -->
          <div class="flex items-center justify-between gap-3">
            <div>
              <div class="font-sans text-sm text-ink">{{ t('settings.data.delete') }}</div>
              <p class="caption text-[11px]">{{ t('settings.data.deleteDesc') }}</p>
            </div>
            <a href="/privacy#delete" class="tag-btn text-[11px] text-blood border-blood/40">
              {{ t('settings.data.deleteManage') }}
            </a>
          </div>
        </section>

        <!-- ─── Subscription ──────────────────────────────────── -->
        <section id="settings-subscription" class="mb-7 scroll-mt-16">
          <div class="data-label mb-3">{{ t('settings.subscription.section') }}</div>
          <app-subscribe />
        </section>

        <!-- ─── History ───────────────────────────────────────── -->
        <section id="settings-history" class="mb-7 scroll-mt-16">
          <div class="data-label mb-3">{{ t('settings.history.section') }}</div>
          <div class="flex items-center justify-between gap-3">
            <div class="min-w-0">
              <div class="font-sans text-sm text-ink">{{ t('settings.history.label') }}</div>
              <p class="caption text-[11px] leading-relaxed mt-0.5">
                {{ t('settings.history.desc') }}
              </p>
            </div>
            <button type="button" (click)="historyOpen.set(!historyOpen())"
              class="tag-btn text-[11px] shrink-0">
              {{ historyOpen() ? t('settings.history.hide') : t('settings.history.open') }}
            </button>
          </div>
          @if (historyOpen()) {
            <div class="mt-4">
              <app-history-sheet />
            </div>
          }
        </section>

        <!-- ─── Feedback ──────────────────────────────────────── -->
        <section id="settings-feedback" class="mb-7 scroll-mt-16">
          <div class="data-label mb-3">{{ t('settings.feedback.section') }}</div>
          <div class="flex items-center justify-between gap-3">
            <div class="min-w-0">
              <div class="font-sans text-sm text-ink">{{ t('settings.feedback.label') }}</div>
              <p class="caption text-[11px] leading-relaxed mt-0.5">
                {{ t('settings.feedback.desc') }}
              </p>
            </div>
            <button type="button" (click)="sendFeedback()"
              [attr.aria-label]="t('settings.feedback.aria')"
              class="tag-btn text-[11px] shrink-0">{{ t('settings.feedback.send') }}</button>
          </div>
        </section>

        <!-- ─── Legal ─────────────────────────────────────────── -->
        <section id="settings-legal" class="scroll-mt-16">
          <div class="data-label mb-3">{{ t('settings.legal.section') }}</div>
          <p class="caption text-[11px] leading-relaxed">
            <a href="/privacy" class="underline decoration-dotted hover:text-blood">{{ t('settings.legal.privacy') }}</a>
            &middot;
            <a href="/terms" class="underline decoration-dotted hover:text-blood">{{ t('settings.legal.terms') }}</a>
            &middot;
            <a href="mailto:gabrielandresbermudez&#64;gmail.com"
              class="underline decoration-dotted hover:text-blood">{{ t('settings.legal.contact') }}</a>
          </p>
        </section>

        } @else {
          <p class="caption">{{ t('settings.signInFirst') }}</p>
        }
      </div>
    </aside>
    </ng-container>
  `,
  styles: [`
    /* Slide in from right on desktop. Starts off-screen to preserve the
       horizontal motion cue; on narrow viewports it covers the full width
       so the motion just reads as a panel rising into view. */
    @keyframes settings-slide-in {
      from { transform: translateX(100%); }
      to   { transform: translateX(0); }
    }
    .settings-slide {
      animation: settings-slide-in 260ms cubic-bezier(0.2, 0.7, 0.3, 1) both;
      box-shadow: -8px 0 24px rgba(0, 0, 0, 0.12);
    }
    @media (prefers-reduced-motion: reduce) {
      .settings-slide { animation: none; }
    }
  `],
})
export class SettingsSheetComponent implements AfterViewInit {
  protected readonly auth = inject(AuthService);
  protected readonly firebase = inject(LEDGER_PORT);
  protected readonly store = inject(FitnessStore);
  protected readonly pushService = inject(PushNotificationService);
  protected readonly subs = inject(SubscriptionService);
  protected readonly translation = inject(TranslationService);

  /** Parent-owned current theme state. Input (not getter) so the sheet
      re-renders correctly under OnPush when the user toggles. */
  readonly darkMode = input.required<boolean>();
  /** Current theme choice for the picker. Parent (App) owns the
      canonical value; this input keeps the radio group in sync. */
  readonly themeChoice = input.required<ThemeChoice>();

  readonly close = output<void>();
  readonly editProfile = output<void>();
  /** Selected theme value from the radio-group picker. Parent applies
      the Pro gate + persistence + CSS update. */
  readonly themeSelect = output<ThemeChoice>();

  /** Whether Pro-gated options are available. Bound by settings-sheet's
      template so unpaid users see the options as disabled. */
  protected readonly isPaid = computed(() => this.subs.isPaid());

  /** History panel is collapsed by default to keep the settings sheet
      short. Loading allTimeLogs is cheap (signal read; already loaded)
      but rendering a long list adds layout cost. */
  protected readonly historyOpen = signal(false);

  /** Picker options. Swatches are inline so reviewers can see the
      palette intent alongside the CSS tokens. Keep in sync with
      `[data-theme="…"]` blocks in styles.css. */
  protected readonly themeOptions: ReadonlyArray<{
    value: ThemeChoice;
    labelKey: string;
    swatch: string;
    pro: boolean;
  }> = [
    { value: 'auto',         labelKey: 'settings.modes.themeAuto',     swatch: 'linear-gradient(90deg, #f4f0e8 50%, #1a1816 50%)', pro: false },
    { value: 'light',        labelKey: 'settings.modes.themeLightOpt', swatch: '#f4f0e8', pro: false },
    { value: 'dark',         labelKey: 'settings.modes.themeDarkOpt',  swatch: '#1a1816', pro: false },
    { value: 'sepia',        labelKey: 'settings.modes.themeSepia',    swatch: '#efe6d2', pro: true  },
    { value: 'graphite',     labelKey: 'settings.modes.themeGraphite', swatch: '#e8e6e2', pro: true  },
    { value: 'oxblood-dark', labelKey: 'settings.modes.themeOxblood',  swatch: '#1a1010', pro: true  },
  ];

  protected chooseTheme(value: ThemeChoice): void {
    this.themeSelect.emit(value);
  }

  private readonly closeBtn = viewChild<ElementRef<HTMLButtonElement>>('closeBtn');

  /** Show the ES-beta banner whenever the active language is es-PR.
      Keeps the warning visible on every visit to settings, not just
      the first flip — the user can always confirm the app knows it's
      serving draft translations. */
  protected readonly showEsBetaBanner = computed(() => this.translation.language() === 'es-PR');

  /** Close on Escape, but only when focus is on non-editing chrome.
      Without this, pressing Escape to dismiss the native <select>
      dropdown (reminder-hour) would also close the whole sheet. */
  @HostListener('document:keydown.escape', ['$event'])
  protected onEscape(evt: Event): void {
    const active = document.activeElement as HTMLElement | null;
    const tag = active?.tagName;
    if (tag === 'SELECT' || tag === 'INPUT' || tag === 'TEXTAREA') return;
    if (evt.defaultPrevented) return;
    this.requestClose();
  }

  /** Scroll a settings sub-section into view. We avoid <a href="#id">
      because hash navigation rewrites the browser URL path (/app →
      /#id), kicking the user out of the gated route and closing the
      sheet. Silent scroll keeps state intact. */
  protected jumpTo(id: string): void {
    document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  protected readonly showWebhook = signal(false);
  protected readonly reminderHours = Array.from({ length: 24 }, (_, i) => i);
  protected readonly reminderHour = computed(() => (this.firebase.profile() as any)?.reminderHour ?? 20);
  protected readonly webhookUrl = 'https://us-central1-fitness-tracker-gb-1775407101.cloudfunctions.net/logWebhook';

  /** Move focus to the close button when the sheet opens, so keyboard
      users don't stay parked on the gear button behind the backdrop.
      WAI-ARIA APG requires initial focus inside a modal dialog. */
  ngAfterViewInit(): void {
    queueMicrotask(() => this.closeBtn()?.nativeElement.focus());
  }

  protected requestClose(): void {
    this.close.emit();
  }

  protected selectLanguage(lang: AppLang): void {
    this.translation.setLanguage(lang);
  }

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

  protected readonly webhookCopied = signal(false);
  private webhookCopyTimer: ReturnType<typeof setTimeout> | null = null;

  protected async copyWebhookKey(): Promise<void> {
    const key = this.store.webhookApiKey();
    if (!key) return;
    try {
      await navigator.clipboard.writeText(key);
      this.webhookCopied.set(true);
      if (this.webhookCopyTimer) clearTimeout(this.webhookCopyTimer);
      this.webhookCopyTimer = setTimeout(() => this.webhookCopied.set(false), 2000);
    } catch {
      // Clipboard API can reject on insecure contexts or permission denial;
      // fall back to leaving the label unchanged rather than pretending the
      // copy succeeded. The key is still visible above for manual copy.
    }
  }

  /** Open the user's mail app with a pre-filled feedback template.
      Including browser + path info removes the round-trip of "what
      browser? what page?" that otherwise kills bug-report signal. */
  protected sendFeedback(): void {
    const subject = this.translation.t('settings.feedback.emailSubject');
    const whatHappened = this.translation.t('settings.feedback.whatHappened');
    const expected = this.translation.t('settings.feedback.expected');
    const build = (globalThis as unknown as { __MACROLOG_RELEASE__?: string }).__MACROLOG_RELEASE__ ?? 'dev';
    const body = [
      whatHappened,
      '',
      '',
      expected,
      '',
      '',
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
