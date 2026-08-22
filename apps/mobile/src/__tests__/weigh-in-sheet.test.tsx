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

jest.mock('@/hooks/useBody', () => ({
  useBody: () => ({
    loading: false,
    error: null,
    currentWeight: 180.4,
    get todayWeight() {
      return mockTodayWeight;
    },
    weighIns: [],
    setWeight: jest.fn(),
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
  useAuth: () => ({ user: { uid: 'u1', email: 'a@b.co' }, profile: { sex: 'male', heightIn: 70 } }),
}));

jest.mock('@/hooks/useDailyTargets', () => ({
  useDailyTargets: () => ({ loaded: false, error: null }),
}));

import BodyScreen from '@/app/(app)/body';

beforeEach(() => {
  mockTodayWeight = 180.4;
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
