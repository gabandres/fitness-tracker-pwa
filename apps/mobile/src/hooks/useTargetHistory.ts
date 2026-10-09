import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  type DailyTargetRecord,
  type DailyTargets,
  type Profile,
  addDays,
  owesNotice,
  parseYmd,
  calendarDateKey,
  planTargetRecord,
  targetSnapshot,
} from '@macrolog/core';
import { useAuth } from '@/lib/auth';
import { ackTargetNotice, subscribeDailyTargets, writeDailyTargetRecord } from '@/lib/ledger';
import { captureError } from '@/lib/sentry';
import { feedChannel, useLedgerFeed } from '@/hooks/useLedgerFeed';

/** Records read: enough to find the last stored day across a long gap. */
const RECORDS_WINDOW = 60;
/** How far back an unacknowledged automatic change is still shown. A change
 *  recorded at 11 pm must not vanish because the next morning's record (same
 *  values) has no change of its own. */
const NOTICE_DAYS = 7;

/**
 * The per-day target record (`packages/core/src/target-history.ts`), from
 * Today: writes today's record when the targets in effect differ from the
 * stored one, and hands Today the newest automatic change the user has not
 * dismissed — old value, new value, reason. No silent changes (owner,
 * 2026-10-08).
 *
 * Its own focus-gated listener, per ADR-0016; the targets themselves come from
 * `useToday`, which already holds the logs, weights and profile. A record is
 * written ONLY when `authoritative` (every input answered from the server)
 * and the records themselves have answered from the server — a cache-only
 * input would record, and announce, a change that never happened.
 */
export function useTargetHistory(input: {
  todayKey: string;
  targets: DailyTargets;
  profile: Profile | null;
  authoritative: boolean;
}): { notice: DailyTargetRecord | null; ack: (date: string) => void } {
  const { todayKey, targets, profile, authoritative } = input;
  const { user } = useAuth();
  const uid = user?.uid;
  const [records, setRecords] = useState<DailyTargetRecord[]>([]);
  const [recordsServer, setRecordsServer] = useState(false);
  useEffect(() => {
    setRecords([]);
    setRecordsServer(false);
  }, [uid]);

  useLedgerFeed({
    uid,
    label: 'TargetHistory',
    gate: 'focus',
    channels: () =>
      uid
        ? [
            feedChannel<DailyTargetRecord[], 'records'>({
              key: 'records',
              settles: 'server',
              // A failed listener leaves the notice unshown and nothing
              // written; Today's own error line belongs to its logs channel.
              open: (deliver) => subscribeDailyTargets(uid, RECORDS_WINDOW, deliver),
              apply: (v, p) => {
                setRecords(v);
                if (p.authoritative) setRecordsServer(true);
              },
            }),
          ]
        : [],
    deps: [uid],
  });

  const plan = useMemo(
    () =>
      authoritative && recordsServer
        ? planTargetRecord(todayKey, targetSnapshot(targets, profile), records)
        : null,
    [authoritative, recordsServer, todayKey, targets, profile, records],
  );

  // One write per distinct plan. The listener answers with the stored record,
  // after which the plan is null — so this cannot loop; the ref only stops a
  // re-render from sending the same write twice while it is in flight.
  const lastWrite = useRef('');
  useEffect(() => {
    if (!uid || !plan) return;
    const sig = JSON.stringify(plan);
    if (sig === lastWrite.current) return;
    lastWrite.current = sig;
    const existing = records.find((r) => r.date === plan.date) ?? null;
    writeDailyTargetRecord(uid, plan, existing).catch((e) => {
      lastWrite.current = '';
      captureError(e, { where: 'targetHistory.write' });
    });
  }, [uid, plan, records]);

  const notice = useMemo(() => {
    const oldest = calendarDateKey(addDays(parseYmd(todayKey), -NOTICE_DAYS));
    return records
      .filter((r) => r.date <= todayKey && r.date >= oldest && owesNotice(r))
      .sort((a, b) => (a.date < b.date ? 1 : -1))[0] ?? null;
  }, [records, todayKey]);

  const ack = useCallback(
    (date: string) => {
      if (!uid) return;
      ackTargetNotice(uid, date).catch((e) => captureError(e, { where: 'targetHistory.ack' }));
    },
    [uid],
  );

  return { notice, ack };
}
