import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { AuthService } from '../../services/auth.service';

type Status = 'idle' | 'sending' | 'sent' | 'error';

@Component({
  selector: 'app-sign-in',
  standalone: true,
  imports: [FormsModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="w-full max-w-md mx-auto">
      <div class="rounded-2xl bg-slate-900/70 ring-1 ring-slate-800 p-6 sm:p-8 shadow-xl">
        <h2 class="text-lg font-semibold text-slate-100">Sign In</h2>
        <p class="text-xs text-slate-400 mt-1">
          Enter your Gmail address. We'll email you a one-time magic link — no password needed.
        </p>

        <form (ngSubmit)="onSubmit()" class="mt-5 space-y-4">
          <div>
            <label for="email" class="block text-xs font-medium uppercase tracking-wide text-slate-400 mb-1">
              Email (Gmail only)
            </label>
            <input
              id="email"
              name="email"
              type="email"
              required
              autocomplete="email"
              inputmode="email"
              [ngModel]="email()"
              (ngModelChange)="email.set($event)"
              placeholder="you@gmail.com"
              class="w-full rounded-lg bg-slate-950 border border-slate-700 px-3 py-2.5 text-slate-100 placeholder-slate-600 focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 outline-none transition"
            />
          </div>

          <button
            type="submit"
            [disabled]="status() === 'sending'"
            class="w-full rounded-lg bg-emerald-600 hover:bg-emerald-500 disabled:bg-slate-700 disabled:text-slate-400 text-white font-semibold py-2.5 transition"
          >
            {{ status() === 'sending' ? 'Sending…' : 'Send Magic Link' }}
          </button>

          @if (status() === 'sent') {
            <div class="rounded-lg bg-emerald-950/40 border border-emerald-800/60 px-3 py-2.5 text-xs text-emerald-300">
              Check <span class="font-semibold">{{ sentTo() }}</span> for a sign-in link. Open it on this device to finish signing in.
            </div>
          }
          @if (status() === 'error') {
            <div class="rounded-lg bg-red-950/40 border border-red-900/60 px-3 py-2.5 text-xs text-red-300">
              {{ errorMsg() }}
            </div>
          }
        </form>
      </div>
    </section>
  `,
})
export class SignInComponent {
  private readonly auth = inject(AuthService);

  protected readonly email = signal('');
  protected readonly status = signal<Status>('idle');
  protected readonly errorMsg = signal('');
  protected readonly sentTo = signal('');

  protected async onSubmit(): Promise<void> {
    const addr = this.email().trim().toLowerCase();

    if (!addr.endsWith('@gmail.com')) {
      this.status.set('error');
      this.errorMsg.set('Gmail addresses only.');
      return;
    }

    this.status.set('sending');
    try {
      await this.auth.sendSignInLink(addr);
      this.sentTo.set(addr);
      this.status.set('sent');
    } catch (err) {
      this.status.set('error');
      this.errorMsg.set(err instanceof Error ? err.message : 'Failed to send link.');
    }
  }
}
