import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { AuthService } from '../../services/auth.service';

/**
 * The only sign-in surface on the web, and it exists for one person.
 *
 * `ignia.fit/admin` is the owner's single-admin panel (ADR-0036 decision 3).
 * This gate deliberately says "Admin" and offers exactly one way in — the
 * Google account that holds the `admin` claim. No email/password form, no
 * sign-up, no reset, no other providers: every affordance removed here is one
 * a stranger might otherwise try. Anyone who signs in without the claim gets
 * the "not an admin" card inside AdminComponent and a sign-out link.
 */
@Component({
  selector: 'app-admin-gate',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="max-w-[360px] mx-auto px-1 py-16 text-center">
      <h1 class="v2-h1">Admin</h1>
      <div class="mt-8">
        <button type="button" (click)="signIn()" [disabled]="busy()"
          class="v2-btn v2-btn--secondary v2-btn--block" style="justify-content: center; gap: 10px;">
          <svg viewBox="0 0 48 48" class="shrink-0" style="width: 18px; height: 18px;" aria-hidden="true">
            <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/>
            <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/>
            <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/>
            <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/>
          </svg>
          {{ busy() ? 'Signing in…' : 'Sign in with Google' }}
        </button>
        @if (error()) {
          <p class="v2-caption mt-3" role="alert" style="color: var(--v2-danger);">{{ error() }}</p>
        }
      </div>
    </section>
  `,
})
export class AdminGateComponent {
  private readonly auth = inject(AuthService);
  protected readonly busy = signal(false);
  protected readonly error = signal('');

  protected async signIn(): Promise<void> {
    if (this.busy()) return;
    this.busy.set(true);
    this.error.set('');
    try {
      await this.auth.signInWithGoogle();
    } catch (err: unknown) {
      const code = (err as { code?: string })?.code;
      // A closed or cancelled popup is not an error worth showing.
      if (code !== 'auth/popup-closed-by-user' && code !== 'auth/cancelled-popup-request') {
        this.error.set(code ?? 'Sign-in failed.');
      }
    } finally {
      this.busy.set(false);
    }
  }
}
