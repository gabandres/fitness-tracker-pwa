import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { TranslocoDirective } from '@jsverse/transloco';
import { AuthService, PendingLinkInfo } from '../../services/auth.service';
import { TranslationService } from '../../services/translation.service';
import { V2Card } from '../ui/card.component';
import { V2Button } from '../ui/button.component';

type Status = 'idle' | 'signing' | 'error' | 'reset-sent';
type Mode = 'signin' | 'signup' | 'reset';
type Method = 'google' | 'microsoft' | 'email';

@Component({
  selector: 'app-sign-in',
  standalone: true,
  imports: [FormsModule, TranslocoDirective, V2Card, V2Button],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <ng-container *transloco="let t">
    <section class="max-w-[480px] mx-auto">
      <v2-card variant="default" class="block">
        <p class="v2-caption" style="text-transform: uppercase; letter-spacing: 0.08em;">
          {{ t('signin.section') }}
        </p>

        <h2 class="v2-h1 mt-2">
          {{ t('signin.titleLead') }}
          <span style="color: var(--v2-accent);">{{ t('signin.titleEm') }}</span>
        </h2>

        <p class="v2-body-soft mt-3">{{ t('signin.blurb') }}</p>
        <p class="v2-caption mt-2">{{ t('signin.caption') }}</p>

        @if (auth.pendingLink(); as link) {
          <v2-card variant="accent" class="block mt-5">
            <p class="v2-caption mb-1" style="text-transform: uppercase; letter-spacing: 0.08em; color: var(--v2-accent); font-weight: 600;">
              {{ t('signin.linkStamp') }}
            </p>
            <p class="v2-body">{{ t(linkPromptKey(link), { email: link.email }) }}</p>
            <p class="v2-caption mt-2">{{ t('signin.linkExplainer') }}</p>
            <div class="mt-3 flex flex-col sm:flex-row gap-2">
              @for (cand of link.candidateProviders; track cand) {
                @if (cand === 'google.com') {
                  <v2-button variant="primary" size="sm" [block]="true"
                    (click)="signInGoogle()"
                    [disabled]="status() === 'signing'">
                    {{ t('signin.linkWithGoogle') }}
                  </v2-button>
                } @else if (cand === 'microsoft.com') {
                  <v2-button variant="primary" size="sm" [block]="true"
                    (click)="signInMicrosoft()"
                    [disabled]="status() === 'signing'">
                    {{ t('signin.linkWithMicrosoft') }}
                  </v2-button>
                } @else if (cand === 'password') {
                  <v2-button variant="primary" size="sm" [block]="true"
                    (click)="openLinkEmailForm()">
                    {{ t('signin.linkWithPassword') }}
                  </v2-button>
                }
              }
              <v2-button variant="ghost" size="sm" (click)="cancelLink()">
                {{ t('signin.linkCancel') }}
              </v2-button>
            </div>
          </v2-card>
        }

        <!-- One-click providers (no password) -->
        <div class="mt-6 space-y-2">
          <button
            type="button"
            (click)="signInGoogle()"
            [disabled]="status() === 'signing'"
            class="v2-btn v2-btn--secondary v2-btn--block"
            style="justify-content: center; gap: 10px;"
          >
            <!-- Official Google "G" logomark. Brand-compliant per Google
                 identity guidelines. Inline SVG keeps it bundled. -->
            <svg viewBox="0 0 48 48" class="shrink-0" style="width: 18px; height: 18px;" aria-hidden="true">
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
            class="v2-btn v2-btn--secondary v2-btn--block"
            style="justify-content: center; gap: 10px;"
          >
            <svg viewBox="0 0 23 23" class="shrink-0" style="width: 16px; height: 16px;" aria-hidden="true">
              <rect x="1" y="1" width="10" height="10" fill="#f35325" />
              <rect x="12" y="1" width="10" height="10" fill="#81bc06" />
              <rect x="1" y="12" width="10" height="10" fill="#05a6f0" />
              <rect x="12" y="12" width="10" height="10" fill="#ffba08" />
            </svg>
            {{ status() === 'signing' && lastMethod() === 'microsoft' ? t('signin.signingIn') : t('signin.signInWithMicrosoft') }}
          </button>
        </div>

        <!-- "or" divider + email/password toggle -->
        <div class="mt-5 flex items-center gap-3">
          <div class="flex-1 h-px" style="background: var(--v2-rule);"></div>
          <span class="v2-caption" style="text-transform: uppercase; letter-spacing: 0.18em;">
            {{ t('signin.or') }}
          </span>
          <div class="flex-1 h-px" style="background: var(--v2-rule);"></div>
        </div>

        @if (!emailFormOpen()) {
          <v2-button variant="ghost" size="sm" [block]="true" class="mt-3 block"
            (click)="openEmailForm()">
            {{ t('signin.useEmail') }}
          </v2-button>
        } @else {
          <form (submit)="submitEmail($event)" class="mt-4 space-y-3">
            <div>
              <label class="v2-caption block mb-1.5" style="text-transform: uppercase; letter-spacing: 0.08em;" for="signin-email">
                {{ t('signin.emailLabel') }}
              </label>
              <input id="signin-email" type="email" name="email" autocomplete="email" required
                [(ngModel)]="emailValue"
                class="v2-field" />
            </div>

            @if (mode() !== 'reset') {
              <div>
                <label class="v2-caption block mb-1.5" style="text-transform: uppercase; letter-spacing: 0.08em;" for="signin-password">
                  {{ t('signin.passwordLabel') }}
                </label>
                <input id="signin-password" type="password" name="password"
                  [autocomplete]="mode() === 'signup' ? 'new-password' : 'current-password'"
                  required
                  [minlength]="mode() === 'signup' ? 10 : 6"
                  [pattern]="mode() === 'signup' ? '(?=.*[A-Za-z])(?=.*\\d)[^\\s]{10,}' : '.*'"
                  [(ngModel)]="passwordValue"
                  class="v2-field"
                  [attr.aria-describedby]="mode() === 'signup' ? 'signin-password-hint' : null" />
                @if (mode() === 'signup') {
                  <p id="signin-password-hint" class="v2-caption mt-1">{{ t('signin.passwordHint') }}</p>
                }
              </div>
            }

            <v2-button type="submit" variant="primary" [block]="true"
              [disabled]="status() === 'signing'">
              @if (status() === 'signing' && lastMethod() === 'email') {
                {{ t('signin.signingIn') }}
              } @else if (mode() === 'signup') {
                {{ t('signin.createAccount') }}
              } @else if (mode() === 'reset') {
                {{ t('signin.sendResetLink') }}
              } @else {
                {{ t('signin.signInWithEmail') }}
              }
            </v2-button>

            <div class="flex items-center justify-between v2-caption pt-1">
              @if (mode() === 'signin') {
                <button type="button" class="v2-link" (click)="setMode('signup')">
                  {{ t('signin.needAccount') }}
                </button>
                <button type="button" class="v2-link v2-link--muted" (click)="setMode('reset')">
                  {{ t('signin.forgotPassword') }}
                </button>
              } @else {
                <button type="button" class="v2-link" (click)="setMode('signin')">
                  ← {{ t('signin.backToSignIn') }}
                </button>
                <span></span>
              }
            </div>
          </form>
        }

        @if (status() === 'error') {
          <p class="v2-caption mt-4" role="alert" style="color: var(--v2-danger);">
            {{ errorMsg() }}
          </p>
        } @else if (status() === 'reset-sent') {
          <p class="v2-caption mt-4" role="status" style="color: var(--v2-sage);">
            {{ t('signin.resetSent') }}
          </p>
        }

        <div class="mt-6 pt-5" style="border-top: 1px solid var(--v2-rule);">
          <p class="v2-caption">{{ t('signin.sessionCaption') }}</p>
        </div>
      </v2-card>
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
