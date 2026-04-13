import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { AuthService } from '../../services/auth.service';
import { FirebaseService } from '../../services/firebase.service';

type DeleteStatus = 'idle' | 'confirming' | 'deleting' | 'error';

@Component({
  selector: 'app-privacy',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="max-w-[640px] mx-auto">
      <a href="/" class="caption text-xs underline decoration-dotted hover:text-blood">
        ← back to macro log
      </a>

      <div class="mt-6 flex items-center gap-3 mb-1">
        <span class="stamp-mark">policy</span>
        <span class="data-label">privacy</span>
      </div>
      <h1 class="font-display text-4xl sm:text-5xl leading-[0.95] tracking-tight text-ink">
        Privacy<br/><em class="text-blood">policy.</em>
      </h1>
      <p class="caption mt-3 text-xs">last updated 2026-04-12 · plain english, no dark patterns.</p>

      <div class="mt-8 prose-field text-ink leading-relaxed">
        <h2 class="font-display italic text-2xl text-blood mt-6 mb-2">What we store</h2>
        <p>
          When you sign in with Google, we store your email, display name, and
          profile photo URL — nothing else from your Google account. Everything
          else in Macro Log is stuff you enter yourself: weight, calories,
          protein, dates, body measurements, meal labels, training toggles, and
          custom meal presets.
        </p>
        <p>
          All of this is stored in Google Cloud Firestore, scoped to your user
          ID. No one else — including us — can read it without your Google
          login.
        </p>

        <h2 class="font-display italic text-2xl text-blood mt-6 mb-2">What we send to Google's Gemini AI</h2>
        <p>
          Two features send data to Google's Gemini AI:
        </p>
        <ul>
          <li>
            <strong>Photo-to-Macros</strong>: the meal photo you take is sent
            to Gemini 2.0 Flash for calorie + protein estimation. Photos are
            processed in-flight and not retained by us. Google's API retention
            policy applies — see
            <a href="https://ai.google.dev/gemini-api/terms" target="_blank" rel="noopener" class="underline">Gemini API terms</a>.
          </li>
          <li>
            <strong>AI Coach consultations</strong>: your question, 14-day log
            summary, profile fields (age, sex, height, activity level, pace),
            and current TDEE are sent to Gemini as context for each
            consultation. Your raw email, name, or photo are never included.
          </li>
        </ul>

        <h2 class="font-display italic text-2xl text-blood mt-6 mb-2">What we don't do</h2>
        <ul>
          <li>We don't sell your data to anyone.</li>
          <li>We don't run ads.</li>
          <li>We don't use your data to train any AI model.</li>
          <li>We don't share your data with anyone except Google Cloud (hosting + AI) and, if you enable it, Google Firebase Cloud Messaging (push notifications).</li>
        </ul>

        <h2 class="font-display italic text-2xl text-blood mt-6 mb-2">Your data, your call</h2>
        <ul>
          <li><strong>Export</strong>: download all your logs as CSV from the dashboard at any time.</li>
          <li><strong>Delete</strong>: use the button below to permanently erase your account and every log, preset, weight, measurement, and report tied to it. This is irreversible.</li>
          <li><strong>Questions</strong>: email <a href="mailto:gabrielandresbermudez&#64;gmail.com" class="underline">gabrielandresbermudez&#64;gmail.com</a>.</li>
        </ul>

        <h2 class="font-display italic text-2xl text-blood mt-6 mb-2">Medical disclaimer</h2>
        <p>
          Macro Log is not a medical device, and the AI coach is not a
          dietician. Nothing in the app is medical advice. If you're doing
          anything clinically meaningful — a cut below 1,500 kcal, weight loss
          of more than 1% body weight per week, or eating for a medical
          condition — talk to a real human doctor or RD first.
        </p>
      </div>

      <!-- Danger zone: account deletion -->
      <div class="mt-12 specimen px-5 py-5 relative" style="border-color: var(--color-blood)">
        <span class="crop-bl" style="border-color: var(--color-blood)"></span>
        <span class="crop-br" style="border-color: var(--color-blood)"></span>

        <div class="flex items-center gap-3 mb-2">
          <span class="stamp-mark" style="transform: rotate(0deg); border-color: var(--color-blood); color: var(--color-blood)">danger</span>
          <span class="data-label">delete account</span>
        </div>

        @if (!auth.isSignedIn()) {
          <p class="caption text-xs">sign in first to delete your account.</p>
        } @else if (deleteStatus() === 'idle') {
          <p class="font-sans text-sm text-ink leading-relaxed mb-3">
            Permanently erase {{ auth.user()?.email }} and every log, preset,
            weight, measurement, and report tied to it. This cannot be undone.
          </p>
          <button type="button" (click)="deleteStatus.set('confirming')"
            class="tag-btn text-blood border-blood/60">
            delete my account
          </button>
        } @else if (deleteStatus() === 'confirming') {
          <p class="font-sans text-sm text-ink leading-relaxed mb-3">
            Type <span class="font-mono font-semibold">delete</span> to confirm:
          </p>
          <div class="flex items-baseline gap-2">
            <input type="text"
              [value]="confirmInput()"
              (input)="confirmInput.set($any($event.target).value)"
              placeholder="delete"
              class="field-input text-sm flex-1 max-w-[200px]" />
            <button type="button" (click)="confirmDelete()"
              [disabled]="confirmInput().trim().toLowerCase() !== 'delete'"
              class="tag-btn text-blood border-blood/60"
              aria-label="Confirm account deletion">
              confirm
            </button>
            <button type="button" (click)="cancelDelete()" class="tag-btn">cancel</button>
          </div>
        } @else if (deleteStatus() === 'deleting') {
          <p class="caption text-xs">erasing your account…</p>
        } @else if (deleteStatus() === 'error') {
          <p class="font-mono text-xs text-blood">✕ {{ errorMsg() }}</p>
          <button type="button" (click)="deleteStatus.set('idle')" class="tag-btn text-[11px] mt-2">try again</button>
        }
      </div>
    </section>
  `,
})
export class PrivacyComponent {
  protected readonly auth = inject(AuthService);
  private readonly firebase = inject(FirebaseService);

  protected readonly deleteStatus = signal<DeleteStatus>('idle');
  protected readonly confirmInput = signal('');
  protected readonly errorMsg = signal('');

  protected cancelDelete(): void {
    this.deleteStatus.set('idle');
    this.confirmInput.set('');
  }

  protected async confirmDelete(): Promise<void> {
    if (this.confirmInput().trim().toLowerCase() !== 'delete') return;
    this.deleteStatus.set('deleting');
    this.errorMsg.set('');

    try {
      await this.firebase.deleteMyAccount();
      // Cloud Function deletes Firestore + Auth user. Sign-out is automatic
      // once the auth user is gone, but we force it to unblock the UI.
      await this.auth.signOut();
      window.location.assign('/');
    } catch (err) {
      this.deleteStatus.set('error');
      this.errorMsg.set(err instanceof Error ? err.message : 'Account deletion failed.');
    }
  }
}
