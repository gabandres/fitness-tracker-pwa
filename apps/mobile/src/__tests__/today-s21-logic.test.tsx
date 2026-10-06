/**
 * S21 — Today + add-meal fixes, the pure seams and the small components:
 * the hero's one-line maintenance caveat (and the ⓘ that holds the rest), the
 * neutral empty ring track, the +'s pressed look, the long-fast check, the
 * metric rows' identity icons and their trailing Trends shortcut, and the
 * portion picker's direct ⊕ add.
 */
import React from 'react';
import { fireEvent, renderWithProviders as render } from '@/test-utils';
import type { MaintenanceView } from '@macrolog/core';

jest.mock('@/lib/auth', () => ({ useAuth: () => ({ user: null, profile: null }) }));
jest.mock('expo-router', () => ({
  ...jest.requireActual('expo-router'),
  useRouter: () => ({ push: jest.fn(), replace: jest.fn(), back: jest.fn() }),
}));
// iOS presents sheets natively, through a route these tests do not mount.
jest.mock('@/components/BottomSheet', () => require('./js-sheet').jsSheetModule());
jest.mock('@/lib/foodSearch', () => ({
  searchFoods: jest.fn(async () => []),
  getFoodDetail: jest.fn(),
  sortServings: (s: unknown) => s,
  warmFoodIndex: jest.fn(),
}));

import { en } from '@/i18n/en';
import { HeroRings, maintenanceNotes, ringTrack } from '@/components/HeroRings';
import { DailyMetrics, FAST_CHECK_HOURS, fastNeedsCheck } from '@/components/DailyMetrics';
import { fabPressedStyle } from '@/components/LogSpeedDial';
import { PortionPicker } from '@/components/FoodSearch';
import { palettes } from '@/theme';

const t = ((key: keyof typeof en, params?: Record<string, string | number>) =>
  String(en[key]).replace(/\{(\w+)\}/g, (_, k) => String(params?.[k] ?? `{${k}}`))) as never;

function mv(over: Partial<MaintenanceView>): MaintenanceView {
  return {
    maintenance: 2665,
    delta: -300,
    reliable: true,
    provisional: false,
    holding: false,
    loggedDays: 40,
    spanDays: 79,
    intakeDays: 40,
    weighInsDropped: 0,
    ...over,
  } as MaintenanceView;
}

describe('maintenanceNotes — one short line, every caveat behind the ⓘ', () => {
  it('says nothing when there is nothing to hedge', () => {
    expect(maintenanceNotes(mv({}), t)).toBeNull();
  });

  it('a rough AND provisional estimate leads with the rough one, and keeps both in full', () => {
    const notes = maintenanceNotes(mv({ reliable: false, provisional: true }), t)!;
    expect(notes.testID).toBe('maintenance-rough');
    expect(notes.short).toBe('Still settling — 40 of 79 days logged');
    expect(notes.full).toEqual([
      '40 of 79 days logged — gaps make this less certain',
      en['today.maintenanceProvisional'],
    ]);
  });

  it('holding replaces rough and provisional rather than stacking with them', () => {
    const notes = maintenanceNotes(mv({ holding: true, reliable: false, provisional: true }), t)!;
    expect(notes.testID).toBe('maintenance-holding');
    expect(notes.full).toEqual([en['today.maintenanceHolding']]);
  });

  it('dropped weigh-ins are said even on a reliable estimate', () => {
    const notes = maintenanceNotes(mv({ weighInsDropped: 2 }), t)!;
    expect(notes.testID).toBe('maintenance-outliers');
    expect(notes.full).toEqual(['2 weigh-ins ignored — a real jump in weight can look like bad readings']);
  });

  it('the food count is named only when it differs from the row count', () => {
    const notes = maintenanceNotes(mv({ reliable: false, intakeDays: 31 }), t)!;
    expect(notes.full[0]).toBe('40 of 79 days logged, 31 with food — gaps make this less certain');
  });
});

describe('the hero footer', () => {
  const base = {
    calConsumed: 0,
    calTarget: 2300,
    protConsumed: 0,
    protTarget: 150,
    carbs: 0,
    fat: 0,
  };

  it('shows ONE caveat line and an ⓘ that opens the full explanation', async () => {
    const screen = await render(
      <HeroRings {...base} maintenance={mv({ reliable: false, provisional: true })} />,
    );
    expect(screen.getByTestId('maintenance-rough')).toBeTruthy();
    // The second caveat is not printed in the panel any more.
    expect(screen.queryByTestId('maintenance-provisional')).toBeNull();
    expect(screen.queryByText(en['today.maintenanceProvisional'])).toBeNull();

    await fireEvent.press(screen.getByTestId('maintenance-info'));
    expect(screen.getByTestId('maintenance-about-title')).toBeTruthy();
    expect(screen.getByText(en['today.maintenanceProvisional'])).toBeTruthy();
    expect(screen.getByText('40 of 79 days logged — gaps make this less certain')).toBeTruthy();
  });

  it('a reliable estimate has no caveat and no ⓘ', async () => {
    const screen = await render(<HeroRings {...base} maintenance={mv({})} />);
    expect(screen.getByTestId('maintenance-line')).toBeTruthy();
    expect(screen.queryByTestId('maintenance-info')).toBeNull();
  });
});

describe('ringTrack — the empty ring reads neutral, not muddy', () => {
  const lum = (hex: string) => {
    const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) =>
      v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4,
    );
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const ratio = (a: string, b: string) => {
    const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
    return (x + 0.05) / (y + 0.05);
  };
  const sat = (hex: string) => {
    const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
    return Math.max(r, g, b) - Math.min(r, g, b);
  };

  it.each(['light', 'dark'] as const)('%s: brighter than the old hue wash, and far less saturated', (scheme) => {
    const c = palettes[scheme].colors;
    for (const hue of [c.ring, c.protein]) {
      const track = ringTrack(hue, c.heroPanel);
      expect(track).toMatch(/^#[0-9a-f]{6}$/);
      // Still an edge on the panel (the old shared grey was 1.29:1).
      expect(ratio(track, c.heroPanel)).toBeGreaterThan(1.5);
      // Desaturated: the brown/bottle-green came from a saturated wash.
      expect(sat(track)).toBeLessThan(30);
    }
    // And the two rings are still told apart before either has any fill.
    expect(ringTrack(c.ring, c.heroPanel)).not.toBe(ringTrack(c.protein, c.heroPanel));
  });
});

describe('the + pressed state', () => {
  it('nothing at rest; a scale and a dim when pressed; only the dim under Reduce Motion', () => {
    expect(fabPressedStyle(false, false)).toBeNull();
    expect(fabPressedStyle(true, false)).toEqual({ opacity: 0.9, transform: [{ scale: 0.93 }] });
    expect(fabPressedStyle(true, true)).toEqual({ opacity: 0.8 });
  });
});

describe('the metric rows', () => {
  const props = {
    water: 16,
    sleep: 7,
    activity: undefined,
    onAddWater: jest.fn(),
    onSetSleep: jest.fn(),
    onStartFast: jest.fn(),
    onBreakFast: jest.fn(),
    onEditFast: jest.fn(),
  };

  it('lead with their OWN identity icon, and keep a named Trends shortcut', async () => {
    const screen = await render(<DailyMetrics {...props} fastStartedAt={null} />);
    for (const m of ['fasting', 'water', 'sleep']) {
      // Decorative (hidden from the reader): the row's label names it.
      expect(screen.getByTestId(`metric-icon-${m}`, { includeHiddenElements: true })).toBeTruthy();
    }
    expect(screen.getByTestId('metric-trends-fasting').props.accessibilityLabel).toBe('Fasting trend');
    expect(screen.getByTestId('metric-trends-water').props.accessibilityLabel).toBe('Water trend');
    expect(screen.getByTestId('metric-trends-sleep').props.accessibilityLabel).toBe('Sleep trend');
  });

  it('a fast past three days asks rather than just counting', () => {
    expect(fastNeedsCheck(null, Date.now())).toBe(false);
    const now = Date.now();
    expect(fastNeedsCheck(new Date(now - (FAST_CHECK_HOURS - 1) * 3_600_000), now)).toBe(false);
    expect(fastNeedsCheck(new Date(now - FAST_CHECK_HOURS * 3_600_000), now)).toBe(true);

  });

  it('a 16-hour fast just counts', async () => {
    const short = await render(<DailyMetrics {...props} fastStartedAt={new Date(Date.now() - 16 * 3_600_000)} />);
    expect(short.queryByTestId('fast-check')).toBeNull();
  });

  it('a 329-hour fast is asked about', async () => {
    const now = Date.now();
    const long = await render(<DailyMetrics {...props} fastStartedAt={new Date(now - 329 * 3_600_000)} />);
    expect(long.getByTestId('fast-check')).toBeTruthy();
    expect(long.getByText(en['metrics.fastCheck'])).toBeTruthy();
  });
});

describe('the portion picker', () => {
  const servings = [
    { label: '1 cup', grams: 245, kcal: 150, protein: 20, carbs: 9, fat: 4, kind: 'portion' as const },
    { label: '100 g', grams: 100, kcal: 61, protein: 8, carbs: 4, fat: 2, kind: 'portion' as const },
  ];

  it('⊕ on a serving logs that portion × the quantity at once; the row still reviews', async () => {
    const onPick = jest.fn();
    const onQuickLog = jest.fn();
    const screen = await render(
      <PortionPicker
        title="Greek yogurt"
        servings={servings}
        backLabel="Results"
        onBack={jest.fn()}
        context={{ source: 'text' }}
        onPick={onPick}
        onQuickLog={onQuickLog}
      />,
    );
    await fireEvent.press(screen.getByTestId('food-qty-plus')); // 1.5×
    await fireEvent.press(screen.getByTestId('portion-add-0'));
    expect(onQuickLog).toHaveBeenCalledTimes(1);
    expect(onQuickLog.mock.calls[0][0]).toMatchObject({ calories: 225, protein: 30, mealLabel: 'Greek yogurt' });
    expect(onPick).not.toHaveBeenCalled();

    await fireEvent.press(screen.getByTestId('portion-1'));
    expect(onPick).toHaveBeenCalledTimes(1);
  });

  it('no ⊕ without a quick-log handler', async () => {
    const screen = await render(
      <PortionPicker
        title="Greek yogurt"
        servings={servings}
        backLabel="Results"
        onBack={jest.fn()}
        context={{ source: 'text' }}
        onPick={jest.fn()}
      />,
    );
    expect(screen.queryByTestId('portion-add-0')).toBeNull();
  });
});
