import Ionicons from '@expo/vector-icons/Ionicons';
import { useCameraPermissions } from 'expo-camera';
import { useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  AppState,
  Image,
  Linking,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { KeyboardAvoidingView } from 'react-native-keyboard-controller';
import Animated from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  findRepeatCandidates,
  hasUngroundedItems,
  parseTimeOfDay,
  rescaleScannedItem,
  setTimeOfDay,
  shiftTimeOfDay,
  sumScannedMacros,
  type CustomFood,
  type MealType,
  type RepeatCandidate,
  type ScannedFoodItem,
} from '@macrolog/core';
import { ConfirmHost, confirm } from '@/components/ConfirmSheet';
import { useDoneKeyProps } from '@/components/KeyboardBar';
import { MealSlotChips, TimeOfDayRow } from '@/components/EntryWhen';
import { ScanCamera } from '@/components/ScanCamera';
import { useAddReceipt } from '@/hooks/useAddReceipt';
import { useToday } from '@/hooks/useToday';
import { announce } from '@/lib/a11y';
import { isOffline, useIsOffline } from '@/lib/connectivity';
import { parseDecimal, settleWithin } from '@/lib/entry-input';
import { captureError } from '@/lib/sentry';
import { showToast } from '@/components/Toast';
import { type I18nKey, type TFn, useLocale, useT } from '@/i18n';
import * as haptics from '@/lib/haptics';
import {
  analyzeMealPhoto,
  encodeMealPhoto,
  pickMealPhoto,
  scanErrorMessage,
  type ScanSource,
} from '@/lib/mealScan';
import { formatNumber, quotaResetLabel } from '@/lib/date-format';
import { track } from '@/lib/analytics';
import { clearLogTimer, startLogTimer } from '@/lib/log-timer';
import { useAuth } from '@/lib/auth';
import { useOtaHold } from '@/lib/ota-hold';
import { clearScanDraft, readScanDraft, saveScanDraft } from '@/lib/scan-draft';
import { encodeEntryPrefill } from '@/lib/entry-prefill';
import { CountUpText, enterUp, PressScale } from '@/lib/motion';
import { useTheme, useThemedStyles, type Theme } from '@/lib/theme-context';
import { font, radius, space, TARGET, type } from '@/theme';

/**
 * `camera` is the in-app viewfinder (`ScanCamera`). The first shot of a meal
 * is analyzed at once (S20: shutter → Add, with Cancel on the wait), so a
 * plate with nothing to say about it never visits `describe` at all. Library
 * picks, and shots after a Cancel or an "Add another angle", collect in its
 * strip, with Analyze beside the shutter.
 * Until 2026-10-04 "Take photo" handed off to the system camera, whose shutter
 * and "Use Photo" confirm were two taps that bought nothing, and every photo
 * then went through `describe` — seven taps from the + to a logged plate.
 *
 * `describe` is now where the optional note is written, reached from the
 * viewfinder's "Add a note" chip, and still where a LIBRARY pick lands when
 * the camera is not available (ADR-0029 item 1). Its reasons stand, they just
 * no longer apply to every scan:
 *
 * 1. It is the only moment a note can exist. The note has to travel WITH the
 *    image — the model reads both together — so there is no way to collect it
 *    during `analyzing`, when the call has already left.
 * 2. It is where repeat detection runs, BEFORE any model call. A note that
 *    matches My Foods can end the flow with zero tokens spent and zero quota
 *    consumed, which turns the extra tap from a tax into a shortcut.
 *
 * The ADR proposed collecting the note pre-capture, on the reasoning that it
 * frames the shot. The owner's actual workflow is photo-first, and the ADR's own
 * instruction was to settle this by trying it rather than arguing — so it is
 * post-capture, where the user can see what they are describing.
 */
type Phase = 'intro' | 'camera' | 'describe' | 'analyzing' | 'review';
const PORTION_STEPS = [0.5, 1, 1.5, 2] as const;

/**
 * Images per scan (ADR-0029 item 5). Must match `MAX_PHOTOS` in
 * `functions/src/analyze-photo.ts`, which rejects anything above it — this
 * copy exists to stop the user reaching that rejection, not to enforce it.
 */
const MAX_PHOTOS = 3;

/**
 * A review row, plus the one thing the server never sends: `added` marks an
 * item the USER put on the list because the model missed it.
 *
 * Such a row has no database match and no model guess, so the grams cannot
 * derive its macros — kcal and protein are typed instead, and the row says so.
 * Kept local rather than on `ScannedFoodItem` in core: nothing past this screen
 * reads it (the plate is summed into one `DailyLog`), and the draft round-trips
 * it as plain JSON.
 */
type ReviewItem = ScannedFoodItem & {
  added?: boolean;
  /** The row's identity for React, minted when it joins the list. Nothing
   *  about the food itself is stable: a model estimate has no `fdcId`, and the
   *  name is the thing being typed — keyed on either, every keystroke in a
   *  name field remounted the row and dropped the keyboard after one letter. */
  key?: string;
  /** The typed text of an added row's kcal/protein, so "12." keeps its point
   *  while the user is still typing (the number alone would drop it). */
  draft?: { calories?: string; protein?: string };
};

/**
 * The three things a scan actually does, in the order it does them, each named
 * for what the user gets rather than what the code calls.
 *
 * Naming the wait is the cheapest latency work available here. The server side
 * is ~7.4 s on a cold instance and roughly half of that is Cloud Run starting a
 * container — a cost the cost rules say we accept rather than pay `minInstances`
 * to avoid (see `functions/src/analyze-photo.ts`). Given a wait we are not
 * removing, the remaining lever is making it read as progress instead of as a
 * hang. `resolving` is genuinely brief; it is listed because a step that
 * appears and passes quickly still tells the user the thing is moving.
 */
const SCAN_STEPS = ['preparing', 'reading', 'resolving'] as const;
type ScanStep = (typeof SCAN_STEPS)[number];

/** Review-row keys (`ReviewItem.key`). Module scope, minted in handlers only. */
let itemSeq = 0;
const nextItemKey = () => `item-${++itemSeq}`;

/** Give every row that lacks one a key — a fresh scan, or a draft written
 *  before rows carried them. A draft written since keeps its own. */
function withKeys(items: readonly ReviewItem[]): ReviewItem[] {
  return items.map((it) => (it.key ? it : { ...it, key: nextItemKey() }));
}

const STEP_LABEL: Record<ScanStep, I18nKey> = {
  preparing: 'scan.stepPreparing',
  reading: 'scan.stepReading',
  resolving: 'scan.stepResolving',
};

/**
 * Photo scan review (ADR-0015 §1).
 *
 * The server returns an ITEMIZED result — each food it recognized, with a
 * portion in grams and macros resolved from the bundled USDA database — so this
 * screen edits a list, not a single black-box total. Editing an item's grams
 * rescales its macros linearly, which is the correction users actually need:
 * the vision model is good at naming food and imperfect at sizing it, and the
 * grams are now the only number it contributes.
 *
 * Items the database could not resolve (mofongo, pernil — regional dishes USDA
 * does not carry) fall back to the model's own numbers and are marked. That
 * distinction is worth showing: ADR-0015 measured LLM protein estimates at >60%
 * error, so a model-sourced row deserves less trust than a database-sourced one,
 * and presenting both identically would hide exactly the thing the architecture
 * exists to fix.
 *
 * The whole plate is still logged as ONE entry, summed. Splitting it into N
 * `DailyLog` rows would change what streaks, counts and the Today list mean for
 * a single meal; that is a product decision, not a consequence of itemizing the
 * review.
 */
export default function Scan() {
  const t = useT();
  const locale = useLocale();
  const styles = useThemedStyles(createStyles);
  const { colors, scheme } = useTheme();
  const router = useRouter();
  // The top inset comes from the root provider, NOT a native `SafeAreaView`:
  // presented as a root-stack `fullScreenModal`, `<SafeAreaView edges={['top']}>`
  // measured a 0 top inset on iOS (2026-10-04, Maestro 06 on iOS 26), so the
  // header drew under the status bar — the title over the clock, and Back and
  // the avatar inside the band where taps never reach the app. The provider's
  // insets are the window's, which is what a full-screen modal covers.
  const insets = useSafeAreaInsets();
  // `customFoods` is already on this hook, so repeat detection adds NO new
  // Firestore subscription (ADR-0016's per-hook model, unchanged).
  const { addEntry, customFoods } = useToday();
  // The receipt ("Logged Rice + chicken · 640 kcal · Undo") is shown from here
  // and survives the replace back to Today: `ToastProvider` wraps the whole
  // tab navigator in `(app)/_layout.tsx`, not this screen.
  const receipt = useAddReceipt();
  const { user } = useAuth();
  const uid = user?.uid ?? null;

  // Seconds-per-log stopwatch (`lib/log-timer.ts`): the scan screen is a
  // logging surface, so the clock runs from the intro to the review's Add —
  // the wait a person actually experiences, model round-trip included.
  useEffect(() => {
    startLogTimer();
    return () => clearLogTimer();
  }, []);

  const [phase, setPhase] = useState<Phase>('intro');
  const [error, setError] = useState<string | null>(null);
  const [items, setItems] = useState<ReviewItem[]>([]);
  const [mealName, setMealName] = useState('');
  const [lowConf, setLowConf] = useState(false);
  // The server has always returned this and the app has never shown it, so a
  // user met the daily cap as a wall rather than as a countdown.
  const [remaining, setRemaining] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  /** Which portion chip is active. 1× is the scan as returned. */
  const [portion, setPortion] = useState(1);
  /** The just-captured frame, shown under the progress so the wait has a subject. */
  const [preview, setPreview] = useState<string | null>(null);
  const [step, setStep] = useState<ScanStep>('preparing');
  /** The user's own words about this meal (ADR-0029 item 1). Optional, always. */
  const [note, setNote] = useState('');
  /**
   * The picked photos, held while the user is on the describe step.
   *
   * Up to {@link MAX_PHOTOS} of ONE meal (ADR-0029 item 5). Every image is
   * charged against the daily quota separately, so the count is shown wherever
   * it can be — a free user spending all three daily scans on one meal should
   * know that before tapping Analyze, not after.
   */
  const [pendingUris, setPendingUris] = useState<string[]>([]);
  /** Focus the note on arrival — set only when the user asked for it ("Add a
   *  note"), so a library pick does not throw a keyboard over its photo. */
  const [noteFocus, setNoteFocus] = useState(false);
  /** The photos behind the review on screen — "Add another angle" puts them
   *  back in the viewfinder's strip. Empty for a restored draft (photos are
   *  not part of it), which then offers Retake only. */
  const [analyzedUris, setAnalyzedUris] = useState<string[]>([]);
  /** Bumped by Cancel during the wait (U9): a result for a run that is no
   *  longer this number is dropped on arrival. */
  const analyzeRun = useRef(0);
  const analyzingUris = useRef<string[]>([]);
  /** Add failed (B3): inline above the footer, where the user is looking. */
  const [addError, setAddError] = useState<string | null>(null);
  /**
   * Which meal, and when (U6). The review had neither, so a plate scanned at
   * 9 PM was filed by the clock at the moment of Add — the only fix was an
   * edit on Today. Untouched, both stay what they were: now, and the slot the
   * clock gives it (the write path's default).
   */
  const [slot, setSlot] = useState<MealType | undefined>(undefined);
  const [eatenAt, setEatenAt] = useState<Date>(() => new Date());
  const [timeTouched, setTimeTouched] = useState(false);
  const [timeDraft, setTimeDraft] = useState<string | null>(null);
  /** Known-offline (U9): photo scan is a model call, so say it BEFORE the
   *  photo is encoded and sent, and offer the search, which works offline. */
  const offline = useIsOffline();

  /**
   * Camera access, read through expo-camera because the viewfinder is
   * expo-camera's — the same OS permission the picker used to ask for.
   *
   * `camBlocked` is the one state with no OS prompt left: denied and not
   * askable again. Only then does the intro explain and offer Settings; any
   * earlier, an explanation before the system dialog is the pre-prompt App
   * Review rejected on BarcodeScanner (5.1.1(iv), submission 5ba1c7f5).
   */
  const [camPerm, requestCamPerm, getCamPerm] = useCameraPermissions();
  const camGranted = !!camPerm?.granted;
  const camBlocked = !!camPerm && !camPerm.granted && !camPerm.canAskAgain;

  // Coming back from Settings is a foreground, and the hook does not re-read
  // on its own — without this the intro kept saying "off" after the user had
  // just turned it on.
  useEffect(() => {
    if (!camBlocked) return;
    const sub = AppState.addEventListener('change', (s) => {
      if (s === 'active') void getCamPerm();
    });
    return () => sub.remove();
  }, [camBlocked, getCamPerm]);

  /**
   * Don't restart the process out from under this flow.
   *
   * `useAutoApplyOta` reloads on every background→active transition once a
   * bundle is pending, and leaving the app mid-scan is ordinary — you go and
   * read the label on the carton. On 2026-09-16 that combination ate a good
   * scan of a mango kefir: result at 00:30:24Z, gone by the time she came back,
   * re-logged by hand at 00:35. See `ota-hold.ts`. The update still applies, on
   * the next foreground after this screen is done.
   */
  useOtaHold(phase !== 'intro');

  /**
   * Restore a scan the process died in the middle of.
   *
   * The hold above removes the cause we control; this covers the ones we do not
   * (an iOS memory kill after the camera and the encode, a crash). A draft is
   * only ever on disk because something ended the process — leaving on purpose
   * clears it — so restoring straight into `review` is honest rather than
   * startling. See `scan-draft.ts`.
   */
  const [restored, setRestored] = useState(false);
  /** A review brought back from disk — it says so, and offers a plain Discard. */
  const [fromDraft, setFromDraft] = useState(false);
  /** When this scan's draft was FIRST written. Kept across restores so the
   *  draft's 6 h expiry runs from the scan, not from the last visit: re-stamping
   *  it on every restore made a review left with Back come back forever. */
  const draftAt = useRef<number | null>(null);
  useEffect(() => {
    if (!uid || restored) return;
    let alive = true;
    void readScanDraft(uid).then((d) => {
      if (!alive) return;
      setRestored(true);
      if (!d) return;
      draftAt.current = d.atMs;
      setFromDraft(true);
      setItems(withKeys(d.items));
      setMealName(d.mealName);
      setPortion(d.portion);
      setLowConf(d.lowConf);
      setNote(d.note);
      setRemaining(d.remaining);
      resetWhen();
      setPhase('review');
    });
    return () => {
      alive = false;
    };
  }, [uid, restored]);

  /**
   * Open straight into the viewfinder — "Scan meal" was the request, so the
   * intro's "Take photo" was a tap spent saying it twice.
   *
   * Only once permission is ALREADY granted (no prompt fires from a screen the
   * user has not acted on yet), only after the draft check has had its say (a
   * restored review must win — it is a meal they already paid a scan for), and
   * only once per visit: after a failed scan the intro carries the error, and
   * snapping back to the camera would hide it.
   */
  const autoOpened = useRef(false);
  const draftChecked = restored || !uid;
  useEffect(() => {
    if (autoOpened.current || !draftChecked || !camPerm) return;
    autoOpened.current = true;
    if (camGranted && phase === 'intro' && !error) setPhase('camera');
  }, [draftChecked, camPerm, camGranted, phase, error]);

  /**
   * Park every edit to the review, debounced.
   *
   * Debounced because `editGrams` fires per keystroke and the draft is only
   * worth what it is at the moment the process dies — a write a third of a
   * second behind the UI loses nothing a user would notice, and a write per
   * character is churn on a path that must never be the slow part of typing.
   */
  useEffect(() => {
    if (phase !== 'review' || !uid || !items.length) return;
    const id = setTimeout(() => {
      if (draftAt.current == null) draftAt.current = Date.now();
      void saveScanDraft({
        uid,
        atMs: draftAt.current,
        items,
        mealName,
        portion,
        lowConf,
        note,
        remaining,
      });
    }, 300);
    return () => clearTimeout(id);
  }, [phase, uid, items, mealName, portion, lowConf, note, remaining]);

  /**
   * Speak the scan's progress — every step, then the result.
   *
   * The labelled checklist is the whole point of the analyzing phase (see
   * `SCAN_STEPS`), and to a screen reader it was silent: VoiceOver stays on the
   * Analyze button that just unmounted, so a blind user waited ~7 s with no
   * sign anything was happening and then landed on a review they had not been
   * told about. Announced from the same real transitions the checklist renders
   * from, never a timer, for the same honesty reason.
   *
   * The result line fires only on analyzing → review, so a restored draft
   * (intro → review on mount) does not claim a scan just finished.
   */
  const prevPhase = useRef<Phase>(phase);
  useEffect(() => {
    const was = prevPhase.current;
    prevPhase.current = phase;
    if (phase === 'analyzing') {
      announce(t(STEP_LABEL[step]));
    } else if (phase === 'review' && was === 'analyzing' && items.length) {
      announce(t('scan.reviewReady', { kcal: formatNumber(Math.round(sumScannedMacros(items).calories), locale) }));
    }
    // `items` is read for the result line only; re-running on an edit would
    // re-announce nothing (the phase guard), but it is still not a trigger.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, step]);

  /**
   * Errors are spoken as well as drawn. The `<Text>` below carries an Android
   * live region; iOS has no equivalent and `role="alert"` is silent under
   * VoiceOver, so without this the quota message — the one error a user has to
   * act on — reached nobody who could not see it.
   */
  useEffect(() => {
    if (error) announce(error, { androidHasLiveRegion: true });
  }, [error]);

  /**
   * Back to Today, optionally opening its add sheet. A `replace` while this
   * screen is a hidden tab; once it is a root-stack `fullScreenModal` (P4) the
   * modal is dismissed onto Today with the same params instead — a replace
   * from inside the modal would stack Today on top of it.
   */
  function leaveToToday(params?: Record<string, string>) {
    const href = params ? { pathname: '/(app)' as const, params } : '/(app)';
    // `?.`: the screen's tests hand it a router with replace/back/push only.
    if (router.canDismiss?.()) router.dismissTo(href);
    else router.replace(href);
  }

  /** Leaving on purpose ends the scan. Only an accident leaves a draft behind —
   *  that is what makes an unexpected restore trustworthy. */
  function onBack() {
    // With a reviewed scan on screen, Back keeps the draft — the same as the
    // hardware back gesture — so coming back restores it. The scan has already
    // been charged to the daily quota; the top-left chevron used to throw it
    // away without a word while Retake, beside Add, asked first.
    if (!items.length) void clearScanDraft();
    router.back();
  }

  /**
   * Capture → analyze, with the waiting made legible.
   *
   * The ordering here is load-bearing. This used to `await captureMealPhoto()`
   * — picker AND resize AND base64 encode — before calling `setPhase`, so the
   * image work happened with the intro screen still rendered and no indicator
   * anywhere. On a mid device that is half a second to a second and a half in
   * which the app looks like it ignored the tap. Now the phase flips and the
   * captured frame renders the moment the picker returns; encoding runs behind
   * it.
   *
   * `step` drives the labelled progress. It is advanced from real transitions,
   * never a timer: a fake progress bar that finishes before the work does is
   * worse than a spinner, because it teaches users the app lies about waiting.
   */
  async function onCapture(source: ScanSource) {
    haptics.tap();
    setError(null);
    const uri = await pickMealPhoto(source);
    if (!uri) return; // cancelled or permission denied (no error banner on cancel)

    // Picked from the viewfinder's library button: it joins the strip there,
    // exactly as a shot would, and the user is still one tap from Analyze.
    if (phase === 'camera') {
      addPhoto(uri);
      return;
    }

    // Stop here. The photo is picked; the note and the repeat check happen
    // before anything is sent, which is the whole point of the step.
    // Appending, not replacing: this is also the "add another angle" path.
    setPendingUris((prev) => (prev.length >= MAX_PHOTOS ? prev : [...prev, uri]));
    if (phase !== 'describe') setNote('');
    setNoteFocus(false);
    setPhase('describe');
  }

  /**
   * A photo joins the viewfinder's strip, and says so.
   *
   * There is no "Use Photo" confirm any more, so this announcement is the only
   * thing telling a VoiceOver user the shutter worked — and "2 of 3" is the
   * part of the strip they cannot see.
   */
  function addPhoto(uri: string) {
    setError(null);
    if (pendingUris.length >= MAX_PHOTOS) return;
    setPendingUris((prev) => (prev.length >= MAX_PHOTOS ? prev : [...prev, uri]));
    announce(t('scan.photoAdded', { n: pendingUris.length + 1, max: MAX_PHOTOS }));
  }

  /**
   * The shutter. The FIRST shot of a meal goes straight to analysis — one
   * photo is the overwhelmingly common scan, and an Analyze tap after every
   * shutter press was a tap that asked nothing (+ → Scan meal → shutter → Add).
   * Cancel on the wait is the way back if the shot was wrong. A shot taken
   * with photos already in the strip (after a Cancel, or "Add another angle"
   * from the review) joins them, and Analyze sends them together.
   */
  function onShutter(uri: string) {
    if (pendingUris.length === 0) void onAnalyze([uri]);
    else addPhoto(uri);
  }

  /** "Search instead" — the add sheet's search works offline (the food index
   *  is on the device), where a photo scan cannot. */
  function searchInstead() {
    haptics.tap();
    void clearScanDraft();
    leaveToToday({ openAdd: String(Date.now()) });
  }

  /**
   * "Take photo" on the intro. The OS dialog fires on THIS tap when access was
   * never decided — the user has asked for the camera, so no pre-prompt of our
   * own comes first. A blocked camera does nothing here; the intro is already
   * showing the Settings line instead of this button.
   */
  async function openCamera() {
    haptics.tap();
    setError(null);
    let p = camPerm;
    if (!p?.granted && (p?.canAskAgain ?? true)) p = await requestCamPerm();
    if (!p?.granted) return;
    setPendingUris([]);
    setNote('');
    setPhase('camera');
  }

  /** "Add a note" from the viewfinder: the describe step, keyboard up. */
  function openNote() {
    haptics.tap();
    setNoteFocus(true);
    setPhase('describe');
  }

  /**
   * Where "start again" lands: the viewfinder when the camera is available —
   * a retake is a request to take a photo — else the intro.
   */
  const restartPhase: Phase = camGranted ? 'camera' : 'intro';

  /** Drop one pending photo. In the viewfinder the strip just shrinks; on the
   *  describe step, removing the last one goes back to where photos come from. */
  function removePending(index: number) {
    haptics.tap();
    setPendingUris((prev) => {
      const next = prev.filter((_, i) => i !== index);
      if (!next.length && phase !== 'camera') setPhase(restartPhase);
      return next;
    });
  }

  /**
   * Send the pending photo, with whatever the user typed.
   *
   * Everything below the picker is unchanged from before the describe step
   * existed, including the ordering that made the wait legible: the phase flips
   * and the captured frame renders first, and the encode runs behind it.
   */
  async function onAnalyze(shot?: string[]) {
    const uris = shot ?? pendingUris;
    if (!uris.length) return;
    haptics.tap();

    // Known offline: stop before the encode and the call (U9). The photos stay
    // in the strip, so Analyze is one tap once the connection is back — and
    // the search, which needs none, is offered beside the message.
    if (isOffline()) {
      setPendingUris(uris);
      setError(t('scan.errOffline'));
      setPhase(camGranted ? 'camera' : 'describe');
      haptics.warning();
      return;
    }

    const run = ++analyzeRun.current;
    analyzingUris.current = uris;
    setError(null);
    setPreview(uris[0]);
    setStep('preparing');
    setPhase('analyzing');

    try {
      track('photo_scan');
      // Encoded in parallel — three sequential resizes on a mid device is
      // three times the dead air, and they do not depend on each other.
      const encoded = (await Promise.all(uris.map(encodeMealPhoto))).filter(
        (b): b is string => typeof b === 'string' && b.length > 0,
      );
      if (run !== analyzeRun.current) return; // cancelled
      if (!encoded.length) throw new Error('encode');

      setStep('reading');
      const scan = await analyzeMealPhoto(encoded, locale, note);
      if (run !== analyzeRun.current) return; // cancelled while the model read
      if (!scan.items.length) throw new Error('empty');

      setStep('resolving');
      setItems(withKeys(scan.items));
      setPortion(1);
      setMealName(defaultMealName(scan.items, t('scan.mealName')));
      setLowConf(scan.confidence === 'low');
      setRemaining(scan.photosRemaining ?? null);
      setAnalyzedUris(uris);
      setFromDraft(false);
      resetWhen();
      setPhase('review');
      haptics.success();
    } catch (e) {
      if (run !== analyzeRun.current) return;
      // Say what actually went wrong. This used to be a bare `catch {}` that
      // rendered "Couldn't read that photo" for every failure — including the
      // daily quota, which is not about the photo and which retaking it can
      // only make worse. See `scanErrorMessage`. A connection lost mid-call is
      // said as that, not as a bad photo.
      const { key, params } = isOffline() ? { key: 'scan.errOffline' as const, params: {} } : scanErrorMessage(e);
      setError(t(key, { ...params, time: quotaResetLabel(locale) }));
      setPhase('intro');
      haptics.warning();
    } finally {
      if (run === analyzeRun.current) {
        setPreview(null);
        setPendingUris([]);
      }
    }
  }

  /**
   * Cancel on the wait (U9). The call cannot be recalled — the server may
   * still count it — but the user is not held hostage by a 7 s cold start for
   * a photo they already know is wrong. The photos go back to the strip.
   */
  function cancelAnalyze() {
    haptics.tap();
    analyzeRun.current++;
    setPreview(null);
    setPendingUris(analyzingUris.current);
    setPhase(restartPhase === 'camera' ? 'camera' : 'describe');
  }

  /**
   * Take a prior food from the describe step to an EDITABLE DRAFT on Today's
   * add sheet (ADR-0029 item 3; its open question settled by the owner on
   * 2026-09-08: review, never log silently — the trust rule every other path
   * already follows).
   *
   * **No model call, no quota slot, no spend.** The macros are ones this person
   * entered and kept, which is better evidence for their own food than anything
   * a vision model produces from a photograph of it. Until 2026-09-08 this
   * wrote the row directly; a device run that day showed the suggestion is
   * offered at exactly the moment the user is least likely to check it, which
   * is the argument `meal-repeat.ts` makes against itself.
   *
   * The stated quantity is applied only when the note actually stated one —
   * `findRepeatCandidates` returns `null` rather than 1 for an unstated amount,
   * so "greek yogurt" drafts one stored serving and "2 cups of greek yogurt"
   * does not silently become one.
   */
  function logRepeat(c: RepeatCandidate<CustomFood>) {
    if (saving) return;
    haptics.tap();
    void clearScanDraft();
    const mult = c.quantity != null && c.quantity > 0 ? c.quantity : 1;
    const f = c.food;
    leaveToToday({
      openAdd: `repeat-${Date.now()}`,
      prefill: encodeEntryPrefill({
        calories: Math.round(f.calories * mult),
        protein: Math.round((f.protein ?? 0) * mult),
        carbs: Math.round((f.carbs ?? 0) * mult),
        fat: Math.round((f.fat ?? 0) * mult),
        mealLabel: f.name,
      }),
    });
  }

  /**
   * Portion chips scale the WHOLE plate — "that was a bigger serving than it
   * looks" — while per-item grams handle one food being off.
   *
   * ## The chips are ABSOLUTE, not multipliers on what is already there
   *
   * This used to be `scalePortion(it, mult)` applied to the current items,
   * which compounded: 1.5× twice was 2.25×, **1× was a no-op rather than a
   * reset**, and 0.5× then 1× left the plate permanently at half. Nothing on
   * screen said which portion was active, so the drift was invisible — reported
   * from a device 2026-08-08.
   *
   * Scaling by `next / portion` makes each chip mean what it says, makes them
   * idempotent, and keeps any per-item gram edits the user has already made
   * (they ride along proportionally, which is the intent — the chip is about
   * the serving, not about correcting one food).
   */
  function applyPortion(next: number) {
    if (next === portion) return;
    haptics.selection();
    const relative = next / portion;
    setItems((prev) => prev.map((it) => scalePortion(it, relative)));
    setPortion(next);
  }

  function editGrams(index: number, raw: string) {
    // Read the way the locale writes it (`parseDecimal`): a pt-BR `12,5` is
    // 12.5, not 125 — and an English `1,250` is 1250, not 1.25.
    const n = parseDecimal(raw, locale) ?? 0;
    setItems((prev) => prev.map((it, i) => (i === index ? rescaleScannedItem(it, n) : it)));
  }

  function editName(index: number, value: string) {
    setItems((prev) => prev.map((it, i) => (i === index ? { ...it, name: value } : it)));
  }

  function removeItem(index: number) {
    haptics.tap();
    setItems((prev) => prev.filter((_, i) => i !== index));
  }

  /**
   * Put something on the plate the model missed — the side of beans behind
   * the plantains, the sauce it could not see.
   *
   * Before this the only fix was to log the scan and then add the rest by hand
   * on Today, which splits one meal into two rows and costs a second trip
   * through the sheet. The row is blank and typed, not resolved: there is no
   * photo of it to send and no model call to spend, and a USDA lookup belongs
   * to the search sheet rather than a second copy of it here.
   */
  function addItem() {
    haptics.tap();
    const key = nextItemKey();
    setItems((prev) => [
      ...prev,
      { name: '', grams: 0, calories: 0, protein: 0, carbs: 0, fat: 0, confidence: 1, added: true, key },
    ]);
  }

  /**
   * kcal / protein on a user-added row. The typed numbers ARE the portion —
   * an added row has no grams field (see `ItemRow`): with one, typing "150" g
   * after 200 kcal rescaled per keystroke from a 1 g basis to 30,000 kcal.
   * `basis` is still dropped so the plate-wide portion chips scale from these.
   */
  function editMacro(index: number, field: 'calories' | 'protein', raw: string) {
    const v = parseDecimal(raw, locale) ?? 0;
    setItems((prev) =>
      prev.map((it, i) =>
        i === index
          ? { ...it, [field]: v, basis: undefined, draft: { ...it.draft, [field]: raw } }
          : it,
      ),
    );
  }

  /** A restored review's way out that is not "retake": just let it go. */
  function onDiscardRestored() {
    haptics.tap();
    confirm({
      title: t('scan.retakeConfirmTitle'),
      confirmText: t('scan.discard'),
      destructive: true,
      onConfirm: discardScan,
    });
  }

  /** "Which meal, and when" back to untouched: now, and the clock's slot. */
  function resetWhen() {
    setSlot(undefined);
    setEatenAt(new Date());
    setTimeTouched(false);
    setTimeDraft(null);
  }

  /** A stepper, a typed time or the native picker. Today only, never the
   *  future (`shiftTimeOfDay` clamps both) — the scan logs to today. The iOS
   *  picker plays its own selection tick (`NativeDateField`), so a change from
   *  it passes `ticked` and this one stays quiet (re-score bug 3: two ticks per
   *  turn of the wheel). */
  function applyTime(next: Date, ticked = false) {
    setTimeTouched(true);
    if (next.getTime() === eatenAt.getTime()) return;
    if (!ticked) haptics.selection();
    setEatenAt(next);
  }

  function commitTypedTime() {
    if (timeDraft == null) return;
    const text = timeDraft;
    setTimeDraft(null);
    if (text.trim() === '') return;
    const parsed = parseTimeOfDay(text);
    if (!parsed) {
      haptics.warning();
      return;
    }
    applyTime(setTimeOfDay(eatenAt, parsed.hours, parsed.minutes, new Date()));
  }

  /**
   * "Add another angle" on the review. The plate is read again from every
   * photo — a second scan for the first photo too, and the edits made here go
   * with the old reading — so it asks, like Retake.
   */
  function onAddAngle() {
    haptics.tap();
    confirm({
      title: t('scan.addAngleTitle'),
      body: t('scan.addAngleBody', { n: analyzedUris.length + 1 }),
      confirmText: t('scan.addAngleConfirm'),
      cancelText: t('scan.keepThis'),
      onConfirm: () => {
        const uris = analyzedUris;
        discardScan();
        setPendingUris(uris);
        if (!camGranted) void onCapture('library');
      },
    });
  }

  /** Throw the reviewed scan away and start over. */
  function discardScan() {
    draftAt.current = null;
    setFromDraft(false);
    setAnalyzedUris([]);
    setAddError(null);
    setPhase(restartPhase);
    setItems([]);
    setPortion(1);
    // The old scan's note would otherwise ride along with the next photo.
    setNote('');
    // Retake is leaving on purpose too: with `items` empty the save
    // effect stops writing but never removes what it wrote, so the
    // thrown-away scan came back as a "restored" review next mount.
    void clearScanDraft();
  }

  /**
   * Retake sits beside Add, a thumb's width from it, and the scan behind it
   * has already been charged to the daily quota — a free user has three. One
   * mis-tap used to throw a paid-for result away with no way back, so it asks
   * first. The describe step's Retake does not: nothing has been sent yet.
   */
  function onRetake() {
    haptics.tap();
    confirm({
      title: t('scan.retakeConfirmTitle'),
      body: t('scan.retakeConfirmBody'),
      confirmText: t('scan.retakeConfirm'),
      destructive: true,
      onConfirm: discardScan,
    });
  }

  async function onAdd() {
    if (!items.length || saving) return;
    setSaving(true);
    setAddError(null);
    // A typed time still open counts — Add is outside the scroll area, so it
    // does not blur the field (the same rule as the add sheet's form).
    const typed = timeDraft != null && timeDraft.trim() !== '' ? parseTimeOfDay(timeDraft) : null;
    const at = typed ? setTimeOfDay(eatenAt, typed.hours, typed.minutes, new Date()) : eatenAt;
    try {
      const total = sumScannedMacros(items);
      const label = mealName.trim() || t('scan.mealName');
      const calories = Math.round(total.calories);
      const write = addEntry({
        calories,
        protein: Math.round(total.protein),
        carbs: Math.round(total.carbs),
        fat: Math.round(total.fat),
        mealLabel: label,
        // Untouched → absent: "now" and the clock's slot, decided at the write.
        ...(slot ? { mealType: slot } : {}),
        ...(timeTouched || typed ? { timestamp: at } : {}),
        // The ONE place a photo-scanned row is distinguishable from a typed one
        // (#109). It is what `first-scan` is awarded on, so it is set here and
        // nowhere else — `logRepeat` above deliberately does NOT set it: that
        // path makes no model call, spends no quota and reads no photograph,
        // and marking it `photo` would award the milestone to somebody who
        // never took one.
        source: 'photo',
      });
      // Up to SAVE_WAIT_MS for the answer, then Today regardless (re-score
      // bug 4): on a weak signal `addEntry` takes up to 8 s to decide, and Add
      // spun for all of it. A late answer is reported by the receipt instead.
      const early = await settleWithin(write);
      if (!early.settled) {
        leaveToToday();
        void write
          .then(async (late) => {
            if (late?.outcome === 'rejected') {
              // Nothing was saved and the review is gone from screen — but its
              // draft is still on disk, so Edit reopens the scan on it (the
              // restore path) rather than asking for a second photo.
              haptics.warning();
              showToast(t('entry.rejectedNamed', { label }), {
                action: { label: t('common.edit'), onPress: () => router.navigate('/scan') },
                testID: 'toast-rejected',
              });
              return;
            }
            await clearScanDraft();
            haptics.success();
            receipt.showAdded(late, { label, calories });
          })
          .catch((e) => {
            haptics.warning();
            captureError(e, { where: 'scan.addLate' });
          });
        return;
      }
      const r = early.value;
      // Refused by the rules: nothing was written, so the review — and the
      // draft protecting it — stays. Said here, where the user is looking.
      if (r?.outcome === 'rejected') throw new Error('add rejected');
      // The row is written; the draft has nothing left to protect. Cleared
      // BEFORE navigating so a restart during the transition cannot resurrect a
      // meal the user has already logged.
      await clearScanDraft();
      haptics.success();
      // The same receipt + Undo every other add surface shows (useAddReceipt).
      // Shown BEFORE the replace: the toast lives in the tab layout, so it is
      // still on screen when Today paints, and a scan was the one add that
      // left the user to infer from the rings whether it had landed.
      receipt.showAdded(r, { label, calories });
      leaveToToday(); // back to Today — rings re-sweep to the new total
    } catch (e) {
      // It used to be try/finally with no catch: a failed add was an
      // unhandled rejection and a button that simply stopped saying "Saving…"
      // (B3). The review stays, the draft with it, and the line says why.
      haptics.warning();
      setAddError(t('scan.addFailed'));
      announce(t('scan.addFailed'), { androidHasLiveRegion: true });
      captureError(e, { where: 'scan.add' });
    } finally {
      setSaving(false);
    }
  }

  const total = sumScannedMacros(items);
  const ungrounded = hasUngroundedItems(items);
  /** Any item whose grams came off a scale in the photo (ADR-0029 item 2/4). */
  const anyMeasured = items.some((i) => i.measured);
  /**
   * Prior foods this note plausibly names. Recomputed as the user types, which
   * is free — the matcher is pure, runs over the already-subscribed My Foods
   * list, and makes no network call.
   *
   * It returns `[]` for most notes on purpose. See `meal-repeat.ts`: a wrong
   * "you logged this before" is worse than no suggestion, because it is offered
   * at the moment the user is least likely to check it.
   */
  const repeats = findRepeatCandidates(note, customFoods);

  /**
   * What the viewfinder / describe step says above its controls: the error
   * from the last attempt, else a standing "you're offline" (U9) — said BEFORE
   * the shutter, so the photo is not taken, encoded and sent to fail. Both
   * offer the search when the network is the problem.
   */
  const offlineError = error === t('scan.errOffline');
  const notice = error
    ? { text: error, onSearch: offlineError ? searchInstead : undefined }
    : offline
      ? { text: t('scan.offlineNotice'), onSearch: searchInstead }
      : null;

  return (
    <View style={[styles.screen, { paddingTop: insets.top }]} testID="scan-screen">
      {/* A full-screen modal leaves by Close, not Back, and carries no
          account avatar (S21): the chevron read as a step back inside a
          stack, and Settings from the middle of a scan is a door out of a
          task nobody needs there. Each platform's own idiom — iOS's "Cancel"
          in words, Material's ✕ for a full-screen dialog — on the same
          `onBack`, which keeps a reviewed scan's draft exactly as before. */}
      <View style={styles.header}>
        <PressScale
          style={Platform.OS === 'ios' ? styles.cancel : styles.back}
          onPress={onBack}
          scaleTo={0.9}
          testID="scan-back"
          accessibilityRole="button"
          accessibilityLabel={Platform.OS === 'ios' ? t('common.cancel') : t('a11y.close')}
        >
          {Platform.OS === 'ios' ? (
            <Text style={styles.cancelText} maxFontSizeMultiplier={1.6}>{t('common.cancel')}</Text>
          ) : (
            <Ionicons name="close" size={24} color={colors.ink} />
          )}
        </PressScale>
        <Text style={styles.title} accessibilityRole="header">{t('scan.title')}</Text>
      </View>

      {phase === 'camera' ? (
        <ScanCamera
          photos={pendingUris}
          max={MAX_PHOTOS}
          hasNote={!!note.trim()}
          footnote={
            pendingUris.length > 1
              ? t('scan.multiCost', { n: pendingUris.length })
              : remaining != null && remaining <= 2
                ? t('scan.remaining', { n: remaining })
                : null
          }
          notice={notice}
          onShot={onShutter}
          onRemove={removePending}
          onLibrary={() => onCapture('library')}
          onNote={openNote}
          onAnalyze={() => void onAnalyze()}
        />
      ) : phase === 'describe' ? (
        // KeyboardAvoidingView from react-native-keyboard-controller, as on the
        // other input screens (feedback.tsx says why not RN's): the note field
        // sits under the photo and the keyboard covered it and Analyze both.
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.kav}>
        <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
          {notice ? <ScanNotice notice={notice} styles={styles} t={t} /> : null}
          {/* One photo fills the width; several become a strip. A single
              image is the overwhelmingly common case and should not be shrunk
              into a gallery to accommodate a case the user has not chosen.
              None yet: the note was opened from the viewfinder before the
              shot, which is how a note reaches a shutter that analyzes. */}
          {pendingUris.length === 0 ? null : pendingUris.length === 1 ? (
            <Image source={{ uri: pendingUris[0] }} style={styles.notePreview} resizeMode="cover" />
          ) : (
            <View style={styles.shotRow}>
              {pendingUris.map((uri, i) => (
                <View key={uri} style={styles.shotWrap}>
                  <Image source={{ uri }} style={styles.shot} resizeMode="cover" />
                  <PressScale
                    style={styles.shotRemove}
                    scaleTo={0.9}
                    onPress={() => removePending(i)}
                    testID={`scan-shot-remove-${i}`}
                    accessibilityRole="button"
                    // Three identical "Remove" buttons in a row told a screen
                    // reader nothing about which photo each one drops.
                    accessibilityLabel={t('scan.removePhoto', { n: i + 1 })}
                    // 22pt disc, so the slop carries it to the full target.
                    hitSlop={(TARGET - 22) / 2}
                  >
                    <Ionicons name="close" size={14} color={colors.onInk} />
                  </PressScale>
                </View>
              ))}
            </View>
          )}

          {pendingUris.length > 0 && pendingUris.length < MAX_PHOTOS ? (
            <PressScale
              style={styles.addShot}
              scaleTo={0.97}
              // Back to the viewfinder when there is one — "another angle"
              // means another shot of the same plate, and the strip there
              // keeps this one. The library is the fallback, not the default.
              onPress={() => {
                if (camGranted) {
                  haptics.tap();
                  setPhase('camera');
                } else {
                  void onCapture('library');
                }
              }}
              testID="scan-add-photo"
              accessibilityRole="button"
            >
              <Ionicons name="add" size={18} color={colors.ink} />
              <Text style={styles.addShotText}>
                {t('scan.addPhoto', { n: MAX_PHOTOS - pendingUris.length })}
              </Text>
            </PressScale>
          ) : null}

          {pendingUris.length > 1 ? (
            <View style={styles.hintRow}>
              <Ionicons name="information-circle-outline" size={16} color={colors.muted} />
              <Text style={styles.hintText}>{t('scan.multiCost', { n: pendingUris.length })}</Text>
            </View>
          ) : null}

          <Animated.View entering={enterUp(0)}>
            <Text style={styles.noteTitle}>{t('scan.noteTitle')}</Text>
            <TextInput
              style={styles.noteInput}
              value={note}
              onChangeText={setNote}
              accessibilityLabel={t('scan.noteTitle')}
              accessibilityHint={t('scan.noteHelp')}
              placeholder={t('scan.notePlaceholder')}
              placeholderTextColor={colors.faint}
              multiline
              maxLength={250}
              autoFocus={noteFocus}
              testID="scan-note"
            />
            <Text style={styles.noteHelp}>{t('scan.noteHelp')}</Text>
          </Animated.View>

          {/* Repeat detection (ADR-0029 item 3). Shown only when the matcher is
              confident, which is rarely — see meal-repeat.ts. Tapping one logs
              the user's OWN stored macros and never calls the model. */}
          {repeats.length ? (
            <Animated.View style={styles.repeatBox} entering={enterUp(1)}>
              <Text style={styles.repeatTitle}>{t('scan.repeatTitle')}</Text>
              {repeats.map((c) => (
                <PressScale
                  key={c.food.id ?? c.food.name}
                  style={styles.repeatRow}
                  scaleTo={0.97}
                  onPress={() => logRepeat(c)}
                  testID={`scan-repeat-${c.food.id ?? c.food.name}`}
                  accessibilityRole="button"
                >
                  <View style={styles.repeatMain}>
                    <Text style={styles.repeatName} numberOfLines={1}>{c.food.name}</Text>
                    <Text style={styles.repeatMeta} numberOfLines={1}>
                      {formatNumber(Math.round(c.food.calories), locale)} {t('today.kcal')}
                      {c.brandMatched && c.food.brand
                        ? ` · ${t('scan.repeatBrand', { brand: c.food.brand })}`
                        : ''}
                    </Text>
                  </View>
                  <Text style={styles.repeatUse}>{t('scan.repeatUse')}</Text>
                </PressScale>
              ))}
            </Animated.View>
          ) : null}

          {pendingUris.length > 0 ? (
            <>
              <PressScale
                style={styles.noteAnalyze}
                scaleTo={0.97}
                onPress={() => void onAnalyze()}
                testID="scan-analyze"
                accessibilityRole="button"
              >
                <Text style={styles.noteAnalyzeText}>{t('scan.noteAnalyze')}</Text>
              </PressScale>
              <PressScale
                style={styles.noteRetake}
                scaleTo={0.97}
                onPress={() => { haptics.tap(); setPhase(restartPhase); setPendingUris([]); setNote(''); }}
                testID="scan-describe-cancel"
                accessibilityRole="button"
              >
                <Text style={styles.noteRetakeText}>{t('scan.retake')}</Text>
              </PressScale>
            </>
          ) : (
            // Note first, photo second: back to the viewfinder, note kept —
            // the shutter there sends both.
            <PressScale
              style={styles.noteAnalyze}
              scaleTo={0.97}
              onPress={() => {
                haptics.tap();
                if (camGranted) setPhase('camera');
                else void onCapture('library');
              }}
              testID="scan-note-done"
              accessibilityRole="button"
            >
              <Text style={styles.noteAnalyzeText}>{t('scan.noteThenPhoto')}</Text>
            </PressScale>
          )}
        </ScrollView>
        </KeyboardAvoidingView>
      ) : phase === 'analyzing' ? (
        <View style={styles.fill}>
          {/* The captured frame, so the wait has a subject and the user can see
              the app got the right photo without waiting to find out. */}
          {preview ? <Image source={{ uri: preview }} style={styles.preview} /> : null}
          <View style={styles.steps}>
            {SCAN_STEPS.map((s, i) => {
              const active = s === step;
              const done = SCAN_STEPS.indexOf(step) > i;
              return (
                <View key={s} style={styles.stepRow}>
                  {done ? (
                    <Ionicons name="checkmark-circle" size={18} color={colors.teal} />
                  ) : active ? (
                    <ActivityIndicator size="small" color={colors.accent} />
                  ) : (
                    <Ionicons name="ellipse-outline" size={18} color={colors.faint} />
                  )}
                  <Text
                    style={[
                      styles.stepText,
                      active && styles.stepTextOn,
                      done && styles.stepTextDone,
                    ]}
                  >
                    {t(STEP_LABEL[s])}
                  </Text>
                </View>
              );
            })}
          </View>
          {/* The way out of a wait the user already knows is wrong (U9). */}
          <PressScale
            style={styles.cancelScan}
            scaleTo={0.97}
            onPress={cancelAnalyze}
            testID="scan-cancel"
            accessibilityRole="button"
          >
            <Text style={styles.cancelScanText}>{t('common.cancel')}</Text>
          </PressScale>
        </View>
      ) : phase === 'review' && items.length ? (
        // Same keyboard handling as the describe step, and here it also lifts
        // the Add footer: editing the last item's grams used to hide both the
        // field being typed in and the button that saves it.
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.kav}>
          <ScrollView
            contentContainerStyle={styles.body}
            keyboardShouldPersistTaps="handled"
            // A drag puts the number pad away (re-score gap 1): the per-item
            // fields had no Return key and no toolbar, so nothing did.
            keyboardDismissMode={Platform.OS === 'ios' ? 'interactive' : 'on-drag'}
          >
            {fromDraft ? (
              <View style={styles.restored} testID="scan-restored">
                <Ionicons name="time-outline" size={18} color={colors.ink} />
                <Text style={styles.restoredText}>{t('scan.restoredNote')}</Text>
                <PressScale
                  onPress={onDiscardRestored}
                  scaleTo={0.95}
                  style={styles.restoredDiscard}
                  accessibilityRole="button"
                  testID="scan-discard-restored"
                >
                  <Text style={styles.restoredDiscardText}>{t('scan.discard')}</Text>
                </PressScale>
              </View>
            ) : null}
            {lowConf ? (
              <Animated.View style={styles.lowConf} entering={enterUp(0)}>
                <Ionicons name="alert-circle-outline" size={18} color={colors.ink} />
                <Text style={styles.lowConfText}>{t('scan.lowConf')}</Text>
              </Animated.View>
            ) : null}

            {/* Hero total (the reward moment), on the shared dark panel. */}
            <Animated.View style={styles.heroPanel} entering={enterUp(lowConf ? 1 : 0)}>
              <View style={styles.hero}>
                <CountUpText value={Math.round(total.calories)} style={styles.heroValue} testID="scan-calories" />
                <Text style={styles.heroUnit} maxFontSizeMultiplier={1.6}>{t('today.kcal')}</Text>
              </View>
              <TextInput
                style={styles.nameInput}
                maxFontSizeMultiplier={1.4}
                keyboardAppearance={scheme}
                value={mealName}
                onChangeText={setMealName}
                placeholder={t('scan.mealName')}
                placeholderTextColor={colors.heroMuted}
                accessibilityLabel={t('scan.mealNameLabel')}
                testID="scan-name"
              />
            </Animated.View>

            {/* Read-only macro totals — the editable numbers are the per-item
                grams below, since every macro is derived from them. */}
            <Animated.View style={styles.totalRow} entering={enterUp(2)}>
              {/* Each chip is read as one item with its unit (re-score gap 4):
                  "Protein" and "32" were two stops, and the grams unsaid. */}
              <TotalChip
                label={t('history.protein')}
                value={total.protein}
                a11yLabel={t('entry.proteinAmount', { n: formatNumber(Math.round(total.protein), locale) })}
                styles={styles}
                testID="scan-protein"
              />
              <TotalChip
                label={t('today.carbs')}
                value={total.carbs}
                a11yLabel={t('entry.carbsAmount', { n: formatNumber(Math.round(total.carbs), locale) })}
                styles={styles}
                testID="scan-carbs"
              />
              <TotalChip
                label={t('today.fat')}
                value={total.fat}
                a11yLabel={t('entry.fatAmount', { n: formatNumber(Math.round(total.fat), locale) })}
                styles={styles}
                testID="scan-fat"
              />
            </Animated.View>

            {/* Items */}
            <Animated.View entering={enterUp(3)} style={styles.itemsBlock}>
              <Text style={styles.section} accessibilityRole="header">{t('scan.items')}</Text>
              {items.map((it, i) => (
                <ItemRow
                  key={it.key ?? String(i)}
                  item={it}
                  index={i}
                  styles={styles}
                  colors={colors}
                  t={t}
                  onName={editName}
                  onGrams={editGrams}
                  onMacro={editMacro}
                  onRemove={removeItem}
                />
              ))}
              <PressScale
                style={styles.addItem}
                scaleTo={0.97}
                onPress={addItem}
                testID="scan-add-item"
                accessibilityRole="button"
              >
                <Ionicons name="add" size={18} color={colors.ink} />
                <Text style={styles.addShotText}>{t('scan.addItem')}</Text>
              </PressScale>
            </Animated.View>

            {ungrounded ? (
              <Animated.View style={styles.hintRow} entering={enterUp(4)}>
                <Ionicons name="information-circle-outline" size={16} color={colors.muted} />
                <Text style={styles.hintText}>{t('scan.estimateHint')}</Text>
              </Animated.View>
            ) : null}

            {anyMeasured ? (
              <Animated.View style={styles.hintRow} entering={enterUp(4)}>
                <Ionicons name="scale-outline" size={16} color={colors.muted} />
                <Text style={styles.hintText}>{t('scan.measuredHint')}</Text>
              </Animated.View>
            ) : null}

            {/* Whole-plate portion */}
            <Animated.View entering={enterUp(5)}>
              <Text style={styles.section} accessibilityRole="header">{t('scan.portion')}</Text>
              {/* One of four, so a radio group (A2) — "1.5×, radio button, 3
                  of 4, checked" rather than a row of unrelated buttons. */}
              <View style={styles.portionRow} accessibilityRole="radiogroup">
                {PORTION_STEPS.map((p) => (
                  <PressScale
                    key={p}
                    style={[styles.portionChip, p === portion && styles.portionChipOn]}
                    scaleTo={0.92}
                    onPress={() => applyPortion(p)}
                    accessibilityRole="radio"
                    accessibilityLabel={t('entry.scaleBy', { n: formatNumber(p, locale) })}
                    accessibilityState={{ checked: p === portion, selected: p === portion }}
                    testID={`portion-${p}`}
                  >
                    <Text style={[styles.portionText, p === portion && styles.portionTextOn]}>
                      {formatNumber(p, locale)}×
                    </Text>
                  </PressScale>
                ))}
              </View>
            </Animated.View>

            {/* Which meal, and when (U6) — the add sheet's own controls. */}
            <Animated.View entering={enterUp(6)} style={styles.whenBlock}>
              <Text style={styles.section} accessibilityRole="header">{t('entry.meal')}</Text>
              <MealSlotChips value={slot} onChange={setSlot} />
              <Text style={styles.section} accessibilityRole="header">{t('entry.time')}</Text>
              <TimeOfDayRow
                at={eatenAt}
                draft={timeDraft}
                onDraftChange={setTimeDraft}
                onStep={(m) => applyTime(shiftTimeOfDay(eatenAt, m, new Date()))}
                onCommit={commitTypedTime}
                onSet={(next) => applyTime(next, Platform.OS === 'ios')}
              />
            </Animated.View>

            {/* Another photo of the same plate, read again with this one. Not
                for a restored draft: its photos did not survive the restart. */}
            {analyzedUris.length > 0 && analyzedUris.length < MAX_PHOTOS ? (
              <PressScale
                style={styles.addShot}
                scaleTo={0.97}
                onPress={onAddAngle}
                testID="scan-add-angle"
                accessibilityRole="button"
              >
                <Ionicons name="add" size={18} color={colors.ink} />
                <Text style={styles.addShotText}>
                  {t('scan.addPhoto', { n: MAX_PHOTOS - analyzedUris.length })}
                </Text>
              </PressScale>
            ) : null}
          </ScrollView>

          {addError ? (
            <Text style={styles.addError} accessibilityRole="alert" accessibilityLiveRegion="polite" testID="scan-add-error">
              {addError}
            </Text>
          ) : null}
          <View style={styles.footer}>
            <PressScale
              style={styles.retake}
              scaleTo={0.96}
              onPress={onRetake}
              testID="scan-retake"
              accessibilityRole="button"
            >
              <Text style={styles.retakeText}>{t('scan.retake')}</Text>
            </PressScale>
            <PressScale
              style={[styles.add, saving && styles.addDisabled]}
              scaleTo={0.97}
              onPress={onAdd}
              disabled={saving}
              testID="scan-add"
              accessibilityRole="button"
              accessibilityState={{ disabled: saving, busy: saving }}
            >
              <Text style={styles.addText}>{saving ? t('common.saving') : t('scan.addToday')}</Text>
            </PressScale>
          </View>
        </KeyboardAvoidingView>
      ) : (
        <View style={styles.body}>
          {error ? (
            <Text
              style={styles.error}
              accessibilityRole="alert"
              accessibilityLiveRegion="polite"
              testID="scan-error"
            >
              {error}
            </Text>
          ) : null}
          {offlineError || (offline && !error) ? (
            <ScanNotice notice={{ text: offline && !error ? t('scan.offlineNotice') : '', onSearch: searchInstead }} styles={styles} t={t} />
          ) : null}
          <Animated.View style={styles.introCard} entering={enterUp(0)}>
            <View style={styles.cameraCircle}>
              <Ionicons name="camera" size={40} color={colors.onInk} />
            </View>
            <Text style={styles.introHint}>{t('scan.hint')}</Text>
            {remaining != null && remaining <= 2 ? (
              <Text style={styles.remaining}>{t('scan.remaining', { n: remaining })}</Text>
            ) : null}
          </Animated.View>
          <Animated.View entering={enterUp(1)}>
            {camBlocked ? (
              // The only state with no OS prompt left to show, so the only one
              // that explains anything (see `camBlocked`). The library below
              // still works — a blocked camera is not a blocked scan.
              <View style={styles.camOff} testID="scan-camera-off">
                <Text style={styles.camOffText}>{t('scan.cameraOff')}</Text>
                <PressScale
                  style={styles.primary}
                  scaleTo={0.97}
                  onPress={() => {
                    haptics.tap();
                    void Linking.openSettings();
                  }}
                  testID="scan-open-settings"
                  accessibilityRole="button"
                >
                  <Ionicons name="settings-outline" size={20} color={colors.onInk} />
                  <Text style={styles.primaryText}>{t('scan.openSettings')}</Text>
                </PressScale>
              </View>
            ) : (
              <PressScale style={styles.primary} scaleTo={0.97} onPress={openCamera} testID="scan-take" accessibilityRole="button">
                <Ionicons name="camera-outline" size={20} color={colors.onInk} />
                <Text style={styles.primaryText}>{t('scan.take')}</Text>
              </PressScale>
            )}
          </Animated.View>
          <Animated.View entering={enterUp(2)}>
            <PressScale style={styles.secondary} scaleTo={0.97} onPress={() => onCapture('library')} testID="scan-choose" accessibilityRole="button">
              <Ionicons name="images-outline" size={20} color={colors.ink} />
              <Text style={styles.secondaryText}>{t('scan.choose')}</Text>
            </PressScale>
          </Animated.View>
          {/* Manual/text entry stays free forever (ADR-0015) — one tap away via
              Today's existing add sheet (openAdd nonce). */}
          <Animated.View entering={enterUp(3)}>
            <PressScale
              style={styles.manual}
              scaleTo={0.97}
              onPress={() => {
                haptics.tap();
                void clearScanDraft();
                leaveToToday({ openAdd: String(Date.now()) });
              }}
              testID="scan-manual"
              accessibilityRole="button"
            >
              <Ionicons name="create-outline" size={18} color={colors.muted} />
              <Text style={styles.manualText}>{t('scan.manual')}</Text>
            </PressScale>
          </Animated.View>
        </View>
      )}
      {/* Presented full-screen over the tabs, where the tab layout's host
          cannot reach — confirms raised here are drawn by this one. */}
      <ConfirmHost />
    </View>
  );
}

function ItemRow({
  item,
  index,
  styles,
  colors,
  t,
  onName,
  onGrams,
  onMacro,
  onRemove,
}: {
  item: ReviewItem;
  index: number;
  styles: ReturnType<typeof createStyles>;
  colors: Theme['colors'];
  // Was `(k: never) => string` — a deliberate 'this row renders no copy'
  // marker. It now does: the remove button needs a label for VoiceOver, and a
  // label is copy.
  t: TFn;
  onName: (i: number, v: string) => void;
  onGrams: (i: number, v: string) => void;
  onMacro: (i: number, field: 'calories' | 'protein', v: string) => void;
  onRemove: (i: number) => void;
}) {
  const locale = useLocale();
  const { scheme } = useTheme();
  // The number fields' way off the keyboard (re-score gap 1): a decimal pad
  // has no Return key, and without a `returnKeyType` iOS drew no toolbar.
  const doneKeyProps = useDoneKeyProps();
  // Shared by the three number fields: decimal (B10 — Android's numeric pad
  // can drop a pt-BR comma), capped where the row stops fitting (gap 5).
  const numProps = {
    ...doneKeyProps,
    inputMode: 'decimal' as const,
    maxFontSizeMultiplier: 1.4,
    keyboardAppearance: scheme,
  };
  const estimated = item.source === 'model';
  // Every label below names the item, so a screen reader moving through three
  // rows hears "Grams of rice", not "Grams" three times. A blank added row
  // falls back to its position.
  const itemName = item.name.trim() || t('scan.itemN', { n: index + 1 });
  return (
    <View style={styles.itemRow} testID={`scan-item-${index}`}>
      <View style={styles.itemMain}>
        <TextInput
          style={styles.itemName}
          value={item.name}
          onChangeText={(v) => onName(index, v)}
          placeholder={item.added ? t('scan.itemNamePlaceholder') : undefined}
          placeholderTextColor={colors.faint}
          maxFontSizeMultiplier={1.4}
          keyboardAppearance={scheme}
          accessibilityLabel={t('scan.itemNameLabel', { n: index + 1 })}
          testID={`scan-item-name-${index}`}
        />
        {item.added ? (
          // A row the user added has nothing to derive macros FROM — no match,
          // no model guess — so the two numbers that matter are typed. Carbs and
          // fat are left at 0 rather than asking for four fields on a correction.
          <View style={styles.addedMacros}>
            <TextInput
              style={styles.itemGrams}
              value={item.draft?.calories ?? (item.calories ? String(item.calories) : '')}
              onChangeText={(v) => onMacro(index, 'calories', v)}
              placeholder="0"
              placeholderTextColor={colors.faint}
              {...numProps}
              accessibilityLabel={t('scan.itemKcalLabel', { name: itemName })}
              testID={`scan-item-kcal-${index}`}
            />
            <Text style={styles.itemGramsUnit} maxFontSizeMultiplier={1.6}>{t('today.kcal')}</Text>
            <TextInput
              style={styles.itemGrams}
              value={item.draft?.protein ?? (item.protein ? String(item.protein) : '')}
              onChangeText={(v) => onMacro(index, 'protein', v)}
              placeholder="0"
              placeholderTextColor={colors.faint}
              {...numProps}
              accessibilityLabel={t('scan.itemProteinLabel', { name: itemName })}
              testID={`scan-item-protein-${index}`}
            />
            <Text style={styles.itemGramsUnit} maxFontSizeMultiplier={1.6}>{t('scan.gProtein')}</Text>
          </View>
        ) : (
          <Text style={styles.itemMacros} maxFontSizeMultiplier={2.2}>
            {/* Spelled, not `P/C/F` — the letter codes were the only place in
                the app that assumed the reader knew them (UX_AUDIT S18-17). */}
            {formatNumber(Math.round(item.calories), locale)} {t('today.kcal')} · {t('history.protein')} {Math.round(item.protein)} g · {t('today.carbs')} {Math.round(item.carbs)} g · {t('today.fat')} {Math.round(item.fat)} g
          </Text>
        )}
        {item.added ? (
          <Text style={styles.itemEstimate}>{t('scan.itemAdded')}</Text>
        ) : estimated ? (
          <Text style={styles.itemEstimate}>{t('scan.sourceEstimate')}</Text>
        ) : item.matchedDescription ? (
          <Text style={styles.itemMatched} numberOfLines={1}>
            {item.matchedDescription}
          </Text>
        ) : null}
        {/* A weighed portion and a guessed one must not look the same
            (ADR-0029 item 4). `grams` is the only number the model contributes
            and every macro scales off it, so this is the difference between a
            measurement and an estimate — the same distinction ADR-0027 insisted
            on for a 2022 menu figure shown as today's. Rendered ALONGSIDE the
            source line, not instead of it: they answer different questions
            (where the macros came from vs where the weight came from). */}
        {item.measured ? (
          <View style={styles.measuredRow}>
            <Ionicons name="scale-outline" size={13} color={colors.teal} />
            <Text style={styles.measuredText}>{t('scan.measured')}</Text>
          </View>
        ) : null}
      </View>
      {/* No grams on an added row: its typed kcal/protein are the portion,
          and a weight with nothing per-gram behind it can only corrupt them. */}
      {item.added ? null : (
      <View style={styles.itemGramsWrap}>
        <TextInput
          style={styles.itemGrams}
          value={String(Math.round(item.grams))}
          onChangeText={(v) => onGrams(index, v)}
          {...numProps}
          selectTextOnFocus
          accessibilityLabel={t('scan.itemGramsLabel', { name: itemName })}
          testID={`scan-item-grams-${index}`}
        />
        <Text style={styles.itemGramsUnit} maxFontSizeMultiplier={1.6}>{t('unit.g')}</Text>
      </View>
      )}
      <PressScale
        style={styles.itemRemove}
        scaleTo={0.9}
        onPress={() => onRemove(index)}
        testID={`scan-item-remove-${index}`}
        accessibilityRole="button"
        accessibilityLabel={t('scan.removeItem', { name: itemName })}
        // 26pt (18 icon + 4 padding); the slop carries it to the full target
        // without widening the row, which would squeeze the name field.
        hitSlop={(TARGET - 26) / 2}
      >
        <Ionicons name="close" size={18} color={colors.muted} />
      </PressScale>
    </View>
  );
}

function TotalChip({
  label,
  value,
  a11yLabel,
  styles,
  testID,
}: {
  label: string;
  value: number;
  /** The whole chip as one sentence, unit included ("32 g protein"). */
  a11yLabel: string;
  styles: ReturnType<typeof createStyles>;
  testID: string;
}) {
  return (
    <View style={styles.totalChip} accessible accessibilityLabel={a11yLabel}>
      <Text style={styles.macroLabel} maxFontSizeMultiplier={1.6}>{label}</Text>
      <Text style={styles.totalValue} testID={testID} maxFontSizeMultiplier={1.6}>
        {Math.round(value)}
      </Text>
    </View>
  );
}

/**
 * A line above the scan's controls, with "Search instead" when the network is
 * what stands in the way (U9). The add sheet's search runs on the device, so
 * it is the one way to log that an offline phone still has.
 */
function ScanNotice({
  notice,
  styles,
  t,
}: {
  notice: { text: string; onSearch?: () => void };
  styles: ReturnType<typeof createStyles>;
  t: TFn;
}) {
  const { colors } = useTheme();
  return (
    <View style={styles.notice} testID="scan-notice">
      {notice.text ? <Text style={styles.noticeText}>{notice.text}</Text> : null}
      {notice.onSearch ? (
        <PressScale
          style={styles.noticeAction}
          scaleTo={0.97}
          onPress={notice.onSearch}
          accessibilityRole="button"
          testID="scan-search-instead"
        >
          <Ionicons name="search" size={16} color={colors.ink} />
          <Text style={styles.noticeActionText}>{t('scan.searchInstead')}</Text>
        </PressScale>
      ) : null}
    </View>
  );
}

/** Name the log entry after what is on the plate, not after "Meal". */
function defaultMealName(items: ScannedFoodItem[], fallback: string): string {
  const names = items.map((i) => i.name).filter(Boolean);
  if (names.length === 0) return fallback;
  if (names.length <= 2) return names.join(' + ');
  return `${names[0]} +${names.length - 1}`;
}

/** Scale one item by a portion factor. Grams-based where we have a portion;
 *  for a model-fallback whole-meal row (grams 0) the macros scale directly. */
function scalePortion(item: ScannedFoodItem, mult: number): ScannedFoodItem {
  if (item.grams > 0) return rescaleScannedItem(item, item.grams * mult);
  const round = (n: number) => Math.round(n * 10) / 10;
  return {
    ...item,
    calories: Math.round(item.calories * mult),
    protein: round(item.protein * mult),
    carbs: round(item.carbs * mult),
    fat: round(item.fat * mult),
  };
}

function createStyles({ colors, shadow }: Theme) {
  return StyleSheet.create({
    screen: { flex: 1, backgroundColor: colors.paper },
    header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: space.lg, paddingTop: space.md, paddingBottom: space.sm, gap: space.sm },
    // A full target, pulled left by its own overhang so the chevron still sits
    // on the header's padding line where it always did.
    back: { width: TARGET, height: TARGET, alignItems: 'center', justifyContent: 'center', marginLeft: -(TARGET - 24) / 2 },
    // iOS's "Cancel": a text button at full target height, its words on the
    // header's padding line.
    cancel: { minHeight: TARGET, minWidth: TARGET, justifyContent: 'center' },
    cancelText: { fontSize: font.body, fontWeight: '600', color: colors.teal },
    kav: { flex: 1 },
    title: { flex: 1, fontFamily: type.display, fontSize: font.h2, color: colors.ink },
    fill: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: space.xl, padding: space.xl },
    analyzing: { fontSize: font.body, color: colors.muted },
    preview: {
      width: 200,
      height: 200,
      borderRadius: radius.lg,
      backgroundColor: colors.card,
    },
    // Left-aligned as a block, centred as a whole: a checklist whose rows start
    // at different x-positions reads as jitter rather than as progress.
    steps: { gap: space.md, alignSelf: 'center' },
    stepRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
    stepText: { fontSize: font.body, color: colors.faint },
    stepTextOn: { color: colors.ink, fontWeight: '600' },
    stepTextDone: { color: colors.muted },
    body: { padding: space.xl, gap: space.md, flexGrow: 1 },
    error: { color: colors.danger, fontSize: font.small, textAlign: 'center' },
    remaining: { color: colors.muted, fontSize: font.small, textAlign: 'center', marginTop: space.xs },
    // intro
    introCard: { alignItems: 'center', gap: space.md, paddingVertical: space.xl },
    cameraCircle: { width: 96, height: 96, borderRadius: 48, backgroundColor: colors.ink, alignItems: 'center', justifyContent: 'center', ...shadow.e2 },
    introHint: { fontSize: font.body, color: colors.muted, textAlign: 'center', paddingHorizontal: space.lg, lineHeight: font.body * 1.4 },
    primary: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: space.sm, backgroundColor: colors.ink, borderRadius: radius.md, paddingVertical: space.lg },
    primaryText: { color: colors.onInk, fontSize: font.h3, fontWeight: '700' },
    secondary: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: space.sm, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.line, borderRadius: radius.md, paddingVertical: space.lg },
    secondaryText: { color: colors.ink, fontSize: font.h3, fontWeight: '700' },
    camOff: { gap: space.md },
    camOffText: { fontSize: font.body, color: colors.ink, textAlign: 'center', lineHeight: font.body * 1.4 },
    manual: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: space.xs, paddingVertical: space.md },
    manualText: { color: colors.muted, fontSize: font.body, fontWeight: '600' },
    // review
    restored: { flexDirection: 'row', alignItems: 'center', gap: space.sm, paddingVertical: space.sm, paddingHorizontal: space.md, borderRadius: radius.md, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.line },
    restoredText: { flex: 1, fontSize: font.small, color: colors.ink, fontWeight: '600' },
    restoredDiscard: { minHeight: TARGET, minWidth: TARGET, justifyContent: 'center', paddingHorizontal: space.sm },
    restoredDiscardText: { fontSize: font.small, fontWeight: '800', color: colors.danger },
    lowConf: { flexDirection: 'row', alignItems: 'center', gap: space.sm, backgroundColor: colors.inputBg, borderRadius: radius.md, paddingHorizontal: space.lg, paddingVertical: space.md },
    lowConfText: { flex: 1, fontSize: font.small, color: colors.ink },
    heroPanel: { backgroundColor: colors.heroPanel, borderRadius: radius.xl, paddingVertical: space.xl, paddingHorizontal: space.lg, alignItems: 'center', gap: space.sm, ...shadow.e2 },
    hero: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'center', gap: space.xs },
    heroValue: { fontFamily: type.display, fontSize: 52, color: colors.heroText, lineHeight: 56 },
    heroUnit: { fontSize: font.h2, color: colors.heroMuted, marginBottom: space.sm },
    nameInput: { minWidth: 160, textAlign: 'center', color: colors.heroText, fontFamily: type.heading, fontSize: font.h3, paddingVertical: space.xs },
    section: { fontSize: font.small, color: colors.muted, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: space.xs },
    portionRow: { flexDirection: 'row', gap: space.sm },
    portionChip: { flex: 1, alignItems: 'center', backgroundColor: colors.card, borderWidth: 1, borderColor: colors.line, borderRadius: radius.md, paddingVertical: space.md },
    portionChipOn: { backgroundColor: colors.ink, borderColor: colors.ink },
    portionText: { fontSize: font.body, fontWeight: '700', color: colors.ink },
    portionTextOn: { color: colors.onInk },
    macroLabel: { fontSize: font.small, color: colors.muted, fontWeight: '600' },
    // totals
    totalRow: { flexDirection: 'row', gap: space.sm },
    totalChip: { flex: 1, alignItems: 'center', gap: 2, backgroundColor: colors.inputBg, borderRadius: radius.md, paddingVertical: space.md },
    totalValue: { fontSize: font.h3, fontWeight: '700', color: colors.ink },
    // items
    itemsBlock: { gap: space.sm },
    itemRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.line, borderRadius: radius.md, paddingHorizontal: space.md, paddingVertical: space.sm },
    itemMain: { flex: 1, gap: 2 },
    itemName: { fontSize: font.body, fontWeight: '700', color: colors.ink, paddingVertical: 2 },
    itemMacros: { fontSize: font.small, color: colors.muted },
    // No `opacity`: muted at 0.8 on `card` measured 4.22:1 in light at 13pt,
    // under the 4.5 floor. Plain `muted` passes, and the smaller size alone
    // still ranks it below the macro line above.
    itemMatched: { fontSize: font.small - 1, color: colors.muted },
    itemEstimate: { fontSize: font.small - 1, color: colors.accent, fontWeight: '700' },
    itemGramsWrap: { flexDirection: 'row', alignItems: 'center', gap: 2 },
    itemGrams: { minWidth: 52, textAlign: 'right', backgroundColor: colors.inputBg, borderRadius: radius.sm, paddingHorizontal: space.sm, paddingVertical: space.xs, fontSize: font.body, color: colors.ink },
    itemGramsUnit: { fontSize: font.small, color: colors.muted },
    itemRemove: { padding: 4 },
    addedMacros: { flexDirection: 'row', alignItems: 'center', gap: space.xs, flexWrap: 'wrap', paddingVertical: 2 },
    addItem: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: space.xs,
      minHeight: TARGET,
      borderRadius: radius.md,
      borderWidth: 1,
      borderStyle: 'dashed',
      borderColor: colors.lineStrong,
      paddingVertical: space.sm,
    },
    hintRow: { flexDirection: 'row', alignItems: 'flex-start', gap: space.xs },
    hintText: { flex: 1, fontSize: font.small, color: colors.muted, lineHeight: font.small * 1.4 },

    // ── The describe step (ADR-0029 item 1) ───────────────────────
    noteTitle: { fontSize: font.h3, fontWeight: '700', color: colors.ink, marginBottom: space.sm },
    noteInput: {
      minHeight: 84,
      textAlignVertical: 'top',
      backgroundColor: colors.inputBg,
      borderRadius: radius.md,
      padding: space.md,
      fontSize: font.body,
      color: colors.ink,
    },
    noteHelp: { fontSize: font.small, color: colors.muted, marginTop: space.xs, lineHeight: font.small * 1.4 },
    /**
     * The photo fills the width on this step, unlike the 200×200 `preview` the
     * ANALYZING step uses. Different job: there the image is a subject for the
     * wait, here it is the thing the user is about to describe, and describing
     * a thumbnail with half the screen empty beside it reads as a broken layout.
     */
    notePreview: { width: '100%', height: 220, borderRadius: radius.lg, backgroundColor: colors.card },
    shotRow: { flexDirection: 'row', gap: space.sm },
    shotWrap: { flex: 1, aspectRatio: 1 },
    shot: { width: '100%', height: '100%', borderRadius: radius.md, backgroundColor: colors.card },
    shotRemove: {
      position: 'absolute',
      top: 4,
      right: 4,
      width: 22,
      height: 22,
      borderRadius: 11,
      backgroundColor: colors.ink,
      alignItems: 'center',
      justifyContent: 'center',
    },
    addShot: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: space.xs,
      borderRadius: radius.md,
      borderWidth: 1,
      borderStyle: 'dashed',
      borderColor: colors.line,
      paddingVertical: space.md,
    },
    addShotText: { fontSize: font.body, fontWeight: '700', color: colors.ink },
    noteAnalyze: { backgroundColor: colors.ink, borderRadius: radius.md, paddingVertical: space.lg, alignItems: 'center' },
    noteAnalyzeText: { color: colors.onInk, fontSize: font.h3, fontWeight: '700' },
    /**
     * **Its own style, and NOT `styles.retake`.** That one carries
     * `paddingHorizontal` and no `paddingVertical`, which works only because
     * the review screen puts it in a flex ROW beside `add` — row stretch gives
     * it `add`'s height for free. Reused standalone in this column it collapses
     * to bare text height and renders as a squashed full-width pill, which is
     * exactly how it shipped on 2026-08-26 and what the owner reported.
     *
     * Metrics are deliberately `noteAnalyze`'s, minus the fill: same
     * `paddingVertical`, same radius, so the two buttons read as a pair.
     */
    noteRetake: {
      borderRadius: radius.md,
      borderWidth: 1,
      borderColor: colors.line,
      paddingVertical: space.lg,
      alignItems: 'center',
      justifyContent: 'center',
    },
    noteRetakeText: { fontSize: font.h3, fontWeight: '700', color: colors.ink },

    // ── Repeat detection (ADR-0029 item 3) ────────────────────────
    repeatBox: { gap: space.sm },
    repeatTitle: { fontSize: font.small, fontWeight: '700', color: colors.muted, textTransform: 'uppercase', letterSpacing: 0.5 },
    repeatRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: space.md,
      backgroundColor: colors.card,
      borderRadius: radius.md,
      paddingHorizontal: space.md,
      paddingVertical: space.md,
    },
    repeatMain: { flex: 1, gap: 2 },
    repeatName: { fontSize: font.body, fontWeight: '700', color: colors.ink },
    repeatMeta: { fontSize: font.small - 1, color: colors.muted },
    repeatUse: { fontSize: font.small, fontWeight: '700', color: colors.accent },

    // ── A weighed portion, marked (ADR-0029 items 2 + 4) ──────────
    measuredRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
    measuredText: { fontSize: font.small - 1, color: colors.teal, fontWeight: '700' },
    footer: { flexDirection: 'row', gap: space.md, paddingHorizontal: space.xl, paddingTop: space.md, paddingBottom: space.lg },
    retake: { paddingHorizontal: space.xl, borderRadius: radius.md, borderWidth: 1, borderColor: colors.line, alignItems: 'center', justifyContent: 'center' },
    retakeText: { fontSize: font.body, fontWeight: '700', color: colors.ink },
    add: { flex: 1, backgroundColor: colors.ink, borderRadius: radius.md, paddingVertical: space.lg, alignItems: 'center' },
    addDisabled: { opacity: 0.5 },
    addText: { color: colors.onInk, fontSize: font.h3, fontWeight: '700' },
    addError: { color: colors.danger, fontSize: font.small, textAlign: 'center', paddingHorizontal: space.xl, paddingTop: space.sm },
    // ── Which meal, and when (U6) ─────────────────────────────────
    whenBlock: { gap: space.sm },
    // ── The wait's way out (U9) ───────────────────────────────────
    cancelScan: {
      minHeight: TARGET,
      minWidth: 120,
      paddingHorizontal: space.xl,
      borderRadius: radius.md,
      borderWidth: 1,
      borderColor: colors.lineStrong,
      alignItems: 'center',
      justifyContent: 'center',
    },
    cancelScanText: { fontSize: font.body, fontWeight: '700', color: colors.ink },
    // ── Offline / last error, with the search beside it (U9) ─────
    notice: { gap: space.sm, padding: space.md, borderRadius: radius.md, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.lineStrong },
    noticeText: { fontSize: font.small, color: colors.ink, lineHeight: font.small * 1.4 },
    noticeAction: {
      flexDirection: 'row',
      alignItems: 'center',
      alignSelf: 'flex-start',
      gap: space.xs,
      minHeight: TARGET,
      paddingHorizontal: space.md,
      borderRadius: radius.md,
      borderWidth: 1,
      borderColor: colors.lineStrong,
      backgroundColor: colors.inputBg,
    },
    noticeActionText: { fontSize: font.small, fontWeight: '700', color: colors.ink },
  });
}
