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
