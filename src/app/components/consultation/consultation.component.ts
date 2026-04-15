import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';
import { TranslocoDirective } from '@jsverse/transloco';
import { marked } from 'marked';
import { GeminiService } from '../../services/gemini.service';
import { FitnessStore } from '../../services/fitness-store.service';
import { SubscriptionService } from '../../services/subscription.service';
import { TranslationService } from '../../services/translation.service';
import { ErrorCode, extractErrorCode } from '../../models/error-codes';

type Status = 'idle' | 'streaming' | 'done' | 'error';

interface SuggestedPrompt {
  labelKey: string;
  promptKey: string;
}

@Component({
  selector: 'app-consultation',
  standalone: true,
  imports: [FormsModule, TranslocoDirective],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <ng-container *transloco="let t">
    <section>
      <div class="rule">
        <span>{{ t('consultation.section') }}</span>
      </div>

      <div class="mt-6">
        <p class="font-display text-xl leading-snug text-ink">
          {{ t('consultation.letterLead') }}<br/>
          <em class="text-blood">{{ t('consultation.letterEm') }}</em>
        </p>
        <p class="caption mt-2 text-[11px]">
          {{ t('consultation.intro') }}
          @if (!subs.isPaid() && remaining() !== null) {
            <span class="ml-1 font-mono not-italic"
              [style.color]="remaining()! <= 1 ? 'var(--color-gold)' : 'var(--color-graphite)'">
              {{ t('consultation.remaining', { n: remaining(), limit: limit() }) }}
            </span>
          }
        </p>
      </div>

      <!-- Suggested prompts -->
      <div class="mt-6 flex flex-wrap gap-2">
        @for (p of suggested; track p.promptKey) {
          <button
            type="button"
            (click)="useSuggestion(t(p.promptKey))"
            [disabled]="status() === 'streaming'"
            class="tag-btn text-xs"
          >
            {{ t(p.labelKey) }}
          </button>
        }
      </div>

      <!-- Composer -->
      <form (ngSubmit)="ask()" class="mt-6">
        <label for="question" class="data-label block mb-1">{{ t('consultation.questionLabel') }}</label>
        <textarea
          id="question"
          name="question"
          rows="3"
          [ngModel]="question()"
          (ngModelChange)="question.set($event)"
          [disabled]="status() === 'streaming'"
          [placeholder]="t('consultation.questionPlaceholder')"
          class="field-input resize-none"
        ></textarea>

        <div class="mt-4">
          <button
            type="submit"
            [disabled]="status() === 'streaming' || !question().trim()"
            class="stamp-btn"
          >
            @if (status() === 'streaming') {
              <span>{{ t('consultation.asking') }}</span>
            } @else {
              <span>{{ t('consultation.ask') }}</span>
            }
          </button>
        </div>
      </form>

      <!-- Response -->
      @if (status() !== 'idle') {
        <article class="mt-8">
          <div class="flex items-center gap-2 mb-3">
            <span class="stamp-mark">{{ t('consultation.replyStamp') }}</span>
            <span class="caption text-[11px]">{{ t('consultation.replyCaption') }}</span>
          </div>

          <div
            class="prose-field font-display text-ink text-[15px] leading-relaxed"
            [innerHTML]="renderedHtml()"
          ></div>

          @if (status() === 'streaming') {
            <span class="inline-block w-2 h-4 bg-ink align-middle animate-pulse ml-0.5"></span>
          }

          @if (status() === 'error') {
            <div class="mt-3 specimen px-4 py-3" style="border-color: var(--color-blood)">
              <span class="crop-bl" style="border-color: var(--color-blood)"></span>
              <span class="crop-br" style="border-color: var(--color-blood)"></span>
              <p class="font-sans text-sm text-blood">{{ errorMsg() }}</p>
              @if (overLimit()) {
                <p class="caption text-[11px] mt-2">
                  {{ t('consultation.overLimitPre') }}
                  <span class="text-ink">{{ t('consultation.overLimitSettingsPath') }}</span>.
                </p>
              }
            </div>
          }
        </article>
      }
    </section>
    </ng-container>
  `,
  // prose-field styles moved to global styles.css
})
export class ConsultationComponent {
  private readonly store = inject(FitnessStore);
  private readonly gemini = inject(GeminiService);
  protected readonly subs = inject(SubscriptionService);
  private readonly sanitizer = inject(DomSanitizer);
  private readonly translation = inject(TranslationService);

  /** Remaining free consultations today. Populated after each ask()
      from the `reserveConsultation` response. `null` means "unknown"
      (we haven't asked anything yet this session). */
  protected readonly remaining = signal<number | null>(null);
  protected readonly limit = signal<number>(5);
  protected readonly overLimit = signal(false);

  protected readonly suggested: SuggestedPrompt[] = [
    { labelKey: 'consultation.suggestedOnTrackLabel', promptKey: 'consultation.suggestedOnTrackPrompt' },
    { labelKey: 'consultation.suggestedAdjustLabel', promptKey: 'consultation.suggestedAdjustPrompt' },
    { labelKey: 'consultation.suggestedRedFlagsLabel', promptKey: 'consultation.suggestedRedFlagsPrompt' },
    { labelKey: 'consultation.suggestedPlateauLabel', promptKey: 'consultation.suggestedPlateauPrompt' },
  ];

  protected readonly question = signal('');
  protected readonly status = signal<Status>('idle');
  protected readonly rawResponse = signal('');
  protected readonly renderedHtml = signal<SafeHtml>('' as SafeHtml);
  protected readonly errorMsg = signal('');

  protected useSuggestion(prompt: string): void {
    this.question.set(prompt);
  }

  protected async ask(): Promise<void> {
    const q = this.question().trim();
    if (!q) return;

    this.status.set('streaming');
    this.rawResponse.set('');
    this.renderedHtml.set('' as SafeHtml);
    this.errorMsg.set('');
    this.overLimit.set(false);

    // Reserve a consultation slot server-side BEFORE streaming.
    // Free tier: 5/day; paid: unlimited. Throws resource-exhausted
    // over the cap. `reserved` tracks whether we owe the user a
    // release on downstream failure.
    let reserved = false;
    try {
      const reservation = await this.gemini.reserveConsultation();
      this.limit.set(reservation.limit);
      this.remaining.set(reservation.remaining < 0 ? null : reservation.remaining);
      reserved = true;

      // All data is already cached in the store — no Firestore call needed.
      const logs = this.store.logs();
      const tdee = this.store.tdee();
      const profile = this.store.profile();
      const profileFields = profile?.profileCompleted
        ? {
            heightIn: profile.heightIn!, age: profile.age!, sex: profile.sex!,
            activityLevel: profile.activityLevel!,
            targetPaceLbsPerWeek: profile.targetPaceLbsPerWeek!,
            goalWeightLbs: profile.goalWeightLbs,
          }
        : null;

      let buffer = '';
      for await (const chunk of this.gemini.askAboutMyData(q, logs, tdee, profileFields)) {
        buffer += chunk;
        this.rawResponse.set(buffer);
        // Re-render markdown on every chunk. marked is synchronous in its
        // default config so this stays cheap.
        const html = await marked.parse(buffer, { gfm: true, breaks: true });
        this.renderedHtml.set(
          this.sanitizer.bypassSecurityTrustHtml(html),
        );
      }
      this.status.set('done');
    } catch (err) {
      this.status.set('error');
      const code = extractErrorCode(err);
      if (code) {
        const details = (err as { details?: Record<string, unknown> }).details ?? {};
        this.errorMsg.set(this.translation.tError(code, details));
        if (code === ErrorCode.CONSULTATION_QUOTA_EXCEEDED) this.overLimit.set(true);
      } else {
        this.errorMsg.set(err instanceof Error ? err.message : this.translation.t('consultation.errorFallback'));
      }
      // If we successfully reserved a slot but the stream then failed,
      // refund it so the user isn't silently penalised for a transient
      // error. If reservation itself threw, there's nothing to release.
      if (reserved) {
        void this.gemini.releaseConsultation();
        // Reflect the refund optimistically in the UI counter.
        const cur = this.remaining();
        if (cur != null) this.remaining.set(cur + 1);
      }
    }
  }
}
