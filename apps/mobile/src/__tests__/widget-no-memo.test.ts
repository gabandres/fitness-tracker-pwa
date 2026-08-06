import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Every Android widget component must opt out of the React Compiler.
 *
 * `app.json` enables `experiments.reactCompiler`, which rewrites any PascalCase
 * function returning JSX to call `useMemoCache`. `react-native-android-widget`
 * does not mount widgets in a React renderer — `buildWidgetTree` invokes the
 * component as a raw function — so that hook throws and the widget renders as
 * an empty transparent box.
 *
 * Nothing else catches this. It typechecks, it bundles, it passes every other
 * test, and it shipped broken in Android vc 4, 6 and 8 before anyone placed the
 * widget on a home screen. So the check is a text assertion on the source: the
 * directive must be the first statement, because a directive prologue only
 * counts before any other statement.
 */

const WIDGET_DIR = join(__dirname, '..', 'widgets');

function componentFiles(): string[] {
  return readdirSync(WIDGET_DIR).filter((f) => {
    if (!f.endsWith('.tsx')) return false;
    const src = readFileSync(join(WIDGET_DIR, f), 'utf8');
    // A widget component: exported, PascalCase, returns JSX.
    return /export\s+function\s+[A-Z]\w*\s*\(/.test(src);
  });
}

it('finds the widget components it is meant to guard', () => {
  // A rename or a move must fail loudly rather than make this suite vacuous.
  expect(componentFiles()).toContain('TodayWidget.tsx');
});

it.each(componentFiles())('%s opts out of the React Compiler', (file) => {
  const src = readFileSync(join(WIDGET_DIR, file), 'utf8');
  const firstStatement = src
    .split('\n')
    .map((l) => l.trim())
    .find((l) => l.length > 0 && !l.startsWith('//') && !l.startsWith('/*') && !l.startsWith('*'));

  expect(firstStatement).toMatch(/^['"]use no memo['"];?$/);
});
