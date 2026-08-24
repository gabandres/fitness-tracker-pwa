import Ionicons from '@expo/vector-icons/Ionicons';
import { useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Animated, Easing, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useAuth } from '@/lib/auth';
import { useLocale, useT } from '@/i18n';
import { formatDate, formatTime } from '@/lib/date-format';
import { useOura } from '@/lib/oura';
import * as haptics from '@/lib/haptics';
import { useTheme, useThemedStyles, type Theme } from '@/lib/theme-context';
import { font, radius, space } from '@/theme';

/**
 * Connected apps — third-party services that import into Ignia.
 *
 * ## Why this is a screen and not a Settings section
 *
 * It was a section, and the owner's verdict on it was that connecting to a
 * third party "should be way better UX". He was right, and the concrete
 * failure underneath the aesthetic one is worth naming: **the app never told
 * anyone the connection had worked.** Consent completes in a system browser,
 * the user comes back, and one line of text changed. No success moment, no
 * count, no last-synced — nothing to distinguish "linked and importing" from
 * "linked and silently broken".
 *
 * So this screen is built around evidence rather than copy: a status pill, when
 * the ring was last read, and how much came back. Those three answer "is it
 * working?" without the user having to go and check Train.
 *
 * ## What is deliberately NOT here
 *
 * **Apple Health / Health Connect.** It looks like a sibling and is not: it is
 * an OS permission for a store on the device, with no account, no OAuth, no
 * revocation page and no scopes — and its controls are entangled with platform
 * branches this screen would have to reproduce. It stays in Settings under its
 * own heading. This screen is for services with an account on the other end,
 * which is what "connected apps" means to a user and what Garmin and Whoop
 * would join.
 *
 * ## Adding the second provider
 *
 * Keep the card shape and lift it into `src/components/` at that point, not
 * before — `src/app/` holds routes and nothing else (AGENTS.md), so a shared
 * card cannot live in this file once two screens want it. One provider does not
 * need the abstraction; two do.
 */
export default function ConnectedAppsScreen() {
  const router = useRouter();
  const { user } = useAuth();
  const t = useT();
  const locale = useLocale();
  const { colors } = useTheme();
  const styles = useThemedStyles(makeStyles);
  const oura = useOura(user?.uid);
  const [showDetails, setShowDetails] = useState(false);

  const connected = oura.status.connected;

  /**
   * The success moment.
   *
   * Consent finishes in a system browser, so the app has no callback to react
   * to — the only signal is the status document flipping to `connected`. That
   * transition is what this watches, which is also why it is honest: it fires
   * when the link genuinely exists, not when the browser merely closed. A user
   * who tapped Cancel at Oura sees nothing, because nothing happened.
   *
   * It auto-clears: a success banner that stays forever stops meaning "just
   * now" and becomes furniture.
   */
  const wasConnected = useRef(connected);
  const [justConnected, setJustConnected] = useState(false);
  const pop = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (!wasConnected.current && connected) {
      setJustConnected(true);
      haptics.success();
      pop.setValue(0);
      Animated.sequence([
        Animated.timing(pop, {
          toValue: 1,
          duration: 320,
          easing: Easing.out(Easing.back(2)),
          useNativeDriver: true,
        }),
        Animated.delay(2400),
        Animated.timing(pop, { toValue: 0, duration: 220, useNativeDriver: true }),
      ]).start(({ finished }) => {
        if (finished) setJustConnected(false);
      });
    }
    wasConnected.current = connected;
  }, [connected, pop]);
  const syncedAt = oura.status.lastSyncedAt;
  const records = oura.status.lastRecordCount;

  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} hitSlop={10} testID="connected-apps-back">
          <Ionicons name="chevron-back" size={26} color={colors.ink} />
        </TouchableOpacity>
        <Text style={styles.title}>{t('connected.title')}</Text>
        {/* Balances the back chevron so the title is optically centred. */}
        <View style={styles.headerSpacer} />
      </View>

      <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
        <Text style={styles.subtitle}>{t('connected.intro')}</Text>

        {justConnected ? (
          <Animated.View
            style={[
              styles.success,
              {
                opacity: pop,
                transform: [
                  { scale: pop.interpolate({ inputRange: [0, 1], outputRange: [0.94, 1] }) },
                ],
              },
            ]}
            testID="oura-just-connected"
          >
            <Ionicons name="checkmark-circle" size={22} color={colors.tealSolid} />
            <Text style={styles.successText}>{t('connected.justConnected')}</Text>
          </Animated.View>
        ) : null}

        <View style={styles.card} testID="provider-oura">
          <View style={styles.cardHead}>
            <View style={styles.cardHeadText}>
              <Text style={styles.provider}>{t('oura.title')}</Text>
              <Text style={styles.providerSub}>
                {connected ? t('oura.subConnected') : t('oura.subDisconnected')}
              </Text>
            </View>
            <View style={[styles.pill, connected ? styles.pillOn : styles.pillOff]}>
              <Text style={[styles.pillText, connected ? styles.pillTextOn : styles.pillTextOff]}>
                {connected ? t('connected.statusConnected') : t('connected.statusOff')}
              </Text>
            </View>
          </View>

          {/*
            The evidence row — the whole reason this screen exists. A connected
            integration that has never been read looks identical to a broken one
            without it, and "Not synced yet" is a truthful, actionable state
            rather than a blank.
          */}
          {connected ? (
            <View style={styles.evidence} testID="oura-evidence">
              <Text style={styles.evidenceLine}>
                {syncedAt
                  ? t('connected.lastSynced', {
                      when: `${formatDate(syncedAt, locale, { month: 'short', day: 'numeric' })} ${formatTime(syncedAt, locale)}`,
                    })
                  : t('connected.lastSyncedNever')}
              </Text>
              <Text style={styles.evidenceLine}>
                {records == null
                  ? t('connected.recordsUnknown')
                  : records > 0
                    ? t('connected.records', { n: records })
                    : t('connected.recordsNone')}
              </Text>
            </View>
          ) : null}

          {/*
            Scope upgrade — and as of 2026-08-24 this is LIVE, not theoretical.
            `daily` was added to the required set, and Oura cannot widen a grant
            without fresh consent, so everyone who linked before that date holds
            `workout` alone. Without this sentence they would see an empty sleep
            row and no reason for it.
          */}
          {oura.needsScopeUpgrade ? (
            <View style={styles.notice} testID="oura-scope-upgrade">
              <Text style={styles.noticeText}>{t('connected.scopeUpgrade')}</Text>
            </View>
          ) : null}

          <View style={styles.actions}>
            <TouchableOpacity
              onPress={connected ? oura.disconnect : oura.connect}
              disabled={oura.busy || !oura.ready}
              style={[
                styles.btn,
                connected ? styles.btnQuiet : styles.btnPrimary,
                (oura.busy || !oura.ready) && styles.btnDisabled,
              ]}
              testID="oura-toggle"
            >
              <Text style={[styles.btnText, connected ? styles.btnTextQuiet : styles.btnTextPrimary]}>
                {oura.busy
                  ? t('oura.connecting')
                  : connected
                    ? t('oura.disconnect')
                    : t('oura.connect')}
              </Text>
            </TouchableOpacity>

            {connected ? (
              <TouchableOpacity
                onPress={oura.syncNow}
                disabled={oura.busy}
                style={[styles.btn, styles.btnPrimary, oura.busy && styles.btnDisabled]}
                testID="oura-sync-now"
              >
                <Text style={[styles.btnText, styles.btnTextPrimary]}>
                  {oura.busy ? t('common.saving') : t('oura.syncNow')}
                </Text>
              </TouchableOpacity>
            ) : null}
          </View>

          {/*
            Four outcomes, four sentences. A single "sync failed" would tell a
            user to retry a revoked grant forever, and would report OUR parser
            being wrong about the wire shape as their ring being quiet.
          */}
          {oura.failed ? <Text style={styles.msg}>{t('oura.failed')}</Text> : null}
          {oura.result && !oura.result.linked ? (
            <Text style={styles.msg}>{t('oura.needsReconnect')}</Text>
          ) : null}
          {oura.result?.linked ? (
            <Text style={styles.msg}>
              {oura.result.written > 0
                ? t('oura.synced', { n: oura.result.written })
                : t('oura.syncedNone')}
            </Text>
          ) : null}
          {oura.result && oura.result.skipped > 0 ? (
            <Text style={styles.msg}>{t('oura.skipped', { n: oura.result.skipped })}</Text>
          ) : null}
          {oura.result?.truncated ? <Text style={styles.msg}>{t('oura.truncated')}</Text> : null}
          {oura.daily && oura.daily.days > 0 ? (
            <Text style={styles.msg}>{t('oura.dailySynced', { n: oura.daily.days })}</Text>
          ) : null}
          {oura.daily?.scopeDenied ? <Text style={styles.msg}>{t('oura.dailyDenied')}</Text> : null}

          {/*
            The three explanatory paragraphs used to sit open on the card, which
            is most of what made it feel heavy. They are still one tap away,
            because what a health integration reads is exactly the thing a user
            is entitled to check — collapsing it is a layout decision, not a
            reason to bury it.
          */}
          <TouchableOpacity
            onPress={() => setShowDetails((v) => !v)}
            style={styles.disclosure}
            testID="oura-details-toggle"
          >
            <Text style={styles.disclosureText}>{t('connected.details')}</Text>
            <Ionicons
              name={showDetails ? 'chevron-up' : 'chevron-down'}
              size={18}
              color={colors.muted}
            />
          </TouchableOpacity>

          {showDetails ? (
            <View style={styles.details} testID="oura-details">
              <Text style={styles.detailText}>{t('oura.scopeNote')}</Text>
              <Text style={styles.detailText}>{t('oura.energyNote')}</Text>
              <Text style={styles.detailText}>{t('oura.revokeNote')}</Text>
            </View>
          ) : null}
        </View>

        <Text style={styles.footnote}>{t('connected.footnote')}</Text>
      </ScrollView>
    </SafeAreaView>
  );
}

const makeStyles = ({ colors }: Theme) =>
  StyleSheet.create({
    screen: { flex: 1, backgroundColor: colors.paper },
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: space.lg,
      paddingVertical: space.md,
    },
    title: { flex: 1, textAlign: 'center', fontSize: font.h2, fontWeight: '800', color: colors.ink },
    headerSpacer: { width: 26 },
    body: { paddingHorizontal: space.xl, paddingBottom: space.xl, gap: space.lg },
    subtitle: { fontSize: font.body, color: colors.muted },

    card: {
      backgroundColor: colors.card,
      borderRadius: radius.lg,
      padding: space.lg,
      gap: space.md,
    },
    cardHead: { flexDirection: 'row', alignItems: 'flex-start', gap: space.md },
    /** `flex: 1` so a long provider description yields instead of pushing the
     *  status pill off screen — the defect this screen was built after. */
    cardHeadText: { flex: 1, gap: 2 },
    provider: { fontSize: font.h3, fontWeight: '800', color: colors.ink },
    providerSub: { fontSize: font.body, color: colors.muted },

    pill: { borderRadius: radius.pill, paddingHorizontal: space.md, paddingVertical: 4 },
    pillOn: { backgroundColor: colors.tealSoft },
    pillOff: { backgroundColor: colors.inputBg },
    pillText: { fontSize: font.small, fontWeight: '700' },
    pillTextOn: { color: colors.tealSolid },
    pillTextOff: { color: colors.muted },

    evidence: {
      gap: 2,
      paddingTop: space.sm,
      borderTopWidth: 1,
      borderTopColor: colors.line,
    },
    evidenceLine: { fontSize: font.small, color: colors.muted },

    notice: {
      backgroundColor: colors.inputBg,
      borderRadius: radius.md,
      padding: space.md,
    },
    noticeText: { fontSize: font.small, color: colors.ink },

    actions: { flexDirection: 'row', gap: space.sm },
    btn: {
      flex: 1,
      borderRadius: radius.md,
      paddingVertical: space.sm,
      paddingHorizontal: space.md,
      alignItems: 'center',
    },
    btnPrimary: { backgroundColor: colors.ink },
    btnQuiet: { borderWidth: 1, borderColor: colors.line },
    btnDisabled: { opacity: 0.5 },
    btnText: { fontSize: font.body, fontWeight: '700' },
    btnTextPrimary: { color: colors.onInk },
    btnTextQuiet: { color: colors.ink },

    msg: { fontSize: font.small, color: colors.muted },

    success: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: space.sm,
      backgroundColor: colors.tealSoft,
      borderRadius: radius.md,
      paddingVertical: space.md,
      paddingHorizontal: space.lg,
    },
    successText: { flex: 1, fontSize: font.body, fontWeight: '700', color: colors.tealSolid },

    disclosure: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingTop: space.sm,
      borderTopWidth: 1,
      borderTopColor: colors.line,
    },
    disclosureText: { fontSize: font.small, fontWeight: '700', color: colors.muted },
    details: { gap: space.sm },
    detailText: { fontSize: font.small, color: colors.muted, lineHeight: font.small * 1.5 },

    footnote: { fontSize: font.tiny, color: colors.faint, lineHeight: font.tiny * 1.5 },
  });
