import { useEffect, useMemo, useState } from 'react';
import { Switch, Text, View } from 'react-native';
import { gymBusyRows } from '@macrolog/core';
import { type I18nKey, useT } from '@/i18n';
import type { MuscleGroup, SessionExercise } from '@/lib/workout';
import { useTheme } from '@/lib/theme-context';
import { font, space } from '@/theme';
import { Touchable } from './Touchable';

const clock = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;

/**
 * "Gym busy" (owner, 2026-11-10): a switch, off by default, that lists every
 * lift with sets left so the lifter can take whatever machine is free. A tap
 * scrolls to that lift's card. Each row says how long its PRIMARY muscle has
 * rested — at least 90 s before that muscle's next cluster (core
 * `gym-busy.ts`). Logging out of order needs nothing else: a superset block
 * counts as completed once its sets are logged, in any order.
 */
export function GymBusyPanel({
  exercises,
  tags,
  musclesOf,
  onJump,
}: {
  exercises: readonly SessionExercise[];
  /** The live superset tags ("B2"), as the cards show them. */
  tags: readonly (string | undefined)[];
  musclesOf: (exerciseId: string) => readonly MuscleGroup[] | undefined;
  onJump: (exerciseIndex: number) => void;
}) {
  const t = useT();
  const { colors } = useTheme();
  const [on, setOn] = useState(false);
  // The rest hints count down: re-read every 5 s, only while the list shows.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!on) return;
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), 5000);
    return () => clearInterval(id);
  }, [on]);
  const rows = useMemo(() => (on ? gymBusyRows(exercises, musclesOf, new Date(now)) : []), [on, exercises, musclesOf, now]);

  return (
    <View style={{ gap: space.xs }} testID="gym-busy">
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.xs }}>
        <View style={{ flex: 1 }}>
          <Text style={{ fontSize: font.small, color: colors.muted }}>{t('train.gymBusy.label')}</Text>
          {on ? <Text style={{ fontSize: font.small, color: colors.faint }}>{t('train.gymBusy.hint')}</Text> : null}
        </View>
        <Switch
          value={on}
          onValueChange={setOn}
          trackColor={{ true: colors.tealSolid, false: colors.lineStrong }}
          accessibilityLabel={t('train.gymBusy.label')}
          testID="gym-busy-switch"
        />
      </View>
      {on && rows.length === 0 ? (
        <Text style={{ fontSize: font.small, color: colors.muted }}>{t('train.gymBusy.empty')}</Text>
      ) : null}
      {rows.map((r) => {
        const tag = tags[r.exerciseIndex];
        const name = tag ? `${tag} · ${r.name}` : r.name;
        const muscle = r.muscle ? t(`train.muscle.${r.muscle}` as I18nKey) : '';
        const rest = r.waitSec > 0 && r.restedSec != null
          ? t('train.gymBusy.wait', { muscle, rested: clock(r.restedSec), left: clock(r.waitSec) })
          : t('train.gymBusy.ready');
        return (
          <Touchable
            key={r.exerciseIndex}
            onPress={() => onJump(r.exerciseIndex)}
            accessibilityRole="button"
            accessibilityLabel={`${t('train.gymBusy.jumpA11y', { name })}, ${t('train.gymBusy.left', { done: r.done, total: r.total })}, ${rest}`}
            style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm, paddingVertical: space.xs }}
            testID={`gym-busy-row-${r.exerciseIndex}`}
          >
            <View style={{ flex: 1 }}>
              <Text style={{ fontSize: font.body, color: colors.ink }} numberOfLines={1}>{name}</Text>
              <Text style={{ fontSize: font.small, color: r.waitSec > 0 ? colors.accent : colors.muted }}>{rest}</Text>
            </View>
            <Text style={{ fontSize: font.small, color: colors.muted }}>{t('train.gymBusy.left', { done: r.done, total: r.total })}</Text>
          </Touchable>
        );
      })}
    </View>
  );
}
