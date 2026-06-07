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
import { SubscriptionService } from '../../services/subscription.service';
import { TranslationService } from '../../services/translation.service';
import { bcp47ForLang } from '../../utils/locale';
import { localDateKey } from '../../utils/date';
import { UiSheet } from '../ui/sheet.component';
import { UiSparkline } from '../ui/sparkline.component';
import {
  WORKOUT_HISTORY_DAYS_FREE,
  type SessionExercise,
  type WorkoutSession,
} from '../../models/workout';
import {
  computeExercisePRs,
  estimateOneRepMax,
  isWorkingSet,
} from '../../utils/workout-progression';

interface SessionPoint {
  date: Date;
  topWeight: number;
  e1rm: number;
  sets: { weight?: number; reps?: number }[];
}

/**
 * Per-exercise progression detail. Pulls every completed session, keeps the
 * rows for one exercise, and renders an estimated-1RM trend (sparkline),
 * the PR line (max weight + best e1RM), and a per-session set table.
 * Free tier is capped to the last WORKOUT_HISTORY_DAYS_FREE days; Pro sees
 * all-time (mirrors CHART_HISTORY_DAYS_FREE on the calorie charts).
 */
@Component({
  selector: 'app-exercise-detail',
  standalone: true,
  imports: [LucideAngularModule, TranslocoDirective, UiSheet, UiSparkline],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <ng-container *transloco="let t">
    <ui-sheet [labelledBy]="'exercise-detail-title'" (close)="closed.emit()">
      <header class="mb-3">
        <h2 id="exercise-detail-title" class="v2-h2">{{ name() }}</h2>
        <p class="v2-caption mt-0.5">{{ t('train.exerciseHistory') }}</p>
      </header>

      @if (loading()) {
        <p class="v2-caption py-8 text-center">…</p>
      } @else if (points().length === 0) {
        <p class="v2-caption py-8 text-center">{{ t('train.noExerciseHistory') }}</p>
      } @else {
        <!-- PRs -->
        <div class="grid grid-cols-2 gap-3 mb-4">
          <div class="v2-card v2-card--flat px-3 py-2">
            <p class="v2-caption" style="font-size: 0.7rem;">{{ t('train.prMaxWeight') }}</p>
            <p class="v2-num" style="font-size: 1.5rem; font-weight: 600;">{{ prs().maxWeight }} <span class="v2-caption">lb</span></p>
          </div>
          <div class="v2-card v2-card--flat px-3 py-2">
            <p class="v2-caption" style="font-size: 0.7rem;">{{ t('train.prE1rm') }}</p>
            <p class="v2-num" style="font-size: 1.5rem; font-weight: 600;">{{ prs().bestE1RM }} <span class="v2-caption">lb</span></p>
          </div>
        </div>

        <!-- e1RM trend -->
        @if (points().length >= 2) {
          <div class="mb-1">
            <p class="v2-caption mb-1" style="font-size: 0.7rem;">{{ t('train.e1rmTrend') }}</p>
            <ui-sparkline [values]="trend()" tone="accent" [width]="560" [height]="56"
                          [ariaLabel]="t('train.e1rmTrend')" />
          </div>
        }

        @if (capped()) {
          <p class="v2-caption mt-2" style="color: var(--v2-ink-muted);">
            <lucide-icon name="sparkles" [size]="12" /> {{ t('train.historyCap', { days: freeDays }) }}
          </p>
        }

        <!-- Set history table -->
        <h3 class="v2-h3 mt-5 mb-2" style="font-weight: 600;">{{ t('train.setHistory') }}</h3>
        <div class="grid gap-2">
          @for (p of pointsDesc(); track p.date.getTime()) {
            <div class="py-2 border-b" style="border-color: var(--v2-rule);">
              <p class="v2-caption" style="color: var(--v2-ink-muted);">{{ formatDate(p.date) }}</p>
              <p class="v2-num" style="font-size: 0.9rem;">
                @for (s of p.sets; track $index) {
                  <span class="mr-2">{{ s.weight ?? '—' }}×{{ s.reps ?? '—' }}</span>
                }
              </p>
            </div>
          }
        </div>
      }
    </ui-sheet>
    </ng-container>
  `,
})
export class ExerciseDetailComponent {
  private readonly workout = inject(WorkoutStore);
  private readonly subs = inject(SubscriptionService);
  private readonly i18n = inject(TranslationService);

  readonly exerciseId = input.required<string>();
  readonly name = input<string>('');
  readonly closed = output<void>();

  protected readonly freeDays = WORKOUT_HISTORY_DAYS_FREE;
  protected readonly loading = signal(true);
  protected readonly points = signal<SessionPoint[]>([]);
  protected readonly capped = signal(false);

  protected readonly pointsDesc = computed(() => [...this.points()].reverse());
  protected readonly trend = computed(() => this.points().map((p) => p.e1rm));
  protected readonly prs = computed(() => {
    // Recompute over the (windowed) rows currently shown.
    const rows: SessionExercise[] = this.points().map((p) => ({
      exerciseId: this.exerciseId(),
      name: this.name(),
      cues: [],
      sets: p.sets.map((s) => ({ kind: 'working' as const, weight: s.weight, reps: s.reps })),
    }));
    return computeExercisePRs(rows);
  });

  constructor() {
    queueMicrotask(() => this.load());
  }

  private async load(): Promise<void> {
    const id = this.exerciseId();
    let sessions: WorkoutSession[] = [];
    try {
      sessions = await this.workout.getAllSessions();
    } catch {
      this.loading.set(false);
      return;
    }

    const paid = this.subs.isPaid();
    const cutoffKey = localDateKey(
      new Date(Date.now() - WORKOUT_HISTORY_DAYS_FREE * 24 * 60 * 60 * 1000),
    );
    let wasCapped = false;

    const pts: SessionPoint[] = [];
    for (const ses of sessions) {
      if (ses.status !== 'completed') continue;
      const ex = ses.exercises.find((e) => e.exerciseId === id);
      if (!ex) continue;
      if (!paid && localDateKey(ses.date) < cutoffKey) {
        wasCapped = true;
        continue;
      }
      const working = ex.sets.filter((s) => isWorkingSet(s) && s.weight != null);
      if (working.length === 0) continue;
      const topWeight = Math.max(...working.map((s) => s.weight ?? 0));
      const e1rm = Math.max(...working.map((s) => estimateOneRepMax(s.weight, s.reps)));
      pts.push({
        date: ses.date,
        topWeight,
        e1rm,
        sets: ex.sets.map((s) => ({ weight: s.weight, reps: s.reps })),
      });
    }

    // getAllSessions is newest-first; chart wants oldest-first.
    pts.reverse();
    this.points.set(pts);
    this.capped.set(wasCapped);
    this.loading.set(false);
  }

  protected formatDate(d: Date): string {
    return d.toLocaleDateString(bcp47ForLang(this.i18n.language()), {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  }
}
