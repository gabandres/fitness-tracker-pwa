jest.mock('@/lib/auth', () => ({
  useAuth: () => ({ user: { uid: 'u1' }, profile: null }),
}));

import { renderWithProviders as render } from '@/test-utils';
import { HeroRings } from '@/components/HeroRings';
import type { MaintenanceView, ProteinFirstView } from '@macrolog/core';

/**
 * Protein-first mode on the Today hero (2026-11-20; core `protein-first.ts`):
 * the centre counts protein, calories are a range, and nothing says "over",
 * "left" or "under maintenance".
 */

const base = { calConsumed: 1420, calTarget: 1850, protConsumed: 92, protTarget: 140, carbs: 80, fat: 30, maintenance: null };

const plan: ProteinFirstView = { source: 'plan', proteinTarget: 140, proteinFloor: 120, kcalMin: 1850, kcalMax: 2150, note: 'Protein first while away.' };
const setting: ProteinFirstView = { source: 'setting', proteinTarget: 140, proteinFloor: null, kcalMin: 1500, kcalMax: 1850 };

const maintenance: MaintenanceView = {
  maintenance: 2358,
  consumed: 1420,
  delta: -938,
  reliable: true,
  loggedDays: 28,
  intakeDays: 28,
  spanDays: 30,
  weighInsDropped: 0,
  confidence: 1,
  provisional: false,
  holding: false,
};

const hidden = { includeHiddenElements: true };

describe('HeroRings — protein first', () => {
  it('without the mode, reads as it always has', async () => {
    const ui = await render(<HeroRings {...base} />);
    expect(ui.getByTestId('hero-rings-open', hidden).props.accessibilityLabel).toContain('1,420 of 1,850 calories, 430 left');
    expect(ui.queryByTestId('hero-protein-first', hidden)).toBeNull();
    expect(ui.getByText('kcal left', hidden)).toBeTruthy();
  });

  it('counts protein in the centre and shows calories as a range', async () => {
    const ui = await render(<HeroRings {...base} proteinFirst={plan} />);
    expect(ui.getByText('g protein left', hidden)).toBeTruthy();
    expect(ui.queryByText('kcal left', hidden)).toBeNull();
    expect(ui.getByTestId('hero-legend', hidden)).toHaveTextContent(/1,420 kcal · range 1,850–2,150/);
    expect(ui.getByTestId('hero-legend', hidden)).toHaveTextContent(/92 \/ 140 g protein · at least 120/);
    expect(ui.getByTestId('hero-protein-first', hidden)).toHaveTextContent('Protein first while away.');
  });

  it('says the same to a screen reader, in words', async () => {
    const ui = await render(<HeroRings {...base} proteinFirst={plan} />);
    expect(ui.getByTestId('hero-rings-open', hidden).props.accessibilityLabel).toBe(
      'Protein 92 of 140 grams, 48 left, at least 120 grams, 1,420 calories, range 1,850 to 2,150, 80 grams carbs, 30 grams fat',
    );
  });

  it('says the target is met instead of counting down past zero', async () => {
    const ui = await render(<HeroRings {...base} protConsumed={151} proteinFirst={plan} />);
    expect(ui.getByText('g protein · target met', hidden)).toBeTruthy();
    expect(ui.getByTestId('hero-rings-open', hidden).props.accessibilityLabel).toContain('Protein 151 of 140 grams, target met');
  });

  it('with the Settings switch: its own note, no floor it does not have, the range from the minimum', async () => {
    const ui = await render(<HeroRings {...base} proteinFirst={setting} />);
    expect(ui.getByTestId('hero-protein-first', hidden)).toHaveTextContent('Protein first. Calories are a range to land in.');
    expect(ui.getByTestId('hero-legend', hidden)).toHaveTextContent(/1,420 kcal · range 1,500–1,850/);
    expect(ui.getByTestId('hero-legend', hidden)).not.toHaveTextContent(/at least/);
  });

  it('shows one calorie number when the range has collapsed to it', async () => {
    const ui = await render(<HeroRings {...base} proteinFirst={{ ...setting, kcalMin: 1850 }} />);
    expect(ui.getByTestId('hero-legend', hidden)).toHaveTextContent(/1,420 \/ 1,850 kcal/);
    expect(ui.getByTestId('hero-rings-open', hidden).props.accessibilityLabel).toContain('1,420 of 1,850 calories');
  });

  it('keeps the maintenance number and drops the "under maintenance" gap', async () => {
    const usual = await render(<HeroRings {...base} maintenance={maintenance} />);
    expect(usual.getByTestId('maintenance-line', hidden)).toHaveTextContent(/under/i);
    usual.unmount();
  });

  it('in the mode, the maintenance line carries no gap', async () => {
    const ui = await render(<HeroRings {...base} maintenance={maintenance} proteinFirst={plan} />);
    expect(ui.getByTestId('maintenance-line', hidden)).toHaveTextContent(/2,358 kcal/);
    expect(ui.getByTestId('maintenance-line', hidden)).not.toHaveTextContent(/under|over/i);
  });
});
