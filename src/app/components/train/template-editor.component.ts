import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import { LucideAngularModule } from 'lucide-angular';
import { TranslocoDirective } from '@jsverse/transloco';
import { WorkoutStore } from '../../services/workout-store.service';
import { TranslationService } from '../../services/translation.service';
import { UiSheet } from '../ui/sheet.component';
import { UiButton } from '../ui/button.component';
import { UiIconButton } from '../ui/icon-button.component';
import {
  TemplateLimitError,
  type PlannedSet,
  type SetKind,
  type TemplateDraft,
  type TemplateExercise,
} from '../../models/workout';
import { normalizeClusterGroups } from '../../utils/cluster-groups';

const SET_KINDS: SetKind[] = ['warmup', 'activation', 'working', 'mini', 'drop'];

/** Local editable shape for one exercise row (flattened progression). */
interface EditExercise {
  exerciseId: string | null; // null = new catalog entry, created on save
  name: string;
  targetLoad?: number;
  cuesText: string; // newline-separated; split on save
  hasProgression: boolean;
  targetReps?: number;
  holdSessions?: number;
  incrementLb?: number;
  sets: PlannedSet[];
}

/**
 * Build-from-scratch (or edit) a workout template. Edits a local draft and
 * commits on Save: any exercise row without an `exerciseId` is created in
 * the catalog first (so progression charts get a stable identity), then the
 * template is written via add/updateTemplate. New templates respect the
 * free-tier cap (TemplateLimitError → upsell message).
 */
@Component({
  selector: 'app-template-editor',
  standalone: true,
  imports: [LucideAngularModule, TranslocoDirective, UiSheet, UiButton, UiIconButton],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <ng-container *transloco="let t">
    <ui-sheet [labelledBy]="'template-editor-title'" (close)="closed.emit()">
      <header class="mb-3">
        <h2 id="template-editor-title" class="v2-h2">
          {{ templateId() ? t('train.editTemplate') : t('train.newTemplate') }}
        </h2>
      </header>

      <label class="block mb-2">
        <span class="v2-field-label">{{ t('train.name') }}</span>
        <input class="v2-input" style="width: 100%;" [value]="name()" (input)="name.set(asValue($event))" />
      </label>
      <label class="block mb-2">
        <span class="v2-field-label">{{ t('train.notes') }}</span>
        <textarea class="v2-input" rows="2" style="width: 100%; resize: vertical;"
                  [value]="notes()" (input)="notes.set(asValue($event))"></textarea>
      </label>
      <div class="grid grid-cols-2 gap-3 mb-4">
        <label class="block">
          <span class="v2-field-label">{{ t('train.restMini') }}</span>
          <input type="number" inputmode="numeric" class="v2-input" style="width: 100%;"
                 [value]="restMini() ?? ''" (input)="restMini.set(asNum($event))" />
        </label>
        <label class="block">
          <span class="v2-field-label">{{ t('train.restCluster') }}</span>
          <input type="number" inputmode="numeric" class="v2-input" style="width: 100%;"
                 [value]="restCluster() ?? ''" (input)="restCluster.set(asNum($event))" />
        </label>
      </div>

      <!-- Exercises -->
      <h3 class="v2-h3 mb-2" style="font-weight: 600;">{{ t('train.exercisesSection') }}</h3>
      @for (ex of exercises(); track $index; let exIdx = $index) {
        <div class="v2-card v2-card--flat px-3 py-3 mb-2">
          <div class="flex items-center justify-between gap-2 mb-2">
            <input class="v2-input grow" [value]="ex.name" (input)="setEx(exIdx, 'name', asValue($event))"
                   [attr.placeholder]="t('train.exerciseName')" />
            <ui-icon-button icon="trash-2" [ariaLabel]="t('train.removeExercise')" (click)="removeEx(exIdx)" />
          </div>

          <div class="grid grid-cols-2 gap-2 mb-2">
            <label class="block">
              <span class="v2-field-label">{{ t('train.targetLoad') }}</span>
              <input type="number" inputmode="decimal" step="0.5" class="v2-input" style="width: 100%;"
                     [value]="ex.targetLoad ?? ''" (input)="setEx(exIdx, 'targetLoad', asNum($event))" />
            </label>
          </div>

          <label class="block mb-2">
            <span class="v2-field-label">{{ t('train.cues') }}</span>
            <textarea class="v2-input" rows="2" style="width: 100%; resize: vertical;"
                      [value]="ex.cuesText" (input)="setEx(exIdx, 'cuesText', asValue($event))"></textarea>
          </label>

          <!-- Progression -->
          <label class="flex items-center gap-2 mb-2 v2-caption" style="font-size: 0.75rem;">
            <input type="checkbox" [checked]="ex.hasProgression" (change)="toggleProgression(exIdx, $event)" />
            {{ t('train.progression') }}
          </label>
          @if (ex.hasProgression) {
            <div class="grid grid-cols-3 gap-2 mb-2">
              <label class="block">
                <span class="v2-field-label">{{ t('train.targetReps') }}</span>
                <input type="number" inputmode="numeric" class="v2-input" style="width: 100%;"
                       [value]="ex.targetReps ?? ''" (input)="setEx(exIdx, 'targetReps', asNum($event))" />
              </label>
              <label class="block">
                <span class="v2-field-label">{{ t('train.holdSessions') }}</span>
                <input type="number" inputmode="numeric" class="v2-input" style="width: 100%;"
                       [value]="ex.holdSessions ?? ''" (input)="setEx(exIdx, 'holdSessions', asNum($event))" />
              </label>
              <label class="block">
                <span class="v2-field-label">{{ t('train.incrementLb') }}</span>
                <input type="number" inputmode="decimal" step="0.5" class="v2-input" style="width: 100%;"
                       [value]="ex.incrementLb ?? ''" (input)="setEx(exIdx, 'incrementLb', asNum($event))" />
              </label>
            </div>
          }

          <!-- Sets -->
          <p class="v2-field-label">{{ t('train.sets') }}</p>
          @for (set of ex.sets; track $index; let setIdx = $index) {
            <div class="flex items-center gap-2 mb-1">
              <select class="v2-input" (change)="setSetKind(exIdx, setIdx, $event)">
                @for (k of kinds; track k) {
                  <option [value]="k" [selected]="k === set.kind">{{ t('train.kind.' + k) }}</option>
                }
              </select>
              <!-- Cluster number is derived from the activation/mini
                   sequence (not free-typed) so clusters always number 1, 2,
                   3 … and can't be corrupted by append-typing. -->
              <span class="v2-caption shrink-0" style="width: 4rem; color: var(--v2-ink-muted);">
                @if (set.group != null) { {{ t('train.cluster', { n: set.group }) }} }
              </span>
              <ui-icon-button icon="trash-2" [ariaLabel]="t('train.removeSet')" (click)="removeSet(exIdx, setIdx)" />
            </div>
          }
          <div class="flex gap-2 mt-1">
            <button type="button" class="v2-btn v2-btn--ghost v2-btn--sm" (click)="addSet(exIdx)">
              <lucide-icon name="plus" [size]="12" /> {{ t('train.addSet') }}
            </button>
            <button type="button" class="v2-btn v2-btn--ghost v2-btn--sm" (click)="addCluster(exIdx)">
              <lucide-icon name="plus" [size]="12" /> {{ t('train.addCluster') }}
            </button>
          </div>
        </div>
      }

      <div class="flex gap-2 mb-4">
        <input class="v2-input grow" [value]="newExName()" (input)="newExName.set(asValue($event))"
               [attr.placeholder]="t('train.exerciseName')"
               [attr.list]="'catalog-names'" />
        <datalist id="catalog-names">
          @for (c of catalog(); track c.id) { <option [value]="c.name"></option> }
        </datalist>
        <ui-button variant="secondary" size="sm" (click)="addExercise()">{{ t('train.addExercise') }}</ui-button>
      </div>

      @if (error()) {
        <p class="v2-caption mb-2" style="color: var(--v2-danger, #c0392b);">{{ error() }}</p>
      }

      <div class="flex gap-3">
        <ui-button variant="ghost" (click)="closed.emit()">{{ t('train.cancel') }}</ui-button>
        <ui-button variant="primary" [block]="true" [disabled]="!canSave() || saving()" (click)="save()">
          {{ saving() ? t('train.saving') : t('train.save') }}
        </ui-button>
      </div>
    </ui-sheet>
    </ng-container>
  `,
})
export class TemplateEditorComponent {
  private readonly workout = inject(WorkoutStore);
  private readonly i18n = inject(TranslationService);

  readonly templateId = input<string | null>(null);
  readonly closed = output<void>();

  protected readonly kinds = SET_KINDS;
  protected readonly catalog = this.workout.exercises;

  protected readonly name = signal('');
  protected readonly notes = signal('');
  protected readonly restMini = signal<number | undefined>(undefined);
  protected readonly restCluster = signal<number | undefined>(undefined);
  protected readonly exercises = signal<EditExercise[]>([]);
  protected readonly newExName = signal('');
  protected readonly saving = signal(false);
  protected readonly error = signal('');

  protected readonly canSave = computed(
    () => this.name().trim().length > 0 && this.exercises().length > 0,
  );

  constructor() {
    queueMicrotask(() => this.hydrate());
  }

  private hydrate(): void {
    const id = this.templateId();
    if (!id) return;
    const tpl = this.workout.templates().find((x) => x.id === id);
    if (!tpl) return;
    this.name.set(tpl.name);
    this.notes.set(tpl.notes ?? '');
    this.restMini.set(tpl.restMiniSec);
    this.restCluster.set(tpl.restClusterSec);
    this.exercises.set(
      tpl.exercises.map((te) => ({
        exerciseId: te.exerciseId,
        name: te.name,
        targetLoad: te.targetLoad,
        cuesText: (te.cues ?? []).join('\n'),
        hasProgression: !!te.progression,
        targetReps: te.progression?.targetReps,
        holdSessions: te.progression?.holdSessions,
        incrementLb: te.progression?.incrementLb,
        sets: te.plannedSets.map((p) => ({ ...p })),
      })),
    );
  }

  // ─── Template inputs (helpers used in template) ───────────────
  protected asValue(e: Event): string {
    return (e.target as HTMLInputElement | HTMLTextAreaElement).value;
  }
  protected asNum(e: Event): number | undefined {
    const v = (e.target as HTMLInputElement).value;
    return v === '' ? undefined : Number(v);
  }

  // ─── Exercise row edits ───────────────────────────────────────
  protected addExercise(): void {
    const raw = this.newExName().trim();
    if (!raw) return;
    const match = this.catalog().find((c) => c.name.toLowerCase() === raw.toLowerCase());
    this.exercises.update((xs) => [
      ...xs,
      {
        exerciseId: match?.id ?? null,
        name: match?.name ?? raw,
        cuesText: (match?.defaultCues ?? []).join('\n'),
        hasProgression: false,
        sets: [{ kind: 'working' }],
      },
    ]);
    this.newExName.set('');
  }

  protected removeEx(idx: number): void {
    this.exercises.update((xs) => xs.filter((_, i) => i !== idx));
  }

  protected setEx<K extends keyof EditExercise>(idx: number, key: K, value: EditExercise[K]): void {
    this.exercises.update((xs) => xs.map((ex, i) => (i === idx ? { ...ex, [key]: value } : ex)));
  }

  protected toggleProgression(idx: number, e: Event): void {
    const on = (e.target as HTMLInputElement).checked;
    this.exercises.update((xs) =>
      xs.map((ex, i) =>
        i === idx
          ? {
              ...ex,
              hasProgression: on,
              targetReps: ex.targetReps ?? (on ? 12 : undefined),
              holdSessions: ex.holdSessions ?? (on ? 2 : undefined),
              incrementLb: ex.incrementLb ?? (on ? 5 : undefined),
            }
          : ex,
      ),
    );
  }

  // ─── Set edits ────────────────────────────────────────────────
  protected addSet(exIdx: number): void {
    this.mutateSets(exIdx, (sets) => [...sets, { kind: 'working' }]);
  }

  protected addCluster(exIdx: number): void {
    // Group numbers are assigned by normalizeClusterGroups (run inside
    // mutateSets) from the activation/mini ordering — no manual numbering.
    this.mutateSets(exIdx, (sets) => [
      ...sets,
      { kind: 'activation' },
      { kind: 'mini' },
      { kind: 'mini' },
    ]);
  }

  protected removeSet(exIdx: number, setIdx: number): void {
    this.mutateSets(exIdx, (sets) => sets.filter((_, i) => i !== setIdx));
  }

  protected setSetKind(exIdx: number, setIdx: number, e: Event): void {
    const kind = (e.target as HTMLSelectElement).value as SetKind;
    this.mutateSets(exIdx, (sets) => sets.map((s, i) => (i === setIdx ? { ...s, kind } : s)));
  }

  /** Every set mutation re-derives cluster groups so numbering stays
   *  sequential and contiguous after kind changes, inserts, and deletes. */
  private mutateSets(exIdx: number, fn: (sets: PlannedSet[]) => PlannedSet[]): void {
    this.exercises.update((xs) =>
      xs.map((ex, i) => (i === exIdx ? { ...ex, sets: normalizeClusterGroups(fn(ex.sets)) } : ex)),
    );
  }

  // ─── Save ─────────────────────────────────────────────────────
  protected async save(): Promise<void> {
    if (!this.canSave() || this.saving()) return;
    this.saving.set(true);
    this.error.set('');
    try {
      const exercises: TemplateExercise[] = [];
      for (const ex of this.exercises()) {
        let exerciseId = ex.exerciseId;
        const cues = ex.cuesText.split('\n').map((c) => c.trim()).filter(Boolean);
        if (!exerciseId) {
          exerciseId = await this.workout.addExercise({
            name: ex.name.trim() || this.i18n.t('train.untitledExercise'),
            muscles: [],
            defaultCues: cues,
          });
        }
        exercises.push({
          exerciseId,
          name: ex.name.trim(),
          targetLoad: ex.targetLoad,
          // Snapshot the catalog exercise's logStyle so the logger renders
          // the right inputs without a catalog join at log time.
          logStyle: this.catalog().find((c) => c.id === exerciseId)?.logStyle,
          cues: cues.length ? cues : undefined,
          progression: ex.hasProgression
            ? {
                targetReps: ex.targetReps ?? 12,
                holdSessions: ex.holdSessions ?? 2,
                incrementLb: ex.incrementLb ?? 5,
              }
            : undefined,
          plannedSets: normalizeClusterGroups(ex.sets.length ? ex.sets : [{ kind: 'working' }]),
        });
      }

      const draft: TemplateDraft = {
        name: this.name().trim(),
        notes: this.notes().trim() || undefined,
        restMiniSec: this.restMini(),
        restClusterSec: this.restCluster(),
        exercises,
      };

      const id = this.templateId();
      if (id) {
        await this.workout.updateTemplate(id, draft);
      } else {
        await this.workout.addTemplate(draft);
      }
      this.closed.emit();
    } catch (err) {
      if (err instanceof TemplateLimitError) {
        this.error.set(this.i18n.t('train.templateCap', { limit: err.limit }));
      } else {
        this.error.set(this.i18n.t('errors.unknown'));
      }
    } finally {
      this.saving.set(false);
    }
  }
}
