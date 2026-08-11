import { describe, expect, it } from 'vitest';
import type { TdeeResult } from './tdee';
import { maintenanceView } from './maintenance-view';

const measured = (over: Partial<TdeeResult> = {}): TdeeResult => ({
  trueTdee: 1870,
  newDailyTarget: 1850,
  weightChangeTrend: -0.1,
  source: 'measured',
  loggingCompletenessPct: 82,
  reliable: true,
  ...over,
});

describe('maintenanceView', () => {
  it('reads intake against maintenance, not against the target', () => {
    expect(maintenanceView(measured(), 1810)).toEqual({
      maintenance: 1870,
      consumed: 1810,
      delta: -60,
      reliable: true,
    });
  });

  it('reports a surplus as a positive delta', () => {
    expect(maintenanceView(measured(), 2100)?.delta).toBe(230);
  });

  it('still returns a view on an empty day', () => {
    expect(maintenanceView(measured(), 0)).toMatchObject({ consumed: 0, delta: -1870 });
  });

  it('shows an unreliable estimate, but marks it', () => {
    // The real case that prompted this: 57% completeness. Withholding the
    // number would leave Today saying nothing at all, which is worse than
    // saying it softly.
    const v = maintenanceView(measured({ reliable: false, loggingCompletenessPct: 57 }), 1810);
    expect(v).not.toBeNull();
    expect(v?.reliable).toBe(false);
    expect(v?.maintenance).toBe(1870);
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
