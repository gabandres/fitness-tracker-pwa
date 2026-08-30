import { Injectable, computed, inject, signal } from '@angular/core';
import {
  AdminService,
  type ActivityItem,
  type AdminUserRow,
  type AuditLog,
  type FeedbackRow,
  type PlatformStats,
  type RetentionHistoryRow,
} from '../../services/admin.service';
import { adminPreviewEnabled } from './admin-preview';
import {
  buildInsights,
  type CeilingStatus,
  type Insight,
  type RetentionSummary,
  type UsageSeries,
} from './admin-insights';

/**
 * One cache for everything the admin panel loads, so Overview, Users, the
 * command palette and the user drawer read the same objects and a section
 * switch never re-issues a Cloud Function call it already made. Each loader
 * is idempotent and can be forced; `busy` is per key so one slow export does
 * not grey out the whole console.
 */
@Injectable({ providedIn: 'root' })
export class AdminDataService {
  private readonly api = inject(AdminService);

  readonly stats = signal<PlatformStats | null>(null);
  readonly usage = signal<UsageSeries | null>(null);
  readonly retention = signal<RetentionSummary | null>(null);
  readonly retentionHistory = signal<RetentionHistoryRow[]>([]);
  readonly ceilings = signal<CeilingStatus[]>([]);
  readonly heartbeatAgeMin = signal<number | null>(null);
  readonly users = signal<AdminUserRow[]>([]);
  readonly activity = signal<ActivityItem[]>([]);
  readonly audit = signal<AuditLog[]>([]);
  readonly feedback = signal<FeedbackRow[]>([]);

  private readonly loading = signal<Record<string, boolean>>({});
  readonly error = signal<string>('');
  readonly lastLoadedAt = signal<Date | null>(null);

  isLoading(key: string): boolean { return this.loading()[key] === true; }
  readonly anyLoading = computed(() => Object.values(this.loading()).some(Boolean));

  // ── Feedback "seen" marks are per-browser: the collection is append-only and
  //    the panel has no write path to it (by design — see admin.service).
  private static readonly SEEN_KEY = 'ignia.admin.feedbackSeen';
  readonly seenFeedback = signal<Set<string>>(AdminDataService.readSeen());
  readonly unreadFeedback = computed(() => this.feedback().filter((f) => !this.seenFeedback().has(f.id)).length);

  readonly insights = computed<Insight[]>(() => buildInsights({
    stats: this.stats(),
    usage: this.usage(),
    retention: this.retention(),
    ceilings: this.ceilings(),
    heartbeatAgeMin: this.heartbeatAgeMin(),
    unreadFeedback: this.unreadFeedback(),
  }));

  private static readSeen(): Set<string> {
    try {
      const raw = localStorage.getItem(AdminDataService.SEEN_KEY);
      return new Set(raw ? (JSON.parse(raw) as string[]) : []);
    } catch { return new Set(); }
  }

  markFeedbackSeen(ids: readonly string[]): void {
    const next = new Set(this.seenFeedback());
    for (const id of ids) next.add(id);
    this.seenFeedback.set(next);
    try { localStorage.setItem(AdminDataService.SEEN_KEY, JSON.stringify([...next])); } catch { /* private mode */ }
  }

  /** Everything the Overview needs, in parallel, each failure isolated. */
  async loadOverview(force = false): Promise<void> {
    await Promise.allSettled([
      this.loadStats(force),
      this.loadUsage(force),
      this.loadRetention(force),
      this.loadCeilings(force),
      this.loadHeartbeat(),
      this.loadFeedback(force),
      this.loadActivity(force),
    ]);
    this.lastLoadedAt.set(new Date());
  }

  loadStats(force = false) { return this.guard('stats', force, this.stats, () => this.api.getPlatformStats(force)); }
  loadUsage(force = false) { return this.guard('usage', force, this.usage, () => this.api.getUsageSeries(30, force)); }
  loadCeilings(force = false) { return this.guard('ceilings', force, this.ceilings, () => this.api.getSpendCeilings(), []); }
  loadActivity(force = false) { return this.guard('activity', force, this.activity, async () => (await this.api.getRecentActivity()).items, []); }
  loadFeedback(force = false) { return this.guard('feedback', force, this.feedback, () => this.api.getFeedback(), []); }
  loadAudit(force = false) { return this.guard('audit', force, this.audit, async () => (await this.api.getAuditLogs({ limit: 200 })).logs, []); }
  loadUsers(force = false) {
    return this.guard('users', force, this.users, async () => {
      const { users } = await this.api.listUsers();
      return users.sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
    }, []);
  }
  async loadRetention(force = false): Promise<void> {
    await this.guard('retention', force, this.retention, () => this.api.getRetention());
    await this.guard('retentionHistory', force, this.retentionHistory, () => this.api.getRetentionHistory(), []);
  }
  async loadHeartbeat(): Promise<void> {
    if (adminPreviewEnabled()) return;
    this.heartbeatAgeMin.set(await this.api.getHeartbeatAgeMin());
  }

  /** Run `op`, store into `target`, skip when already loaded unless forced.
   *  `emptyValue` is what "not loaded yet" looks like for list signals. */
  private async guard<T>(key: string, force: boolean, target: { set(v: T): void; (): T }, op: () => Promise<T>, emptyValue?: T): Promise<void> {
    if (adminPreviewEnabled()) return; // fixtures only — see admin-preview.ts
    const current = target();
    const loaded = emptyValue === undefined ? current !== null : (Array.isArray(current) && current.length > 0);
    if (loaded && !force) return;
    if (this.loading()[key]) return;
    this.loading.update((l) => ({ ...l, [key]: true }));
    try {
      target.set(await op());
    } catch (err) {
      this.error.set(`${key}: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      this.loading.update((l) => ({ ...l, [key]: false }));
    }
  }
}
