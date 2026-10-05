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

  it('ends itself at the deadline through staleDate', () => {
    expect(restShared).toMatch(/staleDate: state\.endsAt/);
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
    for (const name of ['RestAddTimeIntent', 'RestSkipIntent', 'EndFastIntent']) {
      expect(buttons).toMatch(new RegExp(`struct ${name}: LiveActivityIntent`));
    }
    expect((buttons.match(/isDiscoverable: Bool = false/g) ?? []).length).toBe(3);
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
