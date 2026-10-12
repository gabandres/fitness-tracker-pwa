import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * The native string contracts behind the rest-timer Live Activity, the intent
 * inbox and the Live Activity buttons — checked by reading the source, because
 * nothing else on a build machine can.
 *
 * Every pair below is one string spelled twice across a wall the compiler cannot
 * see through: an Expo Module is a CocoaPods target and cannot import
 * `targets/_shared`, and JS cannot import Swift. A mismatch fails SILENTLY — the
 * Lock Screen stays empty, a button does nothing in the app, the phone buzzes
 * "rest over" for a skipped rest — exactly the failure shape
 * `fast-activity-contract.test.ts` exists for. Weak by design: it proves both
 * sides spell the same names, not that iOS honours them. Simulator/device QA is
 * still the proof.
 */

const ROOT = join(__dirname, '..', '..');
const read = (...p: string[]) => readFileSync(join(ROOT, ...p), 'utf8');

const restShared = read('targets', '_shared', 'RestActivity.swift');
const restModule = read('modules', 'rest-timer-activity', 'ios', 'RestTimerActivityModule.swift');
const inboxShared = read('targets', '_shared', 'IntentInbox.swift');
const inboxModule = read('modules', 'intent-inbox', 'ios', 'IntentInboxModule.swift');
const inboxTs = read('modules', 'intent-inbox', 'index.ts');
const glance = read('targets', '_shared', 'Glance.swift');
const buttons = read('targets', '_shared', 'LiveActivityIntents.swift');
const spoken = read('targets', '_shared', 'AppActionIntents.swift');
const restTimerHook = read('src', 'lib', 'rest-notification-id.ts');
const restWidget = read('targets', 'widget', 'RestActivityWidget.swift');
const fastWidget = read('targets', 'widget', 'FastActivityWidget.swift');
const bundle = read('targets', 'widget', 'index.swift');
const androidRoot = ['modules', 'rest-timer-notification', 'android', 'src', 'main'];
const notifier = read(...androidRoot, 'java', 'expo', 'modules', 'resttimernotification', 'RestNotifier.kt');
const actionReceiver = read(...androidRoot, 'java', 'expo', 'modules', 'resttimernotification', 'RestActionReceiver.kt');
const notifManifest = read(...androidRoot, 'AndroidManifest.xml');
const inboxAndroidRoot = ['modules', 'intent-inbox', 'android', 'src', 'main'];
const inboxStore = read(...inboxAndroidRoot, 'java', 'expo', 'modules', 'intentinbox', 'IntentInboxStore.kt');
const inboxManifest = read(...inboxAndroidRoot, 'AndroidManifest.xml');
const inboxConfig = JSON.parse(read('modules', 'intent-inbox', 'expo-module.config.json'));
const en = read('src', 'i18n', 'en.ts');
const esPR = read('src', 'i18n', 'es-PR.ts');
const ptBR = read('src', 'i18n', 'pt-BR.ts');

describe('rest Live Activity bridge', () => {
  it('exposes the bridge class under the name the module looks up', () => {
    expect(restShared).toContain('@objc(IgniaRestActivity)');
    expect(restModule).toContain('BRIDGE_CLASS = "IgniaRestActivity"');
  });

  it.each([
    ['startWithPayload:', 'SEL_START'],
    ['updateWithEndsAt:', 'SEL_UPDATE'],
    ['endActivity', 'SEL_END'],
    ['activityStatus', 'SEL_STATUS'],
    ['workoutWithPayload:', 'SEL_WORKOUT'],
  ])('pins %s on both sides', (selector, constant) => {
    expect(restShared).toContain(`@objc(${selector})`);
    expect(restModule).toContain(`${constant} = "${selector}"`);
  });

  it('keeps one attributes declaration, in _shared, and never asks for a push token', () => {
    expect(restShared).toContain('public struct RestActivityAttributes');
    expect(restModule).not.toMatch(/struct\s+\w*Attributes\b/);
    expect(restShared).toContain('pushType: nil');
    expect(restShared).not.toContain('pushType: .token');
  });

  it('guards ActivityKit, because _shared also compiles for watchOS', () => {
    expect(restShared).toContain('#if canImport(ActivityKit)');
    expect(buttons).toContain('#if canImport(ActivityKit)');
  });

  it('ends itself at the deadline through staleDate (an idle face only when abandoned)', () => {
    expect(restShared).toMatch(/staleDate: state\.isIdle \? Date\(\)\.addingTimeInterval\(abandonAfter\) : state\.endsAt/);
    expect(restWidget).toContain('context.isStale');
  });

  it('is registered in the widget bundle', () => {
    expect(bundle).toContain('RestActivityWidget()');
  });
});

describe('the rest notification the Lock Screen buttons move', () => {
  it('matches on the same id prefix JS schedules with', () => {
    const js = /REST_DONE_ID_PREFIX = '([^']+)'/.exec(restTimerHook)?.[1];
    const swift = /idPrefix = "([^"]+)"/.exec(restShared)?.[1];
    expect(js).toBeTruthy();
    expect(swift).toBe(js);
  });
});

describe('intent inbox', () => {
  it('reads the key and doorbell the writer uses', () => {
    const key = /static let key = "([^"]+)"/.exec(inboxShared)?.[1];
    const darwin = /static let darwinName = "([^"]+)"/.exec(inboxShared)?.[1];
    expect(key).toBeTruthy();
    expect(darwin).toBeTruthy();
    expect(inboxModule).toContain(`KEY = "${key}"`);
    expect(inboxModule).toContain(`DARWIN_NAME = "${darwin}"`);
  });

  it('reads the App Group the writer writes', () => {
    const group = /static let appGroup = "([^"]+)"/.exec(glance)?.[1];
    expect(inboxModule).toContain(`APP_GROUP = "${group}"`);
  });

  it('has a JS reader for every kind a Swift intent posts', () => {
    const posted = new Set(
      [...`${buttons}\n${spoken}`.matchAll(/IntentInbox\.post\(\s*"(\w+)"/g)].map((m) => m[1]),
    );
    expect(posted.size).toBeGreaterThanOrEqual(5);
    for (const kind of posted) expect(inboxTs).toContain(`case '${kind}'`);
  });
});

describe('Live Activity buttons and the spoken intents', () => {
  it('run in the app process (LiveActivityIntent) and stay out of Shortcuts', () => {
    for (const name of ['RestAddTimeIntent', 'RestSkipIntent', 'SetDoneIntent', 'EndFastIntent']) {
      expect(buttons).toMatch(new RegExp(`struct ${name}: LiveActivityIntent`));
    }
    expect((buttons.match(/isDiscoverable: Bool = false/g) ?? []).length).toBe(4);
  });

  it('declares every spoken-intent parameter optional (an App Shortcut trap, AGENTS.md)', () => {
    // A required parameter silently invalidates the WHOLE provider (build 27).
    const params = [...spoken.matchAll(/@Parameter\([^)]*\)\s*\n\s*var \w+: ([^\n]+)/g)].map((m) => m[1].trim());
    expect(params.length).toBeGreaterThan(0);
    for (const type of params) expect(type.endsWith('?')).toBe(true);
  });

  it('puts the End button and the deep link on the fasting face', () => {
    expect(fastWidget).toContain('Button(intent: EndFastIntent())');
    expect(fastWidget).toContain('ignia://?fast=1');
  });
});

describe('Done set on the Lock Screen (S23-8)', () => {
  it('puts the Done set button on the rest face and posts a `set` the JS reader parses', () => {
    expect(restWidget).toContain('Button(intent: SetDoneIntent())');
    expect(buttons).toMatch(/IntentInbox\.post\("set"/);
    expect(inboxTs).toContain("case 'set'");
  });

  it('decodes the planned-set keys JS sends', () => {
    // JSON keys of `PlannedSet` (src/lib/rest-timer-activity.ts) ↔ `RestPlannedSet`.
    for (const key of ['exerciseId', 'exerciseIndex', 'setIndex', 'name', 'label', 'restSec', 'weight', 'reps', 'durationSec', 'setKind', 'group', 'setCount']) {
      expect(restShared).toMatch(new RegExp(`public var ${key}:`));
    }
  });

  it('keeps the Swift face copy equal to the i18n strings', () => {
    const value = (src: string, key: string) => new RegExp(`'${key.replace(/\./g, '\\.')}': '([^']*)'`).exec(src)?.[1];
    const swiftBlock = (marker: string) => restWidget.slice(restWidget.indexOf(marker));
    const cases: [string, string][] = [[en, 'default:'], [esPR, 'case "es-PR":'], [ptBR, 'case "pt-BR":']];
    for (const [dict, marker] of cases) {
      const block = swiftBlock(marker);
      const swift = (field: string) => new RegExp(`${field}: "([^"]*)"`).exec(block)?.[1];
      expect(swift('doneSet')).toBe(value(dict, 'train.lockSet.doneSet'));
      expect(swift('doneSetA11y')).toBe(value(dict, 'train.lockSet.doneSetA11y'));
      expect(swift('upNext')).toBe(value(dict, 'train.lockSet.upNext'));
      expect(swift('nextLine')).toBe(value(dict, 'train.lockSet.nextLine'));
    }
  });
});

describe('Android Live Update and its inbox (S23-8)', () => {
  it('declares the promoted-notification permission and asks for promotion', () => {
    expect(notifManifest).toContain('android.permission.POST_PROMOTED_NOTIFICATIONS');
    expect(notifier).toContain('"android.requestPromotedOngoing"');
    expect(notifier).toContain('.setOngoing(true)');
    // Live Updates refuse custom views and colorized notifications.
    expect(notifier).not.toMatch(/\.setCustom\w*ContentView\(|\.setStyle\(Notification\.DecoratedCustomViewStyle/);
    expect(notifier).toContain('.setColorized(false)');
  });

  it('declares both receivers unexported', () => {
    expect(notifManifest).toMatch(/RestActionReceiver"\s+android:exported="false"/);
    expect(inboxManifest).toMatch(/IntentInboxPostReceiver"\s+android:exported="false"/);
  });

  it('broadcasts to the inbox receiver by the class, action and extra it reads', () => {
    const cls = /INBOX_RECEIVER = "([^"]+)"/.exec(notifier)?.[1];
    const action = /INBOX_ACTION_POST = "([^"]+)"/.exec(notifier)?.[1];
    const extra = /INBOX_EXTRA_ENTRY = "([^"]+)"/.exec(notifier)?.[1];
    expect(cls).toBe('expo.modules.intentinbox.IntentInboxPostReceiver');
    expect(inboxStore).toContain('class IntentInboxPostReceiver');
    expect(inboxStore).toContain(`ACTION_POST = "${action}"`);
    expect(inboxStore).toContain(`EXTRA_ENTRY = "${extra}"`);
  });

  it('ships the inbox module on Android and posts only kinds the JS reader parses', () => {
    expect(inboxConfig.platforms).toContain('android');
    const kinds = new Set([...notifier.matchAll(/put\("kind", "(\w+)"\)/g)].map((m) => m[1]));
    expect([...kinds].sort()).toEqual(['rest', 'set']);
    for (const kind of kinds) expect(inboxTs).toContain(`case '${kind}'`);
    // `rest` replaces, `set` queues — as on iOS.
    expect(inboxStore).toContain('LATEST_WINS = setOf("rest")');
  });

  it('wires every action the notification offers to the receiver', () => {
    for (const a of ['ACTION_SUB', 'ACTION_ADD', 'ACTION_SKIP', 'ACTION_DONE_SET', 'ACTION_DEADLINE', 'ACTION_TIMEOUT']) {
      expect(actionReceiver).toContain(`const val ${a} =`);
      expect(notifier).toContain(`RestActionReceiver.${a}`);
    }
  });
});

describe('round 2b native guarantees (REVIEW-R2-NATIVE)', () => {
  const inboxModuleKt = read('modules', 'intent-inbox', 'android', 'src', 'main', 'java', 'expo', 'modules', 'intentinbox', 'IntentInboxModule.kt');

  it('Android: the rest face times itself out at the deadline and flips on its delete intent — no exact-alarm permission (P2-3)', () => {
    expect(notifier).toContain('.setTimeoutAfter(endsAt - now)');
    expect(notifier).toContain('.setDeleteIntent(timeoutIntent(context, endsAt))');
    expect(notifier).toContain('.setTimeoutAfter(ABANDON_MS)');
    expect(notifManifest).not.toMatch(/SCHEDULE_EXACT_ALARM|USE_EXACT_ALARM/);
  });

  it('Android: native owns the "Rest over" buzz in a workout; JS skips its own (P1-2)', () => {
    expect(notifier).toContain('alertRestOver(');
    expect(read('src', 'hooks', 'useRestTimer.ts')).toContain('if (nativeOwnsRestAlert()) return null;');
  });

  it('echoes the set identity into the Done set entry on both platforms (JS-P2-6)', () => {
    expect(notifier).toMatch(/"setKind", "group", "setCount"/);
    for (const k of ['setKind', 'group', 'setCount']) expect(buttons).toContain(`fields["${k}"]`);
  });

  it('drops out-of-order pictures on both platforms (P2-10)', () => {
    expect(restShared).toContain('RestActivityLane.accept(seq: payload.seq)');
    expect(notifier).toContain('"stale"');
    // Every Activity change on iOS goes through the one lane.
    const bridge = restShared.slice(restShared.indexOf('@objc(IgniaRestActivity)'));
    expect(bridge).not.toMatch(/\n\s+Task \{/);
    expect(buttons).toContain('await RestActivityLane.run { await Self.apply() }.value');
  });

  it('locks the iOS inbox write and offers remove-after-apply on both platforms (P2-9, P2-11)', () => {
    expect(inboxShared).toContain('lock.lock()');
    expect(inboxModule).toContain('AsyncFunction("remove")');
    expect(inboxModuleKt).toContain('AsyncFunction("remove")');
  });
});
