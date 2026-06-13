import {
  ChangeDetectionStrategy,
  Component,
  OnDestroy,
  computed,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import { LucideAngularModule } from 'lucide-angular';
import { TranslocoDirective } from '@jsverse/transloco';
import { FitnessStore } from '../../services/fitness-store.service';
import { WorkoutStore } from '../../services/workout-store.service';
import { TranslationService } from '../../services/translation.service';
import { UiSheet } from '../ui/sheet.component';
import { UiButton } from '../ui/button.component';
import { RestTimer } from './rest-timer';
import type { LogStyle, SessionExercise, WorkoutSession, WorkoutSet } from '../../models/workout';
import { DEFAULT_LOG_STYLE } from '../../models/workout';
import {
  computeExercisePRs,
  estimateOneRepMax,
  suggestProgression,
  type ExercisePRs,
  type ProgressionSuggestion,
} from '../../utils/workout-progression';
import { computePlateLoad, type PlateLoad } from '../../utils/plate-math';
import { generateWarmup, type WarmupSet } from '../../utils/warmup';

const SAVE_DEBOUNCE_MS = 800;

/**
 * The in-progress workout logger. Operates on `WorkoutStore.activeSession`:
 * edits live-write (debounced) back to Firestore via `updateSession`, so a
 * crash/reload resumes exactly where you left off. On open it pulls the
 * template's completed history to drive ghost placeholders ("last: 50×9"),
 * the rule-based load suggestion, and PR badges. "Finish" delegates to the
 * FitnessStore hub (`finishWorkout`) which also mirrors bodyweight and
 * stamps the day's exercise marker.
 */
@Component({
  selector: 'app-workout-session-sheet',
  standalone: true,
  imports: [LucideAngularModule, TranslocoDirective, UiSheet, UiButton],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <ng-container *transloco="let t">
    <ui-sheet [labelledBy]="'workout-session-title'" (close)="requestClose()">
      @if (session(); as s) {
        <header class="mb-4">
          <h2 id="workout-session-title" class="v2-h2">{{ headerName() }}</h2>
          @if (prevNotes()) {
            <p class="v2-caption mt-1" style="color: var(--v2-ink-muted);">
              <lucide-icon name="sticky-note" [size]="13" /> {{ prevNotes() }}
            </p>
          }
        </header>

        <!-- Rest timer -->
        @if (rest.remaining() > 0) {
          <div class="v2-rest-timer mb-3 flex items-center justify-between gap-3 px-4 py-2 rounded-xl"
               style="background: var(--v2-accent-soft);">
            <span class="v2-num" style="font-size: 1.25rem; font-weight: 600;">{{ rest.label() }}</span>
            <button type="button" class="v2-btn v2-btn--ghost v2-btn--sm" (click)="rest.stop()">{{ t('train.skipRest') }}</button>
          </div>
        }

        <!-- Exercises -->
        @for (ex of draft(); track ex.exerciseId; let exIdx = $index) {
          <section class="mb-5">
            <div class="flex items-baseline justify-between gap-2">
              <h3 class="v2-h3" style="font-weight: 600;">{{ ex.name }}</h3>
              @if (ghostText(ex); as g) {
                <span class="v2-caption" style="color: var(--v2-ink-muted); font-size: 0.75rem;">{{ g }}</span>
              }
            </div>

            @if (ex.cues.length) {
              <ul class="mt-1 mb-2 pl-4" style="list-style: disc; color: var(--v2-ink-muted);">
                @for (cue of ex.cues; track cue) {
                  <li class="v2-caption" style="font-size: 0.75rem;">{{ cue }}</li>
                }
              </ul>
            }

            <!-- Warm-up ramp (barbell only), seeded from the working load -->
            @if (styleOf(ex) === 'weight-reps' && warmupSets(ex).length) {
              <button type="button" class="v2-btn v2-btn--ghost v2-btn--sm mb-1"
                [attr.aria-pressed]="warmupOpen() === warmupKey(exIdx)"
                (click)="toggleWarmup(exIdx)">
                <lucide-icon name="flame" [size]="13" /> {{ t('train.warmup') }}
              </button>
              @if (warmupOpen() === warmupKey(exIdx)) {
                <ul class="mb-2 pl-4" style="list-style: disc; color: var(--v2-ink-muted);">
                  @for (w of warmupSets(ex); track $index) {
                    <li class="v2-caption" style="font-size: 0.72rem;">
                      <span class="v2-num">{{ w.weight }}</span> × {{ w.reps }}@if (w.pct == null) { · {{ t('train.warmupBar') }} } @else { · {{ pctLabel(w.pct) }} }
                    </li>
                  }
                </ul>
              }
            }

            @if (suggestionFor(ex); as sug) {
              @if (sug.bumped && sug.suggestedWeight != null) {
                <p class="v2-caption mb-1" style="color: var(--v2-accent); font-size: 0.75rem;">
                  <lucide-icon name="trending-up" [size]="12" /> {{ t('train.suggest', { weight: sug.suggestedWeight }) }}
                </p>
              }
            }

            <!-- Sets -->
            @for (set of ex.sets; track $index; let setIdx = $index) {
              <div class="flex items-center gap-2 py-1 flex-wrap">
                <span class="v2-caption shrink-0" style="width: 5.5rem; font-size: 0.7rem; color: var(--v2-ink-muted);">
                  {{ setLabel(t, set) }}
                </span>
                @switch (styleOf(ex)) {
                  @case ('time') {
                    <input type="number" inputmode="numeric" step="1" min="0"
                      class="v2-input v2-input--num" style="width: 4.5rem;"
                      [attr.aria-label]="t('train.seconds')"
                      [value]="set.durationSec ?? ''"
                      (input)="onSetField(exIdx, setIdx, 'durationSec', $event)" />
                    <span class="v2-caption" style="color: var(--v2-ink-muted);">s</span>
                    <input type="number" inputmode="decimal" step="0.5" min="0"
                      class="v2-input v2-input--num" style="width: 3.75rem;"
                      [attr.aria-label]="t('train.addedWeight')" placeholder="+"
                      [value]="set.weight ?? ''"
                      (input)="onSetField(exIdx, setIdx, 'weight', $event)" />
                  }
                  @case ('bodyweight') {
                    <input type="number" inputmode="numeric" step="1" min="0"
                      class="v2-input v2-input--num" style="width: 4.5rem;"
                      [attr.aria-label]="t('train.reps')"
                      [value]="set.reps ?? ''"
                      (input)="onSetField(exIdx, setIdx, 'reps', $event)" />
                    <span class="v2-caption" style="color: var(--v2-ink-muted);">{{ t('train.repsShort') }}</span>
                    <input type="number" inputmode="decimal" step="0.5" min="0"
                      class="v2-input v2-input--num" style="width: 3.75rem;"
                      [attr.aria-label]="t('train.addedWeight')" placeholder="+"
                      [value]="set.weight ?? ''"
                      (input)="onSetField(exIdx, setIdx, 'weight', $event)" />
                  }
                  @default {
                    <input type="number" inputmode="decimal" step="0.5" min="0"
                      class="v2-input v2-input--num" style="width: 4.5rem;"
                      [attr.aria-label]="t('train.weight')"
                      [value]="set.weight ?? ''"
                      (input)="onSetField(exIdx, setIdx, 'weight', $event)" />
                    <span class="v2-caption" style="color: var(--v2-ink-muted);">×</span>
                    <input type="number" inputmode="numeric" step="1" min="0"
                      class="v2-input v2-input--num" style="width: 4rem;"
                      [attr.aria-label]="t('train.reps')"
                      [value]="set.reps ?? ''"
                      (input)="onSetField(exIdx, setIdx, 'reps', $event)" />
                    <button type="button" class="v2-btn v2-btn--ghost v2-btn--sm"
                      [attr.aria-pressed]="platesOpen() === plateKey(exIdx, setIdx)"
                      (click)="togglePlates(exIdx, setIdx)">{{ t('train.plates') }}</button>
                  }
                }
                @if (showRir(set)) {
                  <span class="v2-caption" style="color: var(--v2-ink-muted);">@</span>
                  <input type="number" inputmode="numeric" step="1" min="0"
                    class="v2-input v2-input--num" style="width: 3rem;"
                    [attr.aria-label]="t('train.rir')" [attr.placeholder]="t('train.rirShort')"
                    [value]="set.rir ?? ''"
                    (input)="onSetField(exIdx, setIdx, 'rir', $event)" />
                }
                @if (isPr(ex, set)) {
                  <span class="v2-badge" style="color: var(--v2-accent); font-size: 0.7rem;">🏆 {{ t('train.pr') }}</span>
                }
                <button type="button" class="v2-icon-btn ml-auto" [attr.aria-label]="t('train.rest')"
                        (click)="markDone(exIdx, setIdx, set)">
                  <lucide-icon [name]="set.done ? 'check-circle-2' : 'circle'" [size]="18" />
                </button>
                @if (platesOpen() === plateKey(exIdx, setIdx)) {
                  <div class="basis-full mt-1" style="padding-left: 5.5rem;">
                    @if (plateLoadFor(set.weight); as pl) {
                      <p class="v2-caption" style="color: var(--v2-ink-muted); font-size: 0.72rem;">
                        @if (pl.perSide.length) {
                          {{ t('train.platesPerSide') }}: {{ plateChips(pl) }}@if (pl.remainder > 0) { · {{ t('train.platesShort', { n: pl.remainder }) }}}
                        } @else {
                          {{ t('train.platesBarOnly', { bar: pl.bar }) }}
                        }
                      </p>
                    } @else {
                      <p class="v2-caption" style="color: var(--v2-ink-muted); font-size: 0.72rem;">{{ t('train.platesNeedWeight') }}</p>
                    }
                  </div>
                }
              </div>
            }
            <button type="button" class="v2-btn v2-btn--ghost v2-btn--sm mt-1" (click)="addSet(exIdx)">
              <lucide-icon name="plus" [size]="13" /> {{ t('train.addSet') }}
            </button>
          </section>
        }

        <!-- Session footer fields -->
        <section class="mt-2 mb-4 grid grid-cols-3 gap-3">
          <label class="block">
            <span class="v2-field-label">{{ t('train.bodyweight') }}</span>
            <input type="number" inputmode="decimal" step="0.1" class="v2-input" style="width: 100%;"
                   [value]="s.bodyweight ?? ''" (input)="onHeaderField('bodyweight', $event)" />
          </label>
          <label class="block">
            <span class="v2-field-label">{{ t('train.sleepHours') }}</span>
            <input type="number" inputmode="decimal" step="0.5" class="v2-input" style="width: 100%;"
                   [value]="s.sleepHours ?? ''" (input)="onHeaderField('sleepHours', $event)" />
          </label>
          <label class="block">
            <span class="v2-field-label">{{ t('train.duration') }}</span>
            <input type="number" inputmode="numeric" step="1" class="v2-input" style="width: 100%;"
                   [value]="s.durationMin ?? ''" (input)="onHeaderField('durationMin', $event)" />
          </label>
        </section>

        <label class="block mb-4">
          <span class="v2-field-label">{{ t('train.nextNotes') }}</span>
          <textarea class="v2-input" rows="2" style="width: 100%; resize: vertical;"
                    [value]="nextNotes()" (input)="onNextNotes($event)"></textarea>
        </label>

        <div class="flex gap-3">
          @if (isEditing()) {
            <ui-button variant="primary" [block]="true" (click)="saveEdits()">
              {{ saving() ? t('train.saving') : t('train.done') }}
            </ui-button>
          } @else {
            <ui-button variant="ghost" (click)="requestDiscard()">{{ t('train.discard') }}</ui-button>
            <ui-button variant="primary" [block]="true" (click)="finish()">
              {{ saving() ? t('train.saving') : t('train.finish') }}
            </ui-button>
          }
        </div>
      }
    </ui-sheet>
    </ng-container>
  `,
})
export class WorkoutSessionSheetComponent implements OnDestroy {
  private readonly store = inject(FitnessStore);
  private readonly workout = inject(WorkoutStore);
  private readonly i18n = inject(TranslationService);

  /** When set, the sheet edits this already-completed session instead of
   *  the live active one: no "finish" lifecycle, just save-and-close. */
  readonly editingSession = input<WorkoutSession | null>(null);

  /** Emitted after a successful finish, save, or discard so the parent can
   *  drop the sheet from the view. */
  readonly closed = output<void>();

  protected readonly isEditing = computed(() => this.editingSession() != null);
  protected readonly session = computed(
    () => this.editingSession() ?? this.workout.activeSession(),
  );

  /** Title resolves to the live template name (by templateId) so a renamed
   *  template shows its current name; falls back to the session's stored
   *  snapshot, then a generic title. */
  protected readonly headerName = computed(() => {
    const s = this.session();
    if (!s) return '';
    if (s.templateId) {
      const tpl = this.workout.templates().find((t) => t.id === s.templateId);
      if (tpl) return tpl.name;
    }
    return s.templateName || this.i18n.t('train.sessionTitle');
  });
  protected readonly draft = signal<SessionExercise[]>([]);
  protected readonly nextNotes = signal('');
  protected readonly prevNotes = signal('');
  protected readonly saving = signal(false);
  /** Between-set rest countdown — see RestTimer for the state machine. */
  protected readonly rest = new RestTimer();

  /** Rest seconds snapshotted off the source template (rest config lives
   *  on the template, not the session). Falls back to sane defaults. */
  private readonly restSecs = computed(() => {
    const tplId = this.session()?.templateId;
    const tpl = this.workout.templates().find((x) => x.id === tplId);
    return { mini: tpl?.restMiniSec ?? 60, cluster: tpl?.restClusterSec ?? 120 };
  });

  /** Per-exercise completed history (most-recent-first), keyed by id. */
  private historyByExercise = new Map<string, SessionExercise[]>();
  private prCache = new Map<string, ExercisePRs>();
  private saveTimer: ReturnType<typeof setTimeout> | null = null;
  private hydratedFor: string | null = null;

  constructor() {
    // Seed the editable draft from the active session once and pull the
    // template history for ghosts/suggestions/PRs. The sheet is created
    // fresh each open (`@if (showSheet())` in the parent), so a one-shot
    // hydrate per instance covers resume-of-a-different-session.
    queueMicrotask(() => this.hydrate());
  }

  ngOnDestroy(): void {
    this.flushSave();
    this.rest.stop();
  }

  private async hydrate(): Promise<void> {
    const s = this.session();
    if (!s?.id || this.hydratedFor === s.id) return;
    this.hydratedFor = s.id;
    this.draft.set(s.exercises.map((ex) => ({ ...ex, sets: ex.sets.map((set) => ({ ...set })) })));
    this.nextNotes.set(s.nextNotes ?? '');

    if (s.templateId) {
      try {
        const history = await this.workout.getSessionsForTemplate(s.templateId, 10);
        this.indexHistory(history);
      } catch {
        /* offline / no index yet — ghosts simply won't show */
      }
    }
  }

  private indexHistory(sessions: WorkoutSession[]): void {
    const byEx = new Map<string, SessionExercise[]>();
    for (const ses of sessions) {
      for (const ex of ses.exercises) {
        const arr = byEx.get(ex.exerciseId) ?? [];
        arr.push(ex);
        byEx.set(ex.exerciseId, arr);
      }
    }
    this.historyByExercise = byEx;
    this.prCache = new Map(
      [...byEx.entries()].map(([id, rows]) => [id, computeExercisePRs(rows)] as const),
    );
    // "From last time" — the most recent completed session's notes.
    this.prevNotes.set(sessions[0]?.nextNotes ?? '');
  }

  protected styleOf(ex: SessionExercise): LogStyle {
    return ex.logStyle ?? DEFAULT_LOG_STYLE;
  }

  /** RIR is meaningful on working + activation sets; warmups/minis/drops
   *  are near-failure or throwaway by design, so skip the input there. */
  protected showRir(set: WorkoutSet): boolean {
    return set.kind === 'working' || set.kind === 'activation';
  }

  protected suggestionFor(ex: SessionExercise): ProgressionSuggestion {
    const history = this.historyByExercise.get(ex.exerciseId) ?? [];
    return suggestProgression(history, ex.progression, this.styleOf(ex));
  }

  /** Ghost "last time" text, formatted per logStyle (weight×reps[ @rir] /
   *  N reps / Ns). Empty string when there's no comparable history. */
  protected ghostText(ex: SessionExercise): string {
    const sug = this.suggestionFor(ex);
    const style = this.styleOf(ex);
    if (style === 'time') {
      return sug.lastDurationSec != null ? this.i18n.t('train.lastTime', { sec: sug.lastDurationSec }) : '';
    }
    if (style === 'bodyweight') {
      return sug.lastReps != null ? this.i18n.t('train.lastReps', { reps: sug.lastReps }) : '';
    }
    if (sug.lastWeight == null) return '';
    const base = this.i18n.t('train.lastSession', { weight: sug.lastWeight, reps: sug.lastReps ?? '—' });
    return sug.lastRir != null ? `${base} @${sug.lastRir}` : base;
  }

  protected isPr(ex: SessionExercise, set: WorkoutSet): boolean {
    if (set.kind === 'warmup') return false;
    const best = this.prCache.get(ex.exerciseId);
    if (!best) return false; // no prior history → not flagged as PR
    const style = this.styleOf(ex);
    if (style === 'time') {
      return set.durationSec != null && best.maxDurationSec > 0 && set.durationSec > best.maxDurationSec;
    }
    if (style === 'bodyweight') {
      return set.reps != null && best.maxReps > 0 && set.reps > best.maxReps;
    }
    if (set.weight == null || set.reps == null || best.bestE1RM === 0) return false;
    return estimateOneRepMax(set.weight, set.reps) > best.bestE1RM;
  }

  protected setLabel(t: (k: string, p?: Record<string, unknown>) => string, set: WorkoutSet): string {
    const kind = t('train.kind.' + set.kind);
    return set.group != null ? `${t('train.cluster', { n: set.group })} · ${kind}` : kind;
  }

  // ─── Plate calculator ─────────────────────────────────────────
  /** Which set's plate breakdown is expanded, keyed `exIdx-setIdx`, or
   *  null. Only one open at a time — it's an inline helper, not a panel. */
  protected readonly platesOpen = signal<string | null>(null);

  protected plateKey(exIdx: number, setIdx: number): string {
    return `${exIdx}-${setIdx}`;
  }

  protected togglePlates(exIdx: number, setIdx: number): void {
    const key = this.plateKey(exIdx, setIdx);
    this.platesOpen.update((cur) => (cur === key ? null : key));
  }

  /** Plate solve for a set's weight (lb, default bar + plate set), or null
   *  when the set has no weight yet. */
  protected plateLoadFor(weight: number | undefined): PlateLoad | null {
    return weight != null ? computePlateLoad(weight) : null;
  }

  /** "45 + 25 + 2.5" per-side chip string. */
  protected plateChips(pl: PlateLoad): string {
    return pl.perSide
      .flatMap((p) => Array.from({ length: p.count }, () => p.plate))
      .join(' + ');
  }

  // ─── Warm-up ramp ─────────────────────────────────────────────
  protected readonly warmupOpen = signal<string | null>(null);

  protected warmupKey(exIdx: number): string {
    return `w${exIdx}`;
  }

  protected toggleWarmup(exIdx: number): void {
    const key = this.warmupKey(exIdx);
    this.warmupOpen.update((cur) => (cur === key ? null : key));
  }

  /** Working load to ramp toward: the snapshot `targetLoad`, else the
   *  heaviest weight already entered across the exercise's sets. */
  private warmupSeed(ex: SessionExercise): number {
    if (ex.targetLoad && ex.targetLoad > 0) return ex.targetLoad;
    return ex.sets.reduce((max, s) => Math.max(max, s.weight ?? 0), 0);
  }

  protected warmupSets(ex: SessionExercise): WarmupSet[] {
    return generateWarmup(this.warmupSeed(ex));
  }

  protected pctLabel(pct: number): string {
    return `${Math.round(pct * 100)}%`;
  }

  // ─── Editing ──────────────────────────────────────────────────
  protected onSetField(
    exIdx: number,
    setIdx: number,
    field: 'weight' | 'reps' | 'durationSec' | 'rir',
    e: Event,
  ): void {
    const raw = (e.target as HTMLInputElement).value;
    const num = raw === '' ? undefined : Number(raw);
    this.draft.update((exs) => {
      const next = exs.map((ex, i) => {
        if (i !== exIdx) return ex;
        const sets = ex.sets.map((s, j) => (j === setIdx ? { ...s, [field]: num } : s));
        return { ...ex, sets };
      });
      return next;
    });
    this.scheduleSave();
  }

  protected addSet(exIdx: number): void {
    this.draft.update((exs) =>
      exs.map((ex, i) => {
        if (i !== exIdx) return ex;
        const last = ex.sets[ex.sets.length - 1];
        const seed: WorkoutSet = { kind: last?.kind ?? 'working', group: last?.group };
        return { ...ex, sets: [...ex.sets, seed] };
      }),
    );
    this.scheduleSave();
  }

  protected markDone(exIdx: number, setIdx: number, set: WorkoutSet): void {
    const nowDone = !set.done;
    this.draft.update((exs) =>
      exs.map((ex, i) =>
        i === exIdx
          ? { ...ex, sets: ex.sets.map((s, j) => (j === setIdx ? { ...s, done: nowDone } : s)) }
          : ex,
      ),
    );
    // Start a rest only when marking done (not un-done). Mini-sets get the
    // short rest; everything else the longer between-cluster rest.
    if (nowDone) {
      const { mini, cluster } = this.restSecs();
      const restSec = set.kind === 'mini' ? mini : cluster;
      if (restSec > 0) this.rest.start(restSec);
    }
    this.scheduleSave();
  }

  protected onHeaderField(field: 'bodyweight' | 'sleepHours' | 'durationMin', e: Event): void {
    const raw = (e.target as HTMLInputElement).value;
    const num = raw === '' ? undefined : Number(raw);
    const id = this.session()?.id;
    if (!id) return;
    void this.workout.updateSession(id, { [field]: num });
  }

  protected onNextNotes(e: Event): void {
    this.nextNotes.set((e.target as HTMLTextAreaElement).value);
    this.scheduleSave();
  }

  // ─── Persistence ──────────────────────────────────────────────
  private scheduleSave(): void {
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => this.flushSave(), SAVE_DEBOUNCE_MS);
  }

  private flushSave(): void {
    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
      this.saveTimer = null;
    }
    const id = this.session()?.id;
    if (!id) return;
    void this.workout.updateSession(id, {
      exercises: this.draft(),
      nextNotes: this.nextNotes() || undefined,
    });
  }

  // ─── Lifecycle actions ────────────────────────────────────────
  protected async finish(): Promise<void> {
    const id = this.session()?.id;
    if (!id || this.saving()) return;
    this.saving.set(true);
    try {
      this.flushSave();
      await this.store.finishWorkout(id, {
        exercises: this.draft(),
        nextNotes: this.nextNotes() || undefined,
      });
      this.closed.emit();
    } finally {
      this.saving.set(false);
    }
  }

  /** Edit-mode primary action: persist pending set/notes edits (header
   *  fields already live-write) and close. No finishWorkout — the session
   *  is already completed, so re-running it would double-stamp the day's
   *  exercise marker. */
  protected saveEdits(): void {
    if (this.saving()) return;
    this.saving.set(true);
    try {
      this.flushSave();
      this.closed.emit();
    } finally {
      this.saving.set(false);
    }
  }

  protected requestDiscard(): void {
    const id = this.session()?.id;
    if (!id) return;
    if (!confirm(this.i18n.t('train.discardConfirm'))) return;
    void this.workout.deleteSession(id).then(() => this.closed.emit());
  }

  protected requestClose(): void {
    // Closing the sheet keeps the session active (it's already persisted)
    // so the user can resume from the Train tab.
    this.flushSave();
    this.closed.emit();
  }
}
