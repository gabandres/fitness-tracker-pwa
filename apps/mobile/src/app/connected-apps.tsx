import Ionicons from '@expo/vector-icons/Ionicons';
import * as Application from 'expo-application';
import { useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import {
  Platform,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import Animated, { FadeInUp, FadeOut, ReduceMotion } from 'react-native-reanimated';
import { SafeAreaView } from 'react-native-safe-area-context';
import { BottomSheet } from '@/components/BottomSheet';
import { ConfirmHost, confirm } from '@/components/ConfirmSheet';
import { useAuth } from '@/lib/auth';
import { useLocale, useT } from '@/i18n';
import { announce } from '@/lib/a11y';
import { formatDate, formatNumber, formatTime } from '@/lib/date-format';
import { openHealthPermissions, useHealthSync } from '@/lib/health-sync';
import { useOura } from '@/lib/oura';
import * as haptics from '@/lib/haptics';
import { captureError } from '@/lib/sentry';
import { useTheme, useThemedStyles, type Theme } from '@/lib/theme-context';
import { font, radius, space } from '@/theme';

/**
 * `READ_EXERCISE` first shipped in an Android manifest at vc 38
 * (`patch-android-release.mjs` step 4b), so the "cardio import arrives with
 * the next update" line is true only on older binaries. It was unconditional
 * until 2026-09-03 and read as stale on vc 42, the first binary a Health
 * Connect grant actually succeeded on. Unknown build → assume old.
 */
const ANDROID_CARDIO_IN_BINARY = Number(Application.nativeBuildVersion ?? 0) >= 38;

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
 * ## Apple Health belongs here too, and the first version was wrong to split it
 *
 * It was left in Settings on the reasoning that it is an OS permission rather
 * than an OAuth account — no credential, no revocation page, no scopes. That
 * is a true distinction and the wrong one to organise a screen around: it
 * describes how the integration is *implemented*, not what it *is* to the
 * person using it. Someone asking "what is feeding my app?" means Apple Health
 * every bit as much as Oura, and answering that in two different places is how
 * the Settings page grew two near-identical sections in the first place.
 *
 * So both live here, and both get the same evidence: is it on, when did it last
 * run, what came back. The platform branches Health needs are a few lines, and
 * "the code is fiddlier" was never a reason to make the user look in two
 * places.
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
  const healthSync = useHealthSync(user?.uid);
  const [showDetails, setShowDetails] = useState(false);
  const [healthMsg, setHealthMsg] = useState<string | null>(null);
  /** The last Health answer was "denied" — the one outcome with a next step
   *  this screen can offer: the OS permission screen (Body review, U11). */
  const [healthDenied, setHealthDenied] = useState(false);
  const store = Platform.OS === 'ios' ? t('health.storeIos') : t('health.storeAndroid');
  const deniedMsg = Platform.OS === 'ios' ? t('settings.healthDeniedIos') : t('settings.healthDeniedAndroid');

  /** Results are SPOKEN (A9): a status line that changes under a button the
   *  user just pressed is invisible to VoiceOver otherwise. Android reads the
   *  line through its live region. */
  useEffect(() => {
    if (healthMsg) announce(healthMsg, { androidHasLiveRegion: true });
  }, [healthMsg]);
  /** The rationale sheet that precedes the OS health prompt (S18 "priming"):
   *  what is read, what is written, where it goes. Open only on a fresh
   *  connect — a reconnect for wider scopes already had the explanation. */
  const [healthPrimeOpen, setHealthPrimeOpen] = useState(false);

  /** The health calls do not catch (`health-sync.ts`); a rejection from the
   *  OS bridge used to leave the Switch flipped with nothing said and reach
   *  Sentry unhandled. The denied copy is the honest fallback: whatever the
   *  cause, Health is not connected. */
  async function connectHealthNow() {
    try {
      const ok = await healthSync.connect();
      setHealthDenied(!ok);
      setHealthMsg(ok ? t('settings.healthConnected') : deniedMsg);
    } catch (e) {
      setHealthDenied(true);
      setHealthMsg(deniedMsg);
      captureError(e, { where: 'connectedApps.toggleHealth' });
    }
  }

  async function toggleHealth(next: boolean) {
    haptics.tap();
    if (next) {
      // Explain first, ask second. The Switch stays off until the OS says
      // yes — its value is `healthSync.connected`, not this tap.
      setHealthPrimeOpen(true);
      return;
    }
    try {
      await healthSync.disconnect();
      setHealthMsg(null);
      setHealthDenied(false);
    } catch (e) {
      setHealthMsg(deniedMsg);
      captureError(e, { where: 'connectedApps.toggleHealth' });
    }
  }

  /** Re-prompt for the OS health scopes. Connecting again IS the whole fix —
   *  `connectHealth` stamps the current scope version only on success, so a
   *  declined prompt leaves the banner up rather than silently clearing it. */
  async function onHealthReconnect() {
    haptics.tap();
    try {
      const ok = await healthSync.connect();
      setHealthDenied(!ok);
      setHealthMsg(ok ? t('settings.healthConnected') : deniedMsg);
    } catch (e) {
      setHealthDenied(true);
      setHealthMsg(deniedMsg);
      captureError(e, { where: 'connectedApps.reconnect' });
    }
  }

  async function onHealthSyncNow() {
    haptics.tap();
    try {
      const n = await healthSync.syncNow();
      setHealthMsg(t('settings.healthSynced', { n: formatNumber(n, locale) }));
    } catch (e) {
      // Bug 10: this was a haptic and nothing else — a failed sync looked
      // exactly like a sync that found nothing new.
      haptics.warning();
      setHealthMsg(t('health.syncFailed', { store }));
      captureError(e, { where: 'connectedApps.syncNow' });
    }
  }

  const connected = oura.status.connected;

  /** Disconnecting deletes our copy of the grant, and coming back means the
   *  whole Oura sign-in again — so it asks first, and says so (re-score). */
  function confirmOuraDisconnect() {
    haptics.tap();
    confirm({
      title: t('oura.disconnectTitle'),
      body: t('oura.disconnectBody'),
      confirmText: t('oura.disconnect'),
      destructive: true,
      onConfirm: () => void oura.disconnect(),
    });
  }

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
  // `null` until the FIRST ready value: `useOuraStatus` starts at
  // `connected: false` before the snapshot lands, so seeding from that made an
  // already-linked user's first snapshot look like a fresh link — the success
  // banner and haptic fired on every visit to this screen.
  const wasConnected = useRef<boolean | null>(null);
  const [justConnected, setJustConnected] = useState(false);

  // The banner's entrance is Reanimated with `ReduceMotion.System` (A12 / bug
  // 11): it was an RN `Animated` back-ease that overshot to 1.0x scale for
  // everyone, Reduce Motion or not. Now a reduce-motion user gets a plain
  // appear/disappear; the 2.6 s life is a timer rather than an animation
  // sequence, so it holds either way.
  useEffect(() => {
    if (!oura.ready) return;
    if (wasConnected.current === false && connected) {
      setJustConnected(true);
      haptics.success();
      announce(t('connected.justConnected'));
    }
    wasConnected.current = connected;
  }, [connected, oura.ready, t]);
  useEffect(() => {
    if (!justConnected) return;
    const timer = setTimeout(() => setJustConnected(false), 2600);
    return () => clearTimeout(timer);
  }, [justConnected]);

  // Oura's outcome lines, spoken once per result (A9).
  useEffect(() => {
    if (oura.failed) announce(t('oura.failed'));
  }, [oura.failed, t]);
  useEffect(() => {
    const r = oura.result;
    if (!r) return;
    announce(!r.linked ? t('oura.needsReconnect') : r.written > 0 ? t('oura.synced', { n: r.written }) : t('oura.syncedNone'));
  }, [oura.result, t]);

  /** P2 is the lead's (a root-stack screen with a native back button); until
   *  then the in-screen chevron must still lead somewhere on a cold deep
   *  link, where there is nothing to go back TO. */
  function goBack() {
    const r = router as typeof router & { canGoBack?: () => boolean };
    if (typeof r.canGoBack === 'function' && !r.canGoBack()) router.replace('/settings');
    else router.back();
  }

  const healthLast = healthSync.lastSync ?? null;
  const healthWhen = healthLast
    ? `${formatDate(new Date(healthLast.atMs), locale, { month: 'short', day: 'numeric' })} ${formatTime(new Date(healthLast.atMs), locale)}`
    : null;
  const syncedAt = oura.status.lastSyncedAt;
  const records = oura.status.lastRecordCount;

  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      <View style={styles.header}>
        <TouchableOpacity
          onPress={goBack}
          hitSlop={10}
          style={styles.backBtn}
          accessibilityRole="button"
          accessibilityLabel={t('common.back')}
          testID="connected-apps-back"
        >
          <Ionicons name="chevron-back" size={26} color={colors.ink} />
        </TouchableOpacity>
        <Text style={styles.title} accessibilityRole="header">{t('connected.title')}</Text>
        {/* Balances the back chevron so the title is optically centred. */}
        <View style={styles.headerSpacer} />
      </View>

      <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
        <Text style={styles.subtitle}>{t('connected.intro')}</Text>

        {/* Health leads (re-score): it is where weigh-ins come from, and
            Body's footer sends people here to find it. */}
        {healthSync.available ? (
          <View style={styles.card} testID="provider-health">
            <View style={styles.cardHead}>
              <View style={styles.cardHeadText}>
                <Text style={styles.provider} accessibilityRole="header">
                  {Platform.OS === 'ios'
                    ? t('settings.healthConnectIos')
                    : t('settings.healthConnectAndroid')}
                </Text>
                <Text style={styles.providerSub}>{t('settings.healthSub')}</Text>
              </View>
              <Switch
                value={healthSync.connected}
                onValueChange={toggleHealth}
                trackColor={{ true: colors.tealSolid, false: colors.lineStrong }}
                // A bare Switch reads "switch, off" (A6) — sync WHAT, with whom.
                accessibilityLabel={t('health.switchA11y', { store })}
                testID="health-toggle"
              />
            </View>

            {healthSync.connected ? (
              <>
                {/*
                  Workout import state is STATED rather than inferred, because
                  an unauthorized read returns an EMPTY LIST on both platforms —
                  so "no permission" and "no workouts" are identical to the code
                  and must not be identical here.
                */}
                <View style={styles.evidence} testID="health-evidence">
                  {/* Bug 14: the evidence this card's header promised. */}
                  <Text style={styles.evidenceLine}>
                    {healthWhen ? t('health.lastSync', { when: healthWhen }) : t('health.lastSyncNever')}
                  </Text>
                  {healthLast ? (
                    <Text style={styles.evidenceLine}>
                      {healthLast.count > 0
                        ? t('health.lastCount', { n: formatNumber(healthLast.count, locale) })
                        : t('health.lastCountNone')}
                    </Text>
                  ) : null}
                  <Text style={styles.evidenceLine}>
                    {healthSync.needsReauth
                      ? t('health.reconnectBody')
                      : Platform.OS === 'android' && !ANDROID_CARDIO_IN_BINARY
                        ? t('health.androidPending')
                        : t('health.workoutsOn')}
                  </Text>
                  {!healthSync.needsReauth && Platform.OS === 'ios' ? (
                    <Text style={styles.evidenceLine}>{t('health.ouraHint')}</Text>
                  ) : null}
                </View>

                <View style={styles.actions}>
                  <TouchableOpacity
                    onPress={healthSync.needsReauth ? onHealthReconnect : onHealthSyncNow}
                    disabled={healthSync.syncing}
                    style={[styles.btn, styles.btnPrimary, healthSync.syncing && styles.btnDisabled]}
                    accessibilityRole="button"
                    accessibilityState={{ disabled: healthSync.syncing, busy: healthSync.syncing }}
                    testID="health-sync-now"
                  >
                    <Text style={[styles.btnText, styles.btnTextPrimary]}>
                      {healthSync.syncing
                        ? t('connected.syncing')
                        : healthSync.needsReauth
                          ? t('health.reconnect')
                          : t('settings.healthSyncNow')}
                    </Text>
                  </TouchableOpacity>
                </View>
              </>
            ) : null}

            {healthMsg ? (
              <Text style={styles.msg} accessibilityLiveRegion="polite" testID="health-msg">
                {healthMsg}
              </Text>
            ) : null}
            {/* Neither OS re-shows a declined permission prompt, so "denied"
                with no way forward was a dead end (U11). */}
            {healthDenied ? (
              <TouchableOpacity
                onPress={() => {
                  haptics.tap();
                  void openHealthPermissions();
                }}
                style={[styles.btn, styles.btnQuiet, styles.btnSolo]}
                accessibilityRole="button"
                testID="health-open-settings"
              >
                <Text style={[styles.btnText, styles.btnTextQuiet]}>
                  {Platform.OS === 'ios' ? t('health.openSettingsIos') : t('health.openSettingsAndroid')}
                </Text>
              </TouchableOpacity>
            ) : null}
          </View>
        ) : null}

        {justConnected ? (
          <Animated.View
            entering={FadeInUp.duration(320).reduceMotion(ReduceMotion.System)}
            exiting={FadeOut.duration(220).reduceMotion(ReduceMotion.System)}
            style={styles.success}
            accessibilityRole="alert"
            testID="oura-just-connected"
          >
            <Ionicons name="checkmark-circle" size={22} color={colors.tealSolid} />
            <Text style={styles.successText}>{t('connected.justConnected')}</Text>
          </Animated.View>
        ) : null}

        <View style={styles.card} testID="provider-oura">
          <View style={styles.cardHead}>
            <View style={styles.cardHeadText}>
              <Text style={styles.provider} accessibilityRole="header">{t('oura.title')}</Text>
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
            {/* The lock is shared, the words are not (bug 9 / C1): only the
                button whose action is RUNNING says so. */}
            <TouchableOpacity
              onPress={connected ? confirmOuraDisconnect : oura.connect}
              disabled={oura.busy || !oura.ready}
              style={[
                styles.btn,
                connected ? styles.btnQuiet : styles.btnPrimary,
                (oura.busy || !oura.ready) && styles.btnDisabled,
              ]}
              accessibilityRole="button"
              accessibilityState={{ disabled: oura.busy || !oura.ready, busy: oura.action === 'connect' || oura.action === 'disconnect' }}
              testID="oura-toggle"
            >
              <Text style={[styles.btnText, connected ? styles.btnTextQuiet : styles.btnTextPrimary]}>
                {oura.action === 'connect'
                  ? t('oura.connecting')
                  : oura.action === 'disconnect'
                    ? t('connected.disconnecting')
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
                accessibilityRole="button"
                accessibilityState={{ disabled: oura.busy, busy: oura.action === 'sync' }}
                testID="oura-sync-now"
              >
                <Text style={[styles.btnText, styles.btnTextPrimary]}>
                  {oura.action === 'sync' ? t('connected.syncing') : t('oura.syncNow')}
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
          {/* Declined-as-not-cardio is a DIFFERENT sentence from "no workouts",
              and #102 is what happens without it: this ring was fetching two
              real records on every sync, both `strengthTraining`, both
              correctly filtered — and the screen said the same thing it says
              for a ring that recorded nothing. The user has no way to tell a
              working integration from a broken one.

              Not phrased as a failure, because it is not one. Importing a
              strength session as cardio would duplicate what the user logs in
              Train by hand. */}
          {oura.result && oura.result.declined > 0 ? (
            <Text style={styles.msg}>{t('oura.declined', { n: oura.result.declined })}</Text>
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
            accessibilityRole="button"
            accessibilityState={{ expanded: showDetails }}
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

      {/* Same idiom as the rest-timer priming sheet on Train (`RestNotifySheet`)
          and `ConfirmSheet`: the app explains in its own voice, then the OS
          asks. Not now leaves the Switch off and nothing recorded — a user
          who wants to read the details first can flip it again. */}
      <BottomSheet
        visible={healthPrimeOpen}
        onClose={() => setHealthPrimeOpen(false)}
        backdropTestID="health-prime-backdrop"
        // P1: a real iOS sheet, sized to its text. Nothing typed, so not guarded.
        native
        detents="fit"
      >
        <View style={styles.primeWrap} testID="health-prime">
          <Text style={styles.primeTitle} accessibilityRole="header">
            {t('connected.healthPrime.title')}
          </Text>
          <Text style={styles.primeBody}>{t('connected.healthPrime.body')}</Text>
          <View style={styles.primeList}>
            <Text style={styles.primeLine}>{t('connected.healthPrime.reads')}</Text>
            <Text style={styles.primeLine}>{t('connected.healthPrime.writes')}</Text>
            <Text style={styles.primeLine}>{t('connected.healthPrime.privacy')}</Text>
          </View>
          <View style={styles.primeRow}>
            <TouchableOpacity
              style={[styles.btn, styles.btnQuiet, styles.primeBtn]}
              onPress={() => setHealthPrimeOpen(false)}
              accessibilityRole="button"
              testID="health-prime-not-now"
            >
              <Text style={[styles.btnText, styles.btnTextQuiet]}>{t('connected.healthPrime.notNow')}</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.btn, styles.btnPrimary, styles.primeBtn]}
              onPress={() => {
                haptics.tap();
                setHealthPrimeOpen(false);
                void connectHealthNow();
              }}
              accessibilityRole="button"
              testID="health-prime-continue"
            >
              <Text style={[styles.btnText, styles.btnTextPrimary]}>{t('connected.healthPrime.continue')}</Text>
            </TouchableOpacity>
          </View>
        </View>
      </BottomSheet>
      {/* A root-stack screen over the tabs: the tab layout's confirm host is
          underneath it, so confirms raised here are drawn by this one (the
          same arrangement as `scan.tsx`). */}
      <ConfirmHost />
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
    headerSpacer: { width: 44 },
    backBtn: { width: 44, minHeight: 44, justifyContent: 'center' },
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
    // 44 pt floor on every card button (A7); they were ~33.
    btn: {
      flex: 1,
      borderRadius: radius.md,
      paddingVertical: space.sm,
      paddingHorizontal: space.md,
      alignItems: 'center',
      justifyContent: 'center',
      minHeight: 44,
    },
    btnSolo: { flex: 0, alignSelf: 'stretch' },
    btnPrimary: { backgroundColor: colors.ink },
    btnQuiet: { borderWidth: 1, borderColor: colors.lineStrong },
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
      minHeight: 44,
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

    // `muted`, not `faint`: faint is 2.40:1 on light paper (S18-2) and these
    // are sentences, not decoration.
    footnote: { fontSize: font.tiny, color: colors.muted, lineHeight: font.tiny * 1.5 },

    primeWrap: { gap: space.sm, paddingTop: space.xs },
    primeTitle: { fontSize: font.h3, fontWeight: '800', color: colors.ink },
    primeBody: { fontSize: font.small, color: colors.muted, lineHeight: 20 },
    primeList: { gap: space.xs, paddingVertical: space.xs },
    primeLine: { fontSize: font.small, color: colors.ink, lineHeight: 20 },
    primeRow: { flexDirection: 'row', gap: space.md, marginTop: space.md },
    /** Every card button has the 44-pt floor now; the sheet's two get more
     *  padding as well, because they are the real decision. */
    primeBtn: { minHeight: 44, justifyContent: 'center', paddingVertical: space.md },
  });
