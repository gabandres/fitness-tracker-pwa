import { describe, expect, it } from 'vitest';
import { maintenanceView } from './maintenance-view';
import { measuredTdeeFixture as measured } from './tdee.test-utils';


describe('maintenanceView', () => {
  it('reads intake against maintenance, not against the target', () => {
    expect(maintenanceView(measured(), 1810)).toEqual({
      maintenance: 1870,
      consumed: 1810,
      delta: -60,
      reliable: true,
      loggedDays: 23,
      spanDays: 28,
      weighInsDropped: 0,
      // A TdeeResult carrying no `confidence` reads as "nothing held back".
      // Absent evidence of damping is not evidence of it — see the field's
      // comment in maintenance-view.ts.
      confidence: 1,
      provisional: false,
      // Same rule as `confidence` above: a TdeeResult with no `estimateState`
      // reads as NOT holding. An absent interval is not evidence of a wide one.
      holding: false,
    });
  });

  it('reports discarded weigh-ins — the warning that fires while reliable is true', () => {
    // The measured two-week-break case: a real 4 lb step makes the robust
    // guard drop every post-break reading, and nothing else in the result
    // changes. Without this the user is told the estimate is reliable and
    // never told it ignored seven observations.
    const v = maintenanceView(measured({ outliersDropped: 7 }), 1810);
    expect(v?.weighInsDropped).toBe(7);
    expect(v?.reliable).toBe(true);
  });

  it('always reports a count — a measured estimate cannot omit one', () => {
    // This used to assert the opposite: that an absent `outliersDropped` came
    // through as null, so a UI could distinguish "nothing was dropped" from "a
    // result predating the field". `TdeeResult` is a discriminated union now
    // and `outliersDropped` is REQUIRED on the measured member, so the absent
    // case is unrepresentable rather than merely unlikely. `MaintenanceView`
    // keeps its `number | null` because both UIs read the field by truthiness
    // and 0 already reads the same as null there.
    expect(maintenanceView(measured({ outliersDropped: 0 }), 1810)?.weighInsDropped).toBe(0);
  });

  it('reports a surplus as a positive delta', () => {
    expect(maintenanceView(measured(), 2100)?.delta).toBe(230);
  });

  it('shows maintenance on an empty day but withholds the delta', () => {
    // "1,870 under your burn" before breakfast is true, useless, and would
    // greet the user every morning. The figure itself is still worth seeing.
    expect(maintenanceView(measured(), 0)).toMatchObject({ consumed: 0, delta: null });
  });

  it('shows an unreliable estimate, but marks it', () => {
    // The real case that prompted this: 57% completeness. Withholding the
    // number would leave Today saying nothing at all, which is worse than
    // saying it softly.
    const v = maintenanceView(
      measured({ reliable: false, loggingCompletenessPct: 57, windowDays: 28, spanDays: 49 }),
      1810,
    );
    expect(v).not.toBeNull();
    expect(v?.reliable).toBe(false);
    expect(v?.maintenance).toBe(1870);
    // The counts are what let the UI say WHY it is rough: 21 unlogged days,
    // every one of them dragging the estimate down.
    expect(v?.loggedDays).toBe(28);
    expect(v?.spanDays).toBe(49);
  });

  it('is null for a formula estimate — that is a population average, not a measurement', () => {
    expect(maintenanceView({ ...measured(), source: 'formula' }, 1810)).toBeNull();
  });

  it('is null for the seed fallback', () => {
    expect(
      maintenanceView(
        { trueTdee: 2450, newDailyTarget: 1800, weightChangeTrend: 0, source: 'seed' },
        1810,
      ),
    ).toBeNull();
  });

  it('is null when the figure is zero or negative', () => {
    expect(maintenanceView(measured({ trueTdee: 0 }), 1810)).toBeNull();
  });

  it('rounds intake and never reports a negative consumed', () => {
    expect(maintenanceView(measured(), 1810.4)?.consumed).toBe(1810);
    expect(maintenanceView(measured(), -5)?.consumed).toBe(0);
  });
});
