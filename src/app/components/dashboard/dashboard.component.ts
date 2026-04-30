import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';
import { marked } from 'marked';
import { TranslocoDirective } from '@jsverse/transloco';
import { FitnessStore } from '../../services/fitness-store.service';
import { TdeeCalculatorService } from '../../services/tdee-calculator.service';
import { TranslationService } from '../../services/translation.service';
import { SubscriptionService } from '../../services/subscription.service';
import { localDateKey } from '../../utils/date';
import { bcp47ForLang } from '../../utils/locale';
import { UpsellCardComponent } from '../upsell-card/upsell-card.component';
import { AnalyticsService } from '../../services/analytics.service';
import { EntryFormManager } from '../../services/entry-form-manager.service';

/** Free-tier CSV export is capped to this many days of history (matches
    the freemium table in the UX plan). Pro subscribers get all history. */
const CSV_EXPORT_DAYS_FREE = 30;

interface SparklinePoint { x: number; y: number; }

@Component({
  selector: 'app-dashboard',
  standalone: true,
  imports: [TranslocoDirective, UpsellCardComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <ng-container *transloco="let t">
    <section>
      <h2 class="rule"><span>{{ t('dashboard.heading') }}</span></h2>

      @if (isHydrating()) {
        <!-- Skeleton readouts during cold-load so the 3-up grid doesn't
             flash empty. Same rhythm/dimensions as the real readouts to
             avoid layout shift when data arrives. -->
        <div class="mt-4 grid grid-cols-3 gap-2" [attr.aria-busy]="true" [attr.aria-label]="t('dashboard.loading')">
          @for (_ of skeletonCols; track $index) {
            <div>
              <span class="skeleton-line h-3 block" style="width: 60%"></span>
              <span class="skeleton-line h-6 block mt-2" style="width: 80%"></span>
              <span class="skeleton-line h-2 block mt-2" style="width: 40%"></span>
            </div>
          }
        </div>
      } @else if (store.logs().length === 0) {
        <!-- First-session hero — replaces the austere "no data, refresh?"
             empty state with a warm greeting + the number that matters
             most for the first interaction. Every new user sees this on
             Day 1, so it has to do two jobs: make the app feel alive
             (not a blank slate), and make the first call-to-action
             obvious (log something). -->
        <div class="mt-4 specimen px-5 py-6 text-center">
          <span class="crop-bl"></span><span class="crop-br"></span>
          <span class="stamp-mark" style="transform: rotate(0deg)">{{ t('dashboard.heroStamp') }}</span>
          <h3 class="font-display text-2xl sm:text-3xl leading-[0.95] text-ink mt-3">
            {{ t('dashboard.heroGreeting.' + greeting()) }}<br/>
            <em class="text-blood">
              {{ t('dashboard.heroBody', { target: store.targetCalories() }) }}
            </em>
          </h3>
          <p class="caption text-[11px] mt-3 leading-relaxed">
            {{ t('dashboard.heroSubtitle') }}
          </p>
          <div class="mt-5 flex items-center justify-center gap-2 flex-wrap">
            <button type="button" (click)="startLog()" class="stamp-btn">
              {{ t('dashboard.heroCta') }}
            </button>
            <!-- REFRESH was demoted off the day-1 empty state. With zero
                 logs there is nothing to re-fetch, so standing a noisy
                 secondary action next to the primary CTA only dilutes
                 "log your first meal". The button is still available
                 inside the long-tail dashboard for stale-data recovery
                 once the user actually has entries. -->
          </div>
        </div>
      } @else {
        <!-- Target / TDEE / Weight (tap a ? to learn what each means) -->
        <div class="mt-4 grid grid-cols-3 gap-2">
          <div class="min-w-0" [attr.title]="t('dashboard.targetHelpTitle')">
            <div class="data-label mb-1 flex items-center gap-1">
              <span>{{ t('dashboard.target') }}</span>
              <button type="button" (click)="toggleHelp('target')"
                [attr.aria-label]="t('dashboard.targetAria')"
                class="readout-help">?</button>
            </div>
            <div class="readout-mono truncate">{{ store.tdee().newDailyTarget }}</div>
            <div class="data-label mt-0.5 opacity-60">{{ t('dashboard.kcalPerDay') }}</div>
          </div>
          <div class="min-w-0" [attr.title]="t('dashboard.tdeeHelpTitle')">
            <div class="data-label mb-1 flex items-center gap-1">
              <span>{{ t('dashboard.tdee') }}</span>
              <button type="button" (click)="toggleHelp('tdee')"
                [attr.aria-label]="t('dashboard.tdeeAria')"
                [class.coachmark-pulse]="showTdeeCoachmark()"
                class="readout-help">?</button>
            </div>
            <div class="readout-mono truncate">{{ store.tdee().trueTdee }}</div>
            <div class="data-label mt-0.5 opacity-60">{{ t('dashboard.kcalPerDay') }}</div>
          </div>
          <div class="min-w-0" [attr.title]="t('dashboard.weightHelpTitle')">
            <div class="data-label mb-1 flex items-center gap-1">
              <span>{{ t('dashboard.weight') }}</span>
              <button type="button" (click)="toggleHelp('weight')"
                [attr.aria-label]="t('dashboard.weightAria')"
                class="readout-help">?</button>
            </div>
            <div class="readout-mono truncate">{{ store.currentWeight() ?? '—' }}</div>
            <div class="data-label mt-0.5 opacity-60">{{ t('dashboard.lbs') }}</div>
          </div>
        </div>
        @if (helpOpen(); as which) {
          <p class="caption text-xs mt-2 italic text-graphite leading-relaxed slide-down">
            {{ helpText(which) }}
          </p>
        } @else if (showTdeeCoachmark()) {
          <p class="caption text-xs mt-2 italic text-graphite leading-relaxed" role="note">
            {{ t('dashboard.tdeeCoachmark') }}
          </p>
        }

        <!-- Source attribution — always visible so users know whether
             their TDEE comes from the formula or their measured data.
             Pre-Slice C this hid after day 14, removing the cue that
             explains why the TDEE moves over time. -->
        <div class="mt-3 flex items-center gap-2">
          <span class="stamp-mark">{{ store.tdee().source }}</span>
          <p class="caption text-xs">
            @if (store.logs().length < 14) {
              {{ (14 - store.logs().length) === 1
                   ? t('dashboard.daysToMeasuredOne', { n: 14 - store.logs().length })
                   : t('dashboard.daysToMeasuredMany', { n: 14 - store.logs().length }) }}
            } @else {
              {{ t('dashboard.tdeeAdaptiveCaption') }}
            }
          </p>
        </div>

        <!-- Adaptive TDEE notification: shown once when measured mode kicks in -->
        @if (store.tdeeTransition(); as tx) {
          <div class="mt-4 specimen px-4 py-3" style="border-color: var(--color-olive)">
            <div class="flex items-center justify-between mb-2">
              <div class="flex items-center gap-2">
                <span class="stamp-mark" style="transform: rotate(0deg); border-color: var(--color-olive); color: var(--color-olive)">{{ t('dashboard.tdeeTransitionStamp') }}</span>
                <span class="data-label">{{ t('dashboard.tdeeTransitionLabel') }}</span>
              </div>
              <button type="button" (click)="dismissTdeeTransition()" class="tag-btn text-[11px]">{{ t('dashboard.dismiss') }}</button>
            </div>
            <p class="font-sans text-sm text-ink leading-relaxed">
              {{ t('dashboard.tdeeTransitionBodyPrefix') }} <span class="font-mono font-semibold">{{ tx.measuredTdee }}</span> {{ t('dashboard.kcalPerDay') }} —
              <span class="font-mono font-semibold"
                [style.color]="tx.diffPct < 0 ? 'var(--color-blood)' : 'var(--color-olive)'">
                {{ tx.diffPct > 0 ? '+' : '' }}{{ tx.diffPct }}%
              </span>
              {{ t('dashboard.tdeeTransitionBodyVsFormula') }} {{ tx.formulaTdee }}{{ t('dashboard.tdeeTransitionBodyUpdated') }}
            </p>
          </div>
        }

        <!-- Goal progress bar -->
        @if (store.goalProgress(); as gp) {
          <div class="mt-5">
            <div class="flex items-center justify-between mb-1">
              <span class="data-label">{{ t('dashboard.goalProgress') }}</span>
              <span class="font-sans text-xs tabular-nums text-graphite">
                {{ t('dashboard.goalTrack', { cur: gp.currentWeight, goal: gp.goalWeight }) }}
              </span>
            </div>
            <div class="h-2 w-full bg-paper-deep relative overflow-hidden border border-rule/30">
              <div class="h-full transition-all duration-500"
                [style.width.%]="gp.pct"
                [style.background]="'var(--color-olive)'">
              </div>
            </div>
            <div class="flex items-center justify-between mt-1">
              <span class="font-sans text-[11px] tabular-nums text-graphite">{{ t('dashboard.goalStart', { start: gp.startWeight }) }}</span>
              <span class="font-sans text-[11px] tabular-nums" style="color: var(--color-olive)">
                {{ t('dashboard.goalRemaining', { pct: gp.pct, remaining: gp.remaining }) }}
              </span>
            </div>
          </div>
        }

        <!-- Weekly summary -->
        @if (store.weekly(); as w) {
          <div class="mt-5 specimen px-4 py-3">
            <span class="crop-bl"></span><span class="crop-br"></span>
            <div class="flex items-center gap-2 mb-2">
              <span class="stamp-mark" style="transform: rotate(0deg)">{{ t('dashboard.weeklyDays', { days: w.days }) }}</span>
              <h3 class="data-label m-0 font-normal">{{ t('dashboard.weeklySummary') }}</h3>
            </div>
            <div class="grid grid-cols-4 gap-2 text-center">
              <div>
                <div class="font-mono text-sm font-medium text-ink tabular-nums">{{ w.avgWeight }}</div>
                <div class="data-label mt-0.5 opacity-60 text-[11px]">{{ t('dashboard.avgLb') }}</div>
              </div>
              <div>
                <div class="font-mono text-sm font-medium text-ink tabular-nums">{{ w.avgCalories }}</div>
                <div class="data-label mt-0.5 opacity-60 text-[11px]">{{ t('dashboard.avgCal') }}</div>
              </div>
              <div>
                <div class="font-mono text-sm font-medium tabular-nums"
                  [style.color]="w.weightDelta <= 0 ? 'var(--color-olive)' : 'var(--color-blood)'">
                  {{ w.weightDelta > 0 ? '+' : '' }}{{ w.weightDelta }}
                </div>
                <div class="data-label mt-0.5 opacity-60 text-[11px]">{{ t('dashboard.deltaLbs') }}</div>
              </div>
              <div>
                <div class="font-mono text-sm font-medium text-ink tabular-nums">{{ w.adherencePct }}%</div>
                <div class="data-label mt-0.5 opacity-60 text-[11px]">{{ t('dashboard.onTarget') }}</div>
              </div>
            </div>
            @if (w.avgProtein != null) {
              <div class="mt-2 pt-2 border-t border-rule/30 text-center">
                <span class="font-mono text-xs tabular-nums" style="color: var(--color-protein)">
                  {{ w.avgProtein }}g
                </span>
                <span class="data-label ml-1 text-[11px]">{{ t('dashboard.avgProteinPerDay') }}</span>
              </div>
            }
          </div>
        }

        <!-- Weekly Calorie Envelope — one-sentence summary + budget bar -->
        @if (store.envelope(); as env) {
          <div class="mt-5 specimen px-4 py-3">
            <span class="crop-bl"></span><span class="crop-br"></span>
            <div class="flex items-center gap-2 mb-2">
              <span class="stamp-mark" style="transform: rotate(0deg)">{{ t('dashboard.envelopeStamp') }}</span>
              <h3 class="data-label m-0 font-normal">{{ t('dashboard.envelopeLabel') }}</h3>
            </div>
            <p class="font-display text-ink text-[17px] leading-snug">
              @if (env.surplus > 0) {
                {{ t('dashboard.envelopeOverPrefix') }} <span class="font-mono font-semibold not-italic" style="color: var(--color-blood)">{{ env.surplus.toLocaleString() }}</span> {{ t('dashboard.envelopeOverSuffix') }}
              } @else if (env.surplus < 0) {
                {{ t('dashboard.envelopeUnderPrefix') }} <span class="font-mono font-semibold not-italic" style="color: var(--color-olive)">{{ Math.abs(env.surplus).toLocaleString() }}</span> {{ t('dashboard.envelopeUnderSuffix') }}
              } @else {
                {{ t('dashboard.envelopeOnBudget') }}
              }
              @if (env.daysRemaining > 0) {
                @if (env.daysRemaining === 1) {
                  {{ t('dashboard.envelopeAimLastDay', { amt: env.adjustedDailyTarget.toLocaleString() }) }}
                } @else {
                  {{ t('dashboard.envelopeAimNextDays', { amt: env.adjustedDailyTarget.toLocaleString(), n: env.daysRemaining }) }}
                }
              } @else {
                {{ t('dashboard.envelopeComplete') }}
              }
            </p>
            <!-- Budget bar: at-a-glance trend -->
            <div class="mt-3 h-1.5 w-full bg-paper-deep relative overflow-hidden border border-rule/30">
              <div class="h-full transition-all duration-300"
                [style.width.%]="Math.min(100, (env.consumed / env.weeklyBudget) * 100)"
                [style.background]="env.consumed > env.weeklyBudget ? 'var(--color-blood)' : 'var(--color-olive)'">
              </div>
            </div>
            <div class="flex justify-between mt-1 font-sans text-[11px] tabular-nums text-graphite">
              <span>{{ t('dashboard.envelopeConsumed', { amt: env.consumed.toLocaleString() }) }}</span>
              <span>{{ t('dashboard.envelopeBudget', { amt: env.weeklyBudget.toLocaleString() }) }}</span>
            </div>
          </div>
        }

        <!-- Weekly AI Report -->
        @if (store.weeklyReport(); as report) {
          <div class="mt-5 specimen px-4 py-3">
            <span class="crop-bl"></span><span class="crop-br"></span>
            <div class="flex items-center justify-between mb-2">
              <div class="flex items-center gap-2">
                <span class="stamp-mark" style="transform: rotate(0deg)">{{ t('dashboard.reportStamp') }}</span>
                <span class="data-label">{{ t('dashboard.reportLabel') }}</span>
              </div>
              <span class="font-sans text-[11px] text-graphite">{{ reportAge() }}</span>
            </div>
            <div class="prose-field font-display text-ink text-[14px] leading-relaxed"
              [innerHTML]="reportHtml()"></div>
            @if (store.reportError(); as err) {
              <p role="alert" class="mt-2 font-sans text-[11px] text-blood">✕ {{ err }}</p>
            }
            <div class="mt-2 pt-2 border-t border-rule/30 flex justify-end">
              <button type="button" (click)="store.generateWeeklyReport()"
                [disabled]="store.reportLoading()"
                class="tag-btn text-[9px]">
                {{ store.reportLoading() ? t('dashboard.reportGenerating') : t('dashboard.reportRegenerate') }}
              </button>
            </div>
          </div>
        } @else if (store.reportLoading()) {
          <div class="mt-5 specimen px-4 py-3 text-center">
            <span class="crop-bl"></span><span class="crop-br"></span>
            <span class="stamp-mark">{{ t('dashboard.reportGeneratingStamp') }}</span>
            <p class="caption text-[11px] mt-2">{{ t('dashboard.reportCompiling') }}</p>
          </div>
        }

        <!-- Long-term summary -->
        @if (store.monthlySummary(); as m) {
          <div class="mt-5 specimen px-4 py-3">
            <div class="flex items-center gap-2 mb-3">
              <span class="stamp-mark" style="transform: rotate(0deg)">{{ t('dashboard.monthlyWeeks', { n: m.weeksTracked }) }}</span>
              <span class="data-label">{{ t('dashboard.monthlyAllTime') }}</span>
            </div>
            <div class="grid grid-cols-3 gap-3 text-center">
              <div>
                <div class="font-mono text-lg font-semibold tabular-nums"
                  [style.color]="m.totalChange <= 0 ? 'var(--color-olive)' : 'var(--color-blood)'">
                  {{ m.totalChange > 0 ? '+' : '' }}{{ m.totalChange }}
                </div>
                <div class="data-label mt-0.5 opacity-60 text-[11px]">{{ t('dashboard.monthlyLbsTotal') }}</div>
              </div>
              <div>
                <div class="font-mono text-lg font-semibold tabular-nums"
                  [style.color]="m.avgWeeklyChange <= 0 ? 'var(--color-olive)' : 'var(--color-blood)'">
                  {{ m.avgWeeklyChange > 0 ? '+' : '' }}{{ m.avgWeeklyChange }}
                </div>
                <div class="data-label mt-0.5 opacity-60 text-[11px]">{{ t('dashboard.monthlyLbsPerWeek') }}</div>
              </div>
              <div>
                <div class="font-mono text-lg font-semibold tabular-nums text-ink">{{ m.adherencePct }}%</div>
                <div class="data-label mt-0.5 opacity-60 text-[11px]">{{ t('dashboard.monthlyAdherence') }}</div>
              </div>
            </div>
            <div class="mt-3 pt-2 border-t border-rule/30 flex items-center justify-between">
              <span class="font-sans text-xs text-graphite">
                {{ t('dashboard.monthlyTrack', { first: m.firstWeight, last: m.lastWeight, days: m.daysTracked }) }}
              </span>
              <span class="font-sans text-xs text-graphite">
                {{ t('dashboard.monthlyAvgKcal', { n: m.avgCalories }) }}
              </span>
            </div>
          </div>
        }

        <!-- Weight chart with range toggle. The 14-day and all-time
             charts read the same data from different windows; merging
             them into a single chart with a segmented selector saves
             vertical space and avoids the user comparing two near-
             duplicate panels. The toggle only appears when both
             windows have enough data to plot. -->
        @if (sparklineRaw().length > 1 || allTimeRawPoints().length > 2) {
          <div class="mt-6">
            <div class="flex items-center justify-between mb-2 gap-2">
              <div class="flex items-center gap-2 min-w-0 flex-wrap">
                <span class="data-label">
                  {{ chartRange() === '14d' ? t('dashboard.trend14') : t('dashboard.trendAllTime') }}
                </span>
                @if (sparklineRaw().length > 1 && allTimeRawPoints().length > 2) {
                  <div class="inline-flex rounded border border-rule overflow-hidden text-[11px]"
                    role="radiogroup" [attr.aria-label]="t('dashboard.chartRangeAria')">
                    <button type="button" role="radio"
                      [attr.aria-checked]="chartRange() === '14d'"
                      (click)="chartRange.set('14d')"
                      [class.bg-ink]="chartRange() === '14d'"
                      [class.text-cream]="chartRange() === '14d'"
                      [class.text-graphite]="chartRange() !== '14d'"
                      class="px-2 py-0.5 font-sans transition-colors">
                      {{ t('dashboard.range14') }}
                    </button>
                    <button type="button" role="radio"
                      [attr.aria-checked]="chartRange() === 'all'"
                      (click)="chartRange.set('all')"
                      [class.bg-ink]="chartRange() === 'all'"
                      [class.text-cream]="chartRange() === 'all'"
                      [class.text-graphite]="chartRange() !== 'all'"
                      class="px-2 py-0.5 font-sans transition-colors border-l border-rule">
                      {{ t('dashboard.rangeAll') }}
                    </button>
                  </div>
                }
              </div>
              @if (chartRange() === '14d') {
                <span class="font-mono text-sm tabular-nums"
                  [style.color]="store.tdee().weightChangeTrend > 0 ? 'var(--color-blood)' : store.tdee().weightChangeTrend < 0 ? 'var(--color-ink)' : 'var(--color-graphite)'">
                  {{ store.trendLabel() }}
                </span>
              } @else if (store.monthlySummary(); as m) {
                <span class="font-mono text-sm tabular-nums"
                  [style.color]="m.totalChange < 0 ? 'var(--color-ink)' : m.totalChange > 0 ? 'var(--color-blood)' : 'var(--color-graphite)'">
                  {{ m.totalChange > 0 ? '+' : '' }}{{ m.totalChange }} {{ t('dashboard.lbs') }}
                </span>
              }
            </div>

            @if (chartRange() === '14d' && sparklineRaw().length > 1) {
              <div class="relative">
                <svg [attr.viewBox]="'0 0 ' + svgW + ' ' + svgH"
                  class="w-full h-16 overflow-visible" preserveAspectRatio="none" aria-hidden="true">
                  <line [attr.x1]="svgW / 2" y1="0" [attr.x2]="svgW / 2" [attr.y2]="svgH"
                    stroke="currentColor" stroke-width="0.5" stroke-dasharray="2 3" class="text-aged" />
                  <polyline [attr.points]="rawSvgPoints()" fill="none"
                    stroke="currentColor" stroke-width="0.75" stroke-linecap="round" stroke-linejoin="round"
                    class="text-graphite-soft" />
                  <polyline [attr.points]="emaSvgPoints()" fill="none"
                    stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"
                    class="text-ink" />
                  @if (sparklineEma().length > 0) {
                    @let p = sparklineEma()[sparklineEma().length - 1];
                    <circle [attr.cx]="p.x" [attr.cy]="p.y" r="3" class="fill-blood" />
                    <circle [attr.cx]="p.x" [attr.cy]="p.y" r="6" class="fill-blood opacity-20" />
                  }
                </svg>
                <div class="flex justify-between mt-1 font-sans text-[11px] tracking-[0.15em] text-graphite">
                  <span>{{ dateLabel(0) }}</span>
                  <span class="font-display italic text-[10px] tracking-normal">
                    <span class="text-graphite-soft">{{ t('dashboard.legendRaw') }}</span> &nbsp;
                    <span class="text-ink">{{ t('dashboard.legendSmoothed') }}</span>
                  </span>
                  <span>{{ dateLabel(-1) }}</span>
                </div>
              </div>
            } @else if (chartRange() === 'all' && allTimeRawPoints().length > 2) {
              <div class="relative">
                <svg [attr.viewBox]="'0 0 ' + allTimeSvgW + ' ' + allTimeSvgH"
                  class="w-full h-20 overflow-visible" preserveAspectRatio="none" aria-hidden="true">
                  <polyline [attr.points]="allTimeRawSvg()" fill="none"
                    stroke="currentColor" stroke-width="0.75" stroke-linecap="round" stroke-linejoin="round"
                    class="text-graphite-soft" />
                  <polyline [attr.points]="allTimeEmaSvg()" fill="none"
                    stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"
                    class="text-ink" />
                  @if (allTimeEmaPoints().length > 0) {
                    @let p = allTimeEmaPoints()[allTimeEmaPoints().length - 1];
                    <circle [attr.cx]="p.x" [attr.cy]="p.y" r="3" class="fill-blood" />
                  }
                </svg>
                <div class="flex justify-between mt-1 font-sans text-[11px] tracking-[0.15em] text-graphite">
                  <span>{{ allTimeDateLabel(0) }}</span>
                  <span>{{ allTimeDateLabel(-1) }}</span>
                </div>
              </div>
            }
          </div>
        }

        <!-- Actions -->
        <div class="mt-5">
          <div class="flex items-center justify-between">
            <div class="flex items-center gap-2 min-w-0">
              <button type="button" (click)="exportCsv()"
                [attr.title]="t('dashboard.exportTitle')"
                class="tag-btn">{{ t('dashboard.actionExport') }}</button>
              @if (!subs.isPaid()) {
                <span class="caption text-[10px] truncate">{{ t('dashboard.exportFreeCaption', { days: csvExportDaysFree }) }}</span>
              }
            </div>
            <button type="button" (click)="store.refresh()" class="tag-btn"
              [disabled]="store.status() === 'loading'">
              {{ store.status() === 'loading' ? t('dashboard.loading') : t('dashboard.refresh') }}
            </button>
          </div>
          <!-- Format hint — shipped because iOS silently opens CSVs in
               unexpected apps and users otherwise can't tell if the
               "export" button actually did anything. -->
          <p class="caption text-[10px] mt-2" style="color: var(--color-graphite)">
            {{ t('dashboard.exportFormatHint') }}
          </p>
          <!-- After a free-tier user exports, surface the Pro pitch
               showing they could have exported all history. Only renders
               once per session to avoid nag; UpsellCard self-gates on
               isPaid so Pro users never see it. -->
          @if (showExportUpsell()) {
            <app-upsell-card context="csvExport" />
          }
        </div>
      }
    </section>
    </ng-container>
  `,
})
export class DashboardComponent {
  protected readonly store = inject(FitnessStore);
  protected readonly translation = inject(TranslationService);
  protected readonly subs = inject(SubscriptionService);
  private readonly sanitizer = inject(DomSanitizer);
  private readonly calc = inject(TdeeCalculatorService);
  private readonly analytics = inject(AnalyticsService);
  private readonly form = inject(EntryFormManager);

  /** Local greeting bucket driven by the current hour. Called from the
      template so it re-evaluates on every change-detection tick; cost
      is trivial (`getHours()` + two comparisons) and the empty-state
      hero where this is used only renders until the first log anyway. */
  protected greeting(): 'morning' | 'afternoon' | 'evening' {
    const h = new Date().getHours();
    if (h < 12) return 'morning';
    if (h < 18) return 'afternoon';
    return 'evening';
  }

  /** Empty-state hero CTA: opens the entry form and asks the app shell
      to switch to the log tab on mobile. Fires an analytics event so
      we can measure first-session activation rate in the breadcrumb
      trail. */
  protected startLog(): void {
    this.analytics.track('empty_hero_cta_clicked');
    this.form.startAdd();
    this.form.requestLogFocus();
  }

  protected readonly csvExportDaysFree = CSV_EXPORT_DAYS_FREE;
  protected readonly Math = Math;
  protected readonly svgW = 320;
  protected readonly svgH = 60;
  /** True after a free-tier user clicks the export button; drives the
      contextual upsell card. One-shot per session — the card itself
      self-gates on isPaid so Pro users never see it. */
  protected readonly showExportUpsell = signal(false);

  /** Selected window for the merged weight chart. Defaults to 14d
      because that's the actionable horizon for cut-pace adjustment;
      users with enough history can flip to all-time. */
  protected readonly chartRange = signal<'14d' | 'all'>('14d');

  /** Show skeleton readouts during initial cold-load so the 3-up grid
      doesn't flash empty. Flips false once logs arrive or the store
      resolves to a genuine empty state. */
  protected readonly isHydrating = computed(() => {
    const status = this.store.status();
    return (status === 'idle' || status === 'loading') && this.store.logs().length === 0;
  });
  protected readonly skeletonCols = Array.from({ length: 3 });

  protected dismissTdeeTransition(): void {
    localStorage.setItem('macrolog.tdee-transition-dismissed', '1');
    // Force re-evaluation by refreshing store (the computed checks localStorage).
    this.store.refresh();
  }

  // ── Readout "?" help tooltips (tap to reveal, same tap to hide) ──
  protected readonly helpOpen = signal<'target' | 'tdee' | 'weight' | null>(null);
  /** First-session coachmark on the TDEE "?" button. Latches off the
      first time the user reveals any of the three help tooltips and
      never reappears (localStorage flag). Uses a lazy read so SSR /
      test harnesses without localStorage don't throw. */
  protected readonly showTdeeCoachmark = signal<boolean>(this.readTdeeCoachmarkFlag());
  protected toggleHelp(which: 'target' | 'tdee' | 'weight'): void {
    this.helpOpen.set(this.helpOpen() === which ? null : which);
    if (this.showTdeeCoachmark()) {
      this.showTdeeCoachmark.set(false);
      try { localStorage.setItem('macrolog.tdee-coachmark-seen', '1'); } catch { /* ignore */ }
    }
  }
  private readTdeeCoachmarkFlag(): boolean {
    try { return !localStorage.getItem('macrolog.tdee-coachmark-seen'); } catch { return false; }
  }
  protected helpText(which: 'target' | 'tdee' | 'weight'): string {
    switch (which) {
      case 'target': return this.translation.t('dashboard.targetHelp');
      case 'tdee':   return this.translation.t('dashboard.tdeeHelp');
      case 'weight': return this.translation.t('dashboard.weightHelp');
    }
  }

  // ── Weekly report rendering ──────────────────────────────────
  protected readonly reportHtml = computed<SafeHtml>(() => {
    const report = this.store.weeklyReport();
    if (!report) return '' as SafeHtml;
    const html = marked.parse(report.markdown, { gfm: true, breaks: true }) as string;
    return this.sanitizer.bypassSecurityTrustHtml(html);
  });

  protected readonly reportAge = computed<string>(() => {
    const report = this.store.weeklyReport();
    if (!report) return '';
    const days = Math.floor((Date.now() - report.generatedAt.getTime()) / (1000 * 60 * 60 * 24));
    if (days === 0) return this.translation.t('dashboard.reportToday');
    if (days === 1) return this.translation.t('dashboard.reportYesterday');
    return this.translation.t('dashboard.reportDaysAgo', { n: days });
  });

  // ── Sparkline geometry (view-only math, stays local) ────────
  private scalePoints(values: number[], rawWeights: number[]): SparklinePoint[] {
    if (values.length < 2) return [];
    const allVals = [...rawWeights, ...values];
    const min = Math.min(...allVals);
    const max = Math.max(...allVals);
    const range = max - min || 1;
    const padY = 6;
    const usableH = this.svgH - padY * 2;
    return values.map((v, i) => ({
      x: (i / (values.length - 1)) * this.svgW,
      y: padY + (1 - (v - min) / range) * usableH,
    }));
  }

  /** Per-day weight series. Weights now live in a separate dailyWeights
      collection (one entry per day) so reading log.weight — which is
      undefined on meal rows — produced an empty sparkline and flickered
      when the user logged a weight. Merge dailyWeights onto log dates
      and deduplicate by day so the trend uses every available point. */
  private readonly sparklineWeights = computed(() => {
    const dw = this.store.dailyWeights();
    const seen = new Set<string>();
    const out: number[] = [];
    for (const log of this.store.logs()) {
      const key = localDateKey(log.date);
      if (seen.has(key)) continue;
      const w = dw[key] ?? log.weight;
      if (w != null) { out.push(w); seen.add(key); }
    }
    return out;
  });

  protected readonly sparklineRaw = computed(() => {
    const w = this.sparklineWeights();
    return this.scalePoints(w, w);
  });
  protected readonly sparklineEma = computed(() => {
    const w = this.sparklineWeights();
    return this.scalePoints(this.store.ema(), w);
  });
  protected readonly rawSvgPoints = computed(() =>
    this.sparklineRaw().map((p) => `${p.x},${p.y}`).join(' '));
  protected readonly emaSvgPoints = computed(() =>
    this.sparklineEma().map((p) => `${p.x},${p.y}`).join(' '));

  // ── All-time weight chart ─────────────────────────────────────
  protected readonly allTimeSvgW = 480;
  protected readonly allTimeSvgH = 80;

  /** All-time daily weights sorted oldest → newest, with sorted date keys for labels. */
  private readonly allTimeDailyData = computed(() => {
    const logs = this.store.allTimeLogs();
    if (logs.length < 7) return { weights: [] as number[], dateKeys: [] as string[] };
    const dw = this.store.dailyWeights();
    const byDay = new Map<string, number>();
    for (const log of logs) {
      const key = localDateKey(log.date);
      if (!byDay.has(key)) {
        const w = dw[key] ?? log.weight;
        if (w != null) byDay.set(key, w);
      }
    }
    const sorted = [...byDay.entries()].sort(([a], [b]) => a.localeCompare(b));
    return { weights: sorted.map(([, w]) => w), dateKeys: sorted.map(([k]) => k) };
  });

  private readonly allTimeWeights = computed(() => this.allTimeDailyData().weights);
  private readonly allTimeDateKeys = computed(() => this.allTimeDailyData().dateKeys);
  private readonly allTimeEma14 = computed(() => this.calc.ema(this.allTimeWeights(), 14));

  private scaleAllTime(values: number[], rawWeights: number[]): SparklinePoint[] {
    if (values.length < 2 || rawWeights.length < 2) return [];
    const all = [...rawWeights, ...values];
    const min = Math.min(...all);
    const max = Math.max(...all);
    const range = max - min || 1;
    const padY = 6;
    const usableH = this.allTimeSvgH - padY * 2;
    return values.map((v, i) => ({
      x: (i / (values.length - 1)) * this.allTimeSvgW,
      y: padY + (1 - (v - min) / range) * usableH,
    }));
  }

  protected readonly allTimeRawPoints = computed(() => {
    const w = this.allTimeWeights();
    return this.scaleAllTime(w, w);
  });
  protected readonly allTimeEmaPoints = computed(() =>
    this.scaleAllTime(this.allTimeEma14(), this.allTimeWeights()));
  protected readonly allTimeRawSvg = computed(() =>
    this.allTimeRawPoints().map((p) => `${p.x},${p.y}`).join(' '));
  protected readonly allTimeEmaSvg = computed(() =>
    this.allTimeEmaPoints().map((p) => `${p.x},${p.y}`).join(' '));

  private localeForDates(): string {
    return bcp47ForLang(this.translation.language());
  }

  protected allTimeDateLabel(index: number): string {
    const keys = this.allTimeDateKeys();
    if (keys.length === 0) return '';
    const i = index < 0 ? keys.length + index : index;
    const key = keys[i];
    if (!key) return '';
    const [y, m, d] = key.split('-').map(Number);
    return new Date(y, m - 1, d).toLocaleDateString(this.localeForDates(), { month: 'short', day: 'numeric' }).toUpperCase();
  }

  protected dateLabel(index: number): string {
    const data = this.store.logs();
    if (data.length === 0) return '';
    const i = index < 0 ? data.length + index : index;
    return data[i]?.date.toLocaleDateString(this.localeForDates(), { month: 'short', day: 'numeric' }).toUpperCase() ?? '';
  }

  protected async exportCsv(): Promise<void> {
    // Flag the upsell for free users the moment they engage with export.
    // UpsellCard still self-gates on isPaid so Pro users see nothing.
    if (!this.subs.isPaid()) this.showExportUpsell.set(true);
    this.analytics.track('export_clicked', { tier: this.subs.isPaid() ? 'paid' : 'free' });
    const allLogs = await this.store.getAllLogs();
    // Free tier exports only the trailing window; Pro exports all history.
    const exportLogs = this.subs.isPaid()
      ? allLogs
      : this.filterLastDays(allLogs, CSV_EXPORT_DAYS_FREE);
    const rows = [
      ['Date', 'Weight (lbs)', 'Calories', 'Protein (g)', 'Exercise'].join(','),
      ...exportLogs.map((l) =>
        [
          localDateKey(l.date),
          l.weight,
          l.calories,
          l.protein ?? '',
          (l.exerciseCompleted || l.liftCompleted || l.cardioCompleted) ? this.translation.t('dashboard.csvExercise') : '',
        ].join(','),
      ),
    ];
    const blob = new Blob([rows.join('\n')], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `macrolog-export-${localDateKey(new Date())}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  private filterLastDays<T extends { date: Date }>(logs: T[], days: number): T[] {
    const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
    return logs.filter((l) => l.date.getTime() >= cutoff);
  }
}
