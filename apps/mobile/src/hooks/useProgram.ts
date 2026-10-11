import { useCallback, useMemo, useState } from 'react';
import {
  estimateTemplateDuration,
  programDrafts,
  programVersion,
  type ProgramVersion,
  type TemplateDraftDoc,
} from '@macrolog/core';
import { feedChannel, useLedgerFeed } from '@/hooks/useLedgerFeed';
import { useAuth } from '@/lib/auth';
import {
  commitDraftSwaps,
  subscribeExercises,
  subscribeRecentSessions,
  subscribeTemplateDrafts,
  subscribeTemplates,
} from '@/lib/ledger';
import { programSwitchWrites } from '@/lib/program-switch';
import type { Exercise, WorkoutSession, WorkoutTemplate } from '@/lib/workout';

export interface ProgramTemplateRow {
  templateId: string;
  name: string;
  /** Estimated minutes, v1 and v2 (core `estimateTemplateDuration`). */
  v1: number;
  v2: number;
}

/**
 * Settings → Program version (Program v2, 2026-10-11): which version is live,
 * the switch for all its templates together, whether the one automatic switch
 * is still armed, and the duration estimate per template, v1 vs v2.
 *
 * Its own focus-gated subscriptions (ADR-0016) — templates, drafts, catalog,
 * and recent sessions (the switch's baselines read them). The switch itself is
 * `programSwitchWrites`, the same step the Train tab runs.
 */
export function useProgram() {
  const { user } = useAuth();
  const uid = user?.uid;
  const [templates, setTemplates] = useState<WorkoutTemplate[]>([]);
  const [drafts, setDrafts] = useState<TemplateDraftDoc[]>([]);
  const [catalog, setCatalog] = useState<Exercise[]>([]);
  const [sessions, setSessions] = useState<WorkoutSession[]>([]);
  const [busy, setBusy] = useState(false);

  useLedgerFeed({
    uid,
    label: 'Program',
    gate: 'focus',
    channels: () =>
      uid
        ? [
            feedChannel({ key: 'templates', settles: 'none', open: (deliver) => subscribeTemplates(uid, deliver), apply: setTemplates }),
            feedChannel({ key: 'templateDrafts', settles: 'none', open: (deliver) => subscribeTemplateDrafts(uid, deliver), apply: setDrafts }),
            feedChannel({ key: 'exercises', settles: 'none', open: (deliver) => subscribeExercises(uid, deliver), apply: setCatalog }),
            feedChannel<WorkoutSession[], 'sessions'>({
              key: 'sessions',
              settles: 'none',
              open: (deliver, fail) => subscribeRecentSessions(uid, 50, deliver, fail),
              apply: (list: WorkoutSession[]) => setSessions(list.filter((x) => x.status === 'completed')),
            }),
          ]
        : [],
    deps: [uid],
  });

  const program = useMemo(() => programDrafts(drafts), [drafts]);
  const version = useMemo(() => programVersion(drafts), [drafts]);
  const armed = program.find((d) => d.autoActivate)?.autoActivate;
  const armedTemplate = armed ? templates.find((t) => t.id === armed.afterTemplateId)?.name : undefined;
  const autoActivatedAt = program.find((d) => d.autoActivatedAt)?.autoActivatedAt;

  const rows = useMemo<ProgramTemplateRow[]>(() => {
    const musclesOf = (id: string) => catalog.find((e) => e.id === id)?.muscles;
    return program.flatMap((d) => {
      const live = templates.find((t) => t.id === d.draftOf);
      if (!live) return [];
      // The v1 body is the live template until v2 is on, then the one kept on
      // the draft; the v2 body the other way round.
      const v1 = d.status === 'active' && d.previous ? d.previous : live;
      const v2 = d.status === 'active' ? live : d.template;
      return [{
        templateId: d.draftOf,
        name: live.name,
        v1: estimateTemplateDuration(v1, musclesOf).minutes,
        v2: estimateTemplateDuration(v2, musclesOf).minutes,
      }];
    });
  }, [program, templates, catalog]);

  const switchTo = useCallback(
    async (to: ProgramVersion) => {
      if (!uid) return;
      const now = new Date();
      const plan = programSwitchWrites(to, { templates, catalog, sessions, drafts, now });
      if (!plan) return;
      setBusy(true);
      await commitDraftSwaps(uid, plan.writes, now, undefined, plan.patches).finally(() => setBusy(false));
    },
    [uid, templates, catalog, sessions, drafts],
  );

  return { version, rows, armedTemplate, autoActivatedAt, switchTo, busy };
}
