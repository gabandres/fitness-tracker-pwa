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
import { marked } from 'marked';
import { FitnessStore } from '../../services/fitness-store.service';
import { BodyMetricStore } from '../../services/body-metric-store.service';
import { WeeklyReportStore } from '../../services/weekly-report-store.service';
import { SubscriptionService } from '../../services/subscription.service';
import { TranslationService } from '../../services/translation.service';
import { UpsellService } from '../../services/upsell.service';
import { ConsultationComponent } from '../consultation/consultation.component';
import { UiBarChart } from '../ui/bar-chart.component';
import { UiButton } from '../ui/button.component';
import { UiCard } from '../ui/card.component';
import { UiIconButton } from '../ui/icon-button.component';
import { UiFastingPill } from '../ui/fasting-pill.component';
import { summarizeDays } from '../../utils/day-summary';
import {
  computeWeeklyInsights,
  type WeightPoint,
} from '../../utils/weekly-insights';
import { computeWeeklyBudget, type WeeklyBudget } from '../../utils/weekly-budget';
import { addDays, localDateKey } from '../../utils/date';
import { bcp47ForLang } from '../../utils/locale';

/**
 * Trends route. Single-page scroll with: 7-day twin-bar chart,
 * weekly averages, weekly report (Pro), AI coach (consultation Q&A).
 *
 * Wraps the v1 <app-consultation> as-is for Week 4 — its visual chrome
 * gets the warm-minimal restyle in Week 6 (per the v2 plan).
 */
@Component({
  selector: 'app-trends',
  standalone: true,
  imports: [
    LucideAngularModule,
    TranslocoDirective,
    UiBarChart,
    UiButton,
    UiCard,
    UiIconButton,
    UiFastingPill,
    ConsultationComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <ng-container *transloco="let t">
    <section class="max-w-[640px] mx-auto">
      <!-- Header -->
      <header class="flex items-start justify-between gap-4 pt-2 pb-2">
        <div>
          <h1 class="page-title">{{ t('v2.trends.title') }}</h1>
          <p class="v2-caption mt-0.5">{{ t('v2.trends.subtitle') }}</p>
        </div>
        <div class="flex items-center gap-2 shrink-0">
          <ui-fasting-pill (bodyRequested)="bodyRequested.emit()" />
          <ui-icon-button
            icon="calendar"
            [ariaLabel]="t('v2.trends.historyAria')"
            (click)="historyRequested.emit()" />
          <ui-icon-button
            icon="settings"
            [ariaLabel]="t('v2.trends.settingsAria')"
            (click)="settingsRequested.emit()" />
        </div>
      </header>

      <!-- Bar chart -->
      <ui-card variant="default" class="mt-6 block">
        @if (hasAnyData()) {
          <ui-bar-chart
            [data]="chartData()"
            [kcalTarget]="kcalTarget()"
            [proteinTarget]="proteinTarget()" />
          <div class="flex items-center justify-between gap-2 mt-3">
            <div class="flex items-center gap-3 v2-caption">
              <span class="inline-flex items-center gap-1.5">
                <span class="inline-block w-2.5 h-2.5 rounded-sm" style="background: var(--v2-accent)"></span>
                {{ t('v2.trends.kcalLegend') }}
              </span>
              <span class="inline-flex items-center gap-1.5">
                <span class="inline-block w-2.5 h-2.5 rounded-sm" style="background: var(--v2-sage)"></span>
                {{ t('v2.trends.proteinLegend') }}
              </span>
            </div>
            <button
              type="button"
              class="v2-btn v2-btn--ghost v2-btn--sm"
              (click)="historyRequested.emit()">
              {{ t('v2.trends.viewMonth') }}
              <lucide-icon name="chevron-right" [size]="14" />
            </button>
          </div>
        } @else {
          <div class="text-center py-8">
            <p class="v2-body-soft">{{ t('v2.trends.noData') }}</p>
          </div>
        }
      </ui-card>

      <!-- Weekly panel: insights ⇄ budget toggle (rule-based, free, no AI) -->
      @if (historyLoaded()) {
        <ui-card variant="flat" class="mt-4 block">
          <div class="flex items-center gap-2 mb-4">
            <button
              type="button"
              class="v2-btn v2-btn--sm"
              [class.v2-btn--ghost]="panelView() !== 'insights'"
              [attr.aria-pressed]="panelView() === 'insights'"
              (click)="panelView.set('insights')">{{ t('trends.insightsTitle') }}</button>
            <button
              type="button"
              class="v2-btn v2-btn--sm"
              [class.v2-btn--ghost]="panelView() !== 'budget'"
              [attr.aria-pressed]="panelView() === 'budget'"
              (click)="panelView.set('budget')">{{ t('trends.budgetTitle') }}</button>
          </div>

          @if (panelView() === 'insights') {
            @if (insights(); as ins) {
              <dl class="grid grid-cols-2 gap-x-4 gap-y-3">
                <div>
                  <dt class="v2-caption">{{ t('trends.insightsBestDay') }}</dt>
                  <dd class="v2-num text-lg font-semibold">
                    {{ t('trends.insightsDayValue', { day: weekday(ins.bestDay.dateKey), delta: deltaLabel(ins.bestDay.delta) }) }}
                  </dd>
                </div>
                <div>
                  <dt class="v2-caption">{{ t('trends.insightsWorstDay') }}</dt>
                  <dd class="v2-num text-lg font-semibold">
                    {{ t('trends.insightsDayValue', { day: weekday(ins.worstDay.dateKey), delta: deltaLabel(ins.worstDay.delta) }) }}
                  </dd>
                </div>
                <div>
                  <dt class="v2-caption">{{ t('v2.trends.avgKcal') }}</dt>
                  <dd class="v2-num text-lg font-semibold">
                    {{ weekly()?.avgCalories ?? '—' }}
                    <span class="v2-caption" style="font-weight: 400;">· {{ deltaLabel(-ins.avgDeficit) }}</span>
                  </dd>
                </div>
                <div>
                  <dt class="v2-caption">{{ t('v2.trends.avgProtein') }}</dt>
                  <dd class="v2-num text-lg font-semibold">
                    {{ weekly()?.avgProtein != null ? weekly()!.avgProtein + 'g' : '—' }}
                  </dd>
                </div>
                <div>
                  <dt class="v2-caption">{{ t('v2.trends.adherence') }}</dt>
                  <dd class="v2-num text-lg font-semibold">{{ weekly()?.adherencePct ?? 0 }}%</dd>
                </div>
                <div>
                  <dt class="v2-caption">{{ t('trends.insightsWeightTrend') }}</dt>
                  <dd class="v2-num text-lg font-semibold">{{ slopeLabel(ins.weightSlopeLbPerWeek) }}</dd>
                </div>
              </dl>
            } @else {
              <p class="v2-body-soft">{{ t('trends.insightsNeedDays') }}</p>
            }
          } @else {
            @if (budget(); as b) {
              <p class="v2-caption mb-3">
                {{ t('trends.budgetSubtitle', { used: b.consumed.toLocaleString(), total: b.weeklyBudget.toLocaleString() }) }}
              </p>
              <!-- Mon→Sun bar strip; baseline = daily target -->
              <div class="flex items-end gap-1.5 h-20">
                @for (bar of b.bars; track bar.dateKey) {
                  <div class="flex-1 h-full flex items-end">
                    <div
                      class="w-full rounded-sm transition-all"
                      [style.height.%]="barHeight(bar.calories, b.dailyTarget)"
                      [style.background]="bar.elapsed ? 'var(--v2-accent)' : 'var(--v2-rule)'"
                      [style.opacity]="bar.calories > 0 ? 1 : 0.35"></div>
                  </div>
                }
              </div>
              <div class="flex mt-1.5">
                @for (bar of b.bars; track bar.dateKey) {
                  <span class="flex-1 text-center v2-caption">{{ weekdayNarrow(bar.dateKey) }}</span>
                }
              </div>
              <dl class="grid grid-cols-2 gap-x-4 gap-y-3 mt-4">
                <div>
                  <dt class="v2-caption">{{ t('trends.budgetRemaining') }}</dt>
                  <dd
                    class="v2-num text-lg font-semibold"
                    [style.color]="b.remaining < 0 ? 'var(--v2-danger)' : null">
                    {{ remainingLabel(b.remaining) }}
                  </dd>
                </div>
                <div>
                  <dt class="v2-caption">{{ t('trends.budgetPerDay') }}</dt>
                  <dd class="v2-num text-lg font-semibold">{{ paceLabel(b) }}</dd>
                </div>
              </dl>
            } @else {
              <p class="v2-body-soft">{{ t('trends.budgetNeedTarget') }}</p>
            }
          }
        </ui-card>
      }

      <!-- Coach panel: free Ask (quota'd) first, Pro weekly report below -->
      <ui-card variant="default" class="mt-4 block">
        <h2 class="card-title mb-3">{{ t('trends.coachAsk') }}</h2>
        <app-consultation />

        <div class="mt-6 pt-5" style="border-top: 1px solid var(--v2-rule);">
          <button type="button"
            class="flex items-center justify-between gap-3 w-full"
            style="background: none; border: none; padding: 0; cursor: pointer; min-height: var(--v2-tap-min);"
            [attr.aria-expanded]="reportExpanded()"
            aria-controls="weekly-report-panel"
            (click)="reportExpanded.set(!reportExpanded())">
            <h3 class="card-title inline-flex items-center gap-2">
              {{ t('trends.coachReport') }}
              @if (!subs.isPaid()) {
                <span class="v2-caption inline-flex items-center gap-1" style="color: var(--v2-accent); font-weight: 600;">
                  <lucide-icon name="sparkles" [size]="12" /> Pro
                </span>
              }
            </h3>
            <lucide-icon
              name="chevron-down"
              [size]="20"
              [style.transform]="reportExpanded() ? 'rotate(180deg)' : 'rotate(0deg)'"
              style="transition: transform 200ms var(--v2-ease); color: var(--v2-ink-muted)" />
          </button>

          @if (reportExpanded()) {
          <div id="weekly-report-panel" class="mt-3">
          @if (reportHtml(); as html) {
            <div class="v2-prose" [innerHTML]="html"></div>
            <p class="v2-caption mt-3">{{ reportAge() }}</p>
            <!-- Generation is strictly user-initiated (the old auto-refresh
                 on staleness burned a Gemini call per Pro user per week).
                 Offer the refresh once the cached report ages out. -->
            @if (subs.isPaid() && report.isReportStale() && !report.reportLoading()) {
              <div class="mt-3">
                <ui-button variant="ghost" size="sm" (click)="generate()">
                  <lucide-icon name="sparkles" [size]="14" />
                  {{ t('trends.regenerate') }}
                </ui-button>
              </div>
            } @else if (report.reportLoading()) {
              <p class="v2-body-soft mt-2">{{ t('v2.trends.generating') }}</p>
            }
          } @else if (report.reportLoading()) {
            <p class="v2-body-soft">{{ t('v2.trends.generating') }}</p>
          } @else if (report.reportError(); as err) {
            <p class="v2-body-soft" style="color: var(--v2-danger)">{{ err }}</p>
            @if (subs.isPaid()) {
              <ui-button variant="ghost" size="sm" (click)="generate()">{{ t('v2.trends.retry') }}</ui-button>
            }
          } @else if (!subs.isPaid()) {
            <p class="v2-body-soft">{{ t('v2.trends.upsellBody') }}</p>
            <div class="mt-3">
              <ui-button variant="primary" size="sm" (click)="openUpgrade()">
                <lucide-icon name="sparkles" [size]="14" />
                {{ t('v2.trends.upgrade') }}
              </ui-button>
            </div>
          } @else if (daysWithLogsThisWeek() < 3) {
            <p class="v2-body-soft">{{ t('v2.trends.needThreeDays') }}</p>
          } @else {
            <ui-button variant="primary" size="sm" (click)="generate()">
              <lucide-icon name="sparkles" [size]="14" />
              {{ t('v2.trends.generateThisWeek') }}
            </ui-button>
          }
          </div>
          }
        </div>
      </ui-card>
    </section>
    </ng-container>
  `,
  styles: [`
    :host ::ng-deep .v2-prose h1,
    :host ::ng-deep .v2-prose h2,
    :host ::ng-deep .v2-prose h3 {
      font-family: var(--v2-font-sans);
      font-weight: 600;
      color: var(--v2-ink);
      margin-top: 1em;
      margin-bottom: 0.5em;
    }
    :host ::ng-deep .v2-prose h2 { font-size: 1rem; }
    :host ::ng-deep .v2-prose h3 { font-size: 0.9rem; }
    :host ::ng-deep .v2-prose p {
      color: var(--v2-ink);
      margin-bottom: 0.75em;
      line-height: 1.55;
    }
    :host ::ng-deep .v2-prose ul {
      padding-left: 1.25em;
      margin-bottom: 0.75em;
    }
    :host ::ng-deep .v2-prose li { margin-bottom: 0.25em; }
    :host ::ng-deep .v2-prose strong { font-weight: 600; }
  `],
})
export class TrendsComponent {
  protected readonly store = inject(FitnessStore);
  private readonly body = inject(BodyMetricStore);
  protected readonly report = inject(WeeklyReportStore);
  protected readonly subs = inject(SubscriptionService);
  private readonly upsell = inject(UpsellService);
  private readonly translation = inject(TranslationService);

  readonly historyRequested = output<void>();
  readonly settingsRequested = output<void>();
  readonly bodyRequested = output<void>();

  protected readonly chartData = computed(() => this.store.last7Days());

  protected readonly hasAnyData = computed(() =>
    this.chartData().some((d) => d.kcal > 0 || d.protein > 0),
  );

  protected readonly kcalTarget = computed(() => this.store.targetCalories());
  protected readonly proteinTarget = computed(() => this.store.proteinTarget());
  protected readonly weekly = computed(() => this.store.weekly());

  /** Weekly panel view toggle: rule-based insights vs calorie banking. */
  protected readonly panelView = signal<'insights' | 'budget'>('insights');
  /** Weekly AI report is collapsed by default — it's long and Pro/on-demand,
   *  so it shouldn't dominate the tab until the user opens it. */
  protected readonly reportExpanded = signal(false);
  /** Days in the last 7 with at least one log. Used to gate the
   *  "Generate this week's readout" affordance — Pro users with under
   *  3 logged days get a hint instead of a button. v1 measured all-time
   *  log count which over-counted users who hadn't logged this week. */
  protected readonly daysWithLogsThisWeek = computed(
    () => this.chartData().filter((d) => d.kcal > 0).length,
  );

  // ── Weekly insights (rule-based) ────────────────────────────

  /** Window the insights judge: the last 7 calendar days for food, the
   *  last 28 for the weight slope (a 7-day fit is all noise). */
  private static readonly INSIGHT_DAYS = 7;
  private static readonly SLOPE_DAYS = 28;

  private lastNDateKeys(n: number): string[] {
    const today = new Date();
    return Array.from({ length: n }, (_, i) => localDateKey(addDays(today, i - (n - 1))));
  }

  /** Hide the card entirely until lifetime history hydrates (ADR-0004:
   *  never let "not loaded yet" read as "no data"). */
  protected readonly historyLoaded = computed(
    () => this.store.logsForLastDaysState(TrendsComponent.INSIGHT_DAYS).loaded,
  );

  private readonly weightPoints = computed<WeightPoint[]>(() => {
    const dw = this.body.dailyWeights();
    return this.lastNDateKeys(TrendsComponent.SLOPE_DAYS)
      .filter((k) => typeof dw[k] === 'number')
      .map((dateKey) => ({ dateKey, weightLb: dw[dateKey] }));
  });

  protected readonly insights = computed(() => {
    const win = this.store.logsForLastDaysState(TrendsComponent.INSIGHT_DAYS);
    if (!win.loaded) return null;
    const days = summarizeDays(this.lastNDateKeys(TrendsComponent.INSIGHT_DAYS), win.logs);
    return computeWeeklyInsights(days, this.kcalTarget(), this.weightPoints());
  });

  protected weekday(dateKey: string): string {
    const [y, m, d] = dateKey.split('-').map(Number);
    return new Date(y, m - 1, d).toLocaleDateString(
      bcp47ForLang(this.translation.language()),
      { weekday: 'short' },
    );
  }

  // ── Weekly calorie budget / banking ─────────────────────────

  /** ISO-local week (Monday-start): the seven Mon→Sun date keys and
   *  today's 1-based position. Monday is at most 6 days back, so the
   *  shared 7-day history window always covers the elapsed week. */
  private isoWeek(): { keys: string[]; daysElapsed: number } {
    const today = new Date();
    const daysSinceMonday = (today.getDay() + 6) % 7; // Sun=0 → 6, Mon=1 → 0
    const monday = addDays(today, -daysSinceMonday);
    const keys = Array.from({ length: 7 }, (_, i) => localDateKey(addDays(monday, i)));
    return { keys, daysElapsed: daysSinceMonday + 1 };
  }

  protected readonly budget = computed<WeeklyBudget | null>(() => {
    const win = this.store.logsForLastDaysState(TrendsComponent.INSIGHT_DAYS);
    if (!win.loaded) return null;
    const { keys, daysElapsed } = this.isoWeek();
    const days = summarizeDays(keys, win.logs);
    return computeWeeklyBudget(days, daysElapsed, this.kcalTarget());
  });

  protected weekdayNarrow(dateKey: string): string {
    const [y, m, d] = dateKey.split('-').map(Number);
    return new Date(y, m - 1, d).toLocaleDateString(
      bcp47ForLang(this.translation.language()),
      { weekday: 'narrow' },
    );
  }

  /** Bar height as a % of the strip; the daily target sits at ~70% so an
   *  over-target day still has headroom to render above it. Logged days
   *  never collapse below a 6% sliver. */
  protected barHeight(calories: number, dailyTarget: number): number {
    if (calories <= 0 || dailyTarget <= 0) return 0;
    return Math.max(6, Math.min(100, (calories / dailyTarget) * 70));
  }

  protected remainingLabel(remaining: number): string {
    const n = Math.round(remaining);
    const signed = n < 0 ? `−${Math.abs(n).toLocaleString()}` : n.toLocaleString();
    return this.translation.t('trends.budgetKcal', { n: signed });
  }

  protected paceLabel(b: WeeklyBudget): string {
    if (b.pacePerRemainingDay == null) return '—';
    if (b.pacePerRemainingDay < 0) return this.translation.t('trends.budgetOver');
    return this.translation.t('trends.budgetKcal', { n: b.pacePerRemainingDay.toLocaleString() });
  }

  protected deltaLabel(delta: number): string {
    const n = Math.round(delta);
    if (n === 0) return this.translation.t('trends.insightsOnTarget');
    const signed = n > 0 ? `+${n.toLocaleString()}` : `−${Math.abs(n).toLocaleString()}`;
    return this.translation.t('trends.insightsKcal', { n: signed });
  }

  protected slopeLabel(slope: number | null): string {
    if (slope == null) return '—';
    const signed = slope > 0 ? `+${slope.toFixed(1)}` : slope.toFixed(1);
    return this.translation.t('trends.insightsLbPerWeek', { n: signed });
  }

  // Plain HTML string bound via [innerHTML] so Angular's sanitizer scrubs it
  // (no bypassSecurityTrustHtml). The report markdown is server-generated, but
  // sanitizing on bind keeps a compromised/edited report field from injecting
  // executing HTML.
  protected readonly reportHtml = computed<string | null>(() => {
    const r = this.report.weeklyReport();
    if (!r) return null;
    return marked.parse(r.markdown, { gfm: true, breaks: true }) as string;
  });

  protected readonly reportAge = computed(() => {
    const r = this.report.weeklyReport();
    if (!r) return '';
    const days = Math.floor((Date.now() - r.generatedAt.getTime()) / (1000 * 60 * 60 * 24));
    if (days === 0) return this.translation.t('v2.trends.reportToday');
    if (days === 1) return this.translation.t('v2.trends.reportYesterday');
    return this.translation.t('v2.trends.reportNDaysAgo', { n: days });
  });

  protected generate(): void {
    void this.report.generateWeeklyReport();
  }

  protected openUpgrade(): void {
    this.upsell.openSubscribe('trends-v2-weekly-report');
  }
}
