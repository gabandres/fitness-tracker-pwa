import { onCall, HttpsError } from "firebase-functions/v2/https";
import { getFirestore, Timestamp } from "firebase-admin/firestore";
import { GoogleAuth } from "google-auth-library";
import { requireAdmin } from "./admin-guard";
import { writeAuditLog } from "./audit-log";

/**
 * The admin console's Cost page, server side.
 *
 * Two layers, because Google Cloud has no "what did this cost" API:
 *
 *  1. `adminGetCostModel` — a MODELLED month-to-date: live usage read from
 *     Cloud Monitoring (Firestore ops, Cloud Run request time), the Secret
 *     Manager / Cloud Scheduler APIs (billable counts), and the `aiUsage`
 *     ledger (Gemini tokens), priced at LIST prices minus the free tiers.
 *     Every line names its usage, its free allowance and its unit price so
 *     the arithmetic can be checked; `PRICES.asOf` is the date the table was
 *     last read off the Cloud Billing Catalog API and the pricing pages.
 *
 *  2. `adminGetBilling` — the ACTUAL bill, from the Cloud Billing → BigQuery
 *     standard usage-cost export. Covers every project on the billing account
 *     (four — CLAUDE.md), which is the only way to see whether a charge is
 *     Ignia's at all. Until the owner enables the export in the console this
 *     returns `{ enabled: false }` and the page shows the setup steps.
 *
 * Neither adds a scheduled job or a secret. Reads use the function's own
 * service account through `google-auth-library` (a firebase-admin dependency).
 */

const PROJECT = process.env.GCLOUD_PROJECT || "fitness-tracker-gb-1775407101";
const REGION = "us-central1";
const BILLING_DATASET = "billing";

// ─── List prices ───────────────────────────────────────────────────
// Sources: Cloud Billing Catalog API (services/152E-C115-5142 Cloud Run,
// EE82-7A5E-871C Secret Manager, 1F14-4801-0E16 Cloud Scheduler, AEFD-7695-64FA
// Gemini API) read 2026-08-30, plus cloud.google.com/firestore/pricing for the
// nam5 multi-region this database lives in. Update `asOf` when re-read.
export const PRICES = {
  asOf: "2026-08-30",
  firestore: {
    location: "nam5 (multi-region US)",
    readPer100k: 0.06,
    writePer100k: 0.18,
    deletePer100k: 0.02,
    freeReadsPerDay: 50_000,
    freeWritesPerDay: 20_000,
    freeDeletesPerDay: 20_000,
  },
  cloudRun: {
    // Request-based billing, Tier 1 (us-central1).
    perMillionRequests: 0.40,
    perVcpuSecond: 0.000024,
    perGibSecond: 0.0000025,
    freeRequestsPerMonth: 2_000_000,
    freeVcpuSecondsPerMonth: 180_000,
    freeGibSecondsPerMonth: 360_000,
  },
  secretManager: { perActiveVersionPerMonth: 0.06, freeVersions: 6 },
  cloudScheduler: { perJobPerMonth: 0.10, freeJobs: 3 },
  /** Gemini API, standard tier, per 1M tokens. Thinking tokens bill as output. */
  gemini: {
    models: {
      "gemini-3.5-flash-lite": { inputPerM: 0.30, outputPerM: 2.50 },
      "gemini-2.5-flash": { inputPerM: 0.30, outputPerM: 2.50 },
      "gemini-flash-latest": { inputPerM: 0.30, outputPerM: 2.50 },
      "gemini-2.5-flash-lite": { inputPerM: 0.10, outputPerM: 0.40 },
      "gemini-3-flash-preview": { inputPerM: 0.50, outputPerM: 3.00 },
    } as Record<string, { inputPerM: number; outputPerM: number }>,
    fallback: { inputPerM: 0.30, outputPerM: 2.50 },
  },
} as const;

export interface CostLine {
  service: string;
  sku: string;
  usage: number;
  unit: string;
  freeAllowance: number;
  billableUsage: number;
  unitPrice: number;
  perUnit: string;
  cost: number;
  note?: string;
}

const auth = new GoogleAuth({ scopes: ["https://www.googleapis.com/auth/cloud-platform"] });

async function gapi<T>(url: string, init?: RequestInit): Promise<T> {
  const client = await auth.getClient();
  const token = await client.getAccessToken();
  const res = await fetch(url, {
    ...init,
    headers: { ...(init?.headers as Record<string, string> | undefined), Authorization: `Bearer ${token.token}`, "Content-Type": "application/json" },
  });
  const body = (await res.json()) as T & { error?: { message?: string } };
  if (!res.ok) throw new Error(`${url.split("?")[0]} → ${res.status}: ${body.error?.message ?? "unknown"}`);
  return body;
}

// ─── Cloud Monitoring ──────────────────────────────────────────────

interface TimeSeries {
  metric: { labels?: Record<string, string> };
  resource: { labels?: Record<string, string> };
  points: Array<{ interval: { endTime: string }; value: { int64Value?: string; doubleValue?: number } }>;
}

/** Sum of a DELTA metric over [start, end], aligned to whole days, grouped by
 *  the given label. Returns { total, byDay, byGroup }. */
async function sumMetric(
  metricType: string,
  start: Date,
  end: Date,
  groupBy: string[] = [],
  extraFilter = "",
): Promise<{ total: number; byDay: Record<string, number>; byGroup: Record<string, number> }> {
  const params = new URLSearchParams({
    filter: `metric.type="${metricType}"${extraFilter}`,
    "interval.startTime": start.toISOString(),
    "interval.endTime": end.toISOString(),
    "aggregation.alignmentPeriod": "86400s",
    "aggregation.perSeriesAligner": "ALIGN_SUM",
    "aggregation.crossSeriesReducer": "REDUCE_SUM",
    view: "FULL",
  });
  for (const g of groupBy) params.append("aggregation.groupByFields", g);
  const url = `https://monitoring.googleapis.com/v3/projects/${PROJECT}/timeSeries?${params.toString()}`;
  const byDay: Record<string, number> = {};
  const byGroup: Record<string, number> = {};
  let total = 0;
  let pageToken: string | undefined;
  do {
    const page = await gapi<{ timeSeries?: TimeSeries[]; nextPageToken?: string }>(url + (pageToken ? `&pageToken=${pageToken}` : ""));
    for (const ts of page.timeSeries ?? []) {
      const key = groupBy.map((g) => {
        const name = g.split(".").pop() as string;
        return ts.resource.labels?.[name] ?? ts.metric.labels?.[name] ?? "";
      }).join("/");
      for (const p of ts.points) {
        const v = p.value.int64Value !== undefined ? Number(p.value.int64Value) : (p.value.doubleValue ?? 0);
        total += v;
        const day = p.interval.endTime.slice(0, 10);
        byDay[day] = (byDay[day] ?? 0) + v;
        if (groupBy.length) byGroup[key] = (byGroup[key] ?? 0) + v;
      }
    }
    pageToken = page.nextPageToken;
  } while (pageToken);
  return { total, byDay, byGroup };
}

// ─── Cloud Run services (to price instance time by their CPU/memory) ───

interface RunService {
  name: string;
  template?: { containers?: Array<{ resources?: { limits?: Record<string, string> } }> };
}

function parseCpu(v: string | undefined): number {
  if (!v) return 1;
  return v.endsWith("m") ? Number(v.slice(0, -1)) / 1000 : Number(v);
}
function parseGib(v: string | undefined): number {
  if (!v) return 0.25;
  const n = Number(v.replace(/[^\d.]/g, ""));
  if (/Gi/.test(v)) return n;
  if (/Mi/.test(v)) return n / 1024;
  return n / 1024 ** 3;
}

async function runServices(): Promise<Record<string, { cpu: number; gib: number }>> {
  const out: Record<string, { cpu: number; gib: number }> = {};
  let pageToken: string | undefined;
  do {
    const page = await gapi<{ services?: RunService[]; nextPageToken?: string }>(
      `https://run.googleapis.com/v2/projects/${PROJECT}/locations/${REGION}/services?pageSize=200${pageToken ? `&pageToken=${pageToken}` : ""}`,
    );
    for (const s of page.services ?? []) {
      const limits = s.template?.containers?.[0]?.resources?.limits ?? {};
      out[s.name.split("/").pop() as string] = { cpu: parseCpu(limits["cpu"]), gib: parseGib(limits["memory"]) };
    }
    pageToken = page.nextPageToken;
  } while (pageToken);
  return out;
}

// ─── Secret Manager / Scheduler counts ─────────────────────────────

async function activeSecretVersions(): Promise<{ secrets: number; versions: number }> {
  const list = await gapi<{ secrets?: Array<{ name: string }> }>(`https://secretmanager.googleapis.com/v1/projects/${PROJECT}/secrets?pageSize=200`);
  let versions = 0;
  for (const s of list.secrets ?? []) {
    const v = await gapi<{ versions?: Array<{ state: string }> }>(`https://secretmanager.googleapis.com/v1/${s.name}/versions?pageSize=100&filter=state:ENABLED`);
    versions += (v.versions ?? []).filter((x) => x.state === "ENABLED").length;
  }
  return { secrets: (list.secrets ?? []).length, versions };
}

async function schedulerJobs(): Promise<number> {
  const r = await gapi<{ jobs?: unknown[] }>(`https://cloudscheduler.googleapis.com/v1/projects/${PROJECT}/locations/${REGION}/jobs?pageSize=100`);
  return (r.jobs ?? []).length;
}

// ─── Gemini ledger ─────────────────────────────────────────────────

interface AiKindTotals { calls: number; promptTokens: number; outputTokens: number; thoughtTokens: number; images: number; }
interface AiModelTotals { id: string; calls: number; promptTokens: number; outputTokens: number; thoughtTokens: number; }

async function aiUsageBetween(from: string, to: string): Promise<{
  kinds: Record<string, AiKindTotals>;
  models: Record<string, AiModelTotals>;
  byDayCost: Record<string, number>;
}> {
  const db = getFirestore();
  const snap = await db.collection("aiUsage").where("day", ">=", from).where("day", "<=", to).get();
  const kinds: Record<string, AiKindTotals> = {};
  const models: Record<string, AiModelTotals> = {};
  const byDayCost: Record<string, number> = {};
  for (const d of snap.docs) {
    const data = d.data();
    for (const [k, v] of Object.entries((data["kinds"] ?? {}) as Record<string, Partial<AiKindTotals>>)) {
      const t = kinds[k] ?? (kinds[k] = { calls: 0, promptTokens: 0, outputTokens: 0, thoughtTokens: 0, images: 0 });
      t.calls += v.calls ?? 0; t.promptTokens += v.promptTokens ?? 0; t.outputTokens += v.outputTokens ?? 0;
      t.thoughtTokens += v.thoughtTokens ?? 0; t.images += v.images ?? 0;
    }
    let dayCost = 0;
    for (const [k, v] of Object.entries((data["models"] ?? {}) as Record<string, Partial<AiModelTotals>>)) {
      const id = v.id ?? k;
      const t = models[id] ?? (models[id] = { id, calls: 0, promptTokens: 0, outputTokens: 0, thoughtTokens: 0 });
      t.calls += v.calls ?? 0; t.promptTokens += v.promptTokens ?? 0; t.outputTokens += v.outputTokens ?? 0; t.thoughtTokens += v.thoughtTokens ?? 0;
      dayCost += geminiCost(id, v.promptTokens ?? 0, (v.outputTokens ?? 0) + (v.thoughtTokens ?? 0));
    }
    byDayCost[data["day"] as string] = dayCost;
  }
  return { kinds, models, byDayCost };
}

export function geminiPrice(model: string): { inputPerM: number; outputPerM: number; known: boolean } {
  const p = PRICES.gemini.models[model];
  return p ? { ...p, known: true } : { ...PRICES.gemini.fallback, known: false };
}
export function geminiCost(model: string, inputTokens: number, outputTokens: number): number {
  const p = geminiPrice(model);
  return (inputTokens / 1e6) * p.inputPerM + (outputTokens / 1e6) * p.outputPerM;
}

// ─── The model ─────────────────────────────────────────────────────

function monthBounds(now = new Date()): { start: Date; end: Date; from: string; to: string; daysElapsed: number; daysInMonth: number } {
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const daysInMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0)).getUTCDate();
  const daysElapsed = now.getUTCDate();
  return { start, end: now, from: start.toISOString().slice(0, 10), to: now.toISOString().slice(0, 10), daysElapsed, daysInMonth };
}

export const adminGetCostModel = onCall({ timeoutSeconds: 120, memory: "512MiB" }, async (request) => {
  requireAdmin(request);
  const now = new Date();
  const m = monthBounds(now);
  const lines: CostLine[] = [];
  const warnings: string[] = [];

  // Firestore — per-day free quota, so billable = Σ max(0, day − free).
  const [reads, writes, deletes] = await Promise.all([
    sumMetric("firestore.googleapis.com/document/read_count", m.start, m.end).catch((e) => { warnings.push(`firestore reads: ${e.message}`); return null; }),
    sumMetric("firestore.googleapis.com/document/write_count", m.start, m.end).catch((e) => { warnings.push(`firestore writes: ${e.message}`); return null; }),
    sumMetric("firestore.googleapis.com/document/delete_count", m.start, m.end).catch((e) => { warnings.push(`firestore deletes: ${e.message}`); return null; }),
  ]);
  const overFree = (byDay: Record<string, number>, free: number) => Object.values(byDay).reduce((a, v) => a + Math.max(0, v - free), 0);
  const fs = PRICES.firestore;
  if (reads) lines.push({ service: "Firestore", sku: "Document reads", usage: reads.total, unit: "reads", freeAllowance: fs.freeReadsPerDay * m.daysElapsed, billableUsage: overFree(reads.byDay, fs.freeReadsPerDay), unitPrice: fs.readPer100k, perUnit: "100k", cost: overFree(reads.byDay, fs.freeReadsPerDay) / 1e5 * fs.readPer100k, note: `free ${fs.freeReadsPerDay.toLocaleString()}/day` });
  if (writes) lines.push({ service: "Firestore", sku: "Document writes", usage: writes.total, unit: "writes", freeAllowance: fs.freeWritesPerDay * m.daysElapsed, billableUsage: overFree(writes.byDay, fs.freeWritesPerDay), unitPrice: fs.writePer100k, perUnit: "100k", cost: overFree(writes.byDay, fs.freeWritesPerDay) / 1e5 * fs.writePer100k, note: `free ${fs.freeWritesPerDay.toLocaleString()}/day` });
  if (deletes) lines.push({ service: "Firestore", sku: "Document deletes", usage: deletes.total, unit: "deletes", freeAllowance: fs.freeDeletesPerDay * m.daysElapsed, billableUsage: overFree(deletes.byDay, fs.freeDeletesPerDay), unitPrice: fs.deletePer100k, perUnit: "100k", cost: overFree(deletes.byDay, fs.freeDeletesPerDay) / 1e5 * fs.deletePer100k, note: `free ${fs.freeDeletesPerDay.toLocaleString()}/day` });

  // Cloud Run (every gen2 function is a Cloud Run service).
  const cr = PRICES.cloudRun;
  const [requests, instanceTime, services] = await Promise.all([
    sumMetric("run.googleapis.com/request_count", m.start, m.end, ["resource.service_name"]).catch((e) => { warnings.push(`cloud run requests: ${e.message}`); return null; }),
    sumMetric("run.googleapis.com/container/billable_instance_time", m.start, m.end, ["resource.service_name"]).catch((e) => { warnings.push(`cloud run instance time: ${e.message}`); return null; }),
    runServices().catch((e) => { warnings.push(`cloud run services: ${e.message}`); return {} as Record<string, { cpu: number; gib: number }>; }),
  ]);
  let vcpuSeconds = 0;
  let gibSeconds = 0;
  const perFunction: Array<{ name: string; requests: number; instanceSeconds: number; vcpuSeconds: number; gibSeconds: number }> = [];
  if (instanceTime) {
    for (const [name, secs] of Object.entries(instanceTime.byGroup)) {
      const cfg = services[name] ?? { cpu: 1, gib: 0.25 };
      const v = secs * cfg.cpu;
      const g = secs * cfg.gib;
      vcpuSeconds += v; gibSeconds += g;
      perFunction.push({ name, requests: requests?.byGroup[name] ?? 0, instanceSeconds: secs, vcpuSeconds: v, gibSeconds: g });
    }
    perFunction.sort((a, b) => b.instanceSeconds - a.instanceSeconds);
  }
  if (requests) lines.push({ service: "Cloud Run functions", sku: "Requests", usage: requests.total, unit: "requests", freeAllowance: cr.freeRequestsPerMonth, billableUsage: Math.max(0, requests.total - cr.freeRequestsPerMonth), unitPrice: cr.perMillionRequests, perUnit: "1M", cost: Math.max(0, requests.total - cr.freeRequestsPerMonth) / 1e6 * cr.perMillionRequests });
  if (instanceTime) {
    lines.push({ service: "Cloud Run functions", sku: "CPU time", usage: vcpuSeconds, unit: "vCPU-s", freeAllowance: cr.freeVcpuSecondsPerMonth, billableUsage: Math.max(0, vcpuSeconds - cr.freeVcpuSecondsPerMonth), unitPrice: cr.perVcpuSecond, perUnit: "vCPU-s", cost: Math.max(0, vcpuSeconds - cr.freeVcpuSecondsPerMonth) * cr.perVcpuSecond });
    lines.push({ service: "Cloud Run functions", sku: "Memory time", usage: gibSeconds, unit: "GiB-s", freeAllowance: cr.freeGibSecondsPerMonth, billableUsage: Math.max(0, gibSeconds - cr.freeGibSecondsPerMonth), unitPrice: cr.perGibSecond, perUnit: "GiB-s", cost: Math.max(0, gibSeconds - cr.freeGibSecondsPerMonth) * cr.perGibSecond });
  }

  // Secret Manager + Scheduler — the two lines CLAUDE.md says actually bill.
  const [secrets, jobs] = await Promise.all([
    activeSecretVersions().catch((e) => { warnings.push(`secret manager: ${e.message}`); return null; }),
    schedulerJobs().catch((e) => { warnings.push(`cloud scheduler: ${e.message}`); return null; }),
  ]);
  if (secrets) lines.push({ service: "Secret Manager", sku: "Active secret versions", usage: secrets.versions, unit: "versions", freeAllowance: PRICES.secretManager.freeVersions, billableUsage: Math.max(0, secrets.versions - PRICES.secretManager.freeVersions), unitPrice: PRICES.secretManager.perActiveVersionPerMonth, perUnit: "version·month", cost: Math.max(0, secrets.versions - PRICES.secretManager.freeVersions) * PRICES.secretManager.perActiveVersionPerMonth, note: "free tier is per BILLING ACCOUNT — the other three projects share it" });
  if (jobs !== null) lines.push({ service: "Cloud Scheduler", sku: "Jobs", usage: jobs, unit: "jobs", freeAllowance: PRICES.cloudScheduler.freeJobs, billableUsage: Math.max(0, jobs - PRICES.cloudScheduler.freeJobs), unitPrice: PRICES.cloudScheduler.perJobPerMonth, perUnit: "job·month", cost: Math.max(0, jobs - PRICES.cloudScheduler.freeJobs) * PRICES.cloudScheduler.perJobPerMonth, note: "free tier is per billing account" });

  // Gemini — from the aiUsage ledger. No free tier is assumed: the project is
  // on the paid tier, and the free tier's rate limits are not a budget.
  const ai = await aiUsageBetween(m.from, m.to).catch((e) => { warnings.push(`aiUsage: ${e.message}`); return null; });
  const aiModels: Array<{ model: string; calls: number; inputTokens: number; outputTokens: number; cost: number; priceKnown: boolean }> = [];
  if (ai) {
    for (const t of Object.values(ai.models)) {
      const out = t.outputTokens + t.thoughtTokens;
      const p = geminiPrice(t.id);
      const cost = geminiCost(t.id, t.promptTokens, out);
      aiModels.push({ model: t.id, calls: t.calls, inputTokens: t.promptTokens, outputTokens: out, cost, priceKnown: p.known });
      lines.push({ service: "Gemini API", sku: `${t.id} input`, usage: t.promptTokens, unit: "tokens", freeAllowance: 0, billableUsage: t.promptTokens, unitPrice: p.inputPerM, perUnit: "1M", cost: (t.promptTokens / 1e6) * p.inputPerM, note: p.known ? undefined : "price assumed — model not in table" });
      lines.push({ service: "Gemini API", sku: `${t.id} output (incl. thinking)`, usage: out, unit: "tokens", freeAllowance: 0, billableUsage: out, unitPrice: p.outputPerM, perUnit: "1M", cost: (out / 1e6) * p.outputPerM });
    }
  }

  const monthToDate = lines.reduce((a, l) => a + l.cost, 0);
  const byService: Record<string, number> = {};
  for (const l of lines) byService[l.service] = (byService[l.service] ?? 0) + l.cost;
  const aiByDay = ai?.byDayCost ?? {};

  return {
    computedAt: now.toISOString(),
    pricesAsOf: PRICES.asOf,
    month: m.from.slice(0, 7),
    daysElapsed: m.daysElapsed,
    daysInMonth: m.daysInMonth,
    monthToDate,
    projectedMonth: m.daysElapsed > 0 ? (monthToDate / m.daysElapsed) * m.daysInMonth : 0,
    byService,
    lines,
    perFunction: perFunction.slice(0, 40),
    ai: ai ? { kinds: ai.kinds, models: aiModels, byDay: aiByDay } : null,
    firestoreByDay: { reads: reads?.byDay ?? {}, writes: writes?.byDay ?? {}, deletes: deletes?.byDay ?? {} },
    warnings,
  };
});

// ─── The actual bill (BigQuery billing export) ─────────────────────

interface BqRow { f: Array<{ v: string | null }> }

async function bqQuery(sql: string): Promise<Array<Record<string, string | null>>> {
  const res = await gapi<{ schema?: { fields: Array<{ name: string }> }; rows?: BqRow[]; jobComplete?: boolean; errors?: unknown[] }>(
    `https://bigquery.googleapis.com/bigquery/v2/projects/${PROJECT}/queries`,
    { method: "POST", body: JSON.stringify({ query: sql, useLegacySql: false, timeoutMs: 60_000, maxResults: 2000 }) },
  );
  if (!res.jobComplete) throw new Error("BigQuery query did not complete in 60 s");
  const names = (res.schema?.fields ?? []).map((f) => f.name);
  return (res.rows ?? []).map((r) => Object.fromEntries(r.f.map((c, i) => [names[i], c.v])));
}

export const adminGetBilling = onCall({ timeoutSeconds: 120 }, async (request) => {
  requireAdmin(request);
  let tables: Array<{ tableReference: { tableId: string } }>;
  try {
    const list = await gapi<{ tables?: Array<{ tableReference: { tableId: string } }> }>(
      `https://bigquery.googleapis.com/bigquery/v2/projects/${PROJECT}/datasets/${BILLING_DATASET}/tables?maxResults=50`,
    );
    tables = list.tables ?? [];
  } catch (err) {
    return { enabled: false, reason: `dataset ${PROJECT}.${BILLING_DATASET} unreadable: ${err instanceof Error ? err.message : String(err)}` };
  }
  const table = tables.map((t) => t.tableReference.tableId).find((id) => id.startsWith("gcp_billing_export_v1_"));
  if (!table) return { enabled: false, reason: "no gcp_billing_export_v1_* table in the dataset yet — enable the standard export in Billing → Billing export, or wait for the first load" };

  const fq = `\`${PROJECT}.${BILLING_DATASET}.${table}\``;
  const [byMonth, byProjectService, bySku, lifetime] = await Promise.all([
    bqQuery(`SELECT invoice.month AS month, project.id AS project, ROUND(SUM(cost) + SUM(IFNULL((SELECT SUM(c.amount) FROM UNNEST(credits) c), 0)), 4) AS net, ROUND(SUM(cost), 4) AS gross
             FROM ${fq} GROUP BY 1, 2 ORDER BY 1 DESC, 2 LIMIT 200`),
    bqQuery(`SELECT invoice.month AS month, project.id AS project, service.description AS service, ROUND(SUM(cost) + SUM(IFNULL((SELECT SUM(c.amount) FROM UNNEST(credits) c), 0)), 4) AS net
             FROM ${fq} WHERE invoice.month >= FORMAT_DATE('%Y%m', DATE_SUB(CURRENT_DATE(), INTERVAL 3 MONTH)) GROUP BY 1, 2, 3 HAVING ABS(net) > 0.00005 ORDER BY 1 DESC, 4 DESC LIMIT 400`),
    bqQuery(`SELECT invoice.month AS month, service.description AS service, sku.description AS sku, ROUND(SUM(usage.amount), 4) AS usage, ANY_VALUE(usage.unit) AS unit, ROUND(SUM(cost), 4) AS gross, ROUND(SUM(cost) + SUM(IFNULL((SELECT SUM(c.amount) FROM UNNEST(credits) c), 0)), 4) AS net
             FROM ${fq} WHERE project.id = '${PROJECT}' AND invoice.month >= FORMAT_DATE('%Y%m', DATE_SUB(CURRENT_DATE(), INTERVAL 2 MONTH)) GROUP BY 1, 2, 3 HAVING gross > 0 ORDER BY 1 DESC, 6 DESC LIMIT 300`),
    bqQuery(`SELECT project.id AS project, ROUND(SUM(cost) + SUM(IFNULL((SELECT SUM(c.amount) FROM UNNEST(credits) c), 0)), 4) AS net, MIN(usage_start_time) AS since FROM ${fq} GROUP BY 1 ORDER BY 2 DESC`),
  ]);
  return { enabled: true, table, byMonth, byProjectService, bySku, lifetime, queriedAt: new Date().toISOString() };
});

// ─── Fixed-cost ledger ─────────────────────────────────────────────

export interface LedgerItem { id: string; label: string; amountUsd: number; cadence: "monthly" | "yearly" | "once"; note?: string; }

export const adminSetCostLedger = onCall(async (request) => {
  const admin = requireAdmin(request);
  const { items } = (request.data || {}) as { items?: LedgerItem[] };
  if (!Array.isArray(items) || items.length > 60) throw new HttpsError("invalid-argument", "items must be an array of at most 60 entries.");
  const clean: LedgerItem[] = items.map((i) => {
    if (typeof i.label !== "string" || !i.label.trim() || typeof i.amountUsd !== "number" || !Number.isFinite(i.amountUsd) || i.amountUsd < 0) {
      throw new HttpsError("invalid-argument", "each item needs a label and a non-negative amountUsd.");
    }
    if (!["monthly", "yearly", "once"].includes(i.cadence)) throw new HttpsError("invalid-argument", "cadence must be monthly, yearly or once.");
    return { id: String(i.id || i.label).slice(0, 60), label: i.label.trim().slice(0, 120), amountUsd: Math.round(i.amountUsd * 100) / 100, cadence: i.cadence, note: typeof i.note === "string" ? i.note.slice(0, 300) : undefined };
  });
  await getFirestore().doc("config/costLedger").set({ items: clean, updatedAt: Timestamp.now(), updatedBy: admin.email });
  await writeAuditLog({ action: "cost_ledger_set", admin, details: { items: clean.length } });
  return { items: clean };
});
