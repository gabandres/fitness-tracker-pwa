import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { AdminDataService } from './admin-data.service';
import { AdminShellState } from './admin-shell.state';
import { AdmBars, AdmKpi, AdmMeter, AdmSpark } from './admin-ui';
import { deltaPct, pct, pooledRetention, sumEvent } from './admin-insights';
import { fmtDateTime, relTime } from './admin-format';

const EVENT_LABELS: Record<string, string> = {
  app_open: 'App opens',
  log_added: 'Meals logged',
  photo_scan: 'Photo scans',
  barcode_scan: 'Barcode scans',
  voice_log: 'Voice logs',
  quick_add: 'Quick adds',
  repeat_yesterday: 'Repeat yesterday',
  weight_logged: 'Weigh-ins',
  workout_finished: 'Workouts finished',
  signup: 'Sign-ups',
  onboarding_complete: 'Onboarding done',
  log_queued_offline: 'Queued offline',
};

/**
 * The first screen: is the product healthy today, and what should the one
 * admin look at. Laid out for the F-pattern — decision KPIs top-left, the
 * insight list where the eye lands next, drill-downs below.
 */
@Component({
  selector: 'adm-overview',
  standalone: true,
  imports: [AdmKpi, AdmBars, AdmMeter, AdmSpark],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="adm-page-head">
      <div>
        <h1 class="adm-h1">Overview</h1>
        <p class="adm-sub">
          Product health for the last 30 days.
          @if (data.lastLoadedAt(); as t) { Loaded {{ relTime(t.toISOString()) }}. }
        </p>
      </div>
      <button type="button" class="adm-btn" (click)="data.loadOverview(true)" [disabled]="data.anyLoading()">
        {{ data.anyLoading() ? 'Refreshing…' : 'Refresh' }}
      </button>
    </div>

    <!-- Row 1 — engagement -->
    <div class="adm-grid adm-grid-4">
      <adm-kpi label="Active today" [value]="u()?.dau ?? '—'" [series]="dailyActive()" tone="accent"
        [hint]="u() ? 'distinct users with any activity' : 'no usage data yet'" />
      <adm-kpi label="Weekly actives" [value]="u()?.wau ?? '—'" [delta]="wauDelta()" tone="teal"
        [hint]="u()?.wauPrior != null ? 'vs ' + u()!.wauPrior + ' the week before' : 'last 7 days'" />
      <adm-kpi label="Monthly actives" [value]="u()?.mau ?? '—'" tone="violet" hint="last 30 days" />
      <adm-kpi label="Stickiness" [value]="stickiness() === null ? '—' : stickiness() + '%'" tone="good"
        hint="DAU ÷ MAU · 20%+ is the consumer bar" />
    </div>

    <!-- Row 2 — growth & activation -->
    <div class="adm-grid adm-grid-4" style="margin-top: 14px;">
      <adm-kpi label="Accounts" [value]="s()?.totalUsers ?? '—'" [hint]="s() ? '+' + s()!.newUsers7d + ' this week · +' + s()!.newUsers30d + ' in 30d' : ''" tone="ink-muted" />
      <adm-kpi label="Activated" [value]="activatedPct() === null ? '—' : activatedPct() + '%'"
        [hint]="s() ? s()!.usersWithFirstEntryCount + ' of ' + s()!.totalUsers + ' logged at least once' : ''" tone="good" />
      <adm-kpi label="Meals logged · 7d" [value]="logs7()" [series]="dailyEvent('log_added')" tone="accent"
        [hint]="'per active user per day: ' + logsPerActive()" />
      <adm-kpi label="Photo scans · 7d" [value]="sumEvent(u(), 'photo_scan', 7)" [series]="dailyEvent('photo_scan')" tone="warn"
        [hint]="'coach calls: ' + sumEvent(u(), 'coach_ask', 7)" />
    </div>

    <!-- Row 3 — insights + system -->
    <div class="adm-grid adm-grid-main" style="margin-top: 14px;">
      <section class="adm-card">
        <div class="adm-card-head">
          <h2 class="adm-h2">Insights <span class="adm-chip muted">{{ data.insights().length }}</span></h2>
          <span class="adm-muted" style="font-size: 12px;">derived from the numbers on this page</span>
        </div>
        @if (data.insights().length === 0) {
          <p class="adm-empty">Nothing needs attention. Every rule below the thresholds is quiet.</p>
        } @else {
          <ul class="adm-insights">
            @for (i of data.insights(); track i.title) {
              <li class="adm-insight">
                <span class="adm-insight-dot" [class]="'adm-insight-dot ' + i.level"></span>
                <div>
                  <div class="adm-insight-title">{{ i.title }}</div>
                  <div class="adm-insight-detail">{{ i.detail }}</div>
                </div>
                @if (i.section !== 'overview') {
                  <button type="button" class="adm-btn sm ghost" (click)="shell.go($any(i.section))">open →</button>
                }
              </li>
            }
          </ul>
        }
      </section>

      <section class="adm-card">
        <div class="adm-card-head"><h2 class="adm-h2">System</h2></div>
        <dl class="adm-kv">
          <dt>Status pulse</dt>
          <dd>
            @if (data.heartbeatAgeMin(); as age) {
              <span class="adm-chip" [class.good]="age <= 20" [class.warn]="age > 20 && age <= 45" [class.danger]="age > 45">{{ age < 1 ? 'just now' : round(age) + ' min ago' }}</span>
            } @else { <span class="adm-chip muted">unknown</span> }
          </dd>
          <dt>Web release</dt><dd>{{ release() }}</dd>
          <dt>Retention run</dt><dd>{{ retentionComputedAt() }}</dd>
          <dt>Usage series</dt><dd>{{ u() ? u()!.from + ' → ' + u()!.to : '—' }}</dd>
        </dl>
        <div class="adm-section">
          <span class="adm-label">AI spend today</span>
          @if (data.ceilings().length === 0) { <p class="adm-muted" style="font-size: 13px;">no ceilings loaded</p> }
          <div style="display: flex; flex-direction: column; gap: 12px;">
            @for (c of data.ceilings(); track c.kind) {
              <adm-meter [label]="c.kind + (c.killed ? ' · OFF' : '')" [ratio]="c.ratio" [display]="c.used + ' / ' + c.limit"
                [tone]="c.killed ? 'danger' : c.ratio >= 0.8 ? 'warn' : 'teal'" [hint]="c.killed ? c.killedReason : 'resets at UTC midnight'" />
            }
          </div>
        </div>
      </section>
    </div>

    <!-- Row 4 — funnel, retention, platforms -->
    <div class="adm-grid adm-grid-3" style="margin-top: 14px;">
      <section class="adm-card">
        <div class="adm-card-head"><h2 class="adm-h2">Activation funnel</h2><span class="adm-muted" style="font-size: 12px;">all time</span></div>
        @if (s(); as st) {
          <adm-bars [rows]="funnel(st)" relativeTo="max" />
        } @else { <p class="adm-empty">loading…</p> }
      </section>

      <section class="adm-card">
        <div class="adm-card-head">
          <h2 class="adm-h2">Retention</h2>
          @if (data.retention()?.insufficientSample) { <span class="adm-chip warn">small sample</span> }
        </div>
        @if (data.retention(); as r) {
          <div style="display: flex; flex-direction: column; gap: 12px;">
            @for (cp of checkpoints; track cp.key) {
              <adm-meter [label]="cp.label" [ratio]="(ret(cp.key).rate ?? 0) / 100"
                [display]="ret(cp.key).rate === null ? '—' : ret(cp.key).rate + '%'"
                [hint]="ret(cp.key).retained + ' of ' + ret(cp.key).eligible + ' activated users'" [tone]="cp.tone" />
            }
          </div>
          <div class="adm-section">
            <span class="adm-label">D7 trend · {{ data.retentionHistory().length }} days</span>
            <adm-spark [values]="d7History()" tone="good" />
            <p class="adm-kpi-hint">{{ r.activatedTotal }} activated of {{ r.usersExamined }} examined · {{ r.logsPerActivatedUserPerDay }} logs / activated user / day</p>
          </div>
        } @else { <p class="adm-empty">No retention run yet — the hourly dispatcher writes it once a day.</p> }
      </section>

      <section class="adm-card">
        <div class="adm-card-head"><h2 class="adm-h2">Platforms</h2><span class="adm-muted" style="font-size: 12px;">active days · 30d</span></div>
        @if (u(); as us) {
          <adm-bars [rows]="platformRows(us.platformTotals)" />
        } @else { <p class="adm-empty">loading…</p> }
        @if (s(); as st) {
          <div class="adm-section">
            <span class="adm-label">Sign-in providers</span>
            <adm-bars [rows]="providerRows(st.providersBreakdown)" />
          </div>
        }
      </section>
    </div>

    <!-- Row 5 — feature usage + recent -->
    <div class="adm-grid adm-grid-2" style="margin-top: 14px;">
      <section class="adm-card">
        <div class="adm-card-head"><h2 class="adm-h2">Feature usage</h2><span class="adm-muted" style="font-size: 12px;">events · 30d</span></div>
        @if (u(); as us) { <adm-bars [rows]="eventRows(us.eventTotals)" relativeTo="max" /> } @else { <p class="adm-empty">loading…</p> }
      </section>
      <section class="adm-card">
        <div class="adm-card-head">
          <h2 class="adm-h2">Latest</h2>
          <button type="button" class="adm-btn sm ghost" (click)="shell.go('activity')">all activity →</button>
        </div>
        <ul class="adm-timeline">
          @for (a of data.activity().slice(0, 8); track a.timestamp + a.uid) {
            <li>
              <span class="when">{{ fmt(a.timestamp) }}</span>
              <span class="what">
                <span class="adm-chip" [class.good]="a.type === 'signup'" [class.muted]="a.type !== 'signup'">{{ a.type }}</span>
                <button type="button" class="adm-btn sm ghost adm-mono" (click)="shell.openUser(a.uid)">{{ a.email || a.uid.slice(0, 8) }}</button>
                <span class="adm-soft">{{ a.detail || '' }}</span>
              </span>
            </li>
          } @empty { <li><span class="adm-empty">no activity yet</span></li> }
        </ul>
      </section>
    </div>
  `,
})
export class AdminOverviewComponent {
  readonly data = inject(AdminDataService);
  readonly shell = inject(AdminShellState);
  readonly sumEvent = sumEvent;
  readonly fmt = fmtDateTime;
  readonly relTime = relTime;
  readonly round = Math.round;
  readonly checkpoints = [
    { key: 'd1' as const, label: 'Day 1', tone: 'teal' },
    { key: 'd7' as const, label: 'Day 7', tone: 'good' },
    { key: 'd30' as const, label: 'Day 30', tone: 'violet' },
  ];

  constructor() {
    void this.data.loadOverview();
  }

  readonly u = computed(() => this.data.usage());
  readonly s = computed(() => this.data.stats());
  readonly dailyActive = computed(() => this.u()?.daily.map((d) => d.activeUsers) ?? null);
  readonly stickiness = computed(() => { const u = this.u(); return u ? pct(u.dau, u.mau) : null; });
  readonly wauDelta = computed(() => { const u = this.u(); return u ? deltaPct(u.wau, u.wauPrior) : null; });
  readonly activatedPct = computed(() => { const s = this.s(); return s ? pct(s.usersWithFirstEntryCount, s.totalUsers) : null; });
  readonly logs7 = computed(() => sumEvent(this.u(), 'log_added', 7));
  readonly logsPerActive = computed(() => {
    const u = this.u(); if (!u) return '—';
    const days = u.daily.slice(-7);
    const activeDays = days.reduce((a, d) => a + d.activeUsers, 0);
    return activeDays ? (this.logs7() / activeDays).toFixed(2) : '—';
  });
  readonly d7History = computed(() => this.data.retentionHistory().map((r) => Math.round((r.d7 ?? 0) * 100)));
  readonly release = computed(() => String((globalThis as { __MACROLOG_RELEASE__?: string }).__MACROLOG_RELEASE__ ?? 'dev').slice(0, 8));
  readonly retentionComputedAt = computed(() => {
    const ts = this.data.retention()?.computedAt as { toDate?: () => Date } | undefined;
    const d = ts?.toDate?.();
    return d ? relTime(d.toISOString()) : '—';
  });

  dailyEvent(event: string): number[] | null {
    const u = this.u();
    return u ? u.daily.map((d) => d.events[event] ?? 0) : null;
  }
  ret(key: 'd1' | 'd7' | 'd30') { return pooledRetention(this.data.retention(), key); }

  funnel(s: NonNullable<ReturnType<AdminDataService['stats']>>) {
    return [
      { label: 'Signed up', value: s.totalUsers, tone: 'ink-muted' },
      { label: 'Verified email', value: s.verifiedCount, tone: 'info' },
      { label: 'Finished onboarding', value: s.profileCompletedCount, tone: 'teal' },
      { label: 'First log', value: s.usersWithFirstEntryCount, tone: 'good' },
      { label: 'First log within 24h', value: s.firstEntryWithin24hCount ?? 0, tone: 'accent' },
    ];
  }
  platformRows(t: Record<string, number>) {
    const tone: Record<string, string> = { ios: 'accent', android: 'good', web: 'ink-muted' };
    return Object.entries(t).sort((a, b) => b[1] - a[1]).map(([k, v]) => ({ label: k, value: v, tone: tone[k] ?? 'violet' }));
  }
  providerRows(t: Record<string, number>) {
    const tone: Record<string, string> = { 'google.com': 'info', 'apple.com': 'ink-muted', password: 'teal', 'microsoft.com': 'violet' };
    return Object.entries(t).sort((a, b) => b[1] - a[1]).map(([k, v]) => ({ label: k.replace('.com', ''), value: v, tone: tone[k] ?? 'warn' }));
  }
  eventRows(t: Record<string, number>) {
    return Object.entries(t)
      .filter(([k]) => k !== 'app_open')
      .sort((a, b) => b[1] - a[1])
      .map(([k, v]) => ({ label: EVENT_LABELS[k] ?? k, value: v, tone: k === 'log_added' ? 'accent' : k.includes('scan') ? 'warn' : k === 'workout_finished' ? 'violet' : 'teal' }));
  }
}
