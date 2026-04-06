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
            class="tag-btn text-[10px]"
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
  styles: [`
    /* Markdown rendering — narrow scope using Tailwind's text-ink palette */
    :host ::ng-deep .prose-field p {
      margin: 0 0 0.9em 0;
    }
    :host ::ng-deep .prose-field p:last-child {
      margin-bottom: 0;
    }
    :host ::ng-deep .prose-field h1,
    :host ::ng-deep .prose-field h2,
    :host ::ng-deep .prose-field h3 {
      font-family: var(--font-display);
      font-style: italic;
      color: var(--color-blood);
      margin: 1.2em 0 0.4em;
      font-size: 1.1em;
      line-height: 1.2;
    }
    :host ::ng-deep .prose-field strong {
      font-family: var(--font-mono);
      font-weight: 500;
      font-style: normal;
      color: var(--color-ink);
      background: rgba(139, 26, 26, 0.08);
      padding: 0 3px;
      font-size: 0.92em;
    }
    :host ::ng-deep .prose-field em {
      color: var(--color-graphite);
    }
    :host ::ng-deep .prose-field ul,
    :host ::ng-deep .prose-field ol {
      margin: 0.5em 0 0.9em 1.2em;
      padding: 0;
    }
    :host ::ng-deep .prose-field li {
      margin: 0.25em 0;
    }
    :host ::ng-deep .prose-field code {
      font-family: var(--font-mono);
      font-size: 0.85em;
      background: var(--color-paper-deep);
      padding: 0 4px;
      color: var(--color-ink);
    }
    :host ::ng-deep .prose-field table {
      border-collapse: collapse;
      margin: 0.8em 0;
      font-family: var(--font-mono);
      font-size: 0.8em;
    }
    :host ::ng-deep .prose-field th,
    :host ::ng-deep .prose-field td {
      border: 1px solid var(--color-rule);
      padding: 4px 10px;
      text-align: left;
    }
    :host ::ng-deep .prose-field th {
      background: var(--color-paper-deep);
      font-weight: 500;
    }
    :host ::ng-deep .prose-field blockquote {
      border-left: 2px solid var(--color-blood);
      padding-left: 1em;
      margin: 0.8em 0;
      font-style: italic;
      color: var(--color-graphite);
    }
  `],
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
