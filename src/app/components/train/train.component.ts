import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  output,
  signal,
} from '@angular/core';
import { LucideAngularModule } from 'lucide-angular';
import { TranslocoDirective } from '@jsverse/transloco';
import { WorkoutStore } from '../../services/workout-store.service';
import { SubscriptionService } from '../../services/subscription.service';
import { TranslationService } from '../../services/translation.service';
import { bcp47ForLang } from '../../utils/locale';
import { UiCard } from '../ui/card.component';
import { UiButton } from '../ui/button.component';
import { UiIconButton } from '../ui/icon-button.component';
import { WorkoutSessionSheetComponent } from './session-sheet.component';
import { TemplateEditorComponent } from './template-editor.component';
import { ExerciseDetailComponent } from './exercise-detail.component';
import type { Exercise } from '../../models/workout';
import { STARTER_TEMPLATES, type SeedTemplate } from '../../models/workout-seed';
import {
  CUSTOM_TEMPLATE_LIMIT_FREE,
  TemplateLimitError,
  type SessionDraft,
  type SessionExercise,
  type WorkoutSession,
  type WorkoutTemplate,
} from '../../models/workout';
import { suggestProgression } from '../../utils/workout-progression';

/**
 * Train tab — the workout home. Surfaces an in-progress session to resume,
 * the user's templates to start from, starter templates to clone when
 * empty, and the recent-session list. Starting a template snapshots its
 * exercises into a new active session (pre-filling each set's weight from
 * the rule-based suggestion) and opens the logging sheet.
 */
@Component({
  selector: 'app-train',
  standalone: true,
  imports: [
    LucideAngularModule,
    TranslocoDirective,
    UiCard,
    UiButton,
    UiIconButton,
    WorkoutSessionSheetComponent,
    TemplateEditorComponent,
    ExerciseDetailComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <ng-container *transloco="let t">
    <section class="max-w-[640px] mx-auto px-5 sm:px-6 pb-32 md:pb-28">
      <header class="flex items-start justify-between gap-4 pt-6 pb-2">
        <div>
          <h1 class="v2-h1">{{ t('train.title') }}</h1>
          <p class="v2-caption mt-0.5">{{ t('train.subtitle') }}</p>
        </div>
        <div class="flex items-center gap-2 shrink-0">
          <ui-icon-button icon="calendar" [ariaLabel]="t('train.historyAria')" (click)="historyRequested.emit()" />
          <ui-icon-button icon="settings" [ariaLabel]="t('train.settingsAria')" (click)="settingsRequested.emit()" />
        </div>
      </header>

      <!-- Resume in-progress -->
      @if (active(); as a) {
        <ui-card variant="default" class="mt-4 block" style="border-left: 3px solid var(--v2-accent);">
          <div class="flex items-center justify-between gap-3">
            <div>
              <p class="v2-field-label" style="color: var(--v2-accent); margin-bottom: 0.25rem;">{{ t('train.resumeTitle') }}</p>
              <h2 class="v2-h2">{{ a.templateName || t('train.sessionTitle') }}</h2>
              <p class="v2-caption mt-0.5">{{ t('train.exerciseCount', { count: a.exercises.length }) }}</p>
            </div>
            <ui-button variant="primary" (click)="openSheet()">{{ t('train.resume') }}</ui-button>
          </div>
        </ui-card>
      }

      <!-- Templates -->
      <div class="mt-6 flex items-baseline justify-between">
        <h2 class="v2-h2">{{ t('train.yourTemplates') }}</h2>
        <ui-button variant="secondary" size="sm" [disabled]="capReached()" (click)="newTemplate()">
          <lucide-icon name="plus" [size]="14" /> {{ t('train.newTemplate') }}
        </ui-button>
      </div>

      @if (templates().length === 0) {
        <ui-card variant="default" class="mt-2 block">
          <p class="v2-caption">{{ t('train.noTemplatesBody') }}</p>
        </ui-card>
      } @else {
        <div class="mt-2 grid gap-2">
          @for (tpl of templates(); track tpl.id) {
            <ui-card variant="default" class="block">
              <div class="flex items-center justify-between gap-3">
                <button type="button" class="text-left grow" [disabled]="busy()" (click)="start(tpl)">
                  <h3 class="v2-h3" style="font-weight: 600;">{{ tpl.name }}</h3>
                  <p class="v2-caption mt-0.5">{{ t('train.exerciseCount', { count: tpl.exercises.length }) }}</p>
                </button>
                <div class="flex items-center gap-1 shrink-0">
                  <ui-icon-button icon="pencil" [ariaLabel]="t('train.editTemplate')" (click)="edit(tpl)" />
                  <ui-icon-button icon="trash-2" [ariaLabel]="t('train.deleteTemplate')" (click)="remove(tpl)" />
                  <ui-button variant="secondary" size="sm" [disabled]="busy()" (click)="start(tpl)">{{ t('train.start') }}</ui-button>
                </div>
              </div>
            </ui-card>
          }
        </div>
      }

      <!-- Starter templates (clone) -->
      @if (availableStarters().length > 0) {
        <h2 class="v2-h2 mt-6">{{ t('train.starterTemplates') }}</h2>
        @if (capReached()) {
          <p class="v2-caption mt-1" style="color: var(--v2-ink-muted);">
            {{ t('train.templateCap', { limit: limit }) }}
          </p>
        }
        <div class="mt-2 grid gap-2">
          @for (seed of availableStarters(); track seed.key) {
            <ui-card variant="flat" class="block">
              <div class="flex items-center justify-between gap-3">
                <div>
                  <h3 class="v2-h3" style="font-weight: 600;">{{ seed.name }}</h3>
                  <p class="v2-caption mt-0.5">{{ t('train.exerciseCount', { count: seed.exercises.length }) }}</p>
                </div>
                <ui-button variant="secondary" size="sm" [disabled]="busy() || capReached()" (click)="clone(seed)">
                  {{ t('train.useTemplate') }}
                </ui-button>
              </div>
            </ui-card>
          }
        </div>
      }

      <!-- Recent sessions -->
      <h2 class="v2-h2 mt-6">{{ t('train.recentSessions') }}</h2>
      @if (completedRecent().length === 0) {
        <p class="v2-caption mt-2">{{ t('train.noSessions') }}</p>
      } @else {
        <div class="mt-2 grid gap-1">
          @for (ses of completedRecent(); track ses.id) {
            <div class="flex items-center justify-between gap-3 py-2 border-b" style="border-color: var(--v2-rule);">
              <button type="button" class="text-left grow" (click)="editSession(ses)">
                <p style="font-weight: 600;">{{ ses.templateName || t('train.sessionTitle') }}</p>
                <p class="v2-caption">{{ formatDate(ses.date) }} · {{ t('train.exerciseCount', { count: ses.exercises.length }) }}</p>
              </button>
              <div class="flex items-center gap-1 shrink-0">
                @if (ses.durationMin) {
                  <span class="v2-caption" style="color: var(--v2-ink-muted);">{{ ses.durationMin }}m</span>
                }
                <ui-icon-button icon="pencil" [ariaLabel]="t('train.editSession')" (click)="editSession(ses)" />
                <ui-icon-button icon="trash-2" [ariaLabel]="t('train.deleteSession')" (click)="removeSession(ses)" />
              </div>
            </div>
          }
        </div>
      }
      <!-- Exercise catalog (progression charts) -->
      @if (catalog().length > 0) {
        <h2 class="v2-h2 mt-6">{{ t('train.exercisesSection') }}</h2>
        <div class="mt-2 grid gap-1">
          @for (ex of catalog(); track ex.id) {
            <button type="button" class="flex items-center justify-between gap-3 py-2 border-b text-left"
                    style="border-color: var(--v2-rule);" (click)="openDetail(ex)">
              <div>
                <p style="font-weight: 600;">{{ ex.name }}</p>
                @if (ex.muscles.length) {
                  <p class="v2-caption">{{ ex.muscles.join(', ') }}</p>
                }
              </div>
              <lucide-icon name="trending-up" [size]="16" />
            </button>
          }
        </div>
      }
    </section>

    @if (showSheet()) {
      <app-workout-session-sheet (closed)="onSheetClosed()" />
    }
    @if (editingSession(); as es) {
      <app-workout-session-sheet [editingSession]="es" (closed)="onEditClosed()" />
    }
    @if (editorOpen()) {
      <app-template-editor [templateId]="editorTemplateId()" (closed)="editorOpen.set(false)" />
    }
    @if (detail(); as d) {
      <app-exercise-detail [exerciseId]="d.id!" [name]="d.name" (closed)="detail.set(null)" />
    }
    </ng-container>
  `,
})
export class TrainComponent {
  private readonly workout = inject(WorkoutStore);
  private readonly subs = inject(SubscriptionService);
  private readonly i18n = inject(TranslationService);

  readonly settingsRequested = output<void>();
  readonly historyRequested = output<void>();

  protected readonly limit = CUSTOM_TEMPLATE_LIMIT_FREE;
  protected readonly active = this.workout.activeSession;
  protected readonly templates = this.workout.templates;
  protected readonly catalog = this.workout.exercises;
  protected readonly showSheet = signal(false);
  protected readonly busy = signal(false);
  protected readonly editorOpen = signal(false);
  protected readonly editorTemplateId = signal<string | null>(null);
  protected readonly detail = signal<Exercise | null>(null);
  protected readonly editingSession = signal<WorkoutSession | null>(null);

  protected readonly completedRecent = computed(() =>
    this.workout.recentSessions().filter((s) => s.status === 'completed'),
  );

  protected readonly capReached = computed(
    () => !this.subs.isPaid() && this.templates().length >= CUSTOM_TEMPLATE_LIMIT_FREE,
  );

  /** Starter templates the user hasn't cloned yet (matched by name). */
  protected readonly availableStarters = computed(() => {
    const have = new Set(this.templates().map((tpl) => tpl.name.toLowerCase()));
    return STARTER_TEMPLATES.filter((s) => !have.has(s.name.toLowerCase()));
  });

  protected openSheet(): void {
    this.showSheet.set(true);
  }

  protected onSheetClosed(): void {
    this.showSheet.set(false);
  }

  protected newTemplate(): void {
    this.editorTemplateId.set(null);
    this.editorOpen.set(true);
  }

  protected edit(tpl: WorkoutTemplate): void {
    this.editorTemplateId.set(tpl.id ?? null);
    this.editorOpen.set(true);
  }

  protected openDetail(ex: Exercise): void {
    this.detail.set(ex);
  }

  /** Open a completed session in the sheet for editing. */
  protected editSession(ses: WorkoutSession): void {
    this.editingSession.set(ses);
  }

  protected onEditClosed(): void {
    this.editingSession.set(null);
  }

  protected async removeSession(ses: WorkoutSession): Promise<void> {
    if (!ses.id) return;
    if (!confirm(this.i18n.t('train.deleteSessionConfirm'))) return;
    await this.workout.deleteSession(ses.id);
  }

  protected formatDate(d: Date): string {
    return d.toLocaleDateString(bcp47ForLang(this.i18n.language()), { month: 'short', day: 'numeric' });
  }

  /** Start (or resume) a workout from a template. */
  protected async start(tpl: WorkoutTemplate): Promise<void> {
    if (this.busy()) return;
    if (this.workout.activeSession()) {
      this.openSheet(); // single-active invariant: resume the existing one
      return;
    }
    this.busy.set(true);
    try {
      const draft = await this.buildDraft(tpl);
      await this.workout.startSession(draft);
      this.openSheet();
    } finally {
      this.busy.set(false);
    }
  }

  /** Snapshot a template into a new session draft, pre-filling each set's
   *  weight from the rule-based suggestion (falling back to targetLoad). */
  private async buildDraft(tpl: WorkoutTemplate): Promise<SessionDraft> {
    let historyByEx = new Map<string, SessionExercise[]>();
    if (tpl.id) {
      try {
        const history = await this.workout.getSessionsForTemplate(tpl.id, 10);
        for (const ses of history) {
          for (const ex of ses.exercises) {
            const arr = historyByEx.get(ex.exerciseId) ?? [];
            arr.push(ex);
            historyByEx.set(ex.exerciseId, arr);
          }
        }
      } catch {
        historyByEx = new Map();
      }
    }

    const exercises: SessionExercise[] = tpl.exercises.map((te) => {
      const sug = suggestProgression(historyByEx.get(te.exerciseId) ?? [], te.progression);
      const weight = sug.suggestedWeight ?? te.targetLoad;
      return {
        exerciseId: te.exerciseId,
        name: te.name,
        targetLoad: te.targetLoad,
        cues: te.cues ?? [],
        progression: te.progression,
        sets: te.plannedSets.map((p) => ({ kind: p.kind, group: p.group, weight })),
      };
    });

    return {
      status: 'active',
      templateId: tpl.id,
      templateName: tpl.name,
      date: new Date(),
      exercises,
    };
  }

  protected async clone(seed: SeedTemplate): Promise<void> {
    if (this.busy()) return;
    this.busy.set(true);
    try {
      await this.workout.cloneStarterTemplate(seed);
    } catch (err) {
      if (err instanceof TemplateLimitError) {
        alert(this.i18n.t('train.templateCap', { limit: err.limit }));
      } else {
        throw err;
      }
    } finally {
      this.busy.set(false);
    }
  }

  protected async remove(tpl: WorkoutTemplate): Promise<void> {
    if (!tpl.id) return;
    if (!confirm(this.i18n.t('train.deleteConfirm', { name: tpl.name }))) return;
    await this.workout.deleteTemplate(tpl.id);
  }
}
