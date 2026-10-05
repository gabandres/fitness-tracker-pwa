/**
 * `NativeDateField` — the system date/time control with a JS fallback.
 *
 * Pinned without a device: the clamp that holds time-of-day bounds Android's
 * day-only calendar cannot; the chip label per mode; that a binary WITHOUT the
 * module renders the caller's fallback (an OTA reaching an older binary must
 * keep its steppers); and that the Android chip opens the picker and reports
 * the clamped pick — or nothing, when dismissed.
 */
jest.mock('@/lib/auth', () => ({
  useAuth: () => ({ user: { uid: 'u1' }, profile: null }),
}));

const mockShow = jest.fn();
jest.mock('../../modules/native-date-picker', () => {
  // State lives in the factory: the component reads the bridge at import time,
  // before any top-level `const` in this file has initialised.
  const state = { view: null as unknown, canShow: false };
  return {
    __state: state,
    get NativeDatePickerView() {
      return state.view;
    },
    get canShowNativeDatePicker() {
      return state.canShow;
    },
    isNativeDatePickerAvailable: false,
    showNativeDatePicker: (...a: unknown[]) => mockShow(...a),
  };
});

import { Text } from 'react-native';
import { act, fireEvent, renderWithProviders as render } from '@/test-utils';
import { NativeDateField, clampDate, dateFieldLabel } from '@/components/NativeDatePicker';

const bridge = jest.requireMock('../../modules/native-date-picker').__state as { view: unknown; canShow: boolean };

const AT = new Date(2026, 9, 4, 13, 5);

beforeEach(() => {
  jest.clearAllMocks();
  bridge.view = null;
  bridge.canShow = false;
});

describe('clampDate', () => {
  it('holds a value inside the bounds and returns the same object when inside', () => {
    const min = new Date(2026, 9, 4, 12, 0);
    const max = new Date(2026, 9, 4, 14, 0);
    expect(clampDate(AT, min, max)).toBe(AT);
    expect(clampDate(new Date(2026, 9, 4, 9, 0), min, max).getTime()).toBe(min.getTime());
    expect(clampDate(new Date(2026, 9, 5, 9, 0), min, max).getTime()).toBe(max.getTime());
    expect(clampDate(AT, null, undefined)).toBe(AT);
  });
});

describe('dateFieldLabel', () => {
  it('shows the day, the time, or both', () => {
    expect(dateFieldLabel(AT, 'time', 'en')).toMatch(/1:05/);
    expect(dateFieldLabel(AT, 'date', 'en')).toMatch(/Oct/);
    const both = dateFieldLabel(AT, 'dateAndTime', 'en');
    expect(both).toMatch(/Oct/);
    expect(both).toMatch(/1:05/);
  });
});

describe('NativeDateField', () => {
  it('renders the fallback when the binary has no native picker', async () => {
    const onChange = jest.fn();
    const view = await render(
      <NativeDateField
        mode="time"
        value={AT}
        onChange={onChange}
        accessibilityLabel="Meal time"
        testID="field"
        fallback={<Text>steppers</Text>}
      />,
    );
    expect(view.getByText('steppers')).toBeTruthy();
    expect(view.queryByTestId('field')).toBeNull();
  });

  it('Android: the chip opens the picker and reports the pick, clamped', async () => {
    bridge.canShow = true;
    const max = new Date(2026, 9, 4, 14, 0);
    mockShow.mockResolvedValue(new Date(2026, 9, 4, 18, 30).getTime());
    const onChange = jest.fn();
    const view = await render(
      <NativeDateField
        mode="time"
        value={AT}
        onChange={onChange}
        maximumDate={max}
        accessibilityLabel="Meal time"
        testID="field"
        fallback={<Text>steppers</Text>}
      />,
    );
    expect(view.queryByText('steppers')).toBeNull();
    await act(async () => {
      fireEvent.press(view.getByTestId('field'));
    });
    expect(mockShow).toHaveBeenCalledWith(
      expect.objectContaining({ mode: 'time', value: AT.getTime(), max: max.getTime(), min: null }),
    );
    expect(onChange).toHaveBeenCalledTimes(1);
    expect((onChange.mock.calls[0][0] as Date).getTime()).toBe(max.getTime());
  });

  it('Android: a dismissed picker changes nothing', async () => {
    bridge.canShow = true;
    mockShow.mockResolvedValue(null);
    const onChange = jest.fn();
    const view = await render(
      <NativeDateField mode="date" value={AT} onChange={onChange} accessibilityLabel="Day" testID="field" />,
    );
    await act(async () => {
      fireEvent.press(view.getByTestId('field'));
    });
    expect(mockShow).toHaveBeenCalled();
    expect(onChange).not.toHaveBeenCalled();
  });

  it('iOS: renders the native view with epoch-ms props and reports its changes', async () => {
    const { View } = require('react-native');
    const Fake = jest.fn((props: Record<string, unknown>) => <View testID="native-picker" {...props} />);
    bridge.view = Fake;
    const onChange = jest.fn();
    const min = new Date(2026, 9, 1);
    const view = await render(
      <NativeDateField
        mode="dateAndTime"
        value={AT}
        onChange={onChange}
        minimumDate={min}
        accessibilityLabel="Fast started"
        testID="field"
      />,
    );
    const props = Fake.mock.calls[Fake.mock.calls.length - 1][0] as Record<string, any>;
    expect(props.value).toBe(AT.getTime());
    expect(props.minimumDate).toBe(min.getTime());
    expect(props.maximumDate).toBeNull();
    expect(props.mode).toBe('dateAndTime');
    expect(props.pickerAccessibilityLabel).toBe('Fast started');
    expect(props.pickerTestID).toBe('field');
    expect(typeof props.locale).toBe('string');
    const picked = new Date(2026, 8, 20, 8, 0).getTime();
    await act(async () => {
      props.onChange({ nativeEvent: { timestamp: picked } });
    });
    // Below the minimum → clamped up to it.
    expect((onChange.mock.calls[0][0] as Date).getTime()).toBe(min.getTime());
    expect(view.getByTestId('native-picker')).toBeTruthy();
  });
});
