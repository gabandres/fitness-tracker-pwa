/**
 * Font-scale relayout (S21) — a text-size change under a running app must
 * remount each screen's content, because Fabric keeps React's stale text nodes
 * (measured at the OLD size) through the next React commit, and only new host
 * nodes are measured afresh. `lib/font-scale.ts` has the full diagnosis.
 *
 * Pins: a fontScale change re-keys the boundary (the content remounts, the
 * boundary itself and everything above it do not); an unchanged scale never
 * does; a held route (unsaved input, a live workout) does not remount until it
 * is released AND out of view; and while a native sheet is up the whole
 * generation waits for the sheets to go — a sheet owner remounting would drop
 * a half-typed entry.
 */
import React, { useEffect } from 'react';
import { readFileSync } from 'fs';
import { join } from 'path';
import * as RN from 'react-native';
import { Text } from 'react-native';
import { act, render } from '@testing-library/react-native';
import {
  nextBoundary,
  nextRelayout,
  RELAYOUT_HOLD_ROUTES,
  RelayoutBoundary,
  RelayoutProvider,
  useRelayoutGeneration,
} from '@/lib/font-scale';
import { __resetSheetPortal, clearSheetActive, markSheetActive } from '@/lib/sheet-portal';

/**
 * Through `Dimensions.set`, not a mocked hook: the real `useWindowDimensions`
 * re-renders on the change event, which is the path the OS takes. A mocked
 * return value would only be read by a component that re-rendered anyway —
 * and under the React Compiler almost nothing does, which is the bug.
 */
async function setFontScale(fontScale: number) {
  const window = { width: 390, height: 844, scale: 3, fontScale };
  await act(async () => {
    RN.Dimensions.set({ window, screen: window });
  });
}

beforeEach(async () => {
  await setFontScale(1);
  __resetSheetPortal();
  clearSheetActive('s1');
});

/** Reports its own mounts — a remount is a second call. */
function Probe({ onMount }: { onMount: () => void }) {
  useEffect(() => {
    onMount();
  }, [onMount]);
  return <Text>probe</Text>;
}

function Screen({ hold, focused, mounts }: { hold?: boolean; focused?: boolean; mounts: Mounts }) {
  const generation = useRelayoutGeneration();
  return (
    <RelayoutBoundary generation={generation} hold={hold} focused={focused}>
      <Probe onMount={mounts} />
    </RelayoutBoundary>
  );
}

type Mounts = jest.Mock<void, []>;

function App(props: { hold?: boolean; focused?: boolean; mounts: Mounts }) {
  return (
    <RelayoutProvider>
      <Screen {...props} />
    </RelayoutProvider>
  );
}

describe('the pure rules', () => {
  it('nextRelayout counts a change, ignores no-change, and waits for sheets', () => {
    const s = { scale: 1, generation: 0 };
    expect(nextRelayout(s, 1, false)).toBe(s);
    expect(nextRelayout(s, 1.5, false)).toEqual({ scale: 1.5, generation: 1 });
    expect(nextRelayout(s, 1.5, true)).toBe(s);
  });

  it('nextBoundary: take it now, owe it while held, and catch up only out of view', () => {
    const s = { applied: 0, deferred: false };
    expect(nextBoundary(s, { generation: 0, hold: false, focused: true })).toBe(s);
    expect(nextBoundary(s, { generation: 1, hold: false, focused: true })).toEqual({ applied: 1, deferred: false });
    const owed = nextBoundary(s, { generation: 1, hold: true, focused: true });
    expect(owed).toEqual({ applied: 0, deferred: true });
    // Released while on screen (a workout just finished): still owed.
    expect(nextBoundary(owed, { generation: 1, hold: false, focused: true })).toBe(owed);
    // Left the screen: now.
    expect(nextBoundary(owed, { generation: 1, hold: false, focused: false })).toEqual({ applied: 1, deferred: false });
  });
});

describe('RelayoutProvider + RelayoutBoundary', () => {
  it('a fontScale change remounts the content; a same-scale render does not', async () => {
    const mounts: Mounts = jest.fn();
    const view = await render(<App mounts={mounts} />);
    expect(mounts).toHaveBeenCalledTimes(1);

    await view.rerender(<App mounts={mounts} />);
    expect(mounts).toHaveBeenCalledTimes(1);

    await setFontScale(3.571); // AX5
    expect(mounts).toHaveBeenCalledTimes(2);

    await setFontScale(1);
    expect(mounts).toHaveBeenCalledTimes(3);
  });

  it('a held route keeps its content (its unsaved input) while held', async () => {
    const mounts: Mounts = jest.fn();
    const view = await render(<App mounts={mounts} hold focused />);
    await setFontScale(2);
    expect(mounts).toHaveBeenCalledTimes(1);
    // Released but still on screen — not yet.
    await view.rerender(<App mounts={mounts} hold={false} focused />);
    expect(mounts).toHaveBeenCalledTimes(1);
    // Out of view: it catches up.
    await view.rerender(<App mounts={mounts} hold={false} focused={false} />);
    expect(mounts).toHaveBeenCalledTimes(2);
  });

  it('waits while a native sheet is up, then remounts once it goes', async () => {
    const mounts: Mounts = jest.fn();
    await render(<App mounts={mounts} />);
    markSheetActive('s1');
    await setFontScale(1.786); // AX1
    expect(mounts).toHaveBeenCalledTimes(1);

    await act(async () => {
      clearSheetActive('s1');
    });
    expect(mounts).toHaveBeenCalledTimes(2);
  });
});

describe('wiring', () => {
  const read = (p: string) => readFileSync(join(__dirname, '..', p), 'utf8');

  it('both navigators key their screens on the generation, below the navigator', () => {
    const root = read('app/_layout.tsx');
    expect(root).toMatch(/<RelayoutProvider>/);
    expect(root).toMatch(/screenLayout=\{\(\{ route, navigation, children \}\) => \(\s*<RelayoutBoundary/);
    const tabs = read('app/(app)/_layout.tsx');
    expect(tabs).toMatch(/screenLayout=\{\(\{ route, navigation, children \}\) => \(\s*<RelayoutBoundary/);
    // Train holds while a workout runs (the rest timer dies with a remount).
    expect(tabs).toMatch(/hold=\{route\.name === 'train' && workoutActive\}/);
  });

  it('holds the nested navigators and the forms that keep typed input in state', () => {
    for (const r of ['(app)', 'history', 'sheet', 'onboarding', 'sign-in', 'feedback', 'coach', 'daily-targets', 'refine-targets']) {
      expect(RELAYOUT_HOLD_ROUTES.has(r)).toBe(true);
    }
    // Read-only screens are NOT held — they are the ones that showed the bug.
    for (const r of ['settings', 'milestones', 'connected-apps']) expect(RELAYOUT_HOLD_ROUTES.has(r)).toBe(false);
  });
});
