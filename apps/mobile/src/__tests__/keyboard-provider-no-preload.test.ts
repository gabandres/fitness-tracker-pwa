import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

/**
 * IGNIA-MOBILE-J: "App Hanging for at least 2000 ms" at launch on an iPhone SE
 * (2nd gen), iOS 18.7, build 64 — main thread inside
 * `UIResponder.preloadKeyboardIfNeeded` -> `UITextField.becomeFirstResponder`
 * -> the RemoteTextInput XPC handshake.
 *
 * That is `react-native-keyboard-controller`'s `<KeyboardProvider>`, whose
 * `preload` prop DEFAULTS TO TRUE: on mount it makes a hidden text field take
 * first responder so the first real keyboard opens faster. On a slow device
 * the warm-up itself blocks the launch. The provider must opt out.
 *
 * A source-level lock (same shape as `sheets-are-one-component.test.ts`): the
 * default is invisible to `tsc` and to a render test with the native module
 * mocked, and dropping the prop looks like a harmless cleanup.
 */
function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) return name === '__tests__' ? [] : sources(p);
    return /\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name) ? [p] : [];
  });
}

it('every <KeyboardProvider> opts out of the launch-time keyboard preload', () => {
  const offenders: string[] = [];
  let found = 0;
  for (const file of sources(join(__dirname, '..'))) {
    // Comments elsewhere say "with <KeyboardProvider> mounted at the root";
    // only real JSX counts.
    const text = readFileSync(file, 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '');
    for (const m of text.matchAll(/<KeyboardProvider\b([^>]*)>/g)) {
      found++;
      if (!/\bpreload=\{false\}/.test(m[1])) offenders.push(file);
    }
  }
  expect(found).toBeGreaterThan(0);
  expect(offenders).toEqual([]);
});
