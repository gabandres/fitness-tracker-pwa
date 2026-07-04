import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import { StyleSheet, useColorScheme } from 'react-native';
import { palettes, type ColorTokens, type ShadowTokens } from '@/theme';

/**
 * Active-theme seam (ADR-0014). Components read the palette through
 * `useTheme()` / `useThemedStyles()` — never a static `colors` import — so
 * the whole app re-skins when the scheme flips. Preference is 3-way
 * (system | light | dark), persisted locally; "system" follows the OS.
 */

export type ThemePreference = 'system' | 'light' | 'dark';
export type Scheme = 'light' | 'dark';

export interface Theme {
  scheme: Scheme;
  colors: ColorTokens;
  shadow: ShadowTokens;
}

interface ThemeContextValue extends Theme {
  preference: ThemePreference;
  setPreference: (p: ThemePreference) => void;
}

const STORAGE_KEY = 'macrolog.theme-preference';

const ThemeContext = createContext<ThemeContextValue | null>(null);

export function ThemeProvider({ children }: { children: ReactNode }) {
  const system = useColorScheme();
  const [preference, setPreferenceState] = useState<ThemePreference>('system');

  // Hydrate the persisted preference once; until it lands we follow the
  // system, which is also the default — so there's no visible flip for
  // system-preference users (the overwhelming default).
  useEffect(() => {
    AsyncStorage.getItem(STORAGE_KEY)
      .then((v) => {
        if (v === 'light' || v === 'dark' || v === 'system') setPreferenceState(v);
      })
      .catch(() => {});
  }, []);

  const setPreference = useCallback((p: ThemePreference) => {
    setPreferenceState(p);
    AsyncStorage.setItem(STORAGE_KEY, p).catch(() => {});
  }, []);

  const scheme: Scheme = preference === 'system' ? (system === 'light' ? 'light' : 'dark') : preference;

  const value = useMemo<ThemeContextValue>(
    () => ({ scheme, ...palettes[scheme], preference, setPreference }),
    [scheme, preference, setPreference],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme must be used inside <ThemeProvider>');
  return ctx;
}

/**
 * Themed StyleSheet factory: `const styles = useThemedStyles(createStyles)`
 * with `createStyles(t: Theme)` defined at module scope (so the memo only
 * recomputes on scheme change, not per render).
 */
export function useThemedStyles<T extends StyleSheet.NamedStyles<T>>(factory: (t: Theme) => T): T {
  const { scheme, colors, shadow } = useTheme();
  return useMemo(() => factory({ scheme, colors, shadow }), [factory, scheme, colors, shadow]);
}
