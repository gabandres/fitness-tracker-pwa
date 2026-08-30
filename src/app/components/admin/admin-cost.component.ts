import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { AdminService, type BillingRow, type CostLine, type LedgerItem } from '../../services/admin.service';
import { AdminDataService } from './admin-data.service';
import { AdminShellState } from './admin-shell.state';
import { AdmBars, AdmKpi, AdmMeter, AdmSpark } from './admin-ui';
import { relTime } from './admin-format';

const PROJECT = 'fitness-tracker-gb-1775407101';

function usd(n: number | null | undefined, digits = 2): string {
  if (n === null || n === undefined || Number.isNaN(n)) return '—';
  if (Math.abs(n) > 0 && Math.abs(n) < 0.005) return '<$0.01';
  return `$${n.toFixed(digits)}`;
}
function num(n: number): string {
  if (n >= 1e6) return `${(n / 1e6).toFixed(2)}M`;
  if (n >= 1e4) return `${(n / 1e3).toFixed(1)}k`;
  return Number.isInteger(n) ? n.toLocaleString() : n.toFixed(1);
}

/**
 * Cost & AI. Two sources of truth, deliberately side by side:
 *
 *  - MODELLED: live usage from Cloud Monitoring + the aiUsage ledger, priced
 *    at list minus free tiers. Available now, per line, explains the *why*.
 *  - ACTUAL: the Cloud Billing → BigQuery export, covering all four projects
 *    on the billing account. The *what*. Needs the owner to enable the export.
 *
 * Plus the fixed-cost ledger (store fees, domains) so the number at the top
 * is what the app costs to exist, not just what Google meters.
 */
@Component({
  selector: 'adm-cost',
  standalone: true,
  imports: [FormsModule, AdmKpi, AdmBars, AdmMeter, AdmSpark],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="adm-page-head">
      <div>
        <h1 class="adm-h1">Cost &amp; AI</h1>
        <p class="adm-sub">What Ignia costs to run: metered usage priced at list ({{ model()?.pricesAsOf ? 'prices as of ' + model()!.pricesAsOf : 'prices pending' }}), the actual bill once the export is on, and the fixed costs around it.</p>
      </div>
      <button type="button" class="adm-btn" (click)="reload()" [disabled]="data.isLoading('costModel')">{{ data.isLoading('costModel') ? 'Reading meters…' : 'Refresh' }}</button>
    </div>

    <!-- Row 1 — the money -->
    <div class="adm-grid adm-grid-4">
      <adm-kpi label="Modelled · month to date" [value]="usd(model()?.monthToDate)" tone="accent"
        [hint]="model() ? 'day ' + model()!.daysElapsed + ' of ' + model()!.daysInMonth + ' · Google services only' : 'reading Cloud Monitoring…'" />
      <adm-kpi label="Projected this month" [value]="usd(model()?.projectedMonth)" tone="warn" hint="straight-line from month to date" />
      <adm-kpi label="Fixed costs · per month" [value]="usd(fixedMonthly())" tone="ink-muted" [hint]="ledger().length + ' ledger item' + (ledger().length === 1 ? '' : 's') + ' · yearly ÷ 12'" />
      <adm-kpi label="All-in run rate" [value]="usd((model()?.projectedMonth ?? 0) + fixedMonthly())" tone="violet"
        [hint]="perMau() === null ? 'per month' : usd(perMau(), 3) + ' per monthly active user'" />
    </div>

    <!-- Row 2 — where it goes + Gemini -->
    <div class="adm-grid adm-grid-main" style="margin-top:14px;">
      <section class="adm-card">
        <div class="adm-card-head"><h2 class="adm-h2">Where the metered money goes</h2><span class="adm-muted" style="font-size:12px;">month to date, modelled</span></div>
        @if (model(); as m) {
          @if (serviceRows(m.byService).length) {
            <adm-bars [rows]="serviceRows(m.byService)" suffix="" relativeTo="max" />
          } @else { <p class="adm-empty">Every line is inside its free tier this month.</p> }
          @if (m.warnings.length) {
            <ul class="adm-timeline" style="margin-top:10px;">
              @for (w of m.warnings; track w) { <li style="grid-template-columns:1fr;"><span class="adm-chip warn">meter unreadable</span> <span class="adm-muted" style="font-size:12px;">{{ w }}</span></li> }
            </ul>
          }
        } @else { <p class="adm-empty">{{ data.isLoading('costModel') ? 'Reading Cloud Monitoring, Secret Manager, Scheduler and the AI ledger…' : 'Not loaded.' }}</p> }
      </section>

      <section class="adm-card">
        <div class="adm-card-head"><h2 class="adm-h2">Gemini</h2><span class="adm-muted" style="font-size:12px;">month to date</span></div>
        @if (model()?.ai; as ai) {
          <div class="adm-grid adm-grid-2" style="gap:10px;">
            @for (k of kindRows(ai); track k.kind) {
              <div class="adm-kpi" style="min-height:0;">
                <span class="adm-label">{{ k.label }}</span>
                <div class="adm-kpi-value adm-kpi-value--sm">{{ usd(k.cost, 3) }}</div>
                <div class="adm-kpi-hint">{{ k.calls }} call{{ k.calls === 1 ? '' : 's' }} · {{ k.calls ? usd(k.cost / k.calls, 4) : '—' }} each{{ k.images ? ' · ' + k.images + ' images' : '' }}</div>
              </div>
            } @empty { <p class="adm-muted" style="font-size:12.5px;">No Gemini calls ledgered yet this month — the ledger starts with the first call after this deploy.</p> }
          </div>
          @if (aiByDay().length > 1) {
            <div class="adm-section"><span class="adm-label">Daily AI cost</span><adm-spark [values]="aiByDay()" tone="warn" /></div>
          }
          @if (ai.models.length) {
            <div class="adm-section">
              <span class="adm-label">By model</span>
              <ul class="adm-timeline">
                @for (mo of ai.models; track mo.model) {
                  <li style="grid-template-columns: 1fr auto;">
                    <span><span class="adm-mono" style="font-size:12.5px;">{{ mo.model }}</span> <span class="adm-muted" style="font-size:12px;">{{ num(mo.inputTokens) }} in · {{ num(mo.outputTokens) }} out (incl. thinking)</span>
                      @if (!mo.priceKnown) { <span class="adm-chip warn">price assumed</span> }</span>
                    <span class="adm-mono">{{ usd(mo.cost, 3) }}</span>
                  </li>
                }
              </ul>
            </div>
          }
        } @else { <p class="adm-empty">—</p> }
      </section>
    </div>

    <!-- Row 3 — line items -->
    <section class="adm-card" style="margin-top:14px;">
      <div class="adm-card-head"><h2 class="adm-h2">Line items</h2><span class="adm-muted" style="font-size:12px;">usage vs free allowance vs list price · every number can be checked</span></div>
      @if (model(); as m) {
        <div class="adm-table-wrap" style="border:none;">
          <table class="adm-table">
            <thead><tr><th style="cursor:default;">Service</th><th style="cursor:default;">SKU</th><th style="cursor:default;">Usage</th><th style="cursor:default;">Free allowance</th><th style="cursor:default;">Billable</th><th style="cursor:default;">List price</th><th style="cursor:default;">Cost</th></tr></thead>
            <tbody>
              @for (l of m.lines; track l.service + l.sku) {
                <tr style="cursor:default;">
                  <td>{{ l.service }}</td>
                  <td>{{ l.sku }}@if (l.note) { <div class="adm-muted" style="font-size:11.5px;">{{ l.note }}</div> }</td>
                  <td class="adm-mono">{{ num(l.usage) }} <span class="adm-muted">{{ l.unit }}</span></td>
                  <td class="adm-mono">{{ l.freeAllowance ? num(l.freeAllowance) : '—' }}</td>
                  <td class="adm-mono">
                    <div>{{ num(l.billableUsage) }}</div>
                    <div class="adm-bars-track" style="width:90px; margin-top:4px;"><div class="adm-bars-fill" [style.width.%]="usedPct(l)" [style.background]="l.billableUsage > 0 ? 'var(--adm-warn)' : 'var(--adm-good)'"></div></div>
                  </td>
                  <td class="adm-mono">{{ '$' + l.unitPrice }} <span class="adm-muted">/ {{ l.perUnit }}</span></td>
                  <td class="adm-mono" [style.color]="l.cost > 0 ? 'var(--adm-ink)' : 'var(--adm-ink-muted)'">{{ usd(l.cost, 4) }}</td>
                </tr>
              } @empty { <tr><td colspan="7"><div class="adm-empty">no lines</div></td></tr> }
            </tbody>
          </table>
        </div>
      } @else { <p class="adm-empty">—</p> }
    </section>

    <!-- Row 4 — the actual bill -->
    <section class="adm-card" style="margin-top:14px;">
      <div class="adm-card-head">
        <h2 class="adm-h2">The actual bill @if (billing()?.enabled) { <span class="adm-chip good">export on</span> } @else { <span class="adm-chip warn">export off</span> }</h2>
        <span class="adm-muted" style="font-size:12px;">Cloud Billing → BigQuery standard export · all four projects on the billing account</span>
      </div>
      @if (billing(); as b) {
        @if (b.enabled) {
          <div class="adm-grid adm-grid-2">
            <div>
              <span class="adm-label">Net cost by invoice month</span>
              <div class="adm-table-wrap" style="border:none; margin-top:6px;">
                <table class="adm-table"><thead><tr><th style="cursor:default;">Month</th><th style="cursor:default;">Project</th><th style="cursor:default;">Net</th></tr></thead>
                  <tbody>@for (r of b.byMonth ?? []; track $index) {
                    <tr style="cursor:default;" [style.font-weight]="r['project'] === project ? '600' : '400'"><td class="adm-mono">{{ r['month'] }}</td><td class="adm-mono" style="font-size:12px;">{{ r['project'] }}@if (r['project'] === project) { <span class="adm-chip accent">Ignia</span> }</td><td class="adm-mono">{{ usd(n(r['net']), 2) }}</td></tr>
                  }</tbody></table>
              </div>
            </div>
            <div>
              <span class="adm-label">Lifetime since the export began</span>
              <ul class="adm-timeline" style="margin-top:6px;">
                @for (r of b.lifetime ?? []; track r['project']) {
                  <li style="grid-template-columns:1fr auto;"><span class="adm-mono" style="font-size:12.5px;">{{ r['project'] }}@if (r['project'] === project) { <span class="adm-chip accent">Ignia</span> }</span><span class="adm-mono">{{ usd(n(r['net']), 2) }}</span></li>
                }
              </ul>
              <span class="adm-label" style="display:block; margin-top:14px;">Ignia by service · last 3 months</span>
              <ul class="adm-timeline" style="margin-top:6px;">
                @for (r of igniaServices(b.byProjectService ?? []); track $index) {
                  <li style="grid-template-columns:70px 1fr auto;"><span class="when">{{ r['month'] }}</span><span>{{ r['service'] }}</span><span class="adm-mono">{{ usd(n(r['net']), 2) }}</span></li>
                } @empty { <li><span class="adm-muted" style="font-size:12.5px;">nothing billed to Ignia in the window</span></li> }
              </ul>
            </div>
          </div>
          @if (b.bySku?.length) {
            <div class="adm-section">
              <span class="adm-label">Ignia SKUs with a charge · last 2 months</span>
              <div class="adm-table-wrap" style="border:none;">
                <table class="adm-table"><thead><tr><th style="cursor:default;">Month</th><th style="cursor:default;">Service</th><th style="cursor:default;">SKU</th><th style="cursor:default;">Usage</th><th style="cursor:default;">Gross</th><th style="cursor:default;">Net</th></tr></thead>
                  <tbody>@for (r of b.bySku ?? []; track $index) {
                    <tr style="cursor:default;"><td class="adm-mono">{{ r['month'] }}</td><td>{{ r['service'] }}</td><td style="font-size:12.5px;">{{ r['sku'] }}</td><td class="adm-mono" style="font-size:12px;">{{ num(n(r['usage'])) }} {{ r['unit'] }}</td><td class="adm-mono">{{ usd(n(r['gross']), 4) }}</td><td class="adm-mono">{{ usd(n(r['net']), 4) }}</td></tr>
                  }</tbody></table>
              </div>
            </div>
          }
          <p class="adm-muted" style="font-size:12px; margin:10px 0 0;">Queried {{ relTime(b.queriedAt) }} from <span class="adm-mono">{{ b.table }}</span>. Net = cost + credits (free-tier and promotional credits are negative).</p>
        } @else {
          <p class="adm-soft" style="font-size:13px; margin:0 0 10px;">Google has no cost API; the bill only becomes queryable through the BigQuery export, which is a one-time console switch that <strong>only the billing-account owner can flip</strong>. The dataset already exists.</p>
          <ol class="adm-soft" style="font-size:13px; padding-left:18px; margin:0; line-height:1.7;">
            <li>Open <span class="adm-mono">console.cloud.google.com/billing</span> → account <span class="adm-mono">010F4E-5E97BC-6B83D0</span> (“Firebase Payment”) → <strong>Billing export</strong> → <strong>BigQuery export</strong> tab.</li>
            <li>Under <strong>Standard usage cost</strong> click <strong>Edit settings</strong>: project <span class="adm-mono">{{ project }}</span>, dataset <span class="adm-mono">billing</span> → Save.</li>
            <li>Leave <em>Detailed usage cost</em> and <em>Pricing</em> off — the standard table is enough and stays inside BigQuery's free tier at this scale.</li>
            <li>Data appears within hours and backfills the current and previous month. Refresh this page; the section switches to the tables on its own.</li>
          </ol>
          <p class="adm-muted" style="font-size:12px; margin:10px 0 0;">Last check: {{ b.reason }}</p>
        }
      } @else { <p class="adm-empty">{{ data.isLoading('billing') ? 'Querying BigQuery…' : '—' }}</p> }
    </section>

    <!-- Row 5 — fixed costs + functions -->
    <div class="adm-grid adm-grid-2" style="margin-top:14px;">
      <section class="adm-card">
        <div class="adm-card-head"><h2 class="adm-h2">Fixed costs</h2><span class="adm-muted" style="font-size:12px;">what Google does not meter</span></div>
        <div style="display:flex; flex-direction:column; gap:8px;">
          @for (it of draft(); track it.id; let i = $index) {
            <div style="display:grid; grid-template-columns: 1fr 100px 110px auto; gap:8px; align-items:center;">
              <input class="adm-field" [ngModel]="it.label" (ngModelChange)="patch(i, { label: $event })" placeholder="Apple Developer Program" />
              <input class="adm-field adm-mono" type="number" min="0" step="0.01" [ngModel]="it.amountUsd" (ngModelChange)="patch(i, { amountUsd: +$event })" />
              <select class="adm-field adm-select" [ngModel]="it.cadence" (ngModelChange)="patch(i, { cadence: $event })"><option value="monthly">monthly</option><option value="yearly">yearly</option><option value="once">one-off</option></select>
              <button type="button" class="adm-btn sm ghost" (click)="remove(i)">✕</button>
            </div>
          } @empty { <p class="adm-muted" style="font-size:12.5px;">Nothing ledgered. Add the store memberships, domains and the registered agent so the run rate above is honest.</p> }
        </div>
        <div class="adm-actions" style="margin-top:10px;">
          <button type="button" class="adm-btn sm" (click)="add()">Add item</button>
          @if (draft().length === 0 && ledger().length === 0) { <button type="button" class="adm-btn sm ghost" (click)="addDefaults()">Add the usual four</button> }
          <button type="button" class="adm-btn sm primary" (click)="save()" [disabled]="busy() || !dirty()">Save ledger</button>
          @if (ledger().length) { <span class="adm-muted" style="font-size:12px; align-self:center;">{{ usd(fixedMonthly()) }}/mo · {{ usd(fixedMonthly() * 12) }}/yr amortised</span> }
        </div>
      </section>

      <section class="adm-card">
        <div class="adm-card-head"><h2 class="adm-h2">Functions by instance time</h2><span class="adm-muted" style="font-size:12px;">month to date · Cloud Run</span></div>
        @if (model()?.perFunction?.length) {
          <div class="adm-table-wrap" style="border:none;">
            <table class="adm-table"><thead><tr><th style="cursor:default;">Function</th><th style="cursor:default;">Requests</th><th style="cursor:default;">Instance-s</th><th style="cursor:default;">vCPU-s</th><th style="cursor:default;">GiB-s</th></tr></thead>
              <tbody>@for (f of model()!.perFunction.slice(0, 12); track f.name) {
                <tr style="cursor:default;"><td class="adm-mono" style="font-size:12px;">{{ f.name }}</td><td class="adm-mono">{{ num(f.requests) }}</td><td class="adm-mono">{{ num(f.instanceSeconds) }}</td><td class="adm-mono">{{ num(f.vcpuSeconds) }}</td><td class="adm-mono">{{ num(f.gibSeconds) }}</td></tr>
              }</tbody></table>
          </div>
          <p class="adm-muted" style="font-size:12px; margin:8px 0 0;">Free tier: {{ num(2000000) }} requests, {{ num(180000) }} vCPU-s and {{ num(360000) }} GiB-s a month. The hourly dispatcher is usually the top row — that is its 24 runs a day, not a leak.</p>
        } @else { <p class="adm-empty">—</p> }
      </section>
    </div>

    <!-- Row 6 — guards (the old AI & spend panel) -->
    <div class="adm-section"><span class="adm-label">Guards</span></div>
    <div class="adm-grid adm-grid-2">
      @for (c of data.ceilings(); track c.kind) {
        <section class="adm-card">
          <div class="adm-card-head">
            <h2 class="adm-h2">{{ label(c.kind) }} @if (c.killed) { <span class="adm-chip danger">OFF</span> } @else { <span class="adm-chip good">on</span> }</h2>
            <span class="adm-muted" style="font-size:12px;">{{ c.date }}</span>
          </div>
          <adm-meter [label]="'today'" [ratio]="c.ratio" [display]="c.used + ' / ' + c.limit" [tone]="c.killed ? 'danger' : c.ratio >= 0.8 ? 'warn' : 'teal'"
            [hint]="c.kind === 'photo' ? 'counts images, not scans · ~' + usd(perUnitCost('photo'), 4) + ' per scan this month' : 'counts calls · ~' + usd(perUnitCost('consultation'), 4) + ' per call this month'" />
          <div class="adm-section">
            <span class="adm-label">Daily ceiling</span>
            <div style="display:flex; gap:8px; align-items:center;">
              <input type="number" class="adm-field" style="width:120px;" [ngModel]="limits()[c.kind] ?? c.limit" (ngModelChange)="setLimit(c.kind, $event)" min="0" />
              <button type="button" class="adm-btn sm" (click)="saveLimit(c)" [disabled]="busy() || (limits()[c.kind] ?? c.limit) === c.limit">Save</button>
              <span class="adm-muted" style="font-size:12px;">≈ {{ usd(c.limit * perUnitCost(c.kind), 2) }}/day at this month's rate</span>
            </div>
          </div>
          <div class="adm-section">
            <span class="adm-label">Kill-switch</span>
            @if (c.killed) {
              <p class="adm-soft" style="font-size:12.5px; margin:0 0 8px;">Reason on file: “{{ c.killedReason || '—' }}”</p>
              <button type="button" class="adm-btn sm" (click)="setKill(c, false)" [disabled]="busy()">Switch {{ label(c.kind) }} back on</button>
            } @else {
              <div style="display:flex; gap:8px; align-items:center;">
                <input class="adm-field grow" [ngModel]="reasons()[c.kind] ?? ''" (ngModelChange)="setReason(c.kind, $event)" placeholder="Reason (required — it goes in the audit log)" />
                <button type="button" class="adm-btn sm danger" (click)="setKill(c, true)" [disabled]="busy() || !(reasons()[c.kind] ?? '').trim()">Switch off</button>
              </div>
            }
          </div>
        </section>
      } @empty { <div class="adm-card"><div class="adm-empty">{{ data.isLoading('ceilings') ? 'Loading…' : 'No ceilings configured.' }}</div></div> }
    </div>
    <p class="adm-muted" style="font-size:12px; margin:12px 0 0;">Per-user quota: 3 photo scans + 3 coach calls a day free, 30 each paid, unlimited for comped and admin. The ceiling is everyone together per UTC day and self-resets; the kill-switch does not. The modelled Gemini cost assumes the paid tier — the free tier's rate limits are not a budget.</p>
  `,
})
export class AdminCostComponent {
  readonly data = inject(AdminDataService);
  readonly shell = inject(AdminShellState);
  private readonly api = inject(AdminService);
  readonly project = PROJECT;
  readonly usd = usd;
  readonly num = num;
  readonly relTime = relTime;

  readonly busy = signal(false);
  readonly limits = signal<Record<string, number>>({});
  readonly reasons = signal<Record<string, string>>({});
  readonly draft = signal<LedgerItem[]>([]);

  readonly model = computed(() => this.data.costModel());
  readonly billing = computed(() => this.data.billing());
  readonly ledger = computed(() => this.data.costLedger());
  readonly dirty = computed(() => JSON.stringify(this.draft()) !== JSON.stringify(this.ledger()));
  readonly fixedMonthly = computed(() => this.ledger().reduce((a, i) => a + (i.cadence === 'monthly' ? i.amountUsd : i.cadence === 'yearly' ? i.amountUsd / 12 : 0), 0));
  readonly perMau = computed(() => {
    const mau = this.data.usage()?.mau ?? 0;
    const m = this.model();
    return mau > 0 && m ? (m.projectedMonth + this.fixedMonthly()) / mau : null;
  });
  readonly aiByDay = computed(() => {
    const d = this.model()?.ai?.byDay ?? {};
    return Object.keys(d).sort().map((k) => Math.round(d[k] * 10000) / 10000);
  });

  constructor() {
    void this.data.loadCeilings();
    void this.data.loadCostModel();
    void this.data.loadBilling();
    void this.data.loadCostLedger().then(() => this.draft.set(structuredClone(this.ledger())));
    if (this.data.usage() === null) void this.data.loadUsage();
  }

  reload(): void {
    void this.data.loadCostModel(true);
    void this.data.loadBilling(true);
    void this.data.loadCeilings(true);
  }

  n(v: string | null | undefined): number { return v == null ? 0 : Number(v); }
  usedPct(l: CostLine): number {
    if (!l.freeAllowance) return l.billableUsage > 0 ? 100 : 0;
    return Math.min(100, Math.round((l.usage / l.freeAllowance) * 100));
  }
  serviceRows(by: Record<string, number>) {
    const tone: Record<string, string> = { 'Gemini API': 'warn', Firestore: 'accent', 'Cloud Run functions': 'teal', 'Secret Manager': 'violet', 'Cloud Scheduler': 'info' };
    return Object.entries(by).filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]).map(([k, v]) => ({ label: `${k} · ${usd(v, 3)}`, value: Math.round(v * 1000) / 1000, tone: tone[k] ?? 'ink-muted' }));
  }
  kindRows(ai: NonNullable<NonNullable<ReturnType<AdminDataService['costModel']>>['ai']>) {
    const labels: Record<string, string> = { photo: 'Photo scans', consultation: 'AI coach', weeklyReport: 'Weekly report' };
    // Price each kind at the month's blended per-token rates, so a kind's cost
    // is its share of the modelled Gemini spend rather than a second estimate.
    const totIn = ai.models.reduce((a, m) => a + m.inputTokens, 0);
    const totOut = ai.models.reduce((a, m) => a + m.outputTokens, 0);
    const inRate = totIn ? ai.models.reduce((a, m) => a + m.inputTokens * (this.knownIn(m.model)), 0) / totIn : 0;
    const outRate = totOut ? ai.models.reduce((a, m) => a + m.outputTokens * (this.knownOut(m.model)), 0) / totOut : 0;
    const price = (k: { promptTokens: number; outputTokens: number; thoughtTokens: number }) =>
      (k.promptTokens * inRate + (k.outputTokens + k.thoughtTokens) * outRate) / 1e6;
    return Object.entries(ai.kinds).map(([kind, k]) => ({ kind, label: labels[kind] ?? kind, calls: k.calls, images: k.images, cost: price(k) }));
  }
  /** Per-1M-token list prices mirrored from functions/src/cost-model.ts PRICES. */
  private static readonly GEMINI: Record<string, [number, number]> = {
    'gemini-3.5-flash-lite': [0.30, 2.50], 'gemini-2.5-flash': [0.30, 2.50], 'gemini-flash-latest': [0.30, 2.50],
    'gemini-2.5-flash-lite': [0.10, 0.40], 'gemini-3-flash-preview': [0.50, 3.00],
  };
  private knownIn(model: string): number { return (AdminCostComponent.GEMINI[model] ?? [0.30, 2.50])[0]; }
  private knownOut(model: string): number { return (AdminCostComponent.GEMINI[model] ?? [0.30, 2.50])[1]; }
  perUnitCost(kind: string): number {
    const ai = this.model()?.ai;
    if (!ai) return 0;
    const row = this.kindRows(ai).find((r) => r.kind === kind);
    return row && row.calls ? row.cost / row.calls : 0;
  }
  igniaServices(rows: BillingRow[]): BillingRow[] { return rows.filter((r) => r['project'] === PROJECT); }

  // ── ledger
  patch(i: number, p: Partial<LedgerItem>): void { this.draft.update((d) => d.map((it, idx) => (idx === i ? { ...it, ...p } : it))); }
  remove(i: number): void { this.draft.update((d) => d.filter((_, idx) => idx !== i)); }
  add(): void { this.draft.update((d) => [...d, { id: `item-${Date.now()}`, label: '', amountUsd: 0, cadence: 'yearly' }]); }
  addDefaults(): void {
    this.draft.set([
      { id: 'apple-dev', label: 'Apple Developer Program', amountUsd: 99, cadence: 'yearly' },
      { id: 'play-dev', label: 'Google Play developer registration', amountUsd: 25, cadence: 'once' },
      { id: 'domain-ignia', label: 'ignia.fit domain', amountUsd: 0, cadence: 'yearly', note: 'fill in the registrar renewal' },
      { id: 'northwest-ra', label: 'Northwest Registered Agent (LLC + bermudezsystems.com)', amountUsd: 0, cadence: 'yearly', note: 'fill in the RA renewal' },
    ]);
  }
  async save(): Promise<void> {
    this.busy.set(true);
    try {
      const items = await this.api.setCostLedger(this.draft().filter((i) => i.label.trim()));
      this.data.costLedger.set(items);
      this.draft.set(structuredClone(items));
      this.shell.toast('Ledger saved', 'ok');
    } catch (err) { this.shell.toast(err instanceof Error ? err.message : String(err), 'error'); }
    finally { this.busy.set(false); }
  }

  // ── guards
  label(kind: string): string { return kind === 'photo' ? 'Photo scan' : kind === 'consultation' ? 'AI coach' : kind; }
  setLimit(kind: string, v: number) { this.limits.update((l) => ({ ...l, [kind]: Number(v) })); }
  setReason(kind: string, v: string) { this.reasons.update((r) => ({ ...r, [kind]: v })); }
  private async run(label: string, op: () => Promise<unknown>) {
    this.busy.set(true);
    try { await op(); await this.data.loadCeilings(true); this.shell.toast(label, 'ok'); }
    catch (err) { this.shell.toast(err instanceof Error ? err.message : String(err), 'error'); }
    finally { this.busy.set(false); }
  }
  saveLimit(c: { kind: string; limit: number }) {
    const limit = this.limits()[c.kind] ?? c.limit;
    return this.run(`${this.label(c.kind)} ceiling → ${limit}`, () => this.api.setSpendCeiling({ kind: c.kind, limit }));
  }
  setKill(c: { kind: string }, killed: boolean) {
    const reason = (this.reasons()[c.kind] ?? '').trim();
    return this.run(`${this.label(c.kind)} switched ${killed ? 'OFF' : 'on'}`, () => this.api.setSpendCeiling({ kind: c.kind, killed, reason }));
  }
}
