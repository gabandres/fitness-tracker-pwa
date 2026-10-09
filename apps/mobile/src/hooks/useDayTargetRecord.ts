import { useEffect, useState } from 'react';
import type { DailyTargetRecord } from '@macrolog/core';
import { useAuth } from '@/lib/auth';
import { subscribeDailyTargetRecord } from '@/lib/ledger';
import { feedChannel, useLedgerFeed } from '@/hooks/useLedgerFeed';

/**
 * The stored target record for one day (`packages/core/src/target-history.ts`)
 * — what the target WAS that day — or null when that day has none. A past day
 * shows its own target, not today's (owner, 2026-10-08: "past days keep the
 * target that was in effect on that day"). Focus-gated like every reader
 * (ADR-0016).
 */
export function useDayTargetRecord(dateKey: string | null): DailyTargetRecord | null {
  const { user } = useAuth();
  const uid = user?.uid;
  const [record, setRecord] = useState<DailyTargetRecord | null>(null);
  useEffect(() => setRecord(null), [uid, dateKey]);
  useLedgerFeed({
    uid,
    label: 'DayTargetRecord',
    gate: 'focus',
    channels: () =>
      uid && dateKey
        ? [
            feedChannel<DailyTargetRecord | null, 'record'>({
              key: 'record',
              settles: 'any',
              open: (deliver) => subscribeDailyTargetRecord(uid, dateKey, deliver),
              apply: (v) => setRecord(v),
            }),
          ]
        : [],
    deps: [uid, dateKey],
  });
  return record;
}
