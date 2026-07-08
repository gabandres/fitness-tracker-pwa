import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { TranslocoDirective } from '@jsverse/transloco';
import { AuthService, PendingLinkInfo } from '../../services/auth.service';
import { TranslationService } from '../../services/translation.service';
import { UiButton } from '../ui/button.component';

type Status = 'idle' | 'signing' | 'error' | 'reset-sent';
type Mode = 'signin' | 'signup' | 'reset';
type Method = 'google' | 'microsoft' | 'apple' | 'email';

@Component({
  selector: 'app-sign-in',
  standalone: true,
  imports: [FormsModule, TranslocoDirective, UiButton],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <ng-container *transloco="let t">
    <section class="max-w-[400px] mx-auto px-1">
      <!-- Brand: the flame mark + Ignia wordmark, matching the mobile app. -->
      <div class="flex flex-col items-center text-center">
        <svg viewBox="0 0 100 100" style="width: 84px; height: 84px;" aria-hidden="true">
          <defs>
            <radialGradient id="signinEmber" cx="50%" cy="66%" r="62%">
              <stop offset="0" stop-color="#f2b24a" />
              <stop offset="0.5" stop-color="#c0472f" />
              <stop offset="1" stop-color="#6e121a" />
            </radialGradient>
          </defs>
          <circle cx="50" cy="50" r="40" fill="#f6ede0" />
          <circle cx="50" cy="50" r="40" fill="none" stroke="#e6dccb" stroke-width="4" />
          <circle cx="50" cy="50" r="40" fill="none" stroke="#ff6a3d" stroke-width="4"
            stroke-linecap="round" stroke-dasharray="176 120" transform="rotate(-90 50 50)" />
          <g transform="translate(21 20) scale(0.58)">
            <path d="M50 15 C 62 31 64 45 60 58 C 57 70 52 78 50 87 C 48 78 43 70 40 58 C 36 45 38 31 50 15 Z" fill="url(#signinEmber)" />
            <path d="M50 41 C 56 49 57 57 54 64 C 52 70 51 74 50 79 C 49 74 48 70 46 64 C 43 57 44 49 50 41 Z" fill="#f2b24a" opacity="0.92" />
            <circle cx="50" cy="66" r="6" fill="#fdf6ec" opacity="0.85" />
          </g>
        </svg>
        <h1 class="mt-4" style="font-family: var(--v2-font-display); font-size: 34px; line-height: 1; color: var(--v2-ink);">Ignia</h1>
        <p class="v2-body-soft mt-2">{{ t(mode() === 'signup' ? 'signin.taglineSignup' : 'signin.tagline') }}</p>
      </div>

      @if (auth.pendingLink(); as link) {
        <div class="block mt-5 rounded-xl p-4" style="background: var(--v2-paper-2); border: 1px solid var(--v2-accent);">
          <p class="v2-caption mb-1" style="text-transform: uppercase; letter-spacing: 0.08em; color: var(--v2-accent); font-weight: 600;">
            {{ t('signin.linkStamp') }}
          </p>
          <p class="v2-body" [innerHTML]="t(linkPromptKey(link), { email: link.email })"></p>
          <p class="v2-caption mt-2">{{ t('signin.linkExplainer') }}</p>
          <div class="mt-3 flex flex-col sm:flex-row gap-2">
            @for (cand of link.candidateProviders; track cand) {
              @if (cand === 'google.com') {
                <ui-button variant="primary" size="sm" [block]="true" (click)="signInGoogle()" [disabled]="status() === 'signing'">
                  {{ t('signin.linkWithGoogle') }}
                </ui-button>
              } @else if (cand === 'microsoft.com') {
                <ui-button variant="primary" size="sm" [block]="true" (click)="signInMicrosoft()" [disabled]="status() === 'signing'">
                  {{ t('signin.linkWithMicrosoft') }}
                </ui-button>
              } @else if (cand === 'password') {
                <ui-button variant="primary" size="sm" [block]="true" (click)="openLinkEmailForm()">
                  {{ t('signin.linkWithPassword') }}
                </ui-button>
              }
            }
            <ui-button variant="ghost" size="sm" (click)="cancelLink()">{{ t('signin.linkCancel') }}</ui-button>
          </div>
        </div>
      }

      <div class="mt-6">
        <!-- Segmented Sign in / Sign up switch -->
        @if (mode() !== 'reset') {
          <div class="flex rounded-full p-1 mb-4" style="background: var(--v2-paper-2); border: 1px solid var(--v2-rule);">
            <button type="button" (click)="setMode('signin')" class="flex-1 py-2 rounded-full text-sm font-bold transition-colors"
              [style.background]="mode() === 'signin' ? 'var(--v2-ink)' : 'transparent'"
              [style.color]="mode() === 'signin' ? 'var(--v2-paper)' : 'var(--v2-ink-soft)'">
              {{ t('signin.tabSignIn') }}
            </button>
            <button type="button" (click)="setMode('signup')" class="flex-1 py-2 rounded-full text-sm font-bold transition-colors"
              [style.background]="mode() === 'signup' ? 'var(--v2-ink)' : 'transparent'"
              [style.color]="mode() === 'signup' ? 'var(--v2-paper)' : 'var(--v2-ink-soft)'">
              {{ t('signin.tabSignUp') }}
            </button>
          </div>
        }

        <form (submit)="submitEmail($event)" class="space-y-3">
          @if (mode() === 'signup') {
            <div class="flex gap-3">
              <input name="firstName" autocomplete="given-name" [placeholder]="t('signin.firstName')" [(ngModel)]="firstNameValue" class="v2-field flex-1" />
              <input name="lastName" autocomplete="family-name" [placeholder]="t('signin.lastName')" [(ngModel)]="lastNameValue" class="v2-field flex-1" />
            </div>
          }

          <input id="signin-email" type="email" name="email" autocomplete="email" required
            [placeholder]="t('signin.emailPh')" [(ngModel)]="emailValue" class="v2-field" />

          @if (mode() !== 'reset') {
            <div style="position: relative;">
              <input id="signin-password" name="password" required
                [type]="showPassword() ? 'text' : 'password'"
                [placeholder]="t('signin.passwordPh')"
                [autocomplete]="mode() === 'signup' ? 'new-password' : 'current-password'"
                [(ngModel)]="passwordValue" class="v2-field" style="padding-right: 46px;" />
              <button type="button" (click)="showPassword.set(!showPassword())"
                [attr.aria-label]="t(showPassword() ? 'signin.hidePassword' : 'signin.showPassword')"
                style="position: absolute; right: 0; top: 0; height: 100%; padding: 0 12px; display: flex; align-items: center; color: var(--v2-ink-soft); background: none; border: none; cursor: pointer;">
                @if (showPassword()) {
                  <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>
                } @else {
                  <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7-11-7-11-7z"/><circle cx="12" cy="12" r="3"/></svg>
                }
              </button>
            </div>

            @if (mode() === 'signup') {
              <div class="space-y-1 px-0.5">
                <div class="flex items-center gap-2 v2-caption" [style.color]="reqLen ? 'var(--v2-sage)' : 'var(--v2-ink-soft)'">
                  <span [style.color]="reqLen ? 'var(--v2-sage)' : 'var(--v2-rule)'">{{ reqLen ? '●' : '○' }}</span> {{ t('signin.reqLen') }}
                </div>
                <div class="flex items-center gap-2 v2-caption" [style.color]="reqLetter ? 'var(--v2-sage)' : 'var(--v2-ink-soft)'">
                  <span [style.color]="reqLetter ? 'var(--v2-sage)' : 'var(--v2-rule)'">{{ reqLetter ? '●' : '○' }}</span> {{ t('signin.reqLetter') }}
                </div>
                <div class="flex items-center gap-2 v2-caption" [style.color]="reqNum ? 'var(--v2-sage)' : 'var(--v2-ink-soft)'">
                  <span [style.color]="reqNum ? 'var(--v2-sage)' : 'var(--v2-rule)'">{{ reqNum ? '●' : '○' }}</span> {{ t('signin.reqNum') }}
                </div>
              </div>
            }
          }

          @if (status() === 'error') {
            <p class="v2-caption" role="alert" style="color: var(--v2-danger);">{{ errorMsg() }}</p>
          } @else if (status() === 'reset-sent') {
            <p class="v2-caption" role="status" style="color: var(--v2-sage);">{{ t('signin.resetSent') }}</p>
          }

          <button type="submit" [disabled]="status() === 'signing'"
            class="v2-btn v2-btn--block"
            style="justify-content: center; background: var(--v2-ink); color: var(--v2-paper); border: 1px solid var(--v2-ink); font-weight: 700;">
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

          <div class="text-center pt-0.5">
            @if (mode() === 'signin') {
              <button type="button" class="v2-link v2-link--muted v2-caption" (click)="setMode('reset')">{{ t('signin.forgotPassword') }}</button>
            } @else if (mode() === 'reset') {
              <button type="button" class="v2-link v2-caption" (click)="setMode('signin')">← {{ t('signin.backToSignIn') }}</button>
            }
          </div>
        </form>

        <div class="flex items-center gap-3 my-4">
          <div class="flex-1 h-px" style="background: var(--v2-rule);"></div>
          <span class="v2-caption" style="text-transform: lowercase;">{{ t('signin.or') }}</span>
          <div class="flex-1 h-px" style="background: var(--v2-rule);"></div>
        </div>

        <div class="space-y-2">
          <button type="button" (click)="signInGoogle()" [disabled]="status() === 'signing'"
            class="v2-btn v2-btn--secondary v2-btn--block" style="justify-content: center; gap: 10px;">
            <svg viewBox="0 0 48 48" class="shrink-0" style="width: 18px; height: 18px;" aria-hidden="true">
              <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/>
              <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/>
              <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/>
              <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/>
            </svg>
            {{ status() === 'signing' && lastMethod() === 'google' ? t('signin.signingIn') : t('signin.signInWithGoogle') }}
          </button>

          <!-- Microsoft is intentionally removed on web for full web/app parity
               (the app cannot offer Microsoft — Firebase RN limitation). Kept
               here, commented, in case parity requirements change.
          <button type="button" (click)="signInMicrosoft()" [disabled]="status() === 'signing'"
            class="v2-btn v2-btn--secondary v2-btn--block" style="justify-content: center; gap: 10px;">
            <svg viewBox="0 0 23 23" class="shrink-0" style="width: 16px; height: 16px;" aria-hidden="true">
              <rect x="1" y="1" width="10" height="10" fill="#f35325" />
              <rect x="12" y="1" width="10" height="10" fill="#81bc06" />
              <rect x="1" y="12" width="10" height="10" fill="#05a6f0" />
              <rect x="12" y="12" width="10" height="10" fill="#ffba08" />
            </svg>
            {{ status() === 'signing' && lastMethod() === 'microsoft' ? t('signin.signingIn') : t('signin.signInWithMicrosoft') }}
          </button>
          -->

          @if (appleWebEnabled) {
            <button type="button" (click)="signInApple()" [disabled]="status() === 'signing'"
              class="v2-btn v2-btn--block" style="justify-content: center; gap: 10px; background: #000; color: #fff; border: 1px solid #000;">
              <svg viewBox="0 0 384 512" style="width: 15px; height: 17px;" fill="#fff" aria-hidden="true">
                <path d="M318.7 268.7c-.2-36.7 16.4-64.4 50-84.8-18.8-26.9-47.2-41.7-84.7-44.6-35.5-2.8-74.3 20.7-88.5 20.7-15 0-49.4-19.7-76.4-19.7C63.3 141.2 4 184.8 4 273.5q0 39.3 14.4 81.2c12.8 36.7 59 126.7 107.2 125.2 25.2-.6 43-17.9 75.8-17.9 31.8 0 48.3 17.9 76.4 17.9 48.6-.7 90.4-82.5 102.6-119.3-65.2-30.7-61.7-90-61.7-91.9zm-56.6-164.2c27.3-32.4 24.8-61.9 24-72.5-24.1 1.4-52 16.4-67.9 34.9-17.5 19.8-27.8 44.3-25.6 71.9 26.1 2 49.9-11.4 69.5-34.3z" />
              </svg>
              {{ status() === 'signing' && lastMethod() === 'apple' ? t('signin.signingIn') : t('signin.signInWithApple') }}
            </button>
          }
        </div>

        <p class="v2-caption mt-6 text-center">{{ t('signin.sessionCaption') }}</p>
      </div>
    </section>
    </ng-container>
  `,
})
export class SignInComponent {
  protected readonly auth = inject(AuthService);
  private readonly translation = inject(TranslationService);

  protected linkPromptKey(link: PendingLinkInfo): string {
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
    const link = this.auth.pendingLink();
    if (link) this.emailValue = link.email;
    this.mode.set('signin');
    this.status.set('idle');
    this.errorMsg.set('');
  }

  protected readonly status = signal<Status>('idle');
  protected readonly errorMsg = signal('');
  protected readonly mode = signal<Mode>('signin');
  protected readonly lastMethod = signal<Method | null>(null);
  protected readonly showPassword = signal(false);
  protected emailValue = '';
  protected firstNameValue = '';
  protected lastNameValue = '';
  passwordValue = '';

  // Live password rules (mirror the app checklist). Getters recompute on each
  // keystroke because ngModel marks the OnPush view for check.
  protected get reqLen(): boolean { return this.passwordValue.length >= 10; }
  protected get reqLetter(): boolean { return /[A-Za-z]/.test(this.passwordValue); }
  protected get reqNum(): boolean { return /\d/.test(this.passwordValue); }
  protected get strongPassword(): boolean { return this.reqLen && this.reqLetter && this.reqNum; }

  protected async signInGoogle(): Promise<void> {
    await this.runPopup('google', () => this.auth.signInWithGoogle());
  }

  protected async signInMicrosoft(): Promise<void> {
    await this.runPopup('microsoft', () => this.auth.signInWithMicrosoft());
  }

  protected async signInApple(): Promise<void> {
    await this.runPopup('apple', () => this.auth.signInWithApple());
  }

  // Apple-on-web needs an Apple Services ID + private key configured in the
  // Firebase Apple provider (see APPLE_WEB_SIGNIN.md). Until that's done,
  // signInWithPopup('apple.com') errors — so the button stays hidden. Flip to
  // true once the Services ID is wired to reach full web/app provider parity.
  protected readonly appleWebEnabled = false;

  private async runPopup(method: Method, fn: () => Promise<void>): Promise<void> {
    this.lastMethod.set(method);
    this.status.set('signing');
    this.errorMsg.set('');
    try {
      await fn();
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
    if (!email || (this.mode() !== 'reset' && !password) || (this.mode() === 'signup' && !this.firstNameValue.trim())) {
      this.status.set('error');
      this.errorMsg.set(this.translation.t('signin.errorMissingFields'));
      return;
    }
    if (this.mode() === 'signup' && !this.strongPassword) {
      this.status.set('error');
      this.errorMsg.set(this.translation.t('signin.passwordHint'));
      return;
    }
    this.status.set('signing');
    this.errorMsg.set('');
    try {
      if (this.mode() === 'signup') {
        const name = `${this.firstNameValue.trim()} ${this.lastNameValue.trim()}`.trim();
        await this.auth.signUpWithEmailPassword(email, password, name);
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
        return this.translation.t('signin.errorEmailDisabled');
      case 'auth/network-request-failed':
        return this.translation.t('signin.errorNetwork');
      default:
        return err instanceof Error ? err.message : this.translation.t('signin.errorFallback');
    }
  }

  protected setMode(next: Mode): void {
    this.mode.set(next);
    this.status.set('idle');
    this.errorMsg.set('');
    this.passwordValue = '';
    this.showPassword.set(false);
  }
}
