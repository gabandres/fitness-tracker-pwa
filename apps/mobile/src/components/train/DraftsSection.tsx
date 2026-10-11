import { useMemo, useState } from 'react';
import { Text, View } from 'react-native';
import { supersetGroups, supersetLabel, type SwapPlan, type TemplateDraftDoc } from '@macrolog/core';
import { confirm } from '@/components/ConfirmSheet';
import { showToast } from '@/components/Toast';
import type { TrainState } from '@/hooks/useTrain';
import { useLocale, useT } from '@/i18n';
import { plural } from '@/i18n/grammar';
import { announce } from '@/lib/a11y';
import * as haptics from '@/lib/haptics';
import { captureError } from '@/lib/sentry';
import { useThemedStyles } from '@/lib/theme-context';
import { Touchable } from './Touchable';
import { createStyles } from './train-styles';

type DraftTrain = Pick<TrainState, 'drafts' | 'templates' | 'planDraftSwaps' | 'switchDrafts' | 'deleteDraft' | 'pendingLoadTestFor'>;

/**
 * Switching superset drafts on and back (2026-10-11), shared by the Drafts
 * section (switch on) and the live template card (switch back).
 *
 * The confirm says what the swap does BEFORE it does it, in the order a lifter
 * needs: the reason to wait (a load test pending), then what happens to the
 * week, then what happens to the lifts, then that it can be undone. When the
 * swap moves lifts between two templates and the other one has a draft too,
 * the primary action is to switch BOTH — one batch — because switching only
 * one runs those lifts twice a week, or not at all.
 */
export function useDraftActions(train: DraftTrain) {
  const t = useT();
  const locale = useLocale();
  const [busy, setBusy] = useState<string | null>(null);
  const nameOf = (id: string) => train.templates.find((x) => x.id === id)?.name ?? '';
  const names = (xs: readonly { name: string }[]) => xs.map((x) => x.name).join(', ');

  /** The other draft that resolves this one's week overlap, if any. */
  const partnerFor = (draft: TemplateDraftDoc, plan: SwapPlan, mode: 'activate' | 'revert') => {
    const moved = new Set([...plan.overlap.doubled, ...plan.overlap.dropped].map((x) => x.exerciseId));
    if (moved.size === 0) return undefined;
    const wantStatus = mode === 'activate' ? 'draft' : 'active';
    return train.drafts.find((d) => d.id !== draft.id && d.status === wantStatus
      && train.templates.some((x) => x.id === d.draftOf)
      && [...(mode === 'activate' ? d.template.exercises : d.previous?.exercises ?? []),
        ...(train.templates.find((x) => x.id === d.draftOf)?.exercises ?? [])]
        .some((e) => moved.has(e.exerciseId)));
  };

  const overlapLines = (draft: TemplateDraftDoc, plan: SwapPlan, mode: 'activate' | 'revert', partner?: TemplateDraftDoc) => {
    const lines: string[] = [];
    const name = nameOf(draft.draftOf);
    const byOther = new Map<string, string[]>();
    for (const d of plan.overlap.doubled) byOther.set(d.alsoIn, [...(byOther.get(d.alsoIn) ?? []), d.name]);
    for (const [other, list] of byOther) {
      lines.push(t(mode === 'activate' ? 'train.drafts.doubled' : 'train.drafts.revertDoubled', { names: list.join(', '), other, name }));
    }
    if (plan.overlap.dropped.length) {
      const other = partner ? nameOf(partner.draftOf) : '';
      lines.push(other
        ? t(mode === 'activate' ? 'train.drafts.dropped' : 'train.drafts.revertDropped', { names: names(plan.overlap.dropped), name, other })
        : t('train.drafts.droppedNowhere', { names: names(plan.overlap.dropped) }));
    }
    return lines;
  };

  const run = (list: readonly TemplateDraftDoc[], mode: 'activate' | 'revert') => {
    const key = list.map((d) => d.id).join('+');
    setBusy(key);
    train.switchDrafts(list, mode)
      .then(() => {
        // Feedback once the write has landed (or is queued offline) — never
        // before, so a refusal cannot play "success" then "warning".
        haptics.success();
        const msg = list.map((d) => t(mode === 'activate' ? 'train.drafts.switchedOn' : 'train.drafts.switchedBack', { name: nameOf(d.draftOf) })).join(' ');
        showToast(msg, { testID: 'train-toast' });
        announce(msg);
      })
      .catch((e) => {
        haptics.warning();
        showToast(t('train.drafts.err'), { testID: 'train-toast' });
        captureError(e, { where: mode === 'activate' ? 'train.activateDraft' : 'train.revertDraft' });
      })
      .then(() => setBusy(null));
  };

  const ask = (draft: TemplateDraftDoc, mode: 'activate' | 'revert') => {
    const single = train.planDraftSwaps([draft], mode);
    if (!single) return;
    const plan = single[0];
    const partner = partnerFor(draft, plan, mode);
    const both = partner ? train.planDraftSwaps([draft, partner], mode) : null;
    const name = nameOf(draft.draftOf);
    const pending = mode === 'activate'
      ? draft.template.exercises.filter((row) => row.supersetGroup != null && train.pendingLoadTestFor(row) != null)
      : [];
    const changed = (both ?? single).reduce((n, p) => n + p.changes.size, 0);
    const stamped = (both ?? single).reduce(
      (n, p) => n + p.body.exercises.filter((e) => e.baseline?.reason.includes('context changed')
        && !p.replaced.exercises.some((r) => r.exerciseId === e.exerciseId && r.baseline?.since === e.baseline?.since)).length,
      0,
    );
    const body = mode === 'activate'
      ? [
          ...(pending.length ? [t('train.drafts.pending', { names: names(pending) })] : []),
          ...overlapLines(draft, plan, mode, partner),
          plural(t, locale, 'train.drafts.effect', changed),
          t('train.drafts.undoLine'),
        ]
      : [
          t('train.drafts.revertBody'),
          ...overlapLines(draft, plan, mode, partner),
          ...(stamped > 0 ? [plural(t, locale, 'train.drafts.revertBaselines', stamped)] : []),
        ];
    const one = () => run([draft], mode);
    confirm({
      title: t(mode === 'activate' ? 'train.drafts.activateTitle' : 'train.drafts.revertTitle', { name }),
      body: body.join('\n\n'),
      ...(partner && both
        ? {
            confirmText: t(mode === 'activate' ? 'train.drafts.both' : 'train.drafts.bothBack'),
            onConfirm: () => run([draft, partner], mode),
            secondaryText: t('train.drafts.only', { name }),
            onSecondary: one,
          }
        : {
            confirmText: t(mode === 'activate' ? 'train.drafts.activate' : 'train.drafts.revert'),
            onConfirm: one,
          }),
    });
  };

  const askDelete = (draft: TemplateDraftDoc) => {
    confirm({
      title: t('train.drafts.deleteTitle', { label: draft.label }),
      body: t('train.drafts.deleteBody'),
      confirmText: t('train.drafts.delete'),
      destructive: true,
      onConfirm: () => {
        train.deleteDraft(draft).catch((e) => {
          haptics.warning();
          showToast(t('train.drafts.err'), { testID: 'train-toast' });
          captureError(e, { where: 'train.deleteDraft' });
        });
      },
    });
  };

  return {
    activate: (d: TemplateDraftDoc) => ask(d, 'activate'),
    revert: (d: TemplateDraftDoc) => ask(d, 'revert'),
    askDelete,
    busy,
  };
}

/**
 * Superset drafts not yet in use (2026-10-11). An ACTIVE draft is not listed
 * here — it shows on its live template's card, where the template now runs
 * supersets, with the way back in that card's menu.
 *
 * Each card is short — what changes, in one line — with the full labelled
 * order behind "Show order", in the template cards' own idiom: Train home is
 * a list, and three drafts printed whole pushed History a screen down.
 */
export function DraftsSection({ train }: { train: DraftTrain }) {
  const t = useT();
  const locale = useLocale();
  const styles = useThemedStyles(createStyles);
  const actions = useDraftActions(train);
  const [open, setOpen] = useState<string | null>(null);
  const waiting = useMemo(() => train.drafts.filter((d) => d.status === 'draft'), [train.drafts]);
  // The engine walk per paired row runs once per change, not per render.
  const pendingFor = train.pendingLoadTestFor;
  const pendingByDraft = useMemo(() => new Map(waiting.map((d) => [
    d.id,
    d.template.exercises.filter((row) => row.supersetGroup != null && pendingFor(row) != null),
  ])), [waiting, pendingFor]);
  if (waiting.length === 0) return null;

  return (
    <>
      <Text style={styles.sectionTitle} accessibilityRole="header">{t('train.drafts.title')}</Text>
      <Text style={styles.sheetHint}>{t('train.drafts.hint')}</Text>
      <View style={styles.list}>
        {waiting.map((draft) => {
          const live = train.templates.find((x) => x.id === draft.draftOf);
          const rows = draft.template.exercises;
          const groups = supersetGroups(rows).size;
          const movedIn = live ? rows.filter((r) => !live.exercises.some((e) => e.exerciseId === r.exerciseId)) : [];
          const from = movedIn.length
            ? train.templates.find((x) => x.id !== draft.draftOf && x.exercises.some((e) => e.exerciseId === movedIn[0].exerciseId))?.name
            : undefined;
          const summary = [
            plural(t, locale, 'train.drafts.liftCount', rows.length),
            plural(t, locale, 'train.drafts.supersetCount', groups),
            ...(movedIn.length && from ? [t('train.drafts.movedFrom', { names: movedIn.map((r) => r.name).join(', '), other: from })] : []),
          ].join(' · ');
          const pending = pendingByDraft.get(draft.id) ?? [];
          const expanded = open === draft.id;
          const order = rows.map((r) => `${supersetLabel(r) ?? '·'}  ${r.name}`);
          const isBusy = actions.busy?.split('+').includes(draft.id ?? '') ?? false;
          return (
            <View key={draft.id} style={styles.tplCard} testID={`draft-${draft.id}`}>
              <View style={[styles.tplCardTop, { alignItems: 'flex-start' }]}>
                <View style={styles.tplMain}>
                  <Text style={styles.histDate}>{live ? t('train.drafts.label', { name: live.name }) : draft.label}</Text>
                  {live ? (
                    <Text style={styles.draftSummary} testID={`draft-summary-${draft.id}`}>{summary}</Text>
                  ) : (
                    <Text style={styles.draftSummary}>{t('train.drafts.orphan')}</Text>
                  )}
                  {pending.length ? (
                    <Text style={styles.draftSummary} numberOfLines={expanded ? undefined : 2}>
                      {t('train.drafts.pending', { names: pending.map((r) => r.name).join(', ') })}
                    </Text>
                  ) : null}
                </View>
              </View>
              {live ? (
                <>
                  <Touchable
                    style={styles.tplNextToggleBtn}
                    onPress={() => setOpen(expanded ? null : draft.id ?? null)}
                    accessibilityRole="button"
                    accessibilityState={{ expanded }}
                    testID={`draft-order-${draft.id}`}
                  >
                    <Text style={styles.tplNextToggle}>{expanded ? t('train.drafts.hideOrder') : t('train.drafts.showOrder')}</Text>
                  </Touchable>
                  {expanded ? (
                    <View
                      style={{ paddingHorizontal: 16 }}
                      accessible
                      accessibilityLabel={t('train.drafts.orderA11y', { list: order.map((o) => o.replace('·', '').trim()).join(', ') })}
                      testID={`draft-order-list-${draft.id}`}
                    >
                      {order.map((line, i) => <Text key={`${rows[i].exerciseId}-${i}`} style={styles.tplExNames}>{line}</Text>)}
                    </View>
                  ) : null}
                </>
              ) : null}
              <View style={[styles.tplCardTop, { marginTop: 8, flexWrap: 'wrap' }]}>
                {live ? (
                  <Touchable
                    style={[styles.tplStart, isBusy && { opacity: 0.5 }]}
                    onPress={() => (isBusy ? undefined : actions.activate(draft))}
                    disabled={isBusy}
                    accessibilityRole="button"
                    accessibilityState={{ busy: isBusy, disabled: isBusy }}
                    accessibilityLabel={t('train.drafts.activateA11y', { name: live.name })}
                    testID={`draft-activate-${draft.id}`}
                  >
                    <Text style={styles.tplStartText}>{t('train.drafts.activate')}</Text>
                  </Touchable>
                ) : null}
                <Touchable
                  style={styles.draftSecondaryBtn}
                  onPress={() => actions.askDelete(draft)}
                  accessibilityRole="button"
                  accessibilityLabel={`${t('train.drafts.delete')}, ${live ? t('train.drafts.label', { name: live.name }) : draft.label}`}
                  testID={`draft-delete-${draft.id}`}
                >
                  <Text style={styles.draftSecondaryText}>{t('train.drafts.delete')}</Text>
                </Touchable>
              </View>
            </View>
          );
        })}
      </View>
    </>
  );
}
