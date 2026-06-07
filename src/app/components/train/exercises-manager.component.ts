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
import { TranslationService } from '../../services/translation.service';
import { UiSheet } from '../ui/sheet.component';
import { UiButton } from '../ui/button.component';
import { UiIconButton } from '../ui/icon-button.component';
import {
  DEFAULT_LOG_STYLE,
  type Exercise,
  type LogStyle,
  type MuscleGroup,
} from '../../models/workout';

const MUSCLES: MuscleGroup[] = [
  'chest', 'back', 'shoulders', 'biceps', 'triceps',
  'quads', 'hamstrings', 'glutes', 'calves', 'core', 'forearms',
];
const LOG_STYLES: LogStyle[] = ['weight-reps', 'bodyweight', 'time'];

/** Local editable shape for the add/edit form. */
interface EditState {
  id: string | null; // null = new
  name: string;
  muscles: MuscleGroup[];
  cuesText: string; // newline-separated
  logStyle: LogStyle;
}

/**
 * Catalog manager: list/search every per-user exercise, add/edit (name,
 * muscles, cues, logStyle), delete (blocked while a template still
 * references it), and merge two exercises into one (the survivor adopts
 * all the victim's history + template refs). Opened from the Train header.
 */
@Component({
  selector: 'app-exercises-manager',
  standalone: true,
  imports: [LucideAngularModule, TranslocoDirective, UiSheet, UiButton, UiIconButton],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <ng-container *transloco="let t">
    <ui-sheet [labelledBy]="'ex-mgr-title'" (close)="closed.emit()">
      @if (editing(); as ed) {
        <!-- ── Add / edit form ── -->
        <header class="mb-3">
          <h2 id="ex-mgr-title" class="v2-h2">{{ ed.id ? t('train.editExercise') : t('train.addExercise') }}</h2>
        </header>

        <label class="block mb-3">
          <span class="v2-field-label">{{ t('train.exerciseName') }}</span>
          <input class="v2-input" style="width: 100%;" [value]="ed.name" (input)="setName(asValue($event))" />
        </label>

        <p class="v2-field-label">{{ t('train.muscles') }}</p>
        <div class="flex flex-wrap gap-1.5 mb-3">
          @for (m of muscles; track m) {
            <button type="button" class="v2-btn v2-btn--sm"
                    [attr.aria-pressed]="ed.muscles.includes(m)"
                    [class.v2-btn--primary]="ed.muscles.includes(m)"
                    [class.v2-btn--ghost]="!ed.muscles.includes(m)"
                    (click)="toggleMuscle(m)">{{ m }}</button>
          }
        </div>

        <p class="v2-field-label">{{ t('train.logStyleLabel') }}</p>
        <div class="flex flex-wrap gap-1.5 mb-3">
          @for (s of logStyles; track s) {
            <button type="button" class="v2-btn v2-btn--sm"
                    [attr.aria-pressed]="ed.logStyle === s"
                    [class.v2-btn--primary]="ed.logStyle === s"
                    [class.v2-btn--ghost]="ed.logStyle !== s"
                    (click)="setLogStyle(s)">{{ t('train.logStyle.' + s) }}</button>
          }
        </div>

        <label class="block mb-4">
          <span class="v2-field-label">{{ t('train.cues') }}</span>
          <textarea class="v2-input" rows="3" style="width: 100%; resize: vertical;"
                    [value]="ed.cuesText" (input)="setCues(asValue($event))"></textarea>
        </label>

        <div class="flex gap-3">
          <ui-button variant="ghost" (click)="editing.set(null)">{{ t('train.cancel') }}</ui-button>
          <ui-button variant="primary" [block]="true" [disabled]="!ed.name.trim() || busy()" (click)="save()">
            {{ busy() ? t('train.saving') : t('train.save') }}
          </ui-button>
        </div>
      } @else if (merging(); as mv) {
        <!-- ── Merge: pick the survivor ── -->
        <header class="mb-2">
          <h2 id="ex-mgr-title" class="v2-h2">{{ t('train.mergeInto', { name: mv.name }) }}</h2>
          <p class="v2-caption mt-1">{{ t('train.mergeHint') }}</p>
        </header>
        <div class="grid gap-1">
          @for (c of others(mv); track c.id) {
            <button type="button" class="flex items-center justify-between gap-3 py-2 border-b text-left"
                    style="border-color: var(--v2-rule);" [disabled]="busy()" (click)="doMerge(mv, c)">
              <span style="font-weight: 600;">{{ c.name }}</span>
              <lucide-icon name="arrow-right" [size]="16" />
            </button>
          }
        </div>
        <div class="mt-4">
          <ui-button variant="ghost" (click)="merging.set(null)">{{ t('train.cancel') }}</ui-button>
        </div>
      } @else {
        <!-- ── List ── -->
        <header class="mb-3 flex items-center justify-between gap-3">
          <h2 id="ex-mgr-title" class="v2-h2">{{ t('train.manageExercises') }}</h2>
          <ui-button variant="secondary" size="sm" (click)="startAdd()">
            <lucide-icon name="plus" [size]="14" /> {{ t('train.addExercise') }}
          </ui-button>
        </header>

        <input class="v2-input mb-3" style="width: 100%;" [value]="query()"
               [attr.placeholder]="t('train.searchExercises')" (input)="query.set(asValue($event))" />

        @if (filtered().length === 0) {
          <p class="v2-caption py-6 text-center">{{ t('train.noExercisesFound') }}</p>
        } @else {
          <div class="grid gap-1">
            @for (ex of filtered(); track ex.id) {
              <div class="flex items-center justify-between gap-2 py-2 border-b" style="border-color: var(--v2-rule);">
                <div class="min-w-0">
                  <p style="font-weight: 600;" class="truncate">{{ ex.name }}</p>
                  <p class="v2-caption truncate">
                    {{ t('train.logStyle.' + (ex.logStyle ?? defaultStyle)) }}@if (ex.muscles.length) { · {{ ex.muscles.join(', ') }} }
                  </p>
                </div>
                <div class="flex items-center gap-1 shrink-0">
                  <ui-icon-button icon="pencil" [ariaLabel]="t('train.editExercise')" (click)="startEdit(ex)" />
                  <ui-icon-button icon="git-merge" [ariaLabel]="t('train.mergeExercise')" (click)="startMerge(ex)" />
                  @if (inTemplate(ex)) {
                    <ui-icon-button icon="trash-2" [ariaLabel]="t('train.deleteExerciseInUse')" [disabled]="true" />
                  } @else {
                    <ui-icon-button icon="trash-2" [ariaLabel]="t('train.deleteExercise')" (click)="remove(ex)" />
                  }
                </div>
              </div>
            }
          </div>
        }
      }
    </ui-sheet>
    </ng-container>
  `,
})
export class ExercisesManagerComponent {
  private readonly workout = inject(WorkoutStore);
  private readonly i18n = inject(TranslationService);

  readonly closed = output<void>();

  protected readonly muscles = MUSCLES;
  protected readonly logStyles = LOG_STYLES;
  protected readonly defaultStyle = DEFAULT_LOG_STYLE;

  protected readonly query = signal('');
  protected readonly editing = signal<EditState | null>(null);
  protected readonly merging = signal<Exercise | null>(null);
  protected readonly busy = signal(false);

  /** Exercise ids referenced by any template — these can't be deleted. */
  private readonly referencedIds = computed(
    () => new Set(this.workout.templates().flatMap((tpl) => tpl.exercises.map((e) => e.exerciseId))),
  );

  protected readonly filtered = computed(() => {
    const q = this.query().trim().toLowerCase();
    const list = this.workout.exercises();
    return q ? list.filter((e) => e.name.toLowerCase().includes(q)) : list;
  });

  protected asValue(e: Event): string {
    return (e.target as HTMLInputElement | HTMLTextAreaElement).value;
  }

  protected inTemplate(ex: Exercise): boolean {
    return !!ex.id && this.referencedIds().has(ex.id);
  }

  protected others(victim: Exercise): Exercise[] {
    return this.workout.exercises().filter((e) => e.id !== victim.id);
  }

  // ── Form ──────────────────────────────────────────────────────
  protected startAdd(): void {
    this.editing.set({ id: null, name: '', muscles: [], cuesText: '', logStyle: DEFAULT_LOG_STYLE });
  }

  protected startEdit(ex: Exercise): void {
    this.editing.set({
      id: ex.id ?? null,
      name: ex.name,
      muscles: [...ex.muscles],
      cuesText: (ex.defaultCues ?? []).join('\n'),
      logStyle: ex.logStyle ?? DEFAULT_LOG_STYLE,
    });
  }

  private patch(p: Partial<EditState>): void {
    this.editing.update((ed) => (ed ? { ...ed, ...p } : ed));
  }
  protected setName(v: string): void { this.patch({ name: v }); }
  protected setCues(v: string): void { this.patch({ cuesText: v }); }
  protected setLogStyle(s: LogStyle): void { this.patch({ logStyle: s }); }
  protected toggleMuscle(m: MuscleGroup): void {
    this.editing.update((ed) => {
      if (!ed) return ed;
      const has = ed.muscles.includes(m);
      return { ...ed, muscles: has ? ed.muscles.filter((x) => x !== m) : [...ed.muscles, m] };
    });
  }

  protected async save(): Promise<void> {
    const ed = this.editing();
    if (!ed || !ed.name.trim() || this.busy()) return;
    this.busy.set(true);
    try {
      const draft = {
        name: ed.name.trim(),
        muscles: ed.muscles,
        defaultCues: ed.cuesText.split('\n').map((c) => c.trim()).filter(Boolean),
        logStyle: ed.logStyle,
      };
      if (ed.id) await this.workout.updateExercise(ed.id, draft);
      else await this.workout.addExercise(draft);
      this.editing.set(null);
    } finally {
      this.busy.set(false);
    }
  }

  // ── Delete / merge ────────────────────────────────────────────
  protected async remove(ex: Exercise): Promise<void> {
    if (!ex.id || this.inTemplate(ex)) return;
    if (!confirm(this.i18n.t('train.deleteExerciseConfirm', { name: ex.name }))) return;
    await this.workout.deleteExercise(ex.id);
  }

  protected startMerge(ex: Exercise): void {
    this.merging.set(ex);
  }

  protected async doMerge(victim: Exercise, survivor: Exercise): Promise<void> {
    if (!victim.id || !survivor.id || this.busy()) return;
    if (!confirm(this.i18n.t('train.mergeConfirm', { from: victim.name, to: survivor.name }))) return;
    this.busy.set(true);
    try {
      await this.workout.mergeExercises(victim.id, survivor.id);
      this.merging.set(null);
    } finally {
      this.busy.set(false);
    }
  }
}
