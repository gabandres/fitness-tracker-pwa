// `@/i18n` pulls in `@/lib/auth`, which imports firebase/auth — untranspiled
// ESM that jest cannot parse. Every component test here stubs it for that
// reason; this sheet reaches Firestore through none of it.
jest.mock('@/lib/auth', () => ({
  useAuth: () => ({ user: { uid: 'u1' }, profile: null }),
}));

import React from 'react';
import { fireEvent, renderWithProviders as render, waitFor } from '@/test-utils';
import { FastSheet } from '@/components/FastSheet';
import type { Fast } from '@macrolog/core';

/**
 * The fasting editor (ADR-0032 decision 3, issue #97).
 *
 * What is worth pinning here is the GATE, not the layout — RNTL runs no Yoga
 * pass, which this project has been bitten by often enough to write down, so a
 * test asserting anything about position would be asserting nothing.
 *
 * The gate matters because overlap is a rule `firestore.rules` structurally
 * cannot enforce: a rule sees one document and cannot query its siblings. So
 * this component is the only thing standing between a mis-typed date and two
 * fasts covering the same hours — which `fastingWindow` would then count twice,
 * permanently inflating a median the user reads as measured. If the Save button
 * stops respecting `overlappingFasts`, nothing downstream will catch it.
 *
 * The three modes are covered for what differs between them and nothing else:
 * which fields exist, and what Save means.
 */

/** A clean 15-minute boundary, so the prefill is exact rather than floored. */
const ANCHOR = new Date('2026-08-25T12:00:00.000Z');
const HOUR = 60 * 60 * 1000;

const fastAt = (id: string, startedAt: Date, endedAt: Date): Fast => ({ id, startedAt, endedAt });

/**
 * Press a control and WAIT for the commit before reading anything.
 *
 * Not ceremony. Under React 19 the state update a press schedules is not
 * committed by the time `fireEvent.press` returns, so a synchronous assertion
 * — or a second press whose handler closes over the old state — sees the
 * previous render. Measured while writing this file: the same nudge asserted
 * synchronously reads the old duration and asserted after a flush reads the new
 * one. Every press below goes through here for that reason.
 */
async function press(screen: { getByTestId: (id: string) => unknown }, testID: string) {
  fireEvent.press(screen.getByTestId(testID) as Parameters<typeof fireEvent.press>[0]);
  await waitFor(() => {});
}

describe('FastSheet — logging a fast nobody timed', () => {
  it('opens on a 16-hour prefill and saves exactly what it shows', async () => {
    const onSave = jest.fn().mockResolvedValue(undefined);
    const screen = await render(
      <FastSheet visible mode="add" anchorEnd={ANCHOR} onSave={onSave} onClose={jest.fn()} />,
    );

    expect(screen.getByTestId('fast-duration')).toHaveTextContent('16h 0m');

    await press(screen, 'fast-save');
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    const [startedAt, endedAt] = onSave.mock.calls[0];
    expect(endedAt.getTime() - startedAt.getTime()).toBe(16 * HOUR);
    expect(endedAt).toEqual(ANCHOR);
  });

  it('nudges the START by default, because that is the field a correction lands on', async () => {
    const onSave = jest.fn().mockResolvedValue(undefined);
    const screen = await render(
      <FastSheet visible mode="add" anchorEnd={ANCHOR} onSave={onSave} onClose={jest.fn()} />,
    );

    await press(screen, 'fast-step-minus-1h');
    expect(screen.getByTestId('fast-duration')).toHaveTextContent('17h 0m');

    await press(screen, 'fast-save');
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    const [startedAt, endedAt] = onSave.mock.calls[0];
    // The END must not have moved — nudging start is what changes the length.
    expect(endedAt).toEqual(ANCHOR);
    expect(endedAt.getTime() - startedAt.getTime()).toBe(17 * HOUR);
  });

  it('moves the END once that row is selected, and leaves the start alone', async () => {
    const onSave = jest.fn().mockResolvedValue(undefined);
    const screen = await render(
      <FastSheet visible mode="add" anchorEnd={ANCHOR} onSave={onSave} onClose={jest.fn()} />,
    );

    await press(screen, 'fast-end-row');
    await press(screen, 'fast-step-plus-1h');
    expect(screen.getByTestId('fast-duration')).toHaveTextContent('17h 0m');

    await press(screen, 'fast-save');
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    const [startedAt, endedAt] = onSave.mock.calls[0];
    expect(startedAt.getTime()).toBe(ANCHOR.getTime() - 16 * HOUR);
    expect(endedAt.getTime()).toBe(ANCHOR.getTime() + HOUR);
  });

  it('REFUSES to save an interval that overlaps a stored fast, and says which one', async () => {
    // Overlaps the 16-hour prefill by four hours.
    const neighbour = fastAt('a', new Date(ANCHOR.getTime() - 20 * HOUR), new Date(ANCHOR.getTime() - 12 * HOUR));
    const onSave = jest.fn().mockResolvedValue(undefined);
    const screen = await render(
      <FastSheet
        visible
        mode="add"
        anchorEnd={ANCHOR}
        fasts={[neighbour]}
        onSave={onSave}
        onClose={jest.fn()}
      />,
    );

    expect(screen.getByTestId('fast-warning')).toBeTruthy();
    await press(screen, 'fast-save');
    expect(onSave).not.toHaveBeenCalled();
  });

  it('lets a back-to-back fast through — ending when another starts is not a collision', async () => {
    // Ends exactly when the prefill starts. A closed comparison would reject
    // this, and a warning that fires on an ordinary day gets ignored.
    const neighbour = fastAt(
      'a',
      new Date(ANCHOR.getTime() - 24 * HOUR),
      new Date(ANCHOR.getTime() - 16 * HOUR),
    );
    const onSave = jest.fn().mockResolvedValue(undefined);
    const screen = await render(
      <FastSheet
        visible
        mode="add"
        anchorEnd={ANCHOR}
        fasts={[neighbour]}
        onSave={onSave}
        onClose={jest.fn()}
      />,
    );

    expect(screen.queryByTestId('fast-warning')).toBeNull();
    await press(screen, 'fast-save');
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
  });

  it('refuses an interval dragged inside out', async () => {
    const onSave = jest.fn().mockResolvedValue(undefined);
    const screen = await render(
      <FastSheet visible mode="add" anchorEnd={ANCHOR} onSave={onSave} onClose={jest.fn()} />,
    );

    // Push the start a full day past the end.
    await press(screen, 'fast-step-plus-1d');
    expect(screen.getByTestId('fast-warning')).toBeTruthy();
    await press(screen, 'fast-save');
    expect(onSave).not.toHaveBeenCalled();
  });
});

describe('FastSheet — correcting a stored fast', () => {
  const stored = fastAt('mine', new Date(ANCHOR.getTime() - 16 * HOUR), ANCHOR);

  it('never reports the fast being edited as conflicting with itself', async () => {
    const onSave = jest.fn().mockResolvedValue(undefined);
    const screen = await render(
      <FastSheet
        visible
        mode="edit"
        editing={stored}
        fasts={[stored]}
        onSave={onSave}
        onClose={jest.fn()}
      />,
    );

    expect(screen.queryByTestId('fast-warning')).toBeNull();
    await press(screen, 'fast-save');
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
  });

  it('offers delete only when there is a stored fast to delete', async () => {
    const onDelete = jest.fn();
    const edit = await render(
      <FastSheet
        visible
        mode="edit"
        editing={stored}
        onSave={jest.fn()}
        onDelete={onDelete}
        onClose={jest.fn()}
      />,
    );
    await press(edit, 'fast-delete');
    expect(onDelete).toHaveBeenCalledTimes(1);

    const add = await render(
      <FastSheet visible mode="add" anchorEnd={ANCHOR} onSave={jest.fn()} onClose={jest.fn()} />,
    );
    expect(add.queryByTestId('fast-delete')).toBeNull();
  });

  it('stays open when the write fails, so the user does not lose what they set', async () => {
    // Closing here would show a list that does not contain the fast they just
    // saved, which reads as silent data loss rather than as a failed write.
    const onSave = jest.fn().mockRejectedValue(new Error('permission-denied'));
    const onClose = jest.fn();
    const screen = await render(
      <FastSheet visible mode="edit" editing={stored} onSave={onSave} onClose={onClose} />,
    );

    await press(screen, 'fast-save');
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    // A second flush: the rejection's own `setSaving(false)` lands a microtask
    // after the assertion above, and without this it commits outside act().
    await waitFor(() => {});
    expect(onClose).not.toHaveBeenCalled();
  });
});

describe('FastSheet — the fast running right now', () => {
  it('has no end to edit, because the end has not happened', async () => {
    const running = { startedAt: new Date(Date.now() - 3 * HOUR), endedAt: new Date() };
    const screen = await render(
      <FastSheet visible mode="running" editing={running} onSave={jest.fn()} onClose={jest.fn()} />,
    );

    expect(screen.getByTestId('fast-start-row')).toBeTruthy();
    expect(screen.queryByTestId('fast-end-row')).toBeNull();
  });

  it('saves the corrected START and measures the fast against now', async () => {
    const startedAt = new Date(Date.now() - 3 * HOUR);
    const onSave = jest.fn().mockResolvedValue(undefined);
    const screen = await render(
      <FastSheet
        visible
        mode="running"
        editing={{ startedAt, endedAt: startedAt }}
        onSave={onSave}
        onClose={jest.fn()}
      />,
    );

    await press(screen, 'fast-step-minus-1h');
    await press(screen, 'fast-save');
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    expect(onSave.mock.calls[0][0].getTime()).toBe(startedAt.getTime() - HOUR);
  });

  it('refuses a start pushed into the future', async () => {
    const onSave = jest.fn().mockResolvedValue(undefined);
    const screen = await render(
      <FastSheet
        visible
        mode="running"
        editing={{ startedAt: new Date(), endedAt: new Date() }}
        onSave={onSave}
        onClose={jest.fn()}
      />,
    );

    await press(screen, 'fast-step-plus-1d');
    expect(screen.getByTestId('fast-warning')).toBeTruthy();
    await press(screen, 'fast-save');
    expect(onSave).not.toHaveBeenCalled();
  });
});
