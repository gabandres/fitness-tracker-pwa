import { Text, View } from 'react-native';
import { supersetLabel, type SwapPlan, type TemplateDraftDoc } from '@macrolog/core';
import { confirm } from '@/components/ConfirmSheet';
import { showToast } from '@/components/Toast';
import type { TrainState } from '@/hooks/useTrain';
import { useT } from '@/i18n';
import * as haptics from '@/lib/haptics';
import { captureError } from '@/lib/sentry';
import { useThemedStyles } from '@/lib/theme-context';
import { Touchable } from './Touchable';
import { createStyles } from './train-styles';

/**
 * Superset drafts of the live templates (2026-10-11).
 *
 * A draft is not in use: it lives in its own collection, "Next up" and Start
 * never see it, and the live template is untouched until the lifter taps
 * Activate. Activation swaps the superset body into the live template (same
 * id, so history and "next up" carry on) and keeps the straight-set body for
 * the one-tap revert. The confirm says what the swap will do BEFORE it does
 * it: how many lifts start a new baseline, which lifts would run twice a week
 * or not at all while only one of a pair of drafts is active, and which have
 * a load test pending.
 */
export function DraftsSection({ train }: { train: TrainState }) {
  const t = useT();
  const styles = useThemedStyles(createStyles);
  if (train.drafts.length === 0) return null;

  const names = (xs: readonly { name: string }[]) => xs.map((x) => x.name).join(', ');

  const warnings = (plan: SwapPlan) => {
    const lines: string[] = [];
    const byOther = new Map<string, string[]>();
    for (const d of plan.overlap.doubled) byOther.set(d.alsoIn, [...(byOther.get(d.alsoIn) ?? []), d.name]);
    for (const [other, list] of byOther) lines.push(t('train.drafts.doubled', { names: list.join(', '), other }));
    if (plan.overlap.dropped.length) lines.push(t('train.drafts.dropped', { names: names(plan.overlap.dropped) }));
    return lines;
  };

  const pendingIn = (draft: TemplateDraftDoc) =>
    draft.template.exercises.filter((row) => row.supersetGroup != null && train.pendingLoadTestFor(row) != null);

  const activate = (draft: TemplateDraftDoc) => {
    const plan = train.planDraftActivation(draft);
    const live = train.templates.find((x) => x.id === draft.draftOf);
    if (!plan || !live) return;
    const pending = pendingIn(draft);
    confirm({
      title: t('train.drafts.activateTitle', { label: draft.label }),
      body: [
        t('train.drafts.activateBody', { name: live.name, n: plan.changes.size }),
        ...warnings(plan),
        ...(pending.length ? [t('train.drafts.pending', { names: names(pending) })] : []),
      ].join('\n\n'),
      confirmText: t('train.drafts.activate'),
      onConfirm: () => {
        haptics.success();
        train.activateDraft(draft).catch((e) => {
          haptics.warning();
          showToast(t('train.drafts.err'));
          captureError(e, { where: 'train.activateDraft' });
        });
      },
    });
  };

  const revert = (draft: TemplateDraftDoc) => {
    const plan = train.planDraftRevert(draft);
    const live = train.templates.find((x) => x.id === draft.draftOf);
    if (!plan || !live) return;
    confirm({
      title: t('train.drafts.revertTitle', { name: live.name }),
      body: [t('train.drafts.revertBody'), ...warnings(plan)].join('\n\n'),
      confirmText: t('train.drafts.revert'),
      onConfirm: () => {
        haptics.tap();
        train.revertDraft(draft).catch((e) => {
          haptics.warning();
          showToast(t('train.drafts.err'));
          captureError(e, { where: 'train.revertDraft' });
        });
      },
    });
  };

  return (
    <>
      <Text style={styles.sectionTitle} accessibilityRole="header">{t('train.drafts.title')}</Text>
      <Text style={styles.sheetHint}>{t('train.drafts.hint')}</Text>
      <View style={styles.list}>
        {train.drafts.map((draft) => {
          const active = draft.status === 'active';
          const pending = active ? [] : pendingIn(draft);
          return (
            <View key={draft.id} style={styles.tplCard} testID={`draft-${draft.id}`}>
              <View style={styles.tplCardTop}>
                <View style={styles.tplMain}>
                  <Text style={styles.histDate}>{draft.label}</Text>
                  {active ? <Text style={styles.supersetTag}>{t('train.drafts.activeBadge')}</Text> : null}
                  {/* The whole order, labelled — "A1 DB Flat Press" — so the
                      draft can be checked before it is used. */}
                  {draft.template.exercises.map((row, i) => (
                    <Text key={`${row.exerciseId}-${i}`} style={styles.tplExNames}>
                      {`${supersetLabel(row) ?? '·'}  ${row.name}`}
                    </Text>
                  ))}
                  {pending.length ? (
                    <Text style={styles.histSub}>{t('train.drafts.pending', { names: names(pending) })}</Text>
                  ) : null}
                </View>
              </View>
              <View style={[styles.tplCardTop, { marginTop: 8 }]}>
                <Touchable
                  style={styles.tplStart}
                  onPress={() => (active ? revert(draft) : activate(draft))}
                  accessibilityRole="button"
                  testID={active ? `draft-revert-${draft.id}` : `draft-activate-${draft.id}`}
                >
                  <Text style={styles.tplStartText}>{active ? t('train.drafts.revert') : t('train.drafts.activate')}</Text>
                </Touchable>
              </View>
            </View>
          );
        })}
      </View>
    </>
  );
}
