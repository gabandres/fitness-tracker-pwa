jest.mock('@/lib/auth', () => ({
  useAuth: () => ({ user: { uid: 'u1' }, profile: null }),
}));
jest.mock('@/lib/a11y', () => ({
  ...jest.requireActual('@/lib/a11y'),
  announce: jest.fn(),
}));

import type { DailyLog } from '@macrolog/core';
import { fireEvent, renderWithProviders as render } from '@/test-utils';
import { DailyMetrics } from '@/components/DailyMetrics';
import { HeroRings } from '@/components/HeroRings';
import { MealEntries } from '@/components/MealEntries';
import { announce } from '@/lib/a11y';
import { palettes } from '@/theme';

/**
 * The Today accessibility + adherence-neutral batch (2026-10-04). Each case
 * pins one finding that a screen-reader user or the brand rule would notice
 * and no layout or snapshot would.
 */

const noop = () => {};

/**
 * The ARGB ints react-native-svg reduces each arc's `stroke` to. The hero's
 * arcs are SVG circles, and by the time they reach the host tree the colour is
 * `{ type: 0, payload: 0xAARRGGBB }`, not the hex the component passed.
 */
function strokes(node: unknown, out: number[] = []): number[] {
  if (!node || typeof node !== 'object') return out;
  const n = node as { type?: string; props?: { stroke?: { payload?: number } }; children?: unknown[] };
  if (n.type === 'RNSVGCircle' && typeof n.props?.stroke?.payload === 'number') out.push(n.props.stroke.payload);
  for (const c of n.children ?? []) strokes(c, out);
  return out;
}
const argb = (hex: string) => 0xff000000 + parseInt(hex.slice(1, 7), 16);

describe('HeroRings over target', () => {
  const over = { calConsumed: 2300, calTarget: 2000, protConsumed: 60, protTarget: 150, carbs: 80, fat: 30, maintenance: null };

  it('never paints the ring in the danger colour (adherence-neutral)', async () => {
    const view = await render(<HeroRings {...over} />);
    const used = strokes(view.toJSON());
    expect(used).toContain(argb(palettes.light.colors.ring));
    expect(used).not.toContain(argb(palettes.light.colors.danger));
    expect(used).not.toContain(argb(palettes.dark.colors.danger));
  });

  it('speaks the over figure, not just consumed-of-target', async () => {
    const view = await render(<HeroRings {...over} />);
    expect(view.getByLabelText(/300 over/, { includeHiddenElements: true })).toBeTruthy();
  });

  it('speaks what is left when under', async () => {
    const view = await render(<HeroRings {...over} calConsumed={1500} />);
    expect(view.getByLabelText(/500 left/, { includeHiddenElements: true })).toBeTruthy();
  });
});

describe('DailyMetrics labels carry the value', () => {
  function setup(props: Partial<React.ComponentProps<typeof DailyMetrics>> = {}) {
    return render(
      <DailyMetrics
        water={16}
        sleep={7}
        fastStartedAt={null}
        fastedTodayHours={null}
        onAddWater={noop}
        onSetSleep={noop}
        onStartFast={noop}
        onBreakFast={noop}
        onEditFast={noop}
        {...props}
      />,
    );
  }

  it('reads the fasting and water values, not only their names', async () => {
    const view = await setup();
    expect(view.getByTestId('fast-open').props.accessibilityLabel).toBe('Fasting, Not fasting');
    expect(view.getByTestId('water-open').props.accessibilityLabel).toBe('Water, 16 fl oz');
  });

  it('names the metric on the short action buttons', async () => {
    const view = await setup({ fastStartedAt: new Date() });
    expect(view.getByTestId('fast-toggle').props.accessibilityLabel).toBe('End fast');
    expect(view.getByTestId('sleep-open').props.accessibilityLabel).toBe('Edit sleep');
  });

  it('announces the new water total after a pill tap', async () => {
    const view = await setup();
    await fireEvent.press(view.getByTestId('water-plus-8'));
    expect(announce).toHaveBeenCalledWith('24 fl oz of water today');
  });
});

describe('MealEntries row', () => {
  const log: DailyLog = {
    id: 'a',
    date: new Date(2026, 9, 4, 8, 0),
    calories: 300,
    mealLabel: 'Oatmeal',
  } as DailyLog;

  it('reads "label, n kcal" and shows the unit', async () => {
    const view = await render(<MealEntries logs={[log]} onPress={noop} />);
    expect(view.getByTestId('entry-a').props.accessibilityLabel).toMatch(/^Oatmeal, 300 kcal/);
    expect(view.getByText('kcal', { exact: false })).toBeTruthy();
  });

  it('offers save-preset and delete as accessibility actions that fire', async () => {
    const onPress = jest.fn();
    const onSavePreset = jest.fn();
    const onDelete = jest.fn();
    const view = await render(
      <MealEntries logs={[log]} onPress={onPress} onSavePreset={onSavePreset} onDelete={onDelete} />,
    );
    const row = view.getByTestId('entry-a');
    expect(row.props.accessibilityActions.map((a: { name: string }) => a.name)).toEqual([
      'activate',
      'savePreset',
      'delete',
    ]);
    await fireEvent(row, 'accessibilityAction', { nativeEvent: { actionName: 'savePreset' } });
    await fireEvent(row, 'accessibilityAction', { nativeEvent: { actionName: 'delete' } });
    await fireEvent(row, 'accessibilityAction', { nativeEvent: { actionName: 'activate' } });
    expect(onSavePreset).toHaveBeenCalledWith(log);
    expect(onDelete).toHaveBeenCalledWith(log);
    expect(onPress).toHaveBeenCalledWith(log);
  });

  it('offers no delete action where the caller cannot delete (History)', async () => {
    const view = await render(<MealEntries logs={[log]} onPress={noop} />);
    const names = view.getByTestId('entry-a').props.accessibilityActions.map((a: { name: string }) => a.name);
    expect(names).toEqual(['activate']);
  });
});

describe('MealEntries row — long-press menu (2026-10-04)', () => {
  it('opens the iOS action sheet with Edit · Save preset · Delete, and runs the pick', async () => {
    const { ActionSheetIOS } = jest.requireActual('react-native') as typeof import('react-native');
    const show = jest
      .spyOn(ActionSheetIOS, 'showActionSheetWithOptions')
      .mockImplementation((_opts, cb) => cb(2)); // "Delete"
    const onDelete = jest.fn();
    const onSavePreset = jest.fn();
    const log: DailyLog = { id: 'm1', date: new Date(2026, 9, 4, 8, 0), calories: 300, mealLabel: 'Oatmeal' };
    const view = await render(
      <MealEntries logs={[log]} onPress={() => {}} onSavePreset={onSavePreset} onDelete={onDelete} />,
    );
    await fireEvent(view.getByTestId('entry-m1'), 'longPress');
    const opts = show.mock.calls[0][0];
    expect(opts.options).toEqual(['Edit entry', 'Save preset', 'Delete', 'Cancel']);
    expect(opts.destructiveButtonIndex).toBe(2);
    expect(onDelete).toHaveBeenCalledWith(log);
    expect(onSavePreset).not.toHaveBeenCalled();
    show.mockRestore();
  });
});
