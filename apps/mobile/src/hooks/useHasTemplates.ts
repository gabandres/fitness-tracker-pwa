import { useState } from 'react';
import { feedChannel, useLedgerFeed } from '@/hooks/useLedgerFeed';
import { useAuth } from '@/lib/auth';
import { subscribeTemplates } from '@/lib/ledger';
import type { WorkoutTemplate } from '@/lib/workout';

/**
 * Does this account have a workout template? `null` until the first snapshot.
 *
 * Settings asks so the Training group — phase, auto-apply, dumbbell steps, the
 * volume gate — is absent for someone who has never built a workout (UX_AUDIT
 * S24-10, 2026-11-19). Its own focus-gated subscription (ADR-0016), like
 * `useProgram`'s on the same screen.
 */
export function useHasTemplates(): boolean | null {
  const { user } = useAuth();
  const uid = user?.uid;
  const [has, setHas] = useState<boolean | null>(null);
  useLedgerFeed({
    uid,
    label: 'HasTemplates',
    gate: 'focus',
    channels: () =>
      uid
        ? [
            feedChannel({
              key: 'templates',
              settles: 'none',
              open: (deliver) => subscribeTemplates(uid, deliver),
              apply: (list: WorkoutTemplate[]) => setHas(list.length > 0),
            }),
          ]
        : [],
    deps: [uid],
  });
  return has;
}
