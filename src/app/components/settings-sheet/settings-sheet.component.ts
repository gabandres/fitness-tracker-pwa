import {
  AfterViewInit, ChangeDetectionStrategy, Component, ElementRef, HostListener,
  computed, inject, input, output, signal, viewChild,
} from '@angular/core';
import { AuthService } from '../../services/auth.service';
import { FirebaseService } from '../../services/firebase.service';
import { FitnessStore } from '../../services/fitness-store.service';
import { PushNotificationService } from '../../services/push-notification.service';
import { SubscribeComponent } from '../subscribe/subscribe.component';

/**
 * All-in-one settings sheet. Replaces the grab-bag of inline links that
 * used to live in the footer. Opens as a slide-in panel from the right
 * on desktop, full-screen on mobile.
 *
 * Sections are grouped by user concern:
 *   - Profile:     edit, sign out
 *   - Reminders:   push permission, daily reminder hour
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
  imports: [SubscribeComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
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
              <span class="stamp-mark" style="transform: rotate(0deg)">menu</span>
              <span class="data-label">settings</span>
            </div>
            <h2 id="settings-title" class="font-display text-3xl leading-[0.95] text-ink mt-2">
              Your<br/><em class="text-blood">settings.</em>
            </h2>
          </div>
          <button type="button" (click)="requestClose()"
            aria-label="Close settings"
            class="tag-btn text-sm shrink-0"
            #closeBtn>&times;</button>
        </div>

        @if (auth.user(); as u) {

        <!-- ─── Profile ───────────────────────────────────────── -->
        <section class="mb-7">
          <div class="data-label mb-3">profile</div>
          <p class="font-sans text-xs text-graphite mb-3">
            signed in as <span class="text-ink font-medium">{{ u.email }}</span>
          </p>
          <div class="flex flex-wrap gap-2">
            <button type="button" (click)="editProfile.emit(); requestClose()"
              class="tag-btn text-[11px]">
              edit profile
            </button>
            <button type="button" (click)="signOut()"
              class="tag-btn text-[11px] text-blood border-blood/40">
              sign out
            </button>
          </div>
        </section>

        <!-- ─── Reminders ─────────────────────────────────────── -->
        <section class="mb-7">
          <div class="data-label mb-3">reminders</div>

          <!-- Push notifications -->
          <div class="flex items-center justify-between gap-3 mb-3">
            <div class="min-w-0">
              <div class="font-sans text-sm text-ink">push notifications</div>
              <p class="caption text-[11px] leading-relaxed mt-0.5">
                @if (pushService.permission() === 'granted') {
                  on — you'll get a nudge after your reminder time if you haven't logged.
                } @else if (pushService.permission() === 'unsupported') {
                  your browser doesn't support push notifications.
                } @else if (pushService.permission() === 'denied') {
                  blocked — update your browser's site settings to re-enable.
                } @else {
                  get a nudge after your reminder time if you haven't logged.
                }
              </p>
            </div>
            @if (pushService.permission() === 'granted') {
              <span class="stamp-mark shrink-0"
                style="transform: rotate(0deg); border-color: var(--color-olive); color: var(--color-olive)">
                on
              </span>
            } @else if (pushService.permission() === 'default') {
              <button type="button" (click)="enablePush()"
                class="tag-btn text-[11px] shrink-0">
                enable
              </button>
            }
          </div>

          <!-- Reminder hour dropdown -->
          <div class="flex items-center justify-between gap-3">
            <div>
              <div class="font-sans text-sm text-ink">reminder time</div>
              <p class="caption text-[11px]">when to check whether you've logged today.</p>
            </div>
            <select
              [value]="reminderHour()"
              (change)="setReminderHour(+$any($event.target).value)"
              aria-label="Daily reminder hour"
              class="bg-transparent text-ink font-sans text-sm border-b border-rule cursor-pointer px-2 py-1">
              @for (h of reminderHours; track h) {
                <option [value]="h" [selected]="h === reminderHour()">{{ formatHour(h) }}</option>
              }
            </select>
          </div>
        </section>

        <!-- ─── Modes ─────────────────────────────────────────── -->
        <section class="mb-7">
          <div class="data-label mb-3">modes</div>

          <!-- Travel mode -->
          <div class="flex items-center justify-between gap-3 mb-3">
            <div class="min-w-0">
              <div class="font-sans text-sm text-ink">travel mode</div>
              <p class="caption text-[11px] leading-relaxed mt-0.5">
                suspends your cut while traveling — target becomes maintenance. toggle off when you're home.
              </p>
            </div>
            <button type="button" (click)="store.toggleTravelMode()"
              [attr.aria-pressed]="store.travelMode()"
              [attr.aria-label]="store.travelMode() ? 'Turn travel mode off' : 'Turn travel mode on'"
              class="tag-btn text-[11px] shrink-0"
              [style.border-color]="store.travelMode() ? 'var(--color-gold)' : ''"
              [style.color]="store.travelMode() ? 'var(--color-gold)' : ''">
              {{ store.travelMode() ? 'on' : 'off' }}
            </button>
          </div>

          <!-- Theme -->
          <div class="flex items-center justify-between gap-3">
            <div>
              <div class="font-sans text-sm text-ink">appearance</div>
              <p class="caption text-[11px]">dark mode follows your system preference by default.</p>
            </div>
            <button type="button" (click)="toggleTheme.emit()"
              [attr.aria-pressed]="darkMode()"
              [attr.aria-label]="darkMode() ? 'Switch to light mode' : 'Switch to dark mode'"
              class="tag-btn text-[11px] shrink-0">
              {{ darkMode() ? '☀ light' : '☾ dark' }}
            </button>
          </div>
        </section>

        <!-- ─── Data ──────────────────────────────────────────── -->
        <section class="mb-7">
          <div class="data-label mb-3">data</div>

          <!-- Apple Shortcuts webhook -->
          <div class="mb-4">
            <div class="flex items-center justify-between gap-3 mb-2">
              <div class="min-w-0">
                <div class="font-sans text-sm text-ink">apple shortcuts webhook</div>
                <p class="caption text-[11px] leading-relaxed mt-0.5">
                  log entries from an iOS shortcut or any HTTP client.
                </p>
              </div>
              <button type="button" (click)="showWebhook.set(!showWebhook())"
                [attr.aria-expanded]="showWebhook()"
                class="tag-btn text-[11px] shrink-0">
                {{ showWebhook() ? 'hide' : 'show' }}
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
                    endpoint: <span class="font-mono text-ink not-italic text-[11px]">{{ webhookUrl }}</span>
                  </p>
                  <div class="mt-2 flex gap-2">
                    <button type="button" (click)="copyWebhookKey()"
                      class="tag-btn text-[11px]">copy key</button>
                    <button type="button" (click)="store.revokeWebhookApiKey()"
                      class="tag-btn text-[11px] text-blood border-blood/40">revoke</button>
                  </div>
                } @else {
                  <p class="caption text-[11px] mb-2">
                    generate a key to enable the webhook endpoint.
                  </p>
                  <button type="button" (click)="store.generateWebhookApiKey()"
                    class="tag-btn text-[11px]">
                    generate api key
                  </button>
                }
              </div>
            }
          </div>

          <!-- Account deletion -->
          <div class="flex items-center justify-between gap-3">
            <div>
              <div class="font-sans text-sm text-ink">delete your account</div>
              <p class="caption text-[11px]">permanently erase every log, preset, weight, and report.</p>
            </div>
            <a href="/privacy#delete" class="tag-btn text-[11px] text-blood border-blood/40">
              manage →
            </a>
          </div>
        </section>

        <!-- ─── Subscription ──────────────────────────────────── -->
        <section class="mb-7">
          <div class="data-label mb-3">subscription</div>
          <app-subscribe />
        </section>

        <!-- ─── Feedback ──────────────────────────────────────── -->
        <section class="mb-7">
          <div class="data-label mb-3">feedback</div>
          <div class="flex items-center justify-between gap-3">
            <div class="min-w-0">
              <div class="font-sans text-sm text-ink">report a bug or share feedback</div>
              <p class="caption text-[11px] leading-relaxed mt-0.5">
                opens your mail app with your browser + page info auto-filled, so you don't have to explain the setup.
              </p>
            </div>
            <button type="button" (click)="sendFeedback()"
              aria-label="Send feedback email"
              class="tag-btn text-[11px] shrink-0">send email</button>
          </div>
        </section>

        <!-- ─── Legal ─────────────────────────────────────────── -->
        <section>
          <div class="data-label mb-3">legal</div>
          <p class="caption text-[11px] leading-relaxed">
            <a href="/privacy" class="underline decoration-dotted hover:text-blood">privacy</a>
            &middot;
            <a href="/terms" class="underline decoration-dotted hover:text-blood">terms</a>
            &middot;
            <a href="mailto:gabrielandresbermudez&#64;gmail.com"
              class="underline decoration-dotted hover:text-blood">contact</a>
          </p>
        </section>

        } @else {
          <p class="caption">sign in first.</p>
        }
      </div>
    </aside>
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
  protected readonly firebase = inject(FirebaseService);
  protected readonly store = inject(FitnessStore);
  protected readonly pushService = inject(PushNotificationService);

  /** Parent-owned current theme state. Input (not getter) so the sheet
      re-renders correctly under OnPush when the user toggles. */
  readonly darkMode = input.required<boolean>();

  readonly close = output<void>();
  readonly editProfile = output<void>();
  /** Fired when the user toggles theme — the parent (App) owns the
      darkMode signal + applies the class to <html>, so we just notify. */
  readonly toggleTheme = output<void>();

  private readonly closeBtn = viewChild<ElementRef<HTMLButtonElement>>('closeBtn');

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
    if (key) await navigator.clipboard.writeText(key);
  }

  /** Open the user's mail app with a pre-filled feedback template.
      Including browser + path info removes the round-trip of "what
      browser? what page?" that otherwise kills bug-report signal. */
  protected sendFeedback(): void {
    const subject = 'Macro Log — feedback';
    const build = (globalThis as unknown as { __MACROLOG_RELEASE__?: string }).__MACROLOG_RELEASE__ ?? 'dev';
    const body = [
      'What happened:',
      '',
      '',
      'Expected:',
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
