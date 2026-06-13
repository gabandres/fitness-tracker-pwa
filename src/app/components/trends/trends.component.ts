import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  output,
} from '@angular/core';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';
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
    <section class="max-w-[640px] mx-auto px-5 sm:px-6 pb-32 md:pb-28">
      <!-- Header -->
      <header class="flex items-start justify-between gap-4 pt-6 pb-2">
        <div>
          <h1 class="v2-h1">{{ t('v2.trends.title') }}</h1>
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

      <!-- Averages -->
      <ui-card variant="flat" class="mt-4 block">
        <h2 class="v2-h3 mb-3">{{ t('v2.trends.thisWeek') }}</h2>
        @if (weekly(); as w) {
          <dl class="grid grid-cols-2 gap-x-4 gap-y-3">
            <div>
              <dt class="v2-caption">{{ t('v2.trends.avgKcal') }}</dt>
              <dd class="v2-num text-lg font-semibold">{{ w.avgCalories }}</dd>
            </div>
            <div>
              <dt class="v2-caption">{{ t('v2.trends.avgProtein') }}</dt>
              <dd class="v2-num text-lg font-semibold">
                {{ w.avgProtein != null ? w.avgProtein + 'g' : '—' }}
              </dd>
            </div>
            <div>
              <dt class="v2-caption">{{ t('v2.trends.weightDelta') }}</dt>
              <dd class="v2-num text-lg font-semibold">{{ weightDeltaLabel() }}</dd>
            </div>
            <div>
              <dt class="v2-caption">{{ t('v2.trends.adherence') }}</dt>
              <dd class="v2-num text-lg font-semibold">{{ w.adherencePct }}%</dd>
            </div>
          </dl>
        } @else {
          <p class="v2-body-soft">{{ t('v2.trends.needSeven') }}</p>
        }
      </ui-card>

      <!-- Weekly insights (rule-based, free — no AI involved) -->
      @if (historyLoaded()) {
        <ui-card variant="flat" class="mt-4 block">
          <h2 class="v2-h3 mb-3">{{ t('trends.insightsTitle') }}</h2>
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
                <dt class="v2-caption">{{ t('trends.insightsAvgVsTarget') }}</dt>
                <dd class="v2-num text-lg font-semibold">{{ deltaLabel(-ins.avgDeficit) }}</dd>
              </div>
              <div>
                <dt class="v2-caption">{{ t('trends.insightsWeightTrend') }}</dt>
                <dd class="v2-num text-lg font-semibold">{{ slopeLabel(ins.weightSlopeLbPerWeek) }}</dd>
              </div>
            </dl>
          } @else {
            <p class="v2-body-soft">{{ t('trends.insightsNeedDays') }}</p>
          }
        </ui-card>
      }

      <!-- Weekly report (Pro) -->
      <ui-card variant="default" class="mt-4 block">
        <h2 class="v2-h3 mb-3">{{ t('v2.trends.weeklyReadout') }}</h2>
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
      </ui-card>

      <!-- AI coach (v1 consultation, restyled in Week 6) -->
      <ui-card variant="default" class="mt-4 block">
        <h2 class="v2-h3 mb-3">{{ t('v2.trends.aiCoach') }}</h2>
        <app-consultation />
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
  private readonly sanitizer = inject(DomSanitizer);
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

  protected readonly weightDeltaLabel = computed(() => {
    const w = this.weekly();
    if (!w || !w.weightDelta) return '—';
    const sign = w.weightDelta > 0 ? '+' : '';
    return `${sign}${w.weightDelta.toFixed(1)} lb`;
  });

  protected readonly reportHtml = computed<SafeHtml | null>(() => {
    const r = this.report.weeklyReport();
    if (!r) return null;
    const html = marked.parse(r.markdown, { gfm: true, breaks: true }) as string;
    return this.sanitizer.bypassSecurityTrustHtml(html);
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
