import React from 'react';
import { Text } from 'react-native';
import { render } from '@testing-library/react-native';
import { audioGraphDescriptor, uniqueLabels } from '@/components/charts/audio-graph';
import { AccessibleChart } from '@/components/charts/AccessibleChart';

/**
 * Audio graphs for the charts (iOS VoiceOver's "Play Audio Graph").
 *
 * The descriptor builder is where every decision lives — dates as categories,
 * gaps as silence, the per-day sentence on one series only — so it is pinned
 * here. The native half (`modules/chart-accessibility`) only translates this
 * JSON into `AXChartDescriptor`, and can only be heard on a device.
 *
 * The wrapper is pinned for the case jest actually is: no native view. It must
 * then be a plain `View` carrying every prop it was given, which is what keeps
 * the charts' existing adjustable stepper — and the suites that test it —
 * exactly as they were.
 */

const base = {
  title: 'Maintenance',
  summary: 'Maintenance, last 3 days, 2,380 to 2,450 kcal',
  xTitle: 'Date',
  xLabels: ['Thu, Oct 2', 'Fri, Oct 3', 'Sat, Oct 4'],
  yTitle: 'kcal',
  unit: 'kcal',
};

describe('audioGraphDescriptor', () => {
  it('describes each series over categorical dates, with the data’s own y range', () => {
    const d = audioGraphDescriptor({
      ...base,
      series: [
        { name: 'Maintenance', values: [2380, 2410, 2450] },
        { name: 'Calories logged', values: [2100, null, 1900], continuous: false },
      ],
      pointLabels: ['Thu: 2,380', 'Fri: 2,410', 'Sat: 2,450'],
    });
    expect(d).not.toBeNull();
    expect(d!.xAxis).toEqual({ title: 'Date', labels: base.xLabels });
    expect(d!.yAxis).toEqual({ title: 'kcal', range: { min: 1900, max: 2450 }, unit: 'kcal', decimals: 0 });
    expect(d!.series[0]).toEqual({
      name: 'Maintenance',
      continuous: true,
      values: [
        { x: 'Thu, Oct 2', y: 2380, label: 'Thu: 2,380' },
        { x: 'Fri, Oct 3', y: 2410, label: 'Fri: 2,410' },
        { x: 'Sat, Oct 4', y: 2450, label: 'Sat: 2,450' },
      ],
    });
  });

  it('keeps a missing day as a gap — silence, never a zero', () => {
    const d = audioGraphDescriptor({ ...base, series: [{ name: 'Logged', values: [2100, null, 1900] }] });
    expect(d!.series[0].values[1]).toEqual({ x: 'Fri, Oct 3', y: null });
  });

  it('puts the per-day sentence on the first series only', () => {
    const d = audioGraphDescriptor({
      ...base,
      series: [
        { name: 'A', values: [1, 2, 3] },
        { name: 'B', values: [3, 2, 1] },
      ],
      pointLabels: ['one', 'two', 'three'],
    });
    expect(d!.series[1].values.every((v) => !('label' in v))).toBe(true);
  });

  it('has nothing to say when there is no finite value at all', () => {
    expect(audioGraphDescriptor({ ...base, series: [{ name: 'A', values: [null, null, null] }] })).toBeNull();
    expect(audioGraphDescriptor({ ...base, xLabels: [], series: [{ name: 'A', values: [] }] })).toBeNull();
    expect(audioGraphDescriptor({ ...base, series: [] })).toBeNull();
  });

  it('makes repeated date labels distinct, so no day merges into another', () => {
    expect(uniqueLabels(['Oct 4', 'Oct 5', 'Oct 4', 'Oct 4'])).toEqual(['Oct 4', 'Oct 5', 'Oct 4 (2)', 'Oct 4 (3)']);
  });

  it('reads weights at the precision asked for', () => {
    const d = audioGraphDescriptor({ ...base, decimals: 1, series: [{ name: 'Trend', values: [81.6, 81.4, 81.3] }] });
    expect(d!.yAxis.decimals).toBe(1);
  });
});

describe('AccessibleChart without the native view (Android, Expo Go, jest, older binaries)', () => {
  it('is a plain View that keeps every accessibility prop and child', async () => {
    const onAction = jest.fn();
    const ui = await render(
      <AccessibleChart
        descriptor={audioGraphDescriptor({ ...base, series: [{ name: 'A', values: [1, 2, 3] }] })}
        accessible
        accessibilityRole="adjustable"
        accessibilityLabel="Summary"
        accessibilityValue={{ text: 'Sat: 3' }}
        accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
        onAccessibilityAction={onAction}
        testID="plot"
      >
        <Text>child</Text>
      </AccessibleChart>,
    );
    const plot = ui.getByTestId('plot');
    expect(plot.props.accessibilityRole).toBe('adjustable');
    expect(plot.props.accessibilityLabel).toBe('Summary');
    expect(plot.props.accessibilityValue).toEqual({ text: 'Sat: 3' });
    expect(plot.props.descriptor).toBeUndefined();
    expect(ui.getByText('child')).toBeTruthy();
  });
});
