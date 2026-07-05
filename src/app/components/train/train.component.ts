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
import { UiAvatar } from '../ui/avatar.component';
import { AuthService } from '../../services/auth.service';
import { UiSheet } from '../ui/sheet.component';
import { WorkoutSessionSheetComponent } from './session-sheet.component';
import { TemplateEditorComponent } from './template-editor.component';
import { ExerciseDetailComponent } from './exercise-detail.component';
import { ExercisesManagerComponent } from './exercises-manager.component';
import type { Exercise } from '../../models/workout';
import { STARTER_TEMPLATES, seedTemplateName, type SeedTemplate } from '@macrolog/core';
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
    UiAvatar,
    UiSheet,
    WorkoutSessionSheetComponent,
    TemplateEditorComponent,
    ExerciseDetailComponent,
    ExercisesManagerComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <ng-container *transloco="let t">
    <section class="max-w-[640px] mx-auto">
      <!-- Header: title + avatar only (mirrors mobile Train) -->
      <header class="flex items-center justify-between gap-4 pt-2 pb-2">
        <h1 class="page-title" style="font-family: var(--v2-font-display);">{{ t('train.title') }}</h1>
        <ui-avatar
          [photoUrl]="authUser()?.photoURL ?? null"
          [name]="authUser()?.displayName || authUser()?.email || null"
          [ariaLabel]="t('train.settingsAria')"
          (activate)="settingsRequested.emit()" />
      </header>

      @if (active(); as a) {
        <!-- Resume in-progress -->
        <ui-card variant="default" class="mt-4 block v2-active-highlight"
                 style="padding: var(--v2-space-4); border-radius: var(--v2-radius-lg);">
          <div class="flex items-center justify-between gap-3">
            <div>
              <p class="v2-field-label" style="color: var(--v2-accent); margin-bottom: 0.25rem;">{{ t('train.resumeTitle') }}</p>
              <h2 class="section-title">{{ sessionLabel(a) }}</h2>
              <p class="v2-caption mt-0.5">{{ t('train.exerciseCount', { count: a.exercises.length }) }}</p>
            </div>
            <ui-button variant="primary" (click)="openSheet()">{{ t('train.resume') }}</ui-button>
          </div>
        </ui-card>

        <!-- Active session's exercises -->
        @if (shownExercises(); as ex) {
          <h2 class="section-title mt-6">{{ t('train.exercisesSection') }} · {{ ex.name }}</h2>
          <div class="mt-2 grid gap-1">
            @for (te of ex.items; track te.exerciseId) {
              <button type="button" class="flex items-center justify-between gap-3 py-2 border-b text-left"
                      style="border-color: var(--v2-rule);" (click)="openDetailById(te.exerciseId, te.name)">
                <div>
                  <p class="v2-row-title">{{ te.name }}</p>
                  @if (musclesFor(te.exerciseId); as m) { <p class="v2-caption">{{ m }}</p> }
                </div>
                <lucide-icon name="trending-up" [size]="16" />
              </button>
            }
          </div>
        }
      } @else {
        <!-- Idle: dark hero + Start + Templates + History + Exercises -->
        <div class="mt-4" style="background: var(--v2-hero-panel); border-radius: var(--v2-radius-xl); padding: var(--v2-space-5) var(--v2-space-4); display: flex; flex-direction: column; align-items: center; gap: var(--v2-space-1); box-shadow: var(--v2-shadow-2);">
          <span style="text-align: center; color: var(--v2-hero-muted); font-size: 14px;">{{ t('train.thisWeek') }}</span>
          <div style="display: flex; align-items: flex-end; gap: var(--v2-space-1); margin-top: var(--v2-space-1);">
            <span style="font-family: var(--v2-font-display); font-weight: 800; font-size: 52px; line-height: 56px; color: var(--v2-hero-text);">{{ heroStats().count }}</span>
            <span style="font-size: 20px; color: var(--v2-hero-muted); margin-bottom: var(--v2-space-2);">{{ heroStats().count === 1 ? t('train.workoutUnit') : t('train.workoutsUnit') }}</span>
          </div>
          @if (heroStats().count === 0) {
            <span style="text-align: center; color: var(--v2-hero-muted); font-size: 14px; margin-top: var(--v2-space-1);">{{ t('train.weekEmpty') }}</span>
          } @else {
            <div style="display: flex; gap: var(--v2-space-2); flex-wrap: wrap; justify-content: center; margin-top: var(--v2-space-2);">
              @if (heroStats().volume > 0) {
                <span style="font-size: 14px; color: var(--v2-hero-muted); background: var(--v2-hero-track); border-radius: 999px; padding: 4px 12px;">{{ t('train.weekVolume') }}&nbsp; <span style="color: var(--v2-hero-text); font-weight: 700;">{{ heroStats().volume.toLocaleString() }} lb</span></span>
              }
              @if (heroStats().topSet > 0) {
                <span style="font-size: 14px; color: var(--v2-hero-muted); background: var(--v2-hero-track); border-radius: 999px; padding: 4px 12px;">{{ t('train.topSet') }}&nbsp; <span style="color: var(--v2-hero-text); font-weight: 700;">{{ heroStats().topSet.toLocaleString() }} lb</span></span>
              }
            </div>
          }
        </div>

        <button type="button" (click)="startEmpty()" class="mt-3 w-full"
                style="background: var(--v2-ink); color: var(--v2-paper); border: none; border-radius: var(--v2-radius-md); padding: var(--v2-space-4); font-weight: 700; font-size: 20px; cursor: pointer;">
          {{ t('train.startWorkout') }}
        </button>

        <!-- Templates -->
        <div class="mt-6 flex items-center justify-between">
          <h2 class="section-title" style="font-family: var(--v2-font-display);">{{ t('train.templates') }}</h2>
          <div class="flex items-center gap-4 shrink-0">
            <button type="button" (click)="openChooser()" style="background: none; border: none; padding: 0; color: var(--v2-accent); font-weight: 700; font-size: 14px; cursor: pointer;">{{ t('train.starters') }}</button>
            <button type="button" [disabled]="capReached()" (click)="blankTemplate()" style="background: none; border: none; padding: 0; color: var(--v2-accent); font-weight: 700; font-size: 14px; cursor: pointer;">{{ t('train.newTemplate') }}</button>
          </div>
        </div>
        @if (templates().length === 0) {
          <p class="v2-caption mt-2">{{ t('train.noTemplatesBody') }}</p>
        } @else {
          <div class="mt-2 grid gap-2">
            @for (tpl of templates(); track tpl.id) {
              <div class="flex items-center gap-3" style="background: var(--v2-paper-2); border: 1px solid var(--v2-rule); border-radius: var(--v2-radius-md); padding: var(--v2-space-3) var(--v2-space-4);">
                <button type="button" class="text-left grow" style="background: none; border: none; padding: 0; cursor: pointer;" (click)="edit(tpl)">
                  <p class="v2-row-title" style="font-weight: 700;">{{ tpl.name }}</p>
                  <p class="v2-caption mt-0.5">{{ t('train.exerciseCount', { count: tpl.exercises.length }) }}</p>
                </button>
                <button type="button" [disabled]="busy()" (click)="start(tpl)"
                        style="background: var(--v2-ink); color: var(--v2-paper); border: none; border-radius: var(--v2-radius-sm); padding: var(--v2-space-2) var(--v2-space-3); font-weight: 700; font-size: 14px; cursor: pointer;">{{ t('train.start') }}</button>
              </div>
            }
          </div>
        }

        <!-- History -->
        <h2 class="section-title mt-6" style="font-family: var(--v2-font-display);">{{ t('train.history') }}</h2>
        @if (completedRecent().length === 0) {
          <p class="v2-caption mt-2">{{ t('train.noSessions') }}</p>
        } @else {
          <p class="v2-caption mt-2 mb-2">{{ t('train.editHint') }}</p>
          <div class="grid gap-2">
            @for (ses of completedRecent(); track ses.id) {
              <button type="button" class="flex items-center justify-between gap-3 text-left"
                      style="background: var(--v2-paper-2); border: 1px solid var(--v2-rule); border-radius: var(--v2-radius-md); padding: var(--v2-space-3) var(--v2-space-4);" (click)="editSession(ses)">
                <div>
                  <p class="v2-row-title" style="font-weight: 700;">{{ formatWeekday(ses.date) }}</p>
                  <p class="v2-caption">{{ t('train.exerciseCount', { count: ses.exercises.length }) }}</p>
                </div>
                @if (volumeOf(ses) > 0) {
                  <span class="v2-num" style="font-weight: 700; color: var(--v2-ink); font-size: 14px;">{{ volumeOf(ses).toLocaleString() }} lb</span>
                }
              </button>
            }
          </div>
        }

        <!-- Exercises catalog -->
        @if (catalog().length) {
          <h2 class="section-title mt-6" style="font-family: var(--v2-font-display);">{{ t('train.exercisesSection') }}</h2>
          <div class="mt-2 grid gap-2">
            @for (e of catalog(); track e.id) {
              <button type="button" class="text-left"
                      style="background: var(--v2-paper-2); border: 1px solid var(--v2-rule); border-radius: var(--v2-radius-md); padding: var(--v2-space-3) var(--v2-space-4);" (click)="openDetailById(e.id!, e.name)">
                <p class="v2-row-title" style="font-weight: 700;">{{ e.name }}</p>
                <p class="v2-caption mt-0.5">{{ t('train.logStyle.' + (e.logStyle || 'weight-reps')) }}</p>
              </button>
            }
          </div>
        }
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
        <h2 id="train-chooser-title" class="section-title mb-3">{{ t('train.newTemplate') }}</h2>
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
                    <h3 class="card-title">{{ starterName(seed) }}</h3>
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
  private readonly auth = inject(AuthService);
  protected readonly authUser = this.auth.user;
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

  /** Idle-hero numbers (mirrors mobile trainHeroStats): workouts + total
   *  volume in the last 7 days, plus the heaviest set weight ever logged. */
  protected readonly heroStats = computed(() => {
    const weekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
    let count = 0;
    let volume = 0;
    let topSet = 0;
    for (const s of this.completedRecent()) {
      if (s.date.getTime() >= weekAgo) {
        count += 1;
        volume += this.volumeOf(s);
      }
      for (const ex of s.exercises) {
        for (const set of ex.sets) {
          if (set.weight != null && set.weight > topSet) topSet = set.weight;
        }
      }
    }
    return { count, volume, topSet };
  });

  /** Session tonnage = Σ weight×reps over logged sets (mirrors mobile
   *  sessionVolume). */
  protected volumeOf(ses: WorkoutSession): number {
    let vol = 0;
    for (const ex of ses.exercises) {
      for (const s of ex.sets) {
        if (s.weight != null && s.reps != null) vol += s.weight * s.reps;
      }
    }
    return Math.round(vol);
  }

  /** Full-width "Start workout": begin an empty active session. */
  protected async startEmpty(): Promise<void> {
    if (this.busy()) return;
    if (this.workout.activeSession()) {
      this.openSheet();
      return;
    }
    this.busy.set(true);
    try {
      await this.workout.startSession({ status: 'active', date: new Date(), exercises: [] });
      this.openSheet();
    } finally {
      this.busy.set(false);
    }
  }

  /** History row date: weekday · month · day (mirrors mobile). */
  protected formatWeekday(d: Date): string {
    return d.toLocaleDateString(bcp47ForLang(this.i18n.language()), {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
    });
  }

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

  /** Starter templates the user hasn't cloned yet. Matched by stable seedKey
   *  (holds across a locale switch); falls back to the localized name for
   *  clones made before seedKey existed. */
  protected readonly availableStarters = computed(() => {
    const es = this.i18n.language() === 'es-PR';
    const cloned = this.templates();
    const seedKeys = new Set(cloned.filter((tpl) => tpl.seedKey).map((tpl) => tpl.seedKey));
    const names = new Set(cloned.filter((tpl) => !tpl.seedKey).map((tpl) => tpl.name.toLowerCase()));
    return STARTER_TEMPLATES.filter(
      (s) => !seedKeys.has(s.key) && !names.has(seedTemplateName(s, es).toLowerCase()),
    );
  });

  /** Localized display name for a starter template (chooser list). */
  protected starterName(seed: SeedTemplate): string {
    return seedTemplateName(seed, this.i18n.language() === 'es-PR');
  }

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
