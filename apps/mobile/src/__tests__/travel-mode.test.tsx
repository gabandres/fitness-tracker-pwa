import React from 'react';

// The Settings card writes through the ledger; these tests only read its
// pure draft check, so the Firestore-backed modules are stubbed.
jest.mock('@/lib/ledger', () => ({ setTravelPeriods: jest.fn() }));
jest.mock('@/lib/auth', () => ({ useAuth: () => ({ user: null, profile: null, isAdmin: false }) }));
import { fireEvent, renderWithProviders as render, waitFor } from '@/test-utils';
import type { MaintenanceView, Recommendation, TravelPeriod } from '@macrolog/core';
import { en } from '@/i18n/en';
import { EyeballMealSheet, eyeballEntry, EYEBALL_SIZES } from '@/components/EyeballMealSheet';
import { TravelCard } from '@/components/TravelCard';
import { draftToPeriod } from '@/components/TravelSettingsCard';
import { maintenanceNotes } from '@/components/HeroRings';
import { recommendationText } from '@/components/train/recommendation-text';
import { entryFromLog } from '@/lib/entry-from-log';

/**
 * Travel mode in the app (owner, 2026-10-26: Bolivia 2026-10-31 → 2026-11-18):
 * the Today card leads with protein, the eyeballed meal saves as such, the
 * Settings draft validates, the maintenance hold is said, and the ladder call
 * reads as "make it harder".
 */

const t = ((key: keyof typeof en, params?: Record<string, string | number>) =>
  String(en[key]).replace(/\{(\w+)\}/g, (_, k) => String(params?.[k] ?? `{${k}}`))) as never;

const BOLIVIA: TravelPeriod = {
  start: '2026-10-31',
  end: '2026-11-18',
  label: 'Bolivia',
  usualSteps: 6200,
  altitude: { place: 'Cochabamba', meters: 2577, arrival: '2026-11-01' },
};

describe('the eyeballed meal', () => {
  it('is the owner\'s three sizes', () => {
    expect(EYEBALL_SIZES).toEqual({ S: { kcal: 300, protein: 20 }, M: { kcal: 550, protein: 35 }, L: { kcal: 850, protein: 45 } });
  });

  it('saves as eyeballed, with the protein-first flag only when set', () => {
    expect(eyeballEntry({ name: ' Salteña ', kcal: 550, protein: 35, proteinFirst: true })).toEqual({
      calories: 550, protein: 35, mealLabel: 'Salteña', estimateQuality: 'eyeballed', proteinFirst: true,
    });
    expect(eyeballEntry({ name: '', kcal: 300, protein: 20, proteinFirst: false })).toEqual({
      calories: 300, protein: 20, estimateQuality: 'eyeballed',
    });
  });

  it('stays eyeballed through an Undo', () => {
    const entry = entryFromLog({ date: new Date(), calories: 550, protein: 35, estimateQuality: 'eyeballed', proteinFirst: true });
    expect(entry).toMatchObject({ estimateQuality: 'eyeballed', proteinFirst: true });
  });

  it('the sheet: pick L, edit protein, log it', async () => {
    const onSave = jest.fn(() => Promise.resolve());
    const onClose = jest.fn();
    const ui = await render(<EyeballMealSheet visible onClose={onClose} onSave={onSave} />);
    await fireEvent.changeText(ui.getByTestId('eyeball-name'), 'Pique macho');
    await fireEvent.press(ui.getByTestId('eyeball-size-L'));
    expect(ui.getByTestId('eyeball-kcal').props.value).toBe('850');
    await fireEvent.changeText(ui.getByTestId('eyeball-protein'), '55');
    await fireEvent.press(ui.getByTestId('eyeball-save'));
    await waitFor(() => expect(onSave).toHaveBeenCalledWith({
      calories: 850, protein: 55, mealLabel: 'Pique macho', estimateQuality: 'eyeballed', proteinFirst: true,
    }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });
});

describe('the Today travel card', () => {
  const card = (todayKey: string, steps: number | null) => (
    <TravelCard period={BOLIVIA} todayKey={todayKey} protein={86} proteinTarget={140} kcal={1240} kcalTarget={1850} steps={steps} onEyeballMeal={jest.fn()} />
  );

  it('leads with protein, calls calories approximate, and compares steps with the usual', async () => {
    const ui = await render(card('2026-10-31', 12_400));
    expect(ui.getByTestId('travel-banner')).toHaveTextContent('Travel · Bolivia · eyeball mode');
    expect(ui.getByTestId('travel-protein')).toHaveTextContent('86 / 140 g');
    expect(ui.getByTestId('travel-kcal')).toHaveTextContent('≈ 1,240 / 1,850 kcal (approximate)');
    expect(ui.getByTestId('travel-steps')).toHaveTextContent('Steps 12,400 · usual ~6,200');
    // Santa Cruz: no altitude note yet.
    expect(ui.queryByTestId('travel-altitude')).toBeNull();
  });

  it('shows the altitude note for the first three days in Cochabamba only', async () => {
    expect((await render(card('2026-11-02', null))).getByTestId('travel-altitude')).toHaveTextContent(/Altitude 2,577 m \(Cochabamba, day 2\) — walk only/);
    expect((await render(card('2026-11-04', null))).queryByTestId('travel-altitude')).toBeNull();
  });
});

describe('the Settings trip draft', () => {
  const base = { label: 'Bolivia', start: '2026-10-31', end: '2026-11-18', usualSteps: '6200', place: '', meters: '', arrival: '' };
  it('becomes a period', () => {
    expect(draftToPeriod(base)).toEqual({ start: '2026-10-31', end: '2026-11-18', label: 'Bolivia', usualSteps: 6200 });
    expect(draftToPeriod({ ...base, place: 'Cochabamba', meters: '2577', arrival: '2026-11-01' })).toMatchObject({
      altitude: { place: 'Cochabamba', meters: 2577, arrival: '2026-11-01' },
    });
  });
  it('refuses reversed dates and a half-filled altitude stop', () => {
    expect(draftToPeriod({ ...base, start: '2026-11-19' })).toBe('dates');
    expect(draftToPeriod({ ...base, place: 'Cochabamba' })).toBe('altitude');
    expect(draftToPeriod({ ...base, place: 'Cochabamba', meters: '2577', arrival: '2026-12-01' })).toBe('altitude');
  });
});

describe('the maintenance hold is said', () => {
  const mv = (over: Partial<MaintenanceView>): MaintenanceView => ({
    maintenance: 2112, consumed: 0, delta: null, reliable: true, loggedDays: 42, intakeDays: 42, spanDays: 42,
    weighInsDropped: 0, confidence: 1, provisional: false, holding: false, ...over,
  });
  it('frozen during the trip', () => {
    const n = maintenanceNotes(mv({ travelHold: { state: 'frozen', start: '2026-10-31', end: '2026-11-18', frozenAsOf: '2026-10-30' } }), t);
    expect(n?.short).toBe('Held for travel');
    expect(n?.full[0]).toMatch(/from 2026-10-30 while you travel/);
  });
  it('rebuilding after it', () => {
    const n = maintenanceNotes(mv({ travelHold: { state: 'rebuilding', start: '2026-10-31', end: '2026-11-18', frozenAsOf: '2026-10-30', valid: 6, needed: 14 } }), t);
    expect(n?.short).toBe('Rebuilding 6/14');
  });
});

describe('the ladder call', () => {
  it('reads as "make it harder", never "hold"', () => {
    const rec: Recommendation = {
      action: 'hold', load: 0, currentLoad: 0, last: [], assisted: false, approximate: false, warnings: [],
      reason: { kind: 'harder-ladder', reps: 21, cap: 20, next: 'tempo', harder: 'feet elevated' },
    };
    const out = recommendationText(rec, 'us', t)!;
    expect(out.headline).toBe('MAKE IT HARDER');
    expect(out.reason).toMatch(/lower for 3 s and pause 1 s.*Add the backpack/);
  });
});
