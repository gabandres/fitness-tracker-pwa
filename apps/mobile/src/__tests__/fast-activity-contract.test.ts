import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * The fasting Live Activity's JS→Swift bridge agrees on four Objective-C names,
 * and nothing but this file checks it (N3).
 *
 * `Activity.request` needs `FastActivityAttributes`, which must be the same
 * declaration the widget extension renders against — so it lives in
 * `targets/_shared/`, which `@bacons/apple-targets` links into the app and the
 * extension. An Expo Module is a CocoaPods target and cannot see `_shared`, so
 * `FastingLiveActivityModule` reaches across with `NSClassFromString` +
 * `NSSelectorFromString`.
 *
 * That coupling is a string, and a wrong string fails **silently**: the fast
 * still starts, Firestore is still written, the Lock Screen simply stays empty
 * and no error is raised anywhere. It is the same failure shape as the
 * quick-add Keychain `SERVICE`/`ACCOUNT` convention, and the same shape that
 * shipped build 27's Siri support dead — a native contract that nothing on a
 * build machine can evaluate.
 *
 * Swift cannot be compiled here, so this asserts on the source text of both
 * files. It is a weak check by design: it proves the two sides spell the same
 * names, not that ActivityKit will start anything. **Device (or simulator) QA
 * is still the only proof of the feature.**
 */

const SHARED = join(__dirname, '..', '..', 'targets', '_shared', 'FastActivity.swift');
const MODULE = join(
  __dirname,
  '..',
  '..',
  'modules',
  'fasting-live-activity',
  'ios',
  'FastingLiveActivityModule.swift',
);

const shared = readFileSync(SHARED, 'utf8');
const module = readFileSync(MODULE, 'utf8');

describe('fasting Live Activity bridge contract', () => {
  it('exposes the bridge class under the name the module looks up', () => {
    expect(shared).toContain('@objc(IgniaFastActivity)');
    expect(module).toContain('BRIDGE_CLASS = "IgniaFastActivity"');
  });

  it.each([
    ['start', 'startWithStartedAt:locale:', 'SEL_START'],
    ['end', 'endActivity', 'SEL_END'],
    ['status', 'activityStatus', 'SEL_STATUS'],
  ])('declares %s under the pinned selector', (_name, selector, constant) => {
    expect(shared).toContain(`@objc(${selector})`);
    expect(module).toContain(`${constant} = "${selector}"`);
  });

  it('keeps the attributes out of the pod, so there is one declaration', () => {
    // Two structs named FastActivityAttributes would be two types ActivityKit
    // matches by name, free to drift, with the drift visible only on a device.
    // The whole reason the module goes through the ObjC runtime is to avoid
    // that — so a copy appearing in the pod is a regression, not a shortcut.
    expect(shared).toContain('public struct FastActivityAttributes');
    // A declaration, not a mention — the module's header explains at length why
    // it does NOT own the type, and that prose must stay allowed.
    expect(module).not.toMatch(/struct\s+\w*Attributes\b/);
    expect(module).not.toMatch(/^\s*import ActivityKit\s*$/m);
  });

  it('guards ActivityKit behind canImport, because _shared also builds for watchOS', () => {
    // `targets/_shared/*` is linked into the watch app and the complication as
    // well (Glance.swift rule 1), and ActivityKit does not exist on watchOS 10.
    expect(shared).toContain('#if canImport(ActivityKit)');
  });

  it('never asks for a push token', () => {
    // The entire $0 claim for N3: the timer is drawn on-device by
    // Text(timerInterval:), so no APNs, no server, no secret. `.token` here
    // would be the moment this feature starts costing something.
    expect(shared).toContain('pushType: nil');
    expect(shared).not.toContain('pushType: .token');
  });
});
