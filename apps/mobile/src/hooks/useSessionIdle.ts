import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AppState } from 'react-native';
import {
  IDLE_PROMPT_MIN,
  clockStart,
  durationNoteFor,
  endAtLastSet,
  idleState,
  isStaleOpen,
  lastActivityAt,
  type EndAtLastSet,
} from '@macrolog/core';
import { confirmNative } from '@/components/ConfirmSheet';
import { showToast } from '@/components/Toast';
import { durationText } from '@/components/train/FinishSheet';
import type { TrainState } from '@/hooks/useTrain';
import { useLocale, useT } from '@/i18n';
import { formatTime } from '@/lib/date-format';
import {
  type IdleMarks,
  cancelIdleNotifications,
  clearIdleMarks,
  onIdleTap,
  readIdleMarks,
  scheduleIdleNotification,
  takeIdleTap,
  writeIdleMarks,
} from '@/lib/session-idle-notify';

/** How the Train screen opens Finish for the timer's auto-stop: asking for the
 *  length, optionally pre-filled with the last set + 5 min. */
export interface IdleFinishRequest {
  askLength: true;
  /** "End at last set": the length to pre-fill, saved as `ended-at-last-set`. */
  presetMin?: number;
}

const MIN = 60_000;

/**
 * The Train screen's half of the timer's auto-stop (core `session-idle.ts`).
 * Mounted on the screen, which owns the Finish sheet and outlives the session.
 *
 * - Every logged set (and "Keep going") moves the "Still training?" local
 *   notification to 20 min after it.
 * - With the app open, the same question is asked in-app at 20 min; with no
 *   answer by 30 min the session ends by itself at the last set + 5 min
 *   (`finishWorkout`, flagged "auto-ended"). A phone that was asleep through
 *   it ends the session on the next foreground, at the same minute.
 * - Opening the app (or the screen) on a session open over 2 h asks "End
 *   session at last set (HH:MM)?" — End / Enter duration / Keep going. End
 *   and Enter duration open the Finish sheet with the length asked, so the
 *   template question and the RIR checks still run.
 * - A notification tap arrives through `useSessionIdleRouter`: the body and
 *   "Keep going" restart the idle clock; "End session" opens Finish at the
 *   last set.
 *
 * Off while editing a finished session, and while the Finish sheet is open.
 */
export function useSessionIdle(
  train: Pick<TrainState, 'active' | 'editingExisting' | 'finishWorkout'>,
  openFinish: (r: IdleFinishRequest) => void,
  finishOpen: boolean,
): void {
  const t = useT();
  const locale = useLocale();
  const session = train.active && !train.editingExisting && train.active.status === 'active' ? train.active : null;
  const id = session?.id;

  // The lifter's answers, for THIS session; null until read from the device.
  const [marks, setMarks] = useState<IdleMarks | null>(null);
  const prevId = useRef<string | undefined>(undefined);
  useEffect(() => {
    let alive = true;
    const before = prevId.current;
    prevId.current = id;
    if (before && before !== id) {
      void cancelIdleNotifications();
      void clearIdleMarks(before);
    }
    setMarks(null);
    if (!id) return;
    void readIdleMarks(id).then((m) => {
      if (alive) setMarks(m);
    });
    return () => {
      alive = false;
    };
  }, [id]);

  const keepGoingAt = marks?.keepGoingAt != null ? new Date(marks.keepGoingAt) : undefined;
  const keepGoingMs = marks?.keepGoingAt;
  const promptAtMs = useMemo(
    () => (session ? lastActivityAt(session, keepGoingMs != null ? new Date(keepGoingMs) : undefined).getTime() + IDLE_PROMPT_MIN * MIN : null),
    [session, keepGoingMs],
  );

  // The notification follows the last sign of life.
  useEffect(() => {
    if (!id || promptAtMs == null || marks == null) return;
    void scheduleIdleNotification(id, new Date(promptAtMs), t);
  }, [id, promptAtMs, marks, t]);
  // And goes when the session does (finished, discarded, paused).
  useEffect(() => {
    if (!id) void cancelIdleNotifications();
  }, [id]);

  // Everything the callbacks below read, current.
  const live = useRef({ session, marks, finishOpen, train, openFinish });
  useEffect(() => {
    live.current = { session, marks, finishOpen, train, openFinish };
  });

  const saveMarks = useCallback((patch: IdleMarks) => {
    const { session: s, marks: m } = live.current;
    if (!s?.id) return;
    const next = { ...(m ?? {}), ...patch };
    setMarks(next);
    void writeIdleMarks(s.id, next);
  }, []);

  const keepGoing = useCallback(() => {
    void cancelIdleNotifications();
    saveMarks({ keepGoingAt: Date.now() });
  }, [saveMarks]);

  const endAtLast = useCallback(() => {
    const s = live.current.session;
    if (!s) return;
    const end = endAtLastSet(s);
    live.current.openFinish(end ? { askLength: true, presetMin: end.durationMin } : { askLength: true });
  }, []);

  const ending = useRef(false);
  const autoEnd = useCallback(async (end: EndAtLastSet) => {
    const s = live.current.session;
    if (!s || ending.current) return;
    ending.current = true;
    try {
      const timerMin = Math.round((Date.now() - clockStart(s).getTime()) / MIN);
      const durationNote = durationNoteFor('auto-ended', { timerMin, savedMin: end.durationMin, lastSetAt: end.lastSetAt });
      const ok = await live.current.train.finishWorkout({ durationMin: end.durationMin, durationNote });
      if (ok) showToast(t('train.idle.autoEnded', { at: formatTime(end.endAt, locale), n: end.durationMin }), { testID: 'idle-auto-ended' });
    } finally {
      ending.current = false;
    }
  }, [t, locale]);

  /** One in-app "Still training?" per idle stretch. */
  const askedFor = useRef<number | null>(null);

  const evaluate = useCallback((reason: 'open' | 'timer') => {
    const { session: s, marks: m, finishOpen: busy } = live.current;
    if (!s || m == null || busy || ending.current) return;
    const now = new Date();
    const kg = m.keepGoingAt != null ? new Date(m.keepGoingAt) : undefined;
    const st = idleState(s, now, kg);
    if (st.kind === 'auto-end') {
      void autoEnd(st.end);
      return;
    }
    if (reason === 'open' && isStaleOpen(s, now, m.staleAskedAt != null ? new Date(m.staleAskedAt) : undefined)) {
      // Asked with the lifter looking at it: that is a sign of life too.
      saveMarks({ staleAskedAt: now.getTime(), keepGoingAt: now.getTime() });
      const end = endAtLastSet(s);
      const time = durationText(Math.round((now.getTime() - clockStart(s).getTime()) / MIN), t);
      const enter = () => live.current.openFinish({ askLength: true });
      confirmNative(end
        ? {
          title: t('train.idle.staleTitle', { at: formatTime(end.lastSetAt, locale) }),
          body: t('train.idle.staleBody', { time, n: end.durationMin }),
          confirmText: t('train.idle.staleEnd'),
          onConfirm: () => live.current.openFinish({ askLength: true, presetMin: end.durationMin }),
          secondaryText: t('train.idle.staleEnter'),
          onSecondary: enter,
          cancelText: t('train.idle.actionContinue'),
        }
        : {
          title: t('train.idle.staleTitleUntimed', { time }),
          body: t('train.idle.staleBodyUntimed'),
          confirmText: t('train.idle.staleEnter'),
          onConfirm: enter,
          cancelText: t('train.idle.actionContinue'),
        });
      return;
    }
    if ((st.kind === 'prompt' || st.kind === 'ask') && askedFor.current !== st.promptAt.getTime()) {
      askedFor.current = st.promptAt.getTime();
      confirmNative({
        title: t('train.idle.notifTitle'),
        body: t('train.idle.askBody', { n: IDLE_PROMPT_MIN }),
        confirmText: t('train.idle.actionContinue'),
        onConfirm: keepGoing,
        secondaryText: t('train.idle.actionEnd'),
        onSecondary: endAtLast,
      });
    }
  }, [autoEnd, saveMarks, keepGoing, endAtLast, t, locale]);

  const ready = session != null && marks != null;

  // On the screen's first look at the session, and on every foreground.
  useEffect(() => {
    if (!ready) return;
    evaluate('open');
    const sub = AppState.addEventListener('change', (s) => {
      if (s === 'active') evaluate('open');
    });
    return () => sub.remove();
    // `ready` flips once per session; `id` re-arms it for the next one.
  }, [ready, id, evaluate]);

  // While the app is open: wake at the next threshold (20 min, then 30).
  useEffect(() => {
    if (!ready || !session) return;
    const st = idleState(session, new Date(), keepGoingAt);
    const at = st.kind === 'active' ? st.promptAt : st.kind === 'prompt' ? st.autoEndAt : null;
    if (!at) return;
    const timer = setTimeout(() => evaluate('timer'), Math.max(0, at.getTime() - Date.now()) + 500);
    return () => clearTimeout(timer);
    // keepGoingAt is derived from marks.
  }, [ready, session, marks, evaluate]); // eslint-disable-line react-hooks/exhaustive-deps

  // A notification tap the router stashed.
  useEffect(() => {
    if (!ready) return;
    const handle = () => {
      const s = live.current.session;
      if (!s?.id) return;
      const tap = takeIdleTap();
      if (!tap || tap.sessionId !== s.id) return;
      if (tap.action === 'end') endAtLast();
      else keepGoing();
    };
    handle();
    return onIdleTap(handle);
  }, [ready, keepGoing, endAtLast]);
}
