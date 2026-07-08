import { Injectable, Signal, computed, inject, signal } from '@angular/core';
import { LEDGER_PORT } from '../ledger/ports/ledger.port';
import { SubscriptionService } from './subscription.service';
import {
  CUSTOM_TEMPLATE_LIMIT_FREE,
  Exercise,
  ExerciseDraft,
  SessionDraft,
  TemplateDraft,
  TemplateExercise,
  TemplateLimitError,
  WorkoutSession,
  WorkoutTemplate,
  dropEmptySets,
} from '../models/workout';
import {
  fillMissingClusterLoads,
  findSeedExercise,
  seedExerciseCues,
  seedExerciseName,
  seedTemplateExerciseCues,
  seedTemplateName,
  seedTemplateNotes,
  type SeedTemplate,
} from '@macrolog/core';
import { TranslationService } from './translation.service';

/**
 * Owns Train-tab state: the exercise catalog, workout templates, the
 * recent-session list, and the single in-progress (`active`) session.
 * Hydration is coordinated by FitnessStore (`hydrate()` / `clear()`) so
 * one sign-in effect drives every store's load lifecycle — matches the
 * BodyMetricStore pattern.
 *
 * This store is persistence-only for its own three collections. The
 * cross-cutting "finish" concerns — mirroring bodyweight into
 * `dailyWeights` and stamping the day's exercise marker — live on the
 * FitnessStore hub (`finishWorkout`), which already owns logs + body, so
 * this store never reaches across the seam (no circular dependency).
 */
@Injectable({ providedIn: 'root' })
export class WorkoutStore {
  private readonly fb = inject(LEDGER_PORT);
  private readonly subs = inject(SubscriptionService);
  private readonly i18n = inject(TranslationService);

  private readonly _exercises = signal<Exercise[]>([]);
  private readonly _templates = signal<WorkoutTemplate[]>([]);
  private readonly _recentSessions = signal<WorkoutSession[]>([]);
  private readonly _activeSession = signal<WorkoutSession | null>(null);

  readonly exercises: Signal<Exercise[]> = this._exercises.asReadonly();
  readonly templates: Signal<WorkoutTemplate[]> = this._templates.asReadonly();
  readonly recentSessions: Signal<WorkoutSession[]> = this._recentSessions.asReadonly();
  readonly activeSession: Signal<WorkoutSession | null> = this._activeSession.asReadonly();

  readonly hasActiveSession: Signal<boolean> = computed(() => this._activeSession() !== null);

  /** Remaining custom-template slots for free users; null when unlimited (Pro). */
  readonly remainingTemplateSlots: Signal<number | null> = computed(() => {
    if (this.subs.isPaid()) return null;
    return Math.max(0, CUSTOM_TEMPLATE_LIMIT_FREE - this._templates().length);
  });

  /** Bulk-load every Train collection. Called from FitnessStore._load(). */
  hydrate(input: {
    exercises: Exercise[];
    templates: WorkoutTemplate[];
    recentSessions: WorkoutSession[];
    activeSession: WorkoutSession | null;
  }): void {
    this._exercises.set(input.exercises);
    this._templates.set(input.templates);
    this._recentSessions.set(input.recentSessions);
    this._activeSession.set(input.activeSession);
  }

  /** Reset to empty on sign-out. */
  clear(): void {
    this._exercises.set([]);
    this._templates.set([]);
    this._recentSessions.set([]);
    this._activeSession.set(null);
  }

  // ─── Exercise catalog ─────────────────────────────────────────
  async addExercise(exercise: ExerciseDraft): Promise<string> {
    const id = await this.fb.addExercise(exercise);
    this._exercises.set(await this.fb.getExercises());
    return id;
  }

  async updateExercise(id: string, patch: Partial<ExerciseDraft>): Promise<void> {
    await this.fb.updateExercise(id, patch);
    this._exercises.set(await this.fb.getExercises());
  }

  async deleteExercise(id: string): Promise<void> {
    await this.fb.deleteExercise(id);
    this._exercises.set(await this.fb.getExercises());
  }

  /** Merge `fromId` into `toId` and refresh every signal the merge can
   *  touch — the catalog, templates, and both session caches all carry
   *  exerciseId references that the merge rewrites. */
  async mergeExercises(fromId: string, toId: string): Promise<void> {
    await this.fb.mergeExercises(fromId, toId);
    const [exercises, templates, active, recent] = await Promise.all([
      this.fb.getExercises(),
      this.fb.getTemplates(),
      this.fb.getActiveSession(),
      this.fb.getRecentSessions(),
    ]);
    this._exercises.set(exercises);
    this._templates.set(templates);
    this._activeSession.set(active);
    this._recentSessions.set(recent);
  }

  // ─── Templates ────────────────────────────────────────────────
  /** @throws TemplateLimitError when a free user is at the cap. The
   *  server has no Pro claim for templates (client cap only, like
   *  presets), so this guard is cosmetic — keep real Pro barriers
   *  server-side per the project convention. */
  async addTemplate(template: TemplateDraft): Promise<string> {
    if (!this.subs.isPaid() && this._templates().length >= CUSTOM_TEMPLATE_LIMIT_FREE) {
      throw new TemplateLimitError(CUSTOM_TEMPLATE_LIMIT_FREE);
    }
    const id = await this.fb.addTemplate(template);
    this._templates.set(await this.fb.getTemplates());
    return id;
  }

  async updateTemplate(id: string, template: TemplateDraft): Promise<void> {
    await this.fb.updateTemplate(id, template);
    this._templates.set(await this.fb.getTemplates());
  }

  async deleteTemplate(id: string): Promise<void> {
    await this.fb.deleteTemplate(id);
    this._templates.set(await this.fb.getTemplates());
  }

  /**
   * Clone a shipped starter template into the user's editable space.
   * Resolves each seed exercise to a catalog entry — reusing one that
   * already exists by name (case-insensitive) or creating it from the
   * library — then builds a template draft that references the resulting
   * exercise ids and snapshots their display names. Subject to the
   * free-tier template cap (throws {@link TemplateLimitError}).
   */
  async cloneStarterTemplate(seed: SeedTemplate): Promise<string> {
    if (!this.subs.isPaid() && this._templates().length >= CUSTOM_TEMPLATE_LIMIT_FREE) {
      throw new TemplateLimitError(CUSTOM_TEMPLATE_LIMIT_FREE);
    }

    // Resolve seed content for the active locale once, then store as the
    // user's own data (never re-translated). Dedupe by the stable seedKey
    // (falling back to the resolved name for pre-seedKey clones) so a re-clone
    // — even after a locale switch — reuses the existing catalog entry instead
    // of splitting history/e1RM across a locale-named duplicate.
    const es = this.i18n.language() === 'es-PR';

    const bySeedKey = new Map(
      this._exercises()
        .filter((e) => e.seedKey)
        .map((e) => [e.seedKey!, e] as const),
    );
    const byName = new Map(
      this._exercises().map((e) => [e.name.toLowerCase(), e] as const),
    );

    const exercises: TemplateExercise[] = [];
    for (const seedEx of seed.exercises) {
      const lib = findSeedExercise(seedEx.key);
      if (!lib) continue; // skip dangling references defensively
      const name = seedExerciseName(lib, es);
      const defaultCues = seedExerciseCues(lib, es);
      let entry = bySeedKey.get(seedEx.key) ?? byName.get(name.toLowerCase());
      if (!entry) {
        const id = await this.fb.addExercise({ name, muscles: lib.muscles, defaultCues, seedKey: seedEx.key });
        entry = { id, name, muscles: lib.muscles, defaultCues, seedKey: seedEx.key, createdAt: new Date() };
        bySeedKey.set(seedEx.key, entry);
        byName.set(name.toLowerCase(), entry);
      }
      exercises.push({
        exerciseId: entry.id!,
        name: entry.name,
        targetLoad: seedEx.targetLoad,
        cues: seedTemplateExerciseCues(seed.key, seedEx, lib, es),
        progression: seedEx.progression,
        plannedSets: seedEx.plannedSets,
      });
    }

    // Refresh the catalog signal once after any new exercises were created.
    this._exercises.set(await this.fb.getExercises());

    const id = await this.fb.addTemplate({
      name: seedTemplateName(seed, es),
      notes: seedTemplateNotes(seed, es),
      restMiniSec: seed.restMiniSec,
      restClusterSec: seed.restClusterSec,
      exercises,
      seedKey: seed.key,
    });
    this._templates.set(await this.fb.getTemplates());
    return id;
  }

  // ─── Sessions ─────────────────────────────────────────────────
  /** Completed sessions for one template, newest-first — backs the
   *  rule-based "last session" autofill + progression suggestions.
   *  Not cached: callers pull on demand when opening a session. */
  getSessionsForTemplate(templateId: string, count = 10): Promise<WorkoutSession[]> {
    return this.fb.getSessionsForTemplate(templateId, count);
  }

  /** All sessions, newest-first — backs per-exercise progression charts
   *  (filtered client-side, like FitnessStore.getAllLogs). */
  getAllSessions(): Promise<WorkoutSession[]> {
    return this.fb.getAllSessions();
  }

  /** Create the in-progress session doc (status:'active'). Enforces the
   *  single-active-session invariant: only one session may be `active` at
   *  a time, so `getActiveSession`'s `limit(1)` is deterministic and no
   *  abandoned session is silently orphaned. Callers gate on
   *  {@link hasActiveSession} and offer resume/finish before starting. */
  async startSession(session: SessionDraft): Promise<string> {
    if (this._activeSession()) {
      throw new Error('A workout is already in progress — resume or finish it first.');
    }
    const id = await this.fb.startSession({ ...session, status: 'active' });
    this._activeSession.set(await this.fb.getActiveSession());
    return id;
  }

  /** Debounced live-write path while logging — and the save path for
   *  editing an already-completed session. Updates whichever local signal
   *  holds the doc (active or the recent list) optimistically so the UI
   *  stays in sync without a refetch. */
  async updateSession(id: string, patch: Partial<SessionDraft>): Promise<void> {
    await this.fb.updateSession(id, patch);
    this._activeSession.update((cur) =>
      cur && cur.id === id ? { ...cur, ...patch, updatedAt: new Date() } : cur,
    );
    this._recentSessions.update((list) =>
      list.map((s) => (s.id === id ? { ...s, ...patch, updatedAt: new Date() } : s)),
    );
  }

  /**
   * Flip a session to `completed`. Persistence + local-cache refresh
   * only — the FitnessStore hub layers on the bodyweight mirror and the
   * exercise marker (`finishWorkout`). Clears the active-session signal
   * and refreshes the recent list.
   */
  async completeSession(id: string, patch: Partial<SessionDraft> = {}): Promise<void> {
    // Strip unfilled cluster-scaffold sets before the session is frozen as
    // `completed`: the template's `plannedSets` pre-create the full cluster
    // structure (activation + mini rows) up front, and any cluster the user
    // didn't complete would otherwise persist as blank rows. Only the
    // finished doc is cleaned — the live autosave path (`updateSession`)
    // keeps the scaffold so in-progress rows stay editable.
    // Auto-default any logged-but-loadless set from its siblings BEFORE pruning
    // empties, so a cluster/activation row with reps but a blank weight is
    // healed (not persisted as weight 0). See fillMissingClusterLoads.
    const cleaned = patch.exercises
      ? { ...patch, exercises: dropEmptySets(fillMissingClusterLoads(patch.exercises)) }
      : patch;
    await this.fb.updateSession(id, { ...cleaned, status: 'completed' });
    this._activeSession.set(await this.fb.getActiveSession());
    this._recentSessions.set(await this.fb.getRecentSessions());
  }

  async deleteSession(id: string): Promise<void> {
    await this.fb.deleteSession(id);
    const [active, recent] = await Promise.all([
      this.fb.getActiveSession(),
      this.fb.getRecentSessions(),
    ]);
    this._activeSession.set(active);
    this._recentSessions.set(recent);
  }
}
