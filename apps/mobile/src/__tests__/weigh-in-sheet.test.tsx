import { fireEvent, renderWithProviders as render } from '@/test-utils';

/**
 * The weigh-in sheet, held to the same rules as the water sheet.
 *
 * They were the same idea built twice. Water hand-rolled its `<Modal>` while
 * this one used the shared `<BottomSheet>`; water had `selectTextOnFocus`, a
 * `done` return key and a note line saying what the total was about to
 * become, and this one — whose field is ALSO prefilled — had none of them.
 * Editing 180.4 to 179.8 therefore cost five backspaces, and typing without
 * clearing produced 180.4179.8.
 *
 * The container half is covered in `one-field-sheets.test.tsx`. This pins the
 * behaviour specific to a weigh-in, and in particular the state that used to
 * have no words at all: an out-of-range weight greyed Save out and said
 * nothing, which reads as a broken button rather than as "50 to 500".
 */

let mockTodayWeight: number | null = 180.4;
let mockUnitSystem: 'us' | 'metric' = 'us';
const mockSetWeight = jest.fn().mockResolvedValue(undefined);

jest.mock('@/hooks/useBody', () => ({
  useBody: () => ({
    loading: false,
    error: null,
    currentWeight: 180.4,
    get todayWeight() {
      return mockTodayWeight;
    },
    weighIns: [],
    setWeight: mockSetWeight,
    measurements: [],
    bodyFat: null,
    bodyFatGap: null,
    bodyFatMissing: [],
    addMeasurement: jest.fn(),
    updateMeasurement: jest.fn(),
    deleteMeasurement: jest.fn(),
    projection: null,
    weightSeries: [],
    projectedSeries: [],
    goalProgress: null,
  }),
}));

jest.mock('@/lib/auth', () => ({
  useAuth: () => ({
    user: { uid: 'u1', email: 'a@b.co' },
    profile: {
      sex: 'male',
      heightIn: 70,
      get unitSystem() {
        return mockUnitSystem;
      },
    },
  }),
}));

jest.mock('@/hooks/useDailyTargets', () => ({
  useDailyTargets: () => ({ loaded: false, error: null }),
}));

import BodyScreen from '@/app/(app)/body';

beforeEach(() => {
  mockTodayWeight = 180.4;
  mockUnitSystem = 'us';
  mockSetWeight.mockClear();
});

async function openSheet() {
  const view = await render(<BodyScreen />);
  await fireEvent.press(view.getByTestId('log-weight'));
  return view;
}

describe('the weigh-in sheet matches the water sheet', () => {
  it('selects its prefilled text on focus and finishes on the return key', async () => {
    const input = (await openSheet()).getByTestId('weight-input');
    expect(input.props.value).toBe('180.4');
    // Without this, the first keystroke appends: 180.4 becomes 180.4179.8.
    expect(input.props.selectTextOnFocus).toBe(true);
    expect(input.props.returnKeyType).toBe('done');
  });

  it('keeps the decimal keypad rather than copying water number-pad', async () => {
    // Consistency in the RULE, not in the value: give the field the keypad its
    // values need. Water is whole fluid ounces; a weigh-in is 180.4.
    const input = (await openSheet()).getByTestId('weight-input');
    expect(input.props.keyboardType).toBe('numeric');
  });

  it('names the current weight at rest', async () => {
    const view = await openSheet();
    expect(view.getByTestId('weight-note').props.children).toContain('180.4');
  });

  it('names the result once a new weight is typed', async () => {
    const view = await openSheet();
    await fireEvent.changeText(view.getByTestId('weight-input'), '179.8');
    const note = view.getByTestId('weight-note').props.children;
    expect(note).toContain('180.4');
    expect(note).toContain('179.8');
  });

  it('SAYS an out-of-range weight is out of range instead of only greying Save', async () => {
    const view = await openSheet();
    await fireEvent.changeText(view.getByTestId('weight-input'), '12');
    const note = view.getByTestId('weight-note').props.children;
    // The shared 50–500 bounds, named — a disabled button with no words reads
    // as a broken button.
    expect(note).toContain('50');
    expect(note).toContain('500');
    expect(view.getByTestId('weight-save').props.accessibilityState?.disabled).toBe(true);
  });

  it('says nothing about "today" before there is a weigh-in today', async () => {
    mockTodayWeight = null;
    const view = await openSheet();
    // Still shows the last recorded weight — it is the number being replaced —
    // but must not call a previous day's reading today's.
    const note = view.getByTestId('weight-note').props.children;
    expect(note).toContain('180.4');
    expect(note).not.toContain('Today');
  });
});

/**
 * UX_AUDIT F3. Body weight was pounds-only everywhere, with no way to change
 * it — `unitSystem` existed but only reached food serving sizes, so typing 68
 * (kg) produced a plan for a 68 lb person.
 *
 * The rule these pin: **the field is in the user's unit and the store is
 * always pounds.** A conversion missing in either direction produces a
 * plausible number and nothing on screen says so, which is exactly the class
 * of defect a test has to hold.
 */
describe('the weigh-in sheet in kilograms', () => {
  beforeEach(() => {
    mockUnitSystem = 'metric';
  });

  it('shows the stored pounds as kilograms', async () => {
    const input = (await openSheet()).getByTestId('weight-input');
    // 180.4 lb = 81.8 kg.
    expect(input.props.value).toBe('81.8');
  });

  it('labels the field kg, not lb', async () => {
    const view = await openSheet();
    expect(view.getByTestId('weight-note').props.children).toContain('kg');
  });

  it('SAVES POUNDS when the user types kilograms', async () => {
    const view = await openSheet();
    await fireEvent.changeText(view.getByTestId('weight-input'), '80');
    await fireEvent.press(view.getByTestId('weight-save'));
    // 80 kg = 176.4 lb. Storing 80 would be the defect.
    expect(mockSetWeight).toHaveBeenCalledTimes(1);
    expect(mockSetWeight.mock.calls[0][0]).toBeCloseTo(176.4, 1);
  });

  it('quotes the out-of-range band in kilograms', async () => {
    const view = await openSheet();
    await fireEvent.changeText(view.getByTestId('weight-input'), '5');
    const note = view.getByTestId('weight-note').props.children;
    // 50–500 lb is 23–226 kg. Telling a metric user "between 50 and 500 lb" is
    // a non-answer, and 50 is a weight they might legitimately be.
    expect(note).toContain('23');
    expect(note).toContain('226');
    expect(note).not.toContain('500');
  });

  it('accepts a weight that is only valid because it was read as kg', async () => {
    const view = await openSheet();
    // 45 would be rejected as pounds (under the 50 lb floor) and is fine as
    // kilograms — 99.2 lb. The unit has to be applied BEFORE the bounds check.
    await fireEvent.changeText(view.getByTestId('weight-input'), '45');
    await fireEvent.press(view.getByTestId('weight-save'));
    expect(mockSetWeight.mock.calls[0][0]).toBeCloseTo(99.2, 1);
  });
});
