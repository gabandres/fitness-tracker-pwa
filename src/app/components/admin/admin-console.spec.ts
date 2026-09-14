import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { vi } from 'vitest';
import { AdminConsole } from './admin-console';
import { AdminService, type AdminUserRow } from '../../services/admin.service';
import { CallableGateway } from '../../services/callable.gateway';
import { AdminShellState } from './admin-shell.state';

/**
 * The admin data path had no spec at all until this file: three modules, one
 * cache, and a partial-failure rule (`loadOverview`) that is invisible until
 * the day a callable is down and the owner is looking at a blank console.
 *
 * Everything here drives AdminConsole against a fake gateway — no Firebase,
 * no callables, no network.
 */

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (err: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

const row = (uid: string, createdAt: string): AdminUserRow => ({
  uid, email: `${uid}@example.com`, displayName: '', emailVerified: true, disabled: false,
  createdAt, lastSignInAt: null, providers: [], admin: false, profileCompleted: true,
  stripeRole: null, preferredLocale: null, platforms: {}, lastActiveDay: null, activeDays90: 0,
});

describe('AdminConsole', () => {
  let call: ReturnType<typeof vi.fn>;
  let replies: Record<string, unknown>;
  let api: Record<string, ReturnType<typeof vi.fn>>;
  let console_: AdminConsole;
  let shell: AdminShellState;

  beforeEach(() => {
    // Nothing in this spec may look like `/admin?preview=1` — that mode
    // short-circuits every load (admin-preview.ts).
    window.history.replaceState({}, '', '/admin');
    localStorage.clear();

    replies = {
      getPlatformStats: { totalUsers: 52 },
      adminGetUsageSeries: { dau: 7, mau: 41 },
      adminGetSpendCeilings: { ceilings: [{ kind: 'photo' }] },
      listUsers: { users: [row('older', '2026-01-01'), row('newer', '2026-09-01')] },
      getRecentActivity: { items: [{ type: 'signup' }] },
      getAuditLogs: { logs: [{ id: 'a1', timestamp: '2026-09-02' }], hasMore: true },
      adminGetCostModel: { monthToDate: 0.93 },
      adminGetBilling: { enabled: false },
      adminSyncAppVersion: { doc: { android: { latestVersionCode: 41 } }, notes: ['ios unchanged'] },
      adminSetCompedEmail: {},
      adminSetSpendCeiling: { ceiling: { kind: 'photo' } },
    };
    call = vi.fn(async (name: string) => replies[name]);

    api = {
      getRetention: vi.fn(async () => ({ activatedTotal: 27 })),
      getRetentionHistory: vi.fn(async () => [{ date: '2026-09-01' }]),
      getHeartbeatAgeMin: vi.fn(async () => 4),
      getStoreVersions: vi.fn(async () => ({ android: { latestVersionCode: 40 } })),
      getFeedback: vi.fn(async () => [{ id: 'f1' }]),
      getCostLedger: vi.fn(async () => [{ id: 'apple-dev' }]),
      refreshAdminStatus: vi.fn(async () => true),
      noteSession: vi.fn(),
    };

    TestBed.configureTestingModule({
      providers: [
        {
          provide: AdminService,
          // AdminService eagerly injects Auth/Firestore/Functions at field-init
          // time; stub it so the spec needs no Firebase.
          useValue: {
            ready: signal(true), isAdmin: signal(true), canBootstrap: signal(false),
            compedEmails: signal<string[]>(['comped@example.com']),
            ...api,
          },
        },
        { provide: CallableGateway, useValue: { call } },
      ],
    });
    console_ = TestBed.inject(AdminConsole);
    shell = TestBed.inject(AdminShellState);
  });

  // ─── cache / dedupe ──────────────────────────────────────────────

  it('fetches once and then serves the cache', async () => {
    await console_.stats.load();
    await console_.stats.load();
    expect(call).toHaveBeenCalledTimes(1);
    expect(console_.stats()).toEqual({ totalUsers: 52 });
  });

  it('re-fetches on refresh, and tells the server it is a forced read', async () => {
    await console_.stats.load();
    await console_.stats.refresh();
    expect(call).toHaveBeenCalledTimes(2);
    expect(call.mock.calls[0][1]).toEqual({ refresh: false });
    expect(call.mock.calls[1][1]).toEqual({ refresh: true });
  });

  it('collapses concurrent loads into the first flight', async () => {
    const d = deferred<unknown>();
    call.mockReturnValueOnce(d.promise);
    const a = console_.stats.load();
    const b = console_.stats.load();
    d.resolve({ totalUsers: 1 });
    await Promise.all([a, b]);
    expect(call).toHaveBeenCalledTimes(1);
  });

  it('does not treat an empty list as loaded', async () => {
    replies['getRecentActivity'] = { items: [] };
    await console_.activity.load();
    await console_.activity.load();
    expect(call).toHaveBeenCalledTimes(2);
  });

  it('sorts users newest-first, as the table expects', async () => {
    await console_.users.load();
    expect(console_.users().map((u) => u.uid)).toEqual(['newer', 'older']);
  });

  it('exposes the same object by key as by name', () => {
    expect(console_.section('users')).toBe(console_.users);
    expect(console_.section('costModel')).toBe(console_.costModel);
  });

  // ─── per-key busy ────────────────────────────────────────────────

  it('holds a busy flag per key, never a global one', async () => {
    const d = deferred<unknown>();
    call.mockReturnValueOnce(d.promise);
    const inFlight = console_.stats.load();

    expect(console_.stats.loading()).toBe(true);
    expect(console_.users.loading()).toBe(false);
    expect(console_.anyLoading()).toBe(true);

    d.resolve({ totalUsers: 3 });
    await inFlight;
    expect(console_.stats.loading()).toBe(false);
    expect(console_.anyLoading()).toBe(false);
  });

  it('re-reads the heartbeat every time — it is the one thing that may not be cached', async () => {
    await console_.heartbeat.load();
    await console_.heartbeat.load();
    expect(api['getHeartbeatAgeMin']).toHaveBeenCalledTimes(2);
    expect(console_.heartbeat()).toBe(4);
  });

  // ─── per-key error ───────────────────────────────────────────────

  it('keeps a failure on its own key and names the key in the banner', async () => {
    call.mockRejectedValueOnce(new Error('permission-denied'));
    await console_.stats.load();

    expect(console_.stats.error()).toBe('permission-denied');
    expect(console_.users.error()).toBe('');
    expect(console_.error()).toBe('stats: permission-denied');
    expect(console_.stats.loading()).toBe(false);
  });

  it('clears a key error once that key succeeds, leaving the banner to be dismissed', async () => {
    call.mockRejectedValueOnce(new Error('boom'));
    await console_.stats.load();
    await console_.stats.refresh();

    expect(console_.stats()).toEqual({ totalUsers: 52 });
    expect(console_.stats.error()).toBe('');
    expect(console_.error()).toBe('stats: boom');
  });

  // ─── partial failure ─────────────────────────────────────────────

  it('lets one dead section fail alone: the rest of the Overview still loads', async () => {
    call.mockImplementation(async (name: string) => {
      if (name === 'getPlatformStats') throw new Error('stats are down');
      return replies[name];
    });

    await console_.loadOverview();

    expect(console_.stats()).toBeNull();
    expect(console_.stats.error()).toBe('stats are down');
    // …and every other Overview card is populated.
    expect(console_.usage()).toEqual({ dau: 7, mau: 41 });
    expect(console_.ceilings()).toEqual([{ kind: 'photo' }]);
    expect(console_.activity()).toEqual([{ type: 'signup' }]);
    expect(console_.feedback()).toEqual([{ id: 'f1' }]);
    expect(console_.storeVersions()).toEqual({ android: { latestVersionCode: 40 } });
    expect(console_.heartbeat()).toBe(4);
    expect(console_.retention()).toEqual({ activatedTotal: 27 });
    expect(console_.retentionHistory()).toEqual([{ date: '2026-09-01' }]);
    expect(console_.lastLoadedAt()).toBeInstanceOf(Date);
    expect(console_.anyLoading()).toBe(false);
  });

  it('survives a section that rejects with a non-Error', async () => {
    call.mockImplementation(async (name: string) => {
      if (name === 'adminGetUsageSeries') throw 'unauthenticated';
      return replies[name];
    });
    await console_.loadOverview();
    expect(console_.usage.error()).toBe('unauthenticated');
    expect(console_.stats()).toEqual({ totalUsers: 52 });
  });

  // ─── the two writes that go through a resource ───────────────────

  it('pages the audit log through the audit resource, appending', async () => {
    await console_.audit.load();
    expect(console_.auditHasMore()).toBe(true);

    replies['getAuditLogs'] = { logs: [{ id: 'a0', timestamp: '2026-08-30' }], hasMore: false };
    await console_.loadMoreAudit();

    expect(console_.audit().map((l) => l.id)).toEqual(['a1', 'a0']);
    expect(console_.auditHasMore()).toBe(false);
    expect(call.mock.calls[1][1]).toEqual({ limit: 100, startAfterTimestamp: '2026-09-02' });
  });

  it('writes the store sync into the storeVersions resource with its notes', async () => {
    await console_.syncStoreVersions();
    expect(console_.storeVersions()).toEqual({ android: { latestVersionCode: 41 } });
    expect(console_.storeSyncNotes()).toEqual(['ios unchanged']);
  });

  // ─── commands ────────────────────────────────────────────────────

  it('holds one busy flag per scope while a command runs, and reports success', async () => {
    const d = deferred<void>();
    const running = console_.run('users', () => d.promise);
    expect(console_.running('users')).toBe(true);
    expect(console_.running('cost')).toBe(false);
    d.resolve();
    await expect(running).resolves.toBe(true);
    expect(console_.running('users')).toBe(false);
  });

  it('turns a failed command into one error toast and a false result', async () => {
    const ok = await console_.run('exports', async () => { throw new Error('export failed'); });
    expect(ok).toBe(false);
    expect(shell.toasts().map((t) => [t.text, t.kind])).toEqual([['export failed', 'error']]);
    expect(console_.running('exports')).toBe(false);
  });

  it('reloads the user list after a write that changes it, and not after one that does not', async () => {
    await console_.users.load();
    call.mockClear();

    await console_.toggleSuspend(row('u1', '2026-01-01'));
    expect(call.mock.calls.map((c) => c[0])).toEqual(['adminSuspendUser', 'listUsers']);

    call.mockClear();
    await console_.resetQuotas(row('u1', '2026-01-01'));
    expect(call.mock.calls.map((c) => c[0])).toEqual(['adminResetQuotas']);
  });

  it('reads comped status off the live config snapshot', () => {
    expect(console_.isComped(row('x', '2026-01-01'))).toBe(false);
    expect(console_.isComped({ ...row('x', '2026-01-01'), email: 'Comped@example.com' })).toBe(true);
  });

  it('refreshes the ceilings before it says the ceiling was saved', async () => {
    await console_.setCeilingLimit('photo', 60);
    expect(call.mock.calls.map((c) => c[0])).toEqual(['adminSetSpendCeiling', 'adminGetSpendCeilings']);
    expect(shell.toasts().map((t) => t.text)).toEqual(['Photo scan ceiling → 60']);
  });
});
