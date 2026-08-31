import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { TranslocoDirective } from '@jsverse/transloco';
import {
  Auth,
  applyActionCode,
  confirmPasswordReset,
  verifyPasswordResetCode,
} from '@angular/fire/auth';
import { APP_STORE_URL, PLAY_STORE_URL } from '../../utils/app-store';
import { UiCard } from '../ui/card.component';

/**
 * The branded landing for Firebase auth action links (`/auth/action`).
 *
 * `sendVerificationEmail` and `sendPasswordReset` mint links whose HOST was
 * already rebranded to ignia.fit (auth-links.ts, 2026-07-24) — but the PATH
 * still pointed at `/__/auth/action`, Firebase Hosting's reserved stock OOB
 * handler: an unbranded Material card whose CONTINUE went to the homepage.
 * Every new email/password signup saw it (owner flagged it 2026-08-31, from
 * the funnel-verification throwaway's own email). Hosting reserves `/__/**`,
 * so that page cannot be restyled in place — this component replaces it by
 * consuming the `oobCode` ourselves via the injected Auth (single-SDK rule).
 *
 * Modes handled: `verifyEmail` (applied on load) and `resetPassword`
 * (code checked, then a new-password form). Anything else — `recoverEmail`,
 * second-factor reverts, links minted by flows we don't own — is passed
 * through to the stock handler with the query intact: a working ugly page
 * beats a branded dead end, the same conservatism auth-links.ts states.
 *
 * The success CTA deep-links into the app (`ignia://`): verification's whole
 * audience is someone the app just walled out, and the mobile verify screen
 * re-checks on foreground, so returning is enough to resume onboarding.
 */
@Component({
  selector: 'app-auth-action',
  standalone: true,
  imports: [TranslocoDirective, UiCard],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <ng-container *transloco="let t">
    <section class="max-w-[560px] mx-auto px-5 sm:px-6 py-16">
      <ui-card>
        @switch (state()) {
          @case ('working') {
            <p class="v2-caption" style="color: var(--v2-accent); text-transform: uppercase; letter-spacing: 0.08em;">Ignia</p>
            <h1 class="v2-h1 mt-2">{{ t('authAction.workingTitle') }}</h1>
            <p class="v2-body-soft mt-4">{{ t('authAction.workingBody') }}</p>
          }
          @case ('verified') {
            <p class="v2-caption" style="color: var(--v2-accent); text-transform: uppercase; letter-spacing: 0.08em;">{{ t('authAction.section') }}</p>
            <h1 class="v2-h1 mt-2">{{ t('authAction.verifiedTitle') }}</h1>
            <p class="v2-body-soft mt-4">{{ t('authAction.verifiedBody') }}</p>
            <div class="mt-8">
              <a href="ignia://" class="v2-btn v2-btn--primary">{{ t('authAction.openApp') }}</a>
            </div>
            <p class="v2-caption mt-4">{{ t('authAction.openAppHint') }}</p>
            <div class="mt-6 flex flex-wrap items-center gap-4">
              <a [href]="APP_STORE_URL" rel="noopener" [attr.aria-label]="t('retired.appStoreAlt')">
                <img src="/appstore-badge.svg" alt="{{ t('retired.appStoreAlt') }}"
                  width="180" height="60" loading="lazy" decoding="async" class="h-[44px] w-auto" />
              </a>
              <a [href]="PLAY_STORE_URL" rel="noopener" class="v2-link v2-caption">{{ t('retired.playStore') }}</a>
            </div>
          }
          @case ('resetForm') {
            <p class="v2-caption" style="color: var(--v2-accent); text-transform: uppercase; letter-spacing: 0.08em;">{{ t('authAction.section') }}</p>
            <h1 class="v2-h1 mt-2">{{ t('authAction.resetTitle') }}</h1>
            <p class="v2-body-soft mt-4">{{ t('authAction.resetBody', { email: resetEmail() }) }}</p>
            <label class="block mt-6">
              <span class="v2-caption">{{ t('authAction.passwordLabel') }}</span>
              <input type="password" autocomplete="new-password" class="v2-input mt-2 w-full"
                [value]="password()" (input)="password.set($any($event.target).value)"
                (keydown.enter)="submitReset()" />
            </label>
            <p class="v2-caption mt-2">{{ t('authAction.passwordHint') }}</p>
            @if (formError(); as err) {
              <p class="v2-caption mt-3" style="color: var(--v2-danger, #dc2626);" role="alert">{{ t(err) }}</p>
            }
            <div class="mt-6">
              <button type="button" class="v2-btn v2-btn--primary" [disabled]="busy()"
                (click)="submitReset()">{{ t('authAction.resetSubmit') }}</button>
            </div>
          }
          @case ('resetDone') {
            <p class="v2-caption" style="color: var(--v2-accent); text-transform: uppercase; letter-spacing: 0.08em;">{{ t('authAction.section') }}</p>
            <h1 class="v2-h1 mt-2">{{ t('authAction.resetDoneTitle') }}</h1>
            <p class="v2-body-soft mt-4">{{ t('authAction.resetDoneBody') }}</p>
            <div class="mt-8">
              <a href="ignia://" class="v2-btn v2-btn--primary">{{ t('authAction.openApp') }}</a>
            </div>
            <p class="v2-caption mt-4">{{ t('authAction.openAppHint') }}</p>
          }
          @case ('error') {
            <p class="v2-caption" style="color: var(--v2-accent); text-transform: uppercase; letter-spacing: 0.08em;">{{ t('authAction.section') }}</p>
            <h1 class="v2-h1 mt-2">{{ t('authAction.errorTitle') }}</h1>
            <p class="v2-body-soft mt-4">{{ t('authAction.errorBody') }}</p>
            <div class="mt-8">
              <a href="ignia://" class="v2-btn v2-btn--secondary">{{ t('authAction.openApp') }}</a>
            </div>
          }
        }
      </ui-card>
    </section>
    </ng-container>
  `,
})
export class AuthActionComponent {
  private readonly auth = inject(Auth);

  protected readonly APP_STORE_URL = APP_STORE_URL;
  protected readonly PLAY_STORE_URL = PLAY_STORE_URL;

  protected readonly state = signal<'working' | 'verified' | 'resetForm' | 'resetDone' | 'error'>('working');
  protected readonly resetEmail = signal('');
  protected readonly password = signal('');
  protected readonly formError = signal<string | null>(null);
  protected readonly busy = signal(false);

  private readonly oobCode: string;

  constructor() {
    // A signed-in surface's link target — never meant to rank.
    const meta = document.createElement('meta');
    meta.name = 'robots';
    meta.content = 'noindex';
    document.head.appendChild(meta);

    const params = new URLSearchParams(window.location.search);
    const mode = params.get('mode') ?? '';
    this.oobCode = params.get('oobCode') ?? '';

    if (mode === 'verifyEmail' && this.oobCode) {
      void this.applyVerification();
    } else if (mode === 'resetPassword' && this.oobCode) {
      void this.startReset();
    } else {
      // Modes we don't own (recoverEmail, 2FA reverts) or a mangled link:
      // hand off to Firebase's stock handler with the query intact.
      window.location.replace(`/__/auth/action${window.location.search}`);
    }
  }

  private async applyVerification(): Promise<void> {
    try {
      await applyActionCode(this.auth, this.oobCode);
      this.state.set('verified');
    } catch {
      // Expired, malformed, or already used. "Already used" lands here too,
      // and the remedy is the same either way: the app re-checks on open.
      this.state.set('error');
    }
  }

  private async startReset(): Promise<void> {
    try {
      this.resetEmail.set(await verifyPasswordResetCode(this.auth, this.oobCode));
      this.state.set('resetForm');
    } catch {
      this.state.set('error');
    }
  }

  /** Mirrors the project's Identity Platform password policy (2026-04-19):
   *  min 10, uppercase + lowercase + numeric. Checking here turns a server
   *  round-trip into an inline message. */
  protected submitReset(): void {
    const pw = this.password();
    if (pw.length < 10 || !/[A-Z]/.test(pw) || !/[a-z]/.test(pw) || !/[0-9]/.test(pw)) {
      this.formError.set('authAction.passwordWeak');
      return;
    }
    if (this.busy()) return;
    this.busy.set(true);
    this.formError.set(null);
    confirmPasswordReset(this.auth, this.oobCode, pw).then(
      () => this.state.set('resetDone'),
      () => {
        // The code can expire between the form rendering and the submit.
        this.busy.set(false);
        this.formError.set('authAction.resetFailed');
      },
    );
  }
}
