import React from 'react';
import { fireEvent, renderWithProviders as render } from '@/test-utils';
import { Sparkline, sparklineGeometry } from '@/components/Sparkline';

jest.mock('@/lib/auth', () => ({ useAuth: () => ({ user: { uid: 'u1' }, profile: null }) }));

/**
 * The exercise sheet's e1RM line (train-ux H-N13, 2026-10-12): two sessions
 * drew a convex arc with no start marker, ending at ~80% of the sheet — a
 * curve between two readings is data that does not exist.
 */
describe('sparklineGeometry', () => {
  it('joins fewer than four points with straight segments and marks every one', () => {
    const g = sparklineGeometry([100, 110], [], 200, 56);
    expect(g.mainD).toMatch(/^M [\d.]+ [\d.]+ L [\d.]+ [\d.]+$/);
    expect(g.mainD).not.toContain('Q');
    expect(g.dots).toHaveLength(2);
    // Edge to edge, inside the 4 pt pad.
    expect(g.dots[0].x).toBeCloseTo(4);
    expect(g.dots[1].x).toBeCloseTo(196);
  });

  it('keeps the smoothed line and a single end dot from four points up', () => {
    const g = sparklineGeometry([100, 105, 103, 110], [], 200, 56);
    expect(g.mainD).toContain('Q');
    expect(g.dots).toHaveLength(1);
    expect(g.dots[0].x).toBeCloseTo(196);
  });

  it('has no data under two readings', () => {
    expect(sparklineGeometry([100], [], 200, 56).hasData).toBe(false);
  });
});

describe('Sparkline width', () => {
  const svgWidth = (ui: Awaited<ReturnType<typeof render>>) => {
    let w: unknown;
    const walk = (n: unknown) => {
      if (!n || typeof n !== 'object' || w != null) return;
      if (Array.isArray(n)) return n.forEach(walk);
      const node = n as { type?: string; props?: { width?: unknown }; children?: unknown };
      if (node.type && /svg/i.test(node.type) && node.props?.width != null) w = node.props.width;
      walk(node.children);
    };
    walk(ui.toJSON());
    return w;
  };

  it('fills its container when no width is given', async () => {
    const ui = await render(<Sparkline values={[100, 110]} testID="spark" />);
    await fireEvent(ui.getByTestId('spark'), 'layout', { nativeEvent: { layout: { width: 342, height: 56, x: 0, y: 0 } } });
    expect(String(svgWidth(ui))).toBe('342');
  });

  it('keeps an explicit width', async () => {
    const ui = await render(<Sparkline values={[100, 110]} width={120} testID="spark" />);
    await fireEvent(ui.getByTestId('spark'), 'layout', { nativeEvent: { layout: { width: 342, height: 56, x: 0, y: 0 } } });
    expect(String(svgWidth(ui))).toBe('120');
  });
});
