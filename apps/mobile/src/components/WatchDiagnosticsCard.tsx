import { useEffect, useState } from 'react';
import { Platform, StyleSheet, Text, View } from 'react-native';
import * as Application from 'expo-application';
import {
  isComplicationEnabled,
  isPaired,
  isWatchAppInstalled,
  isWatchLinkAvailable,
  remainingComplicationTransfers,
} from '../../modules/watch-link';
import { useT } from '@/i18n';
import { readWatchAssertOutcome } from '@/lib/widget';
import { useThemedStyles, type Theme } from '@/lib/theme-context';
import { font, radius, space } from '@/theme';

/**
 * Why the watch face is or is not current — read off the live `WCSession`.
 *
 * ## Why this exists
 *
 * The complication transport has four ways to fail and, from the wrist, all
 * four look identical: a stale number. Worse, the most likely one is invisible
 * by design — `isComplicationEnabled` is **false when the widget sits in the
 * Smart Stack** instead of on an active watch face, and the two are
 * indistinguishable to the person wearing it. Without this card the only
 * available move is to guess and ship another binary.
 *
 * Every value here already existed natively; nothing new is computed. This is
 * a window, not a mechanism — it changes no behaviour and cannot fix anything.
 *
 * The build number rides along because "is the fix even in this binary" is the
 * first question every watch report has to answer, and `targets/` Swift does
 * not move the OTA runtime version — so a device can be running new JS over
 * old native code and look entirely current.
 */
/**
 * Whether this build has a watch surface to diagnose at all.
 *
 * Exported because the SECTION HEADER lives in the settings screen while the
 * guard lived only in here — so Android rendered an "Apple Watch" heading with
 * nothing under it. A component that can return `null` must publish the
 * condition, or every caller has to re-derive it and one of them will drift.
 */
export const watchDiagnosticsAvailable = Platform.OS === 'ios' && isWatchLinkAvailable;

export function WatchDiagnosticsCard() {
  const t = useT();
  const styles = useThemedStyles(createStyles);
  const [tick, setTick] = useState(0);

  // Re-read on an interval: `isComplicationEnabled` flips when the user edits
  // a watch face, with no notification to us, so a value read once at mount
  // goes quietly wrong while the card is on screen.
  useEffect(() => {
    const id = setInterval(() => setTick((n) => n + 1), 3000);
    return () => clearInterval(id);
  }, []);
  void tick;

  // iOS-only surface. Android has no counterpart and the native module is not
  // in that binary at all.
  if (!watchDiagnosticsAvailable) return null;

  const paired = isPaired();
  const installed = isWatchAppInstalled();
  const complication = isComplicationEnabled();
  const remaining = remainingComplicationTransfers();
  // Read every tick, not once at mount: the whole point of this row is that
  // someone taps a widget chip or speaks to Siri and then looks here.
  const lastPush = readWatchAssertOutcome();

  return (
    <View style={styles.card} testID="watch-diagnostics">
      <Row label={t('settings.watchPaired')} ok={paired} styles={styles} />
      {paired ? (
        <>
          <Row label={t('settings.watchAppInstalled')} ok={installed} styles={styles} />
          <Row label={t('settings.watchComplication')} ok={complication} styles={styles} />
          {complication ? null : (
            <Text style={styles.hint}>{t('settings.watchComplicationHint')}</Text>
          )}
          <View style={styles.rowBetween}>
            <Text style={styles.rowLabel}>{t('settings.watchTransfers')}</Text>
            <Text style={styles.rowValue}>{remaining}</Text>
          </View>
        </>
      ) : null}
      {/* Raw tokens on purpose. This row exists to name which guard fired and
          which process ran, and a friendlier rendering would blur exactly the
          distinctions it is here to make. See `readWatchAssertOutcome`. */}
      {lastPush ? (
        <View style={styles.rowBetween}>
          <Text style={styles.rowLabel}>{t('settings.watchLastPush')}</Text>
          <Text style={styles.rowValue} testID="watch-last-push">
            {lastPush.outcome} · {lastPush.process}
            {lastPush.atMs > 0
              ? ` · ${new Date(lastPush.atMs).toLocaleTimeString(undefined, {
                  hour: 'numeric',
                  minute: '2-digit',
                })}`
              : ''}
          </Text>
        </View>
      ) : null}
      <Text style={styles.build}>
        {t('settings.watchBuild', { n: Application.nativeBuildVersion ?? '—' })}
      </Text>
    </View>
  );
}

function Row({
  label,
  ok,
  styles,
}: {
  label: string;
  ok: boolean;
  styles: ReturnType<typeof createStyles>;
}) {
  return (
    <View style={styles.rowBetween}>
      <Text style={styles.rowLabel}>{label}</Text>
      <Text style={[styles.rowValue, ok ? styles.yes : styles.no]}>{ok ? '✓' : '✗'}</Text>
    </View>
  );
}

const createStyles = ({ colors }: Theme) =>
  StyleSheet.create({
    card: {
      backgroundColor: colors.card,
      borderRadius: radius.lg,
      borderWidth: 1,
      borderColor: colors.line,
      paddingHorizontal: space.lg,
      paddingVertical: space.md,
      gap: space.xs,
    },
    rowBetween: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
    rowLabel: { fontSize: font.small, color: colors.ink, flex: 1 },
    rowValue: { fontSize: font.small, color: colors.muted, fontWeight: '700' },
    yes: { color: colors.accent },
    no: { color: colors.muted },
    hint: { fontSize: font.tiny, color: colors.faint, lineHeight: 16 },
    build: { fontSize: font.tiny, color: colors.faint, marginTop: space.xs },
  });
