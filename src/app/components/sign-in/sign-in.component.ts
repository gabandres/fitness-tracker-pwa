import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { AuthService } from '../../services/auth.service';

type Status = 'idle' | 'signing' | 'error';

@Component({
  selector: 'app-sign-in',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section>
      <div class="specimen px-6 py-8 sm:px-8 sm:py-10 relative">
        <span class="crop-bl"></span><span class="crop-br"></span>

        <div class="flex items-center gap-3 mb-1">
          <span class="stamp-mark">restricted</span>
          <span class="data-label">access</span>
        </div>

        <h2 class="font-display text-3xl sm:text-4xl leading-[0.95] text-ink mt-3">
          Identify<br/>
          <em class="text-blood">yourself.</em>
        </h2>

        <p class="font-sans text-sm text-ink-soft mt-4 leading-relaxed">
          Track calories, protein, and weight. Get a coach that reads your data.
        </p>

        <p class="caption mt-3 text-[11px] leading-relaxed">
          gmail accounts only. one click, no passwords, stays signed in
          until you sign out.
        </p>

        <div class="mt-8">
          <button
            type="button"
            (click)="signIn()"
            [disabled]="status() === 'signing'"
            class="stamp-btn"
          >
            <svg
              viewBox="0 0 24 24"
              class="w-4 h-4 shrink-0"
              aria-hidden="true"
              fill="currentColor"
            >
              <path d="M12.48 10.92v3.28h7.84c-.24 1.84-.853 3.187-1.787 4.133-1.147 1.147-2.933 2.4-6.053 2.4-4.827 0-8.6-3.893-8.6-8.72s3.773-8.72 8.6-8.72c2.6 0 4.507 1.027 5.907 2.347l2.307-2.307C18.747 1.44 16.133 0 12.48 0 5.867 0 .307 5.387.307 12s5.56 12 12.173 12c3.573 0 6.267-1.173 8.373-3.36 2.16-2.16 2.84-5.213 2.84-7.667 0-.76-.053-1.467-.173-2.053H12.48z"/>
            </svg>
            {{ status() === 'signing' ? 'signing in…' : 'sign in with google' }}
          </button>

          @if (status() === 'error') {
            <p class="font-mono text-[11px] text-blood mt-4 leading-relaxed">
              ✕ {{ errorMsg() }}
            </p>
          }
        </div>

        <div class="mt-8 pt-6 border-t border-rule/40">
          <p class="caption text-xs leading-relaxed">
            your session is stored locally by firebase. sign out any time
            to clear it. no password is kept on any server.
          </p>
        </div>
      </div>
    </section>
  `,
})
export class SignInComponent {
  private readonly auth = inject(AuthService);

  protected readonly status = signal<Status>('idle');
  protected readonly errorMsg = signal('');

  protected async signIn(): Promise<void> {
    this.status.set('signing');
    this.errorMsg.set('');
    try {
      await this.auth.signInWithGoogle();
      // On success, onAuthStateChanged fires and the App shell swaps
      // this component out — no local state change needed.
    } catch (err: unknown) {
      const code = (err as { code?: string })?.code;
      // Treat user cancellation as a no-op rather than an error.
      if (code === 'auth/popup-closed-by-user' || code === 'auth/cancelled-popup-request') {
        this.status.set('idle');
        return;
      }
      this.status.set('error');
      this.errorMsg.set(err instanceof Error ? err.message : 'Sign-in failed.');
    }
  }
}
