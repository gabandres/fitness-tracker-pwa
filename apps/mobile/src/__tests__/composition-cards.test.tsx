import React from 'react';
import { renderWithProviders as render } from '@/test-utils';
import type { CompositionMaintenanceOk, RecompSignal } from '@macrolog/core';

jest.mock('@/lib/auth', () => ({ useAuth: () => ({ user: { uid: 'u1' }, profile: null }) }));
jest.mock('@/lib/reminders', () => ({
  getTapeReminder: jest.fn(async () => null),
  setTapeReminder: jest.fn(async () => true),
}));

import { CompositionLine, RecompCard } from '@/components/CompositionCards';
import { FEATURES, isFeatureOn } from '@/lib/features';

/**
 * ADR-0043 surfaces. The copy rules are the point: the composition number is
 * shown beside maintenance, never as a direction claim while Low, and lean
 * mass is "lean mass (includes water)" — never "muscle".
 */

const ok = (over: Partial<CompositionMaintenanceOk> = {}): CompositionMaintenanceOk => ({
  status: 'ok',
  median: 2034,
  p10: 1606,
  p90: 2468,
  halfWidth80: 431,
  confidence: 'low',
  pointEstimate: 2031,
  mode: 'mixed',
  points: 5,
  sources: { dxa: 0, other: 0, navy: 5 },
  firstKey: '2026-08-05',
  lastKey: '2026-09-28',
  spanDays: 54,
  loggedDays: 54,
  intakeFromKey: '2026-08-05',
  meanIntake: 1890,
  weightStartKg: 71,
  weightEndKg: 70.5,
  bodyFatStartPct: 16.4,
  bodyFatEndPct: 15.3,
  deltaFmKg: -0.86,
  deltaFfmKg: 0.36,
  storedKcal: -7465,
  ...over,
});

const allText = (screen: Awaited<ReturnType<typeof render>>) => JSON.stringify(screen.toJSON());

describe('CompositionLine', () => {
  it('prints the median, the 80% range, confidence and the evidence — rounded to tens', async () => {
    const screen = await render(<CompositionLine result={ok()} unitSystem="us" />);
    expect(screen.getByTestId('comp-line').props.children).toBe(
      'Composition-adjusted: ~2,030 (range 1,610–2,470) · Low confidence · based on 5 tapes over 54 days',
    );
  });

  it('makes no direction claim inside Low confidence', async () => {
    const screen = await render(<CompositionLine result={ok()} unitSystem="us" />);
    expect(screen.queryByTestId('comp-detail')).toBeNull();
  });

  it('above Low it shows the split — "lean mass (includes water)", never "muscle"', async () => {
    const screen = await render(<CompositionLine result={ok({ confidence: 'medium' })} unitSystem="us" />);
    const detail = screen.getByTestId('comp-detail').props.children as string;
    expect(detail).toBe('Fat −1.9 lb · lean mass (includes water) +0.8 lb');
    expect(allText(screen).toLowerCase()).not.toContain('muscle');
  });

  it('DXA-anchored → the evidence is named as DXA scans', async () => {
    const result = ok({ mode: 'dxa_anchored', points: 2, sources: { dxa: 2, other: 0, navy: 0 }, spanDays: 119, confidence: 'high' });
    const screen = await render(<CompositionLine result={result} unitSystem="us" />);
    expect(screen.getByTestId('comp-line').props.children).toContain('based on 2 DXA scans over 119 days');
  });

  it('insufficient → the tape instruction', async () => {
    const screen = await render(
      <CompositionLine result={{ status: 'insufficient_tapes', points: 2, spanDays: 14, profileMissing: false }} unitSystem="us" />,
    );
    expect(screen.getByTestId('comp-line').props.children).toBe(
      'Log a waist + neck tape weekly to estimate recomposition (needs 3 tapes over 4+ weeks).',
    );
  });
});

describe('women need the hip too', () => {
  it('the insufficient line asks for waist + neck + hip', async () => {
    const screen = await render(
      <CompositionLine result={{ status: 'insufficient_tapes', points: 0, spanDays: 0, profileMissing: false }} unitSystem="us" female />,
    );
    expect(screen.getByTestId('comp-line').props.children).toBe(
      'Log a waist + neck + hip tape weekly to estimate recomposition (needs 3 tapes over 4+ weeks).',
    );
  });

  it('the how-to measures the waist at its narrowest and the hips at their widest', async () => {
    const screen = await render(
      <RecompCard signal={{ status: 'insufficient', reason: 'tapes', tapes: 0 }} unitSystem="us" lastTapeAt={null} female />,
    );
    const text = allText(screen);
    expect(text).toContain('hips at their widest');
    expect(text).not.toContain('Adam');
  });
});

describe('RecompCard', () => {
  const signal: RecompSignal = {
    status: 'ok',
    cls: 'recomp',
    weightLbPerWeek: -0.133,
    waistInPer4Wk: -0.238,
    waistSeInPer4Wk: 0.341,
    waistWithinNoise: true,
    tapes: 3,
  };

  it('shows the class, both slopes, the tape count, and the noise caveat', async () => {
    const screen = await render(<RecompCard signal={signal} unitSystem="us" lastTapeAt={null} />);
    expect(screen.getByTestId('recomp-class').props.children).toBe('Recomposition signal: waist down, weight stable');
    expect(screen.getByTestId('recomp-slopes').props.children).toBe(
      'Weight −0.13 lb/wk · Waist −0.24 ± 0.34 in per 4 wk · 3 tapes',
    );
    expect(screen.getByTestId('recomp-noise')).toBeTruthy();
  });

  it('metric users get kg and cm', async () => {
    const screen = await render(<RecompCard signal={signal} unitSystem="metric" lastTapeAt={null} />);
    expect(screen.getByTestId('recomp-slopes').props.children).toBe(
      'Weight −0.06 kg/wk · Waist −0.60 ± 0.87 cm per 4 wk · 3 tapes',
    );
  });

  it('too few tapes says how many it has', async () => {
    const screen = await render(
      <RecompCard signal={{ status: 'insufficient', reason: 'tapes', tapes: 2 }} unitSystem="us" lastTapeAt={null} />,
    );
    expect(screen.getByTestId('recomp-insufficient').props.children).toBe('Needs 3 waist tapes in the last 6 weeks (you have 2).');
  });
});

describe('the flag', () => {
  it("compositionMaintenance is 'admin': on for the admin claim only", () => {
    expect(FEATURES.compositionMaintenance).toBe('admin');
    expect(isFeatureOn(FEATURES.compositionMaintenance, { isAdmin: true })).toBe(true);
    expect(isFeatureOn(FEATURES.compositionMaintenance, { isAdmin: false })).toBe(false);
    expect(isFeatureOn(FEATURES.compositionMaintenance, {})).toBe(false);
  });

  it('the Forbes prior ships OFF', () => {
    expect(FEATURES.forbesPrior).toBe(false);
  });
});
