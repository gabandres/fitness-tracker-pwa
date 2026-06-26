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
import { UiSheet } from '../ui/sheet.component';
import { WorkoutSessionSheetComponent } from './session-sheet.component';
import { TemplateEditorComponent } from './template-editor.component';
import { ExerciseDetailComponent } from './exercise-detail.component';
import { ExercisesManagerComponent } from './exercises-manager.component';
import type { Exercise } from '../../models/workout';
import { STARTER_TEMPLATES, type SeedTemplate } from '../../models/workout-seed';
import {
  CUSTOM_TEMPLATE_LIMIT_FREE,
  DEFAULT_LOG_STYLE,
  TemplateLimitError,
  type SessionDraft,
  type SessionExercise,
  type WorkoutSession,
  type WorkoutSet,
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
    UiSheet,
    WorkoutSessionSheetComponent,
    TemplateEditorComponent,
    ExerciseDetailComponent,
    ExercisesManagerComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <ng-container *transloco="let t">
    <section class="max-w-[640px] mx-auto pb-32 md:pb-28">
      <header class="flex items-start justify-between gap-4 pt-2 pb-2">
        <div>
          <h1 class="v2-h1">{{ t('train.title') }}</h1>
          <p class="v2-caption mt-0.5">{{ t('train.subtitle') }}</p>
        </div>
        <div class="flex items-center gap-2 shrink-0">
          <ui-icon-button icon="dumbbell" [ariaLabel]="t('train.manageExercises')" (click)="managerOpen.set(true)" />
          <ui-icon-button icon="calendar" [ariaLabel]="t('train.historyAria')" (click)="historyRequested.emit()" />
          <ui-icon-button icon="settings" [ariaLabel]="t('train.settingsAria')" (click)="settingsRequested.emit()" />
        </div>
      </header>

      <!-- Resume in-progress -->
      @if (active(); as a) {
        <ui-card variant="default" class="mt-4 block v2-active-highlight"
                 style="padding: var(--v2-space-4); border-radius: var(--v2-radius-lg);">
          <div class="flex items-center justify-between gap-3">
            <div>
              <p class="v2-field-label" style="color: var(--v2-accent); margin-bottom: 0.25rem;">{{ t('train.resumeTitle') }}</p>
              <h2 class="v2-h2">{{ sessionLabel(a) }}</h2>
              <p class="v2-caption mt-0.5">{{ t('train.exerciseCount', { count: a.exercises.length }) }}</p>
            </div>
            <ui-button variant="primary" (click)="openSheet()">{{ t('train.resume') }}</ui-button>
          </div>
        </ui-card>
      }

      <!-- Templates + Recent: hidden while a workout is in progress so the
           in-progress view stays focused on Resume + the exercises below. -->
      @if (!active()) {
      <!-- Templates -->
      <div class="mt-6 flex items-baseline justify-between">
        <h2 class="v2-h2">{{ t('train.yourTemplates') }}</h2>
        <ui-button variant="secondary" size="sm" [disabled]="capReached()" (click)="openChooser()">
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
            <ui-card variant="default" class="block v2-template-card"
                     [class.v2-active-highlight]="selectedTemplate()?.id === tpl.id">
              <div class="flex items-center justify-between gap-3">
                <button type="button" class="text-left grow"
                        [attr.aria-pressed]="selectedTemplate()?.id === tpl.id"
                        [attr.aria-expanded]="selectedTemplate()?.id === tpl.id" (click)="select(tpl)">
                  <div class="flex items-center gap-1.5">
                    <h3 class="v2-h3" style="font-weight: 600;">{{ tpl.name }}</h3>
                    <lucide-icon [name]="selectedTemplate()?.id === tpl.id ? 'chevron-down' : 'chevron-right'" [size]="16"
                                 [style.color]="selectedTemplate()?.id === tpl.id ? 'var(--v2-accent)' : 'var(--v2-ink-muted)'" />
                  </div>
                  <p class="v2-caption mt-0.5">{{ t('train.exerciseCount', { count: tpl.exercises.length }) }}</p>
                </button>
                <div class="flex items-center gap-1 shrink-0">
                  <ui-icon-button icon="pencil" [ariaLabel]="t('train.editTemplate')" (click)="edit(tpl)" />
                  <ui-icon-button icon="trash-2" [ariaLabel]="t('train.deleteTemplate')" (click)="remove(tpl)" />
                  @if (!active()) {
                    <ui-button variant="secondary" size="sm" [disabled]="busy()" (click)="start(tpl)">{{ t('train.start') }}</ui-button>
                  }
                </div>
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
                <p class="v2-row-title">{{ sessionLabel(ses) }}</p>
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
      }
      <!-- Exercises: the in-progress workout's exercises while active, else
           the selected template's. Workout order; tap for progression. -->
      @if (shownExercises(); as ex) {
        <h2 class="v2-h2 mt-6">{{ t('train.exercisesSection') }} · {{ ex.name }}</h2>
        <div class="mt-2 grid gap-1">
          @for (te of ex.items; track te.exerciseId) {
            <button type="button" class="flex items-center justify-between gap-3 py-2 border-b text-left"
                    style="border-color: var(--v2-rule);" (click)="openDetailById(te.exerciseId, te.name)">
              <div>
                <p class="v2-row-title">{{ te.name }}</p>
                @if (musclesFor(te.exerciseId); as m) {
                  <p class="v2-caption">{{ m }}</p>
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
    @if (chooserOpen()) {
      <ui-sheet [labelledBy]="'train-chooser-title'" (close)="chooserOpen.set(false)">
        <h2 id="train-chooser-title" class="v2-h2 mb-3">{{ t('train.newTemplate') }}</h2>
        <div class="grid gap-2">
          <button type="button" class="text-left" (click)="blankTemplate()">
            <ui-card variant="default" class="block">
              <div class="flex items-center gap-3">
                <lucide-icon name="plus" [size]="18" />
                <span style="font-weight: 600;">{{ t('train.blankTemplate') }}</span>
              </div>
            </ui-card>
          </button>
          @for (seed of availableStarters(); track seed.key) {
            <button type="button" class="text-left" [disabled]="busy()" (click)="pickStarter(seed)">
              <ui-card variant="flat" class="block">
                <div class="flex items-center justify-between gap-3">
                  <div>
                    <h3 class="v2-h3" style="font-weight: 600;">{{ seed.name }}</h3>
                    <p class="v2-caption mt-0.5">{{ t('train.exerciseCount', { count: seed.exercises.length }) }}</p>
                  </div>
                  <lucide-icon name="chevron-right" [size]="18" />
                </div>
              </ui-card>
            </button>
          }
        </div>
      </ui-sheet>
    }
    @if (editorOpen()) {
      <app-template-editor [templateId]="editorTemplateId()" (closed)="editorOpen.set(false)" />
    }
    @if (detail(); as d) {
      <app-exercise-detail [exerciseId]="d.id!" [name]="d.name" (closed)="detail.set(null)" />
    }
    @if (managerOpen()) {
      <app-exercises-manager (closed)="managerOpen.set(false)" />
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
  protected readonly chooserOpen = signal(false);
  protected readonly managerOpen = signal(false);
  protected readonly editorTemplateId = signal<string | null>(null);
  protected readonly detail = signal<Exercise | null>(null);
  protected readonly editingSession = signal<WorkoutSession | null>(null);

  /** Explicit template selection: `undefined` = auto (fall back to the
   *  active/most-recent default), `null` = user explicitly deselected,
   *  string = the chosen template id. Drives the Exercises section. */
  private readonly selectedId = signal<string | null | undefined>(undefined);

  protected readonly completedRecent = computed(() =>
    this.workout.recentSessions().filter((s) => s.status === 'completed'),
  );

  /** Catalog lookup by id — backs the selected template's muscle subtitles
   *  and the progression-detail open. */
  private readonly exerciseById = computed(
    () => new Map(this.catalog().map((e) => [e.id, e] as const)),
  );

  /** Default selection when the user hasn't chosen: the active session's
   *  template, else the most-recent completed session's template (that
   *  still exists), else none. */
  private readonly autoTemplateId = computed<string | null>(() => {
    const ids = new Set(this.templates().map((t) => t.id));
    const activeId = this.active()?.templateId;
    if (activeId && ids.has(activeId)) return activeId;
    for (const ses of this.completedRecent()) {
      if (ses.templateId && ids.has(ses.templateId)) return ses.templateId;
    }
    return null;
  });

  /** The currently-highlighted template (explicit choice or auto default). */
  protected readonly selectedTemplate = computed<WorkoutTemplate | null>(() => {
    const chosen = this.selectedId();
    const id = chosen === undefined ? this.autoTemplateId() : chosen;
    return id ? (this.templates().find((t) => t.id === id) ?? null) : null;
  });

  /** Exercises to list at the bottom: while a workout is in progress, the
   *  active session's own exercises (what they're actually doing); else the
   *  selected template's. Null hides the section. */
  protected readonly shownExercises = computed<{
    name: string;
    items: { exerciseId: string; name: string }[];
  } | null>(() => {
    const a = this.active();
    if (a) return { name: this.sessionLabel(a), items: a.exercises };
    const s = this.selectedTemplate();
    return s ? { name: s.name, items: s.exercises } : null;
  });

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

  protected openChooser(): void {
    this.chooserOpen.set(true);
  }

  /** Chooser → blank: open the editor on a fresh template. */
  protected blankTemplate(): void {
    this.chooserOpen.set(false);
    this.editorTemplateId.set(null);
    this.editorOpen.set(true);
  }

  /** Chooser → starter: clone it, then close the chooser. */
  protected async pickStarter(seed: SeedTemplate): Promise<void> {
    await this.clone(seed);
    this.chooserOpen.set(false);
  }

  protected edit(tpl: WorkoutTemplate): void {
    this.editorTemplateId.set(tpl.id ?? null);
    this.editorOpen.set(true);
  }

  /** Tap a template to select it (filters the Exercises section); tap the
   *  selected one again to deselect. Starting stays on the Start button. */
  protected select(tpl: WorkoutTemplate): void {
    this.selectedId.set(this.selectedTemplate()?.id === tpl.id ? null : (tpl.id ?? null));
  }

  protected musclesFor(exerciseId: string): string {
    return this.exerciseById().get(exerciseId)?.muscles.join(', ') ?? '';
  }

  /** Open the progression detail for one of the selected template's
   *  exercises. Prefers the catalog entry (carries muscles); falls back to
   *  a minimal record if the catalog hasn't hydrated it. */
  protected openDetailById(exerciseId: string, name: string): void {
    const ex = this.exerciseById().get(exerciseId);
    this.detail.set(ex ?? ({ id: exerciseId, name, muscles: [] } as unknown as Exercise));
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

  /** Display name for a session: the live template name (resolved by
   *  templateId) so renames reflect in history; falls back to the stored
   *  snapshot if the template was deleted, then to a generic title. */
  protected sessionLabel(ses: { templateId?: string; templateName?: string }): string {
    if (ses.templateId) {
      const tpl = this.templates().find((t) => t.id === ses.templateId);
      if (tpl) return tpl.name;
    }
    return ses.templateName || this.i18n.t('train.sessionTitle');
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
      // Prefer the template snapshot; fall back to the catalog for templates
      // authored before logStyle existed (or cloned starters).
      const resolvedStyle = te.logStyle ?? this.catalog().find((e) => e.id === te.exerciseId)?.logStyle;
      const style = resolvedStyle ?? DEFAULT_LOG_STYLE;
      const sug = suggestProgression(historyByEx.get(te.exerciseId) ?? [], te.progression, style);
      const weight = sug.suggestedWeight ?? te.targetLoad;
      return {
        exerciseId: te.exerciseId,
        name: te.name,
        targetLoad: te.targetLoad,
        cues: te.cues ?? [],
        logStyle: resolvedStyle,
        progression: te.progression,
        sets: te.plannedSets.map((p) => {
          const s: WorkoutSet = { kind: p.kind, group: p.group, weight };
          if (style === 'time' && sug.lastDurationSec != null) s.durationSec = sug.lastDurationSec;
          return s;
        }),
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
