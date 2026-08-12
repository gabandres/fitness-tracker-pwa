import { renderHook } from '@testing-library/react-native';

/**
 * Today shows at most one Nudge (UX_AUDIT §S14 TD1).
 *
 * The failure this prevents is not a crash — it is three cards stacked above
 * the rings, which is what the screen exists for. Web has had the gate since
 * `c824b99d`; this is the mobile half, and these tests pin the priority so the
 * two cannot drift.
 */

const mockUpdate = { value: false };
const mockRecal = { value: false };
const mockWhatsNew = { value: false };

jest.mock('@/components/UpdateBanner', () => ({
  useUpdateVisible: () => mockUpdate.value,
}));
jest.mock('@/components/RecalibrationCard', () => ({
  useRecalibrationVisible: () => mockRecal.value,
}));
jest.mock('@/components/WhatsNewBanner', () => ({
  useWhatsNewVisible: () => mockWhatsNew.value,
}));

import { useTodayNudge } from '@/hooks/useTodayNudge';

beforeEach(() => {
  mockUpdate.value = false;
  mockRecal.value = false;
  mockWhatsNew.value = false;
});

// `renderHook` is async in this RNTL version — the same shape `log-writes`
// uses.
async function activeNudge() {
  const { result } = await renderHook(() => useTodayNudge());
  return result.current;
}

describe('useTodayNudge', () => {
  it('is null when nothing wants the slot', async () => {
    expect(await activeNudge()).toBeNull();
  });

  it('gives the slot to the only claimant', async () => {
    mockWhatsNew.value = true;
    expect(await activeNudge()).toBe('whatsNew');
  });

  it('ranks update over everything — its value decays, the others wait', async () => {
    mockUpdate.value = true;
    mockRecal.value = true;
    mockWhatsNew.value = true;
    expect(await activeNudge()).toBe('update');
  });

  it('ranks a real target change over marketing about a release already running', async () => {
    mockRecal.value = true;
    mockWhatsNew.value = true;
    expect(await activeNudge()).toBe('recalibration');
  });

  it('never returns more than one — the whole point', async () => {
    // Guards against a future refactor that returns a list "for flexibility".
    mockUpdate.value = true;
    mockRecal.value = true;
    expect(typeof (await activeNudge())).toBe('string');
  });
});
