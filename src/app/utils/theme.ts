/**
 * Theme model. `auto` follows prefers-color-scheme. `light` and `dark`
 * are free. The remaining three are Pro-gated — enforcement lives in
 * the setter (`App.setTheme`), which downgrades to `auto` when a non-
 * paid user somehow lands on a Pro stored value (trial ended, signed
 * out, etc.).
 */
export type ThemeChoice = 'auto' | 'light' | 'dark' | 'sepia' | 'graphite' | 'oxblood-dark';

export const PRO_THEMES: readonly ThemeChoice[] = ['sepia', 'graphite', 'oxblood-dark'];

const STORAGE_KEY = 'macrolog.theme';
const ALL_CHOICES: readonly ThemeChoice[] = ['auto', 'light', 'dark', ...PRO_THEMES];

export function isProTheme(choice: ThemeChoice): boolean {
  return PRO_THEMES.includes(choice);
}

/** Legacy reads: pre-refresh we stored 'dark' | 'light' only. Any
    unknown value falls back to 'auto' so upgrades never leave users
    on an invalid theme. */
export function readStoredTheme(): ThemeChoice {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (raw && (ALL_CHOICES as readonly string[]).includes(raw)) {
    return raw as ThemeChoice;
  }
  return 'auto';
}

export function writeStoredTheme(choice: ThemeChoice): void {
  localStorage.setItem(STORAGE_KEY, choice);
}

/** Resolve a ThemeChoice against `prefers-color-scheme`, apply it to the
 *  document root and keep `<meta name="theme-color">` in step so the browser
 *  chrome matches. Returns the effective (non-auto) theme. */
export function applyThemeChoice(choice: ThemeChoice): Exclude<ThemeChoice, 'auto'> {
  const el = document.documentElement;
  let effective: Exclude<ThemeChoice, 'auto'>;
  if (choice === 'auto') {
    effective = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  } else {
    effective = choice;
  }
  if (effective === 'light') el.removeAttribute('data-theme');
  else el.setAttribute('data-theme', effective);

  // Kept in sync with the --color-paper values in styles.css.
  const chromeColor: Record<Exclude<ThemeChoice, 'auto'>, string> = {
    light: '#f2ead7',
    dark: '#1c1915',
    sepia: '#efe6d2',
    graphite: '#e8e6e2',
    'oxblood-dark': '#1a1010',
  };
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', chromeColor[effective]);
  return effective;
}

/** The theme currently applied to the document, read back off the root. */
export function currentEffectiveTheme(): Exclude<ThemeChoice, 'auto'> {
  const v = document.documentElement.getAttribute('data-theme');
  return (v && (ALL_CHOICES as readonly string[]).includes(v) && v !== 'auto' ? v : 'light') as Exclude<ThemeChoice, 'auto'>;
}
