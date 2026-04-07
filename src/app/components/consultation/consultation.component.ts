import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';
import { marked } from 'marked';
import { GeminiService } from '../../services/gemini.service';
import { FitnessStore } from '../../services/fitness-store.service';

type Status = 'idle' | 'streaming' | 'done' | 'error';

interface SuggestedPrompt {
  label: string;
  prompt: string;
}

@Component({
  selector: 'app-consultation',
  standalone: true,
  imports: [FormsModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section>
      <div class="rule">
        <span>consultation</span>
      </div>

      <div class="mt-6">
        <p class="font-display text-xl leading-snug text-ink">
          Write a letter<br/>
          <em class="text-blood">to your coach.</em>
        </p>
        <p class="caption mt-2 text-[11px]">
          ask anything about your data. your fourteen-day record is attached
          automatically. responses are streamed from gemini.
        </p>
      </div>

      <!-- Suggested prompts -->
      <div class="mt-6 flex flex-wrap gap-2">
        @for (p of suggested; track p.prompt) {
          <button
            type="button"
            (click)="useSuggestion(p.prompt)"
            [disabled]="status() === 'streaming'"
            class="tag-btn text-xs"
          >
            {{ p.label }}
          </button>
        }
      </div>

      <!-- Composer -->
      <form (ngSubmit)="ask()" class="mt-6">
        <label for="question" class="data-label block mb-1">your question</label>
        <textarea
          id="question"
          name="question"
          rows="3"
          [ngModel]="question()"
          (ngModelChange)="question.set($event)"
          [disabled]="status() === 'streaming'"
          placeholder="e.g. am i losing too quickly? should i hold my target?"
          class="field-input resize-none"
        ></textarea>

        <div class="mt-4">
          <button
            type="submit"
            [disabled]="status() === 'streaming' || !question().trim()"
            class="stamp-btn"
          >
            @if (status() === 'streaming') {
              <span>transmitting…</span>
            } @else {
              <span>dispatch ⟶</span>
            }
          </button>
        </div>
      </form>

      <!-- Response -->
      @if (status() !== 'idle') {
        <article class="mt-8">
          <div class="flex items-center gap-2 mb-3">
            <span class="stamp-mark">reply</span>
            <span class="caption text-[11px]">from the desk of gemini</span>
          </div>

          <div
            class="prose-field font-display text-ink text-[15px] leading-relaxed"
            [innerHTML]="renderedHtml()"
          ></div>

          @if (status() === 'streaming') {
            <span class="inline-block w-2 h-4 bg-ink align-middle animate-pulse ml-0.5"></span>
          }

          @if (status() === 'error') {
            <p class="font-mono text-[11px] text-blood mt-3">✕ {{ errorMsg() }}</p>
          }
        </article>
      }
    </section>
  `,
  // prose-field styles moved to global styles.css
})
export class ConsultationComponent {
  private readonly store = inject(FitnessStore);
  private readonly gemini = inject(GeminiService);
  private readonly sanitizer = inject(DomSanitizer);

  protected readonly suggested: SuggestedPrompt[] = [
    { label: 'am i on track?', prompt: 'How am I progressing toward my cut goal? Be specific about what the data shows.' },
    { label: 'adjust target?', prompt: 'Should I adjust my daily calorie target based on the last 14 days? Explain your reasoning.' },
    { label: 'red flags', prompt: 'Are there any red flags or concerning patterns in my log data I should be aware of?' },
    { label: 'weight plateau', prompt: 'Am I in a weight plateau? What does my 14-day trend suggest about my metabolic rate?' },
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

    try {
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
      this.errorMsg.set(err instanceof Error ? err.message : 'Consultation failed.');
    }
  }
}
