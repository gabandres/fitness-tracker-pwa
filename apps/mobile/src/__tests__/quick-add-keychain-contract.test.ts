import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * The quick-add credential envelope is reachable from the widget extension
 * (ADR-0020, amended 2026-08-08).
 *
 * ## The bug this locks down
 *
 * `LogQuickAddSlotIntent` lives in `targets/_shared/`, so it is compiled into
 * `Today.appex` as well as the app, and **WidgetKit performs the extension's
 * copy in the extension's process** — verified in build 32's `.ipa`, where the
 * appex carries its own `Metadata.appintents` listing the intent. The module's
 * header had asserted the opposite ("and so is a widget `Button(intent:)`") and
 * on that basis dropped the shared Keychain access group ADR-0020 called for.
 *
 * A process cannot read another's default keychain group. So
 * `QuickAdd.credentials()` returned `nil`, `QuickAdd.log` returned `.signedOut`
 * — the one outcome that skips the optimistic snapshot bump — and tapping the
 * widget button did **nothing at all** from build 27 through build 32. No row,
 * no error, no moved number, nothing in Sentry. Siri worked the whole time,
 * because App Shortcuts genuinely do launch the app, which is what made it look
 * like a session bug rather than a process one.
 *
 * Four declarations have to agree, in four languages, across three build
 * systems. Nothing else checks them, and the failure is silent in every
 * direction — so this asserts on the source text. It cannot prove entitlements
 * are granted at runtime; only a device or simulator can. It can prove they were
 * never *asked* for, which is what actually happened.
 */

const ROOT = join(__dirname, '..', '..');
const SHARED = readFileSync(join(ROOT, 'targets', '_shared', 'QuickAdd.swift'), 'utf8');
const MODULE = readFileSync(
  join(ROOT, 'modules', 'quick-add-credentials', 'ios', 'QuickAddCredentialsModule.swift'),
  'utf8',
);
const WIDGET_CONFIG = readFileSync(
  join(ROOT, 'targets', 'widget', 'expo-target.config.js'),
  'utf8',
);
const APP_JSON = JSON.parse(readFileSync(join(ROOT, 'app.json'), 'utf8'));

const ENTITLEMENT_KEY = 'keychain-access-groups';
/** The suffix, without the team prefix each side spells differently. */
const GROUP_SUFFIX = 'fit.ignia.app.quickAdd';

function swiftConstant(src: string, name: string): string | undefined {
  return new RegExp(`${name}\\s*=\\s*"([^"]+)"`).exec(src)?.[1];
}

describe('quick-add keychain access group', () => {
  it('is the same string on the read and write sides', () => {
    const read = swiftConstant(SHARED, 'keychainAccessGroup');
    const write = swiftConstant(MODULE, 'ACCESS_GROUP');
    expect(read).toBeDefined();
    expect(write).toEqual(read);
  });

  it('carries a literal team prefix, because Swift never expands the Xcode variable', () => {
    // `$(AppIdentifierPrefix)` is substituted by Xcode inside entitlement plists
    // only. Left in a Swift string it is a literal, and every keychain query
    // silently matches nothing.
    const read = swiftConstant(SHARED, 'keychainAccessGroup')!;
    expect(read).not.toContain('$(');
    expect(read).toBe(`${APP_JSON.expo.ios.appleTeamId}.${GROUP_SUFFIX}`);
  });

  it('is declared on the APP', () => {
    const groups = APP_JSON.expo.ios.entitlements[ENTITLEMENT_KEY];
    expect(groups).toEqual([`$(AppIdentifierPrefix)${GROUP_SUFFIX}`]);
  });

  it('is declared on the WIDGET EXTENSION — the half that was missing', () => {
    // Forwarded from the app's entitlements rather than repeated, so `app.json`
    // stays the single source and the two cannot drift.
    expect(WIDGET_CONFIG).toContain(`'${ENTITLEMENT_KEY}': config.ios.entitlements[`);
  });

  it('still reads the pre-access-group envelope, so an in-place update keeps Siri', () => {
    // Every envelope written before this change lives in the app's default
    // group. Querying only the shared group would break Siri until the user
    // reopened the app — trading one silent failure for another.
    expect(SHARED).toContain('credentials(inAccessGroup: nil)');
  });

  it('clears BOTH groups, so a sign-out cannot strand a live write credential', () => {
    expect(MODULE).toContain('SecItemDelete(Self.query(inGroup: true) as CFDictionary)');
    expect(MODULE).toContain('SecItemDelete(Self.query(inGroup: false) as CFDictionary)');
  });

  it('keeps the service and account agreeing across the two Swift halves', () => {
    // The original convention this file was written to guard, unchanged.
    expect(swiftConstant(MODULE, 'SERVICE')).toEqual(swiftConstant(SHARED, 'keychainService'));
    expect(swiftConstant(MODULE, 'ACCOUNT')).toEqual(swiftConstant(SHARED, 'keychainAccount'));
  });
});
