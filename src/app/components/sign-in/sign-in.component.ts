import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { TranslocoDirective } from '@jsverse/transloco';
import { AuthService } from '../../services/auth.service';
import { TranslationService } from '../../services/translation.service';

type Status = 'idle' | 'signing' | 'error' | 'reset-sent';
type Mode = 'signin' | 'signup' | 'reset';

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

        <!-- Google sign-in (one click, no password) -->
        <div class="mt-8">
          <button
            type="button"
            (click)="signInGoogle()"
            [disabled]="status() === 'signing'"
            class="stamp-btn"
          >
            <svg viewBox="0 0 24 24" class="w-4 h-4 shrink-0" aria-hidden="true" fill="currentColor">
              <path d="M12.48 10.92v3.28h7.84c-.24 1.84-.853 3.187-1.787 4.133-1.147 1.147-2.933 2.4-6.053 2.4-4.827 0-8.6-3.893-8.6-8.72s3.773-8.72 8.6-8.72c2.6 0 4.507 1.027 5.907 2.347l2.307-2.307C18.747 1.44 16.133 0 12.48 0 5.867 0 .307 5.387.307 12s5.56 12 12.173 12c3.573 0 6.267-1.173 8.373-3.36 2.16-2.16 2.84-5.213 2.84-7.667 0-.76-.053-1.467-.173-2.053H12.48z"/>
            </svg>
            {{ status() === 'signing' && lastMethod() === 'google' ? t('signin.signingIn') : t('signin.signInWithGoogle') }}
          </button>
        </div>

        <!-- "or" divider + email/password toggle -->
        <div class="mt-6 flex items-center gap-3">
          <div class="flex-1 h-px bg-rule/40"></div>
          <span class="font-sans text-[11px] uppercase tracking-[0.18em] text-graphite">{{ t('signin.or') }}</span>
          <div class="flex-1 h-px bg-rule/40"></div>
        </div>

        @if (!emailFormOpen()) {
          <button type="button" (click)="emailFormOpen.set(true)"
            class="mt-4 tag-btn w-full justify-center text-xs">
            {{ t('signin.useEmail') }}
          </button>
        } @else {
          <form (submit)="submitEmail($event)" class="mt-4 space-y-3 slide-down">
            <div>
              <label class="data-label block mb-1" for="signin-email">{{ t('signin.emailLabel') }}</label>
              <input id="signin-email" type="email" name="email" autocomplete="email" required
                [(ngModel)]="emailValue"
                class="w-full bg-paper-deep/40 border border-rule/40 rounded px-3 py-2 font-mono text-sm text-ink"
                [attr.aria-label]="t('signin.emailLabel')" />
            </div>

            @if (mode() !== 'reset') {
              <div>
                <label class="data-label block mb-1" for="signin-password">{{ t('signin.passwordLabel') }}</label>
                <input id="signin-password" type="password" name="password"
                  [autocomplete]="mode() === 'signup' ? 'new-password' : 'current-password'"
                  required minlength="6"
                  [(ngModel)]="passwordValue"
                  class="w-full bg-paper-deep/40 border border-rule/40 rounded px-3 py-2 font-mono text-sm text-ink"
                  [attr.aria-label]="t('signin.passwordLabel')" />
                @if (mode() === 'signup') {
                  <p class="caption text-[11px] mt-1">{{ t('signin.passwordHint') }}</p>
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
                <button type="button" (click)="mode.set('signup')" class="text-ink underline-offset-2 hover:underline">
                  {{ t('signin.needAccount') }}
                </button>
                <button type="button" (click)="mode.set('reset')" class="text-graphite underline-offset-2 hover:underline">
                  {{ t('signin.forgotPassword') }}
                </button>
              } @else {
                <button type="button" (click)="mode.set('signin')" class="text-ink underline-offset-2 hover:underline">
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
  private readonly auth = inject(AuthService);
  private readonly translation = inject(TranslationService);

  protected readonly status = signal<Status>('idle');
  protected readonly errorMsg = signal('');
  protected readonly emailFormOpen = signal(false);
  protected readonly mode = signal<Mode>('signin');
  protected readonly lastMethod = signal<'google' | 'email' | null>(null);
  protected emailValue = '';
  passwordValue = '';

  protected async signInGoogle(): Promise<void> {
    this.lastMethod.set('google');
    this.status.set('signing');
    this.errorMsg.set('');
    try {
      await this.auth.signInWithGoogle();
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
    this.status.set('signing');
    this.errorMsg.set('');
    const email = this.emailValue.trim();
    const password = this.passwordValue;
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
      default:
        return err instanceof Error ? err.message : this.translation.t('signin.errorFallback');
    }
  }
}
