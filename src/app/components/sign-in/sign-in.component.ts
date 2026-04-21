import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { TranslocoDirective } from '@jsverse/transloco';
import { AuthService, PendingLinkInfo } from '../../services/auth.service';
import { TranslationService } from '../../services/translation.service';

type Status = 'idle' | 'signing' | 'error' | 'reset-sent';
type Mode = 'signin' | 'signup' | 'reset';
type Method = 'google' | 'microsoft' | 'email';

@Component({
  selector: 'app-sign-in',
  standalone: true,
  imports: [FormsModule, TranslocoDirective],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <ng-container *transloco="let t">
    <section>
      <div class="specimen px-6 py-8 sm:px-8 sm:py-10 relative">
        <span class="crop-bl"></span><span class="crop-br"></span>

        <div class="flex items-center gap-3 mb-1">
          <span class="stamp-mark">{{ t('signin.stamp') }}</span>
          <span class="data-label">{{ t('signin.section') }}</span>
        </div>

        <h2 class="font-display text-3xl sm:text-4xl leading-[0.95] text-ink mt-3">
          {{ t('signin.titleLead') }}<br/>
          <em class="text-blood">{{ t('signin.titleEm') }}</em>
        </h2>

        <p class="font-sans text-sm text-ink-soft mt-4 leading-relaxed">
          {{ t('signin.blurb') }}
        </p>

        <p class="caption mt-3 text-[11px] leading-relaxed">
          {{ t('signin.caption') }}
        </p>

        @if (auth.pendingLink(); as link) {
          <div class="mt-6 specimen px-4 py-4 relative" style="border-color: var(--color-gold)">
            <span class="crop-bl" style="border-color: var(--color-gold)"></span>
            <span class="crop-br" style="border-color: var(--color-gold)"></span>
            <p class="data-label mb-1" style="color: var(--color-gold)">{{ t('signin.linkStamp') }}</p>
            <p class="font-sans text-sm text-ink leading-relaxed">
              {{ t(linkPromptKey(link), { email: link.email }) }}
            </p>
            <p class="caption text-[11px] mt-2 leading-relaxed">
              {{ t('signin.linkExplainer') }}
            </p>
            <div class="mt-3 flex flex-col sm:flex-row gap-2">
              @for (cand of link.candidateProviders; track cand) {
                @if (cand === 'google.com') {
                  <button type="button" (click)="signInGoogle()"
                    [disabled]="status() === 'signing'"
                    class="stamp-btn flex-1 justify-center text-xs">
                    {{ t('signin.linkWithGoogle') }}
                  </button>
                } @else if (cand === 'microsoft.com') {
                  <button type="button" (click)="signInMicrosoft()"
                    [disabled]="status() === 'signing'"
                    class="stamp-btn flex-1 justify-center text-xs">
                    {{ t('signin.linkWithMicrosoft') }}
                  </button>
                } @else if (cand === 'password') {
                  <button type="button" (click)="openLinkEmailForm()"
                    class="stamp-btn flex-1 justify-center text-xs">
                    {{ t('signin.linkWithPassword') }}
                  </button>
                }
              }
              <button type="button" (click)="cancelLink()"
                class="tag-btn justify-center text-xs">
                {{ t('signin.linkCancel') }}
              </button>
            </div>
          </div>
        }

        <!-- One-click providers (no password) -->
        <div class="mt-8 space-y-2">
          <button
            type="button"
            (click)="signInGoogle()"
            [disabled]="status() === 'signing'"
            class="gbutton"
          >
            <!-- Official Google "G" logomark, four-color. Brand-compliant
                 per Google identity guidelines: white/dark background,
                 no tinting of the mark. Inline SVG keeps it bundled so
                 the button doesn't flash-of-unstyled during offline or
                 slow cold-load. -->
            <svg viewBox="0 0 48 48" class="w-[18px] h-[18px] shrink-0" aria-hidden="true">
              <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/>
              <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/>
              <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/>
              <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/>
              <path fill="none" d="M0 0h48v48H0z"/>
            </svg>
            {{ status() === 'signing' && lastMethod() === 'google' ? t('signin.signingIn') : t('signin.signInWithGoogle') }}
          </button>

          <button
            type="button"
            (click)="signInMicrosoft()"
            [disabled]="status() === 'signing'"
            class="stamp-btn w-full justify-center"
          >
            <!-- Microsoft 4-square logo, brand colors. Inline SVG so it
                 ships in the bundle and survives offline. -->
            <svg viewBox="0 0 23 23" class="w-4 h-4 shrink-0" aria-hidden="true">
              <rect x="1" y="1" width="10" height="10" fill="#f35325" />
              <rect x="12" y="1" width="10" height="10" fill="#81bc06" />
              <rect x="1" y="12" width="10" height="10" fill="#05a6f0" />
              <rect x="12" y="12" width="10" height="10" fill="#ffba08" />
            </svg>
            {{ status() === 'signing' && lastMethod() === 'microsoft' ? t('signin.signingIn') : t('signin.signInWithMicrosoft') }}
          </button>
        </div>

        <!-- "or" divider + email/password toggle -->
        <div class="mt-6 flex items-center gap-3">
          <div class="flex-1 h-px bg-rule/40"></div>
          <span class="font-sans text-[11px] uppercase tracking-[0.18em] text-graphite">{{ t('signin.or') }}</span>
          <div class="flex-1 h-px bg-rule/40"></div>
        </div>

        @if (!emailFormOpen()) {
          <button type="button" (click)="openEmailForm()"
            class="mt-4 tag-btn w-full justify-center text-xs">
            {{ t('signin.useEmail') }}
          </button>
        } @else {
          <form (submit)="submitEmail($event)" class="mt-4 space-y-3 slide-down">
            <div>
              <label class="data-label block mb-1" for="signin-email">{{ t('signin.emailLabel') }}</label>
              <input id="signin-email" type="email" name="email" autocomplete="email" required
                [(ngModel)]="emailValue"
                class="w-full bg-paper-deep/40 border border-rule/40 rounded px-3 py-2 font-mono text-sm text-ink" />
            </div>

            @if (mode() !== 'reset') {
              <div>
                <label class="data-label block mb-1" for="signin-password">{{ t('signin.passwordLabel') }}</label>
                <!-- Sign-up enforces a stronger policy (min 10 + at least
                     one letter + one digit) via an HTML pattern. Sign-in
                     uses the legacy minlength so existing users with
                     older weaker passwords can still authenticate; the
                     real server-side policy is configured in Firebase
                     Auth settings (see README operator checklist). -->
                <input id="signin-password" type="password" name="password"
                  [autocomplete]="mode() === 'signup' ? 'new-password' : 'current-password'"
                  required
                  [minlength]="mode() === 'signup' ? 10 : 6"
                  [pattern]="mode() === 'signup' ? '(?=.*[A-Za-z])(?=.*\\d)[^\\s]{10,}' : '.*'"
                  [(ngModel)]="passwordValue"
                  class="w-full bg-paper-deep/40 border border-rule/40 rounded px-3 py-2 font-mono text-sm text-ink"
                  [attr.aria-describedby]="mode() === 'signup' ? 'signin-password-hint' : null" />
                @if (mode() === 'signup') {
                  <p id="signin-password-hint" class="caption text-[11px] mt-1">{{ t('signin.passwordHint') }}</p>
                }
              </div>
            }

            <div class="flex items-center gap-2 pt-1">
              <button type="submit"
                [disabled]="status() === 'signing'"
                class="stamp-btn flex-1 justify-center">
                @if (status() === 'signing' && lastMethod() === 'email') {
                  {{ t('signin.signingIn') }}
                } @else if (mode() === 'signup') {
                  {{ t('signin.createAccount') }}
                } @else if (mode() === 'reset') {
                  {{ t('signin.sendResetLink') }}
                } @else {
                  {{ t('signin.signInWithEmail') }}
                }
              </button>
            </div>

            <div class="flex items-center justify-between text-[11px]">
              @if (mode() === 'signin') {
                <button type="button" (click)="setMode('signup')" class="text-ink underline-offset-2 hover:underline">
                  {{ t('signin.needAccount') }}
                </button>
                <button type="button" (click)="setMode('reset')" class="text-graphite underline-offset-2 hover:underline">
                  {{ t('signin.forgotPassword') }}
                </button>
              } @else {
                <button type="button" (click)="setMode('signin')" class="text-ink underline-offset-2 hover:underline">
                  ← {{ t('signin.backToSignIn') }}
                </button>
                <span></span>
              }
            </div>
          </form>
        }

        @if (status() === 'error') {
          <p class="font-mono text-[11px] text-blood mt-4 leading-relaxed" role="alert">
            ✕ {{ errorMsg() }}
          </p>
        } @else if (status() === 'reset-sent') {
          <p class="font-mono text-[11px] mt-4 leading-relaxed" style="color: var(--color-olive)" role="status">
            ✓ {{ t('signin.resetSent') }}
          </p>
        }

        <div class="mt-8 pt-6 border-t border-rule/40">
          <p class="caption text-xs leading-relaxed">
            {{ t('signin.sessionCaption') }}
          </p>
        </div>
      </div>
    </section>
    </ng-container>
  `,
})
export class SignInComponent {
  protected readonly auth = inject(AuthService);
  private readonly translation = inject(TranslationService);

  protected linkPromptKey(link: PendingLinkInfo): string {
    // Build an i18n key like `signin.linkPrompt.microsoft.google` —
    // "your Google-registered email tried to sign in with Microsoft."
    const map: Record<string, string> = {
      'google.com': 'google',
      'microsoft.com': 'microsoft',
      'password': 'password',
      'unknown': 'unknown',
    };
    const existing = map[link.existingProvider];
    const attempted = map[link.attemptedProvider];
    return `signin.linkPrompt.${attempted}.${existing}`;
  }

  protected cancelLink(): void {
    this.auth.clearPendingLink();
    this.status.set('idle');
    this.errorMsg.set('');
  }

  protected openLinkEmailForm(): void {
    // Prefill email from the pending link info; user supplies password.
    const link = this.auth.pendingLink();
    if (link) this.emailValue = link.email;
    this.emailFormOpen.set(true);
    this.mode.set('signin');
    this.status.set('idle');
    this.errorMsg.set('');
  }

  protected readonly status = signal<Status>('idle');
  protected readonly errorMsg = signal('');
  protected readonly emailFormOpen = signal(false);
  protected readonly mode = signal<Mode>('signin');
  protected readonly lastMethod = signal<Method | null>(null);
  protected emailValue = '';
  passwordValue = '';

  protected async signInGoogle(): Promise<void> {
    await this.runPopup('google', () => this.auth.signInWithGoogle());
  }

  protected async signInMicrosoft(): Promise<void> {
    await this.runPopup('microsoft', () => this.auth.signInWithMicrosoft());
  }

  /** Shared wrapper for popup-based providers — handles the spinner,
      cancellation no-op, and friendly error mapping. */
  private async runPopup(method: Method, fn: () => Promise<void>): Promise<void> {
    this.lastMethod.set(method);
    this.status.set('signing');
    this.errorMsg.set('');
    try {
      await fn();
      // On success, onAuthStateChanged fires and the App shell swaps
      // this component out — no local state change needed.
    } catch (err: unknown) {
      const code = (err as { code?: string })?.code;
      if (code === 'auth/popup-closed-by-user' || code === 'auth/cancelled-popup-request') {
        this.status.set('idle');
        return;
      }
      this.status.set('error');
      this.errorMsg.set(this.friendlyError(code, err));
    }
  }

  protected async submitEmail(evt: Event): Promise<void> {
    evt.preventDefault();
    if (this.status() === 'signing') return;
    this.lastMethod.set('email');
    const email = this.emailValue.trim();
    const password = this.passwordValue;
    // Guard against the empty-submit path that bypasses native `required`
    // validation (form-level submit() fires even when inputs are blank on
    // some browsers / assistive tech). Without this check the request
    // hits Firebase and returns 400, but the UI showed nothing.
    if (!email || (this.mode() !== 'reset' && !password)) {
      this.status.set('error');
      this.errorMsg.set(this.translation.t('signin.errorMissingFields'));
      return;
    }
    this.status.set('signing');
    this.errorMsg.set('');
    try {
      if (this.mode() === 'signup') {
        await this.auth.signUpWithEmailPassword(email, password);
      } else if (this.mode() === 'reset') {
        await this.auth.sendPasswordReset(email);
        this.status.set('reset-sent');
        this.passwordValue = '';
        return;
      } else {
        await this.auth.signInWithEmailPassword(email, password);
      }
    } catch (err: unknown) {
      const code = (err as { code?: string })?.code;
      this.status.set('error');
      this.errorMsg.set(this.friendlyError(code, err));
    }
  }

  /** Translates Firebase auth error codes into user-readable strings. */
  private friendlyError(code: string | undefined, err: unknown): string {
    switch (code) {
      case 'auth/email-already-in-use':
        return this.translation.t('signin.errorEmailInUse');
      case 'auth/invalid-email':
        return this.translation.t('signin.errorInvalidEmail');
      case 'auth/weak-password':
        return this.translation.t('signin.errorWeakPassword');
      case 'auth/wrong-password':
      case 'auth/invalid-credential':
        return this.translation.t('signin.errorWrongPassword');
      case 'auth/user-not-found':
        return this.translation.t('signin.errorNoAccount');
      case 'auth/too-many-requests':
        return this.translation.t('signin.errorTooMany');
      case 'auth/account-exists-with-different-credential':
        return this.translation.t('signin.errorWrongProvider');
      case 'auth/operation-not-allowed':
        // Email/password provider hasn't been enabled in the Firebase
        // console yet (or has been disabled). Rather than show the raw
        // code, point the user at the working providers.
        return this.translation.t('signin.errorEmailDisabled');
      case 'auth/network-request-failed':
        return this.translation.t('signin.errorNetwork');
      default:
        return err instanceof Error ? err.message : this.translation.t('signin.errorFallback');
    }
  }

  /** Switch auth sub-form. Clears any stale error/success state so
      users don't see a "create account failed" banner after hopping
      over to the forgot-password screen. */
  protected setMode(next: Mode): void {
    this.mode.set(next);
    this.status.set('idle');
    this.errorMsg.set('');
    this.passwordValue = '';
  }

  /** Opens the email sub-form and resets any stale provider errors
      (e.g. a popup-blocked Google attempt) so the clean form is
      visible without a carried-over banner. */
  protected openEmailForm(): void {
    this.emailFormOpen.set(true);
    this.status.set('idle');
    this.errorMsg.set('');
  }
}
