import { render, type RenderOptions } from '@testing-library/react-native';
import type { ReactElement, ReactNode } from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { I18nProvider } from '@/i18n';
import { ThemeProvider } from '@/lib/theme-context';

/**
 * Renders with the providers every screen assumes.
 *
 * i18n and theme are deliberately the REAL implementations, not mocks. A
 * stubbed `t()` that echoes its key would make every copy assertion vacuous —
 * and a missing translation key is exactly the kind of defect this layer
 * should catch, not paper over. The theme provider is real for the same
 * reason: components read the palette through `useTheme()` (ADR-0014), so a
 * mocked one hides a whole class of breakage.
 *
 * SafeAreaProvider needs explicit initial metrics — without them insets
 * resolve asynchronously and every screen renders zero-height on first pass.
 */
const INITIAL_METRICS = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 47, left: 0, right: 0, bottom: 34 },
};

function AllProviders({ children }: { children: ReactNode }) {
  return (
    <SafeAreaProvider initialMetrics={INITIAL_METRICS}>
      <I18nProvider>
        <ThemeProvider>{children}</ThemeProvider>
      </I18nProvider>
    </SafeAreaProvider>
  );
}

export function renderWithProviders(ui: ReactElement, options?: RenderOptions) {
  return render(ui, { wrapper: AllProviders, ...options });
}

export * from '@testing-library/react-native';
