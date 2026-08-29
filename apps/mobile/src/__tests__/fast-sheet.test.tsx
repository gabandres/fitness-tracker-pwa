// `@/i18n` pulls in `@/lib/auth`, which imports firebase/auth — untranspiled
// ESM that jest cannot parse. Every component test here stubs it for that
// reason; this sheet reaches Firestore through none of it.
jest.mock('@/lib/auth', () => ({
  useAuth: () => ({ user: { uid: 'u1' }, profile: null }),
}));

import React from 'react';
import { Alert } from 'react-native';
import { fireEvent, renderWithProviders as render, waitFor } from '@/test-utils';
import { FastSheet, localeUses12Hour } from '@/components/FastSheet';
import type { Fast } from '@macrolog/core';

/**
 * The fasting editor (ADR-0032 decision 3, issue #97).
 *
 * Two cases below are REGRESSIONS from the first build, both reported off a
 * device with a screenshot within hours of it shipping, and both invisible to
 * the twelve tests that replaced them:
 *
 * 1. **A round time was unreachable.** The editor adjusted a time by ±15m /
 *    ±1h, which is RELATIVE, so a fast the timer started at 4:01 PM could
 *    become 4:16 or 3:01 and never 4:00. "I actually started at four" — the
 *    likeliest correction there is — could not be expressed at all. The time
 *    is typed now, and `sets a round time the old nudges could never reach`
 *    fails if anyone reintroduces an offset-preserving step.
 * 2. **Overlap blocked the RUNNING fast, which made the sheet a dead end.** A
 *    running fast writes no document — correcting its start rewrites one field
 *    on the profile — so it cannot create a collision and must never be
 *    refused for one. The reporter's own state hit it: fasting since 4:01 PM
 *    with a completed 9:17–10:46 PM fast inside it, Save permanently disabled,
 *    and the offending fast not even visible on that screen.
 *
 * What is NOT pinned here is layout. RNTL runs no Yoga pass, so an assertion
 * about position would be asserting nothing — that belongs on a device.
 */

/** Local-time constructors throughout: the component reads `getHours()` and
 *  formats through the locale, so a UTC fixture would test a different
 *  function than the one that ships. */
const at = (y: number, m: number, d: number, h: number, min = 0): Date =>
  new Date(y, m - 1, d, h, min, 0, 0);

/** Noon on Aug 28 2026, local. The prefill therefore starts 8:00 PM Aug 27. */
const ANCHOR = at(2026, 8, 28, 12);
const HOUR = 60 * 60 * 1000;

const fastAt = (id: string, startedAt: Date, endedAt: Date): Fast => ({ id, startedAt, endedAt });

/**
 * Fire an event and WAIT for the commit before reading anything.
 *
 * Not ceremony. Under React 19 the state update an event schedules is not
 * committed by the time `fireEvent` returns, so a synchronous assertion — or a
 * second event whose handler closes over the old state — sees the previous
 * render. Measured while writing this file.
 */
type Screen = Awaited<ReturnType<typeof render>>;

async function tap(screen: Screen, testID: string) {
  fireEvent.press(screen.getByTestId(testID));
  await waitFor(() => {});
}

async function type(screen: Screen, testID: string, text: string) {
  fireEvent.changeText(screen.getByTestId(testID), text);
  await waitFor(() => {});
}

function addSheet(props: Partial<React.ComponentProps<typeof FastSheet>> = {}) {
  const onSave = jest.fn().mockResolvedValue(undefined);
  const onClose = jest.fn();
  return {
    onSave,
    onClose,
    ui: (
      <FastSheet
        visible
        mode="add"
        anchorEnd={ANCHOR}
        onSave={onSave}
        onClose={onClose}
        {...props}
      />
    ),
  };
}

describe('FastSheet — you type the time', () => {
  it('opens on a 16-hour prefill and saves exactly what it shows', async () => {
    const { onSave, ui } = addSheet();
    const screen = await render(ui);

    expect(screen.getByTestId('fast-duration')).toHaveTextContent('16h 0m');

    await tap(screen, 'fast-save');
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    const [startedAt, endedAt] = onSave.mock.calls[0];
    expect(endedAt.getTime() - startedAt.getTime()).toBe(16 * HOUR);
  });

  it('sets a round time the old nudges could never reach', async () => {
    // THE REPORTED BUG. Prefill start is 8:00 PM Aug 27; the user means 4:00 PM.
    // Under ±15m steps from an odd minute this was unreachable at any number of
    // taps. Typed, it is three interactions.
    const { onSave, ui } = addSheet();
    const screen = await render(ui);

    await type(screen, 'fast-start-hour', '4');
    await type(screen, 'fast-start-minute', '00');
    await tap(screen, 'fast-start-pm');

    await tap(screen, 'fast-save');
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    const [startedAt] = onSave.mock.calls[0];
    expect(startedAt.getHours()).toBe(16);
    expect(startedAt.getMinutes()).toBe(0);
    expect(startedAt.getSeconds()).toBe(0);
    expect(startedAt.getDate()).toBe(27);
    // 4:00 PM Aug 27 → noon Aug 28 is twenty hours.
    expect(screen.getByTestId('fast-duration')).toHaveTextContent('20h 0m');
  });

  it('reaches a time in the morning through the AM control', async () => {
    const { onSave, ui } = addSheet();
    const screen = await render(ui);

    await type(screen, 'fast-start-hour', '9');
    await type(screen, 'fast-start-minute', '30');
    await tap(screen, 'fast-start-am');

    await tap(screen, 'fast-save');
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    const [startedAt] = onSave.mock.calls[0];
    expect(startedAt.getHours()).toBe(9);
    expect(startedAt.getMinutes()).toBe(30);
  });

  it('treats 12 as noon and midnight the way a clock does, not as hour twelve', async () => {
    const { onSave, ui } = addSheet();
    const screen = await render(ui);

    await type(screen, 'fast-start-hour', '12');
    await type(screen, 'fast-start-minute', '00');
    await tap(screen, 'fast-start-am');
    await tap(screen, 'fast-save');
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    expect(onSave.mock.calls[0][0].getHours()).toBe(0);
  });

  it('ignores a half-typed or impossible hour instead of jumping somewhere else', async () => {
    // Clearing the field mid-edit must not move the stored value, or the
    // duration lurches while the user is still typing.
    const { ui } = addSheet();
    const screen = await render(ui);

    await type(screen, 'fast-start-hour', '');
    expect(screen.getByTestId('fast-duration')).toHaveTextContent('16h 0m');
    await type(screen, 'fast-start-hour', '99');
    expect(screen.getByTestId('fast-duration')).toHaveTextContent('16h 0m');
    await type(screen, 'fast-start-minute', '77');
    expect(screen.getByTestId('fast-duration')).toHaveTextContent('16h 0m');
  });

  it('REFUSES an out-of-range hour rather than displaying one', async () => {
    // Found on a device: the field accepted `50` and simply declined to commit
    // it, so the box read 50 while the row above still read 5:10 PM — the
    // field and the value disagreeing, with nothing to say which was real.
    const { ui } = addSheet();
    const screen = await render(ui);

    await type(screen, 'fast-start-hour', '7');
    expect(screen.getByTestId('fast-start-hour').props.value).toBe('7');
    await type(screen, 'fast-start-hour', '70');
    expect(screen.getByTestId('fast-start-hour').props.value).toBe('7');
    // 12 is in range at both one digit and two, so it still types normally.
    await type(screen, 'fast-start-hour', '1');
    await type(screen, 'fast-start-hour', '12');
    expect(screen.getByTestId('fast-start-hour').props.value).toBe('12');
  });

  it('steps the day without disturbing the time of day', async () => {
    const { onSave, ui } = addSheet();
    const screen = await render(ui);

    await tap(screen, 'fast-start-day-prev');
    await tap(screen, 'fast-save');
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    const [startedAt] = onSave.mock.calls[0];
    expect(startedAt.getDate()).toBe(26);
    expect(startedAt.getHours()).toBe(20);
    expect(startedAt.getMinutes()).toBe(0);
  });

  it('edits the END once that row is selected, and leaves the start alone', async () => {
    const { onSave, ui } = addSheet();
    const screen = await render(ui);

    await tap(screen, 'fast-end-row');
    await type(screen, 'fast-end-hour', '2');
    await type(screen, 'fast-end-minute', '00');
    await tap(screen, 'fast-end-pm');

    await tap(screen, 'fast-save');
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    const [startedAt, endedAt] = onSave.mock.calls[0];
    expect(startedAt.getHours()).toBe(20);
    expect(endedAt.getHours()).toBe(14);
    expect(endedAt.getDate()).toBe(28);
  });
});

describe('FastSheet — the overlap guard', () => {
  it('REFUSES to save a new fast that overlaps a stored one, and says which', async () => {
    const neighbour = fastAt('a', at(2026, 8, 27, 16), at(2026, 8, 28, 2));
    const { onSave, ui } = addSheet({ fasts: [neighbour] });
    const screen = await render(ui);

    expect(screen.getByTestId('fast-warning')).toBeTruthy();
    await tap(screen, 'fast-save');
    expect(onSave).not.toHaveBeenCalled();
  });

  it('lets a back-to-back fast through — ending when another starts is not a collision', async () => {
    // Ends exactly when the prefill starts. A closed comparison would reject
    // this, and a warning that fires on an ordinary day gets ignored.
    const neighbour = fastAt('a', at(2026, 8, 27, 8), at(2026, 8, 27, 20));
    const { onSave, ui } = addSheet({ fasts: [neighbour] });
    const screen = await render(ui);

    expect(screen.queryByTestId('fast-warning')).toBeNull();
    await tap(screen, 'fast-save');
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
  });

  it('refuses an interval whose end is before its start', async () => {
    const { onSave, ui } = addSheet();
    const screen = await render(ui);

    await tap(screen, 'fast-start-day-next');
    await tap(screen, 'fast-start-day-next');
    expect(screen.getByTestId('fast-warning')).toBeTruthy();
    await tap(screen, 'fast-save');
    expect(onSave).not.toHaveBeenCalled();
  });
});

describe('FastSheet — correcting a stored fast', () => {
  const stored = fastAt('mine', at(2026, 8, 27, 20), ANCHOR);

  const editSheet = (props: Partial<React.ComponentProps<typeof FastSheet>> = {}) => {
    const onSave = jest.fn().mockResolvedValue(undefined);
    const onClose = jest.fn();
    return {
      onSave,
      onClose,
      ui: (
        <FastSheet
          visible
          mode="edit"
          editing={stored}
          onSave={onSave}
          onClose={onClose}
          {...props}
        />
      ),
    };
  };

  it('never reports the fast being edited as conflicting with itself', async () => {
    const { onSave, ui } = editSheet({ fasts: [stored] });
    const screen = await render(ui);

    expect(screen.queryByTestId('fast-warning')).toBeNull();
    await tap(screen, 'fast-save');
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
  });

  it('offers delete only when there is a stored fast to delete', async () => {
    const onDelete = jest.fn();
    const edit = await render(editSheet({ onDelete }).ui);
    await tap(edit, 'fast-delete');
    expect(onDelete).toHaveBeenCalledTimes(1);

    const add = await render(addSheet().ui);
    expect(add.queryByTestId('fast-delete')).toBeNull();
  });

  it('closes on the LOCAL write rather than waiting for the server', async () => {
    // A device pass on the LG G6 is why. Firestore is local-first, so the
    // corrected fast is already on the row behind the sheet; when that radio
    // dropped the Write stream the awaited promise settled late and the sheet
    // sat open over a change the user could already see. This pins that a
    // still-pending write does not hold the sheet.
    let settle: () => void = () => {};
    const onSave = jest.fn().mockReturnValue(new Promise<void>((r) => { settle = r; }));
    const onClose = jest.fn();
    const screen = await render(editSheet({ onSave, onClose }).ui);

    await tap(screen, 'fast-save');
    expect(onSave).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
    settle();
    await waitFor(() => {});
  });

  it('says so when a write that already applied is rolled back', async () => {
    // The local cache reverts on a rules rejection, so the fast would silently
    // go back to what it was — the exact data-loss shape this feature exists
    // to end. Swallowing it would also put it on the unhandled-rejection path,
    // which has reported as a crash in this app before.
    jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    const onSave = jest.fn().mockRejectedValue(new Error('permission-denied'));
    const screen = await render(editSheet({ onSave }).ui);

    await tap(screen, 'fast-save');
    await waitFor(() => expect(Alert.alert).toHaveBeenCalledTimes(1));
  });
});

describe('FastSheet — the fast running right now', () => {
  const runningSheet = (startedAt: Date, fasts: readonly Fast[] = []) => {
    const onSave = jest.fn().mockResolvedValue(undefined);
    return {
      onSave,
      ui: (
        <FastSheet
          visible
          mode="running"
          editing={{ startedAt, endedAt: startedAt }}
          fasts={fasts}
          onSave={onSave}
          onClose={jest.fn()}
        />
      ),
    };
  };

  it('has no end to edit, because the end has not happened', async () => {
    const screen = await render(runningSheet(new Date(Date.now() - 3 * HOUR)).ui);
    expect(screen.getByTestId('fast-start-row')).toBeTruthy();
    expect(screen.queryByTestId('fast-end-row')).toBeNull();
  });

  it('SAVES a corrected start even when the running fast overlaps a stored one', async () => {
    // THE REPORTED DEAD END, reproduced from the screenshot: fasting since
    // 4:01 PM with a completed 9:17–10:46 PM fast sitting inside it. A running
    // fast writes no document, so it cannot create a collision — refusing to
    // save left the user with no way out of a state they reached by accident.
    const now = Date.now();
    const startedAt = new Date(now - 6 * HOUR - 46 * 60 * 1000);
    const swallowed = fastAt('other', new Date(now - 90 * 60 * 1000), new Date(now - 60 * 1000));
    const { onSave, ui } = runningSheet(startedAt, [swallowed]);
    const screen = await render(ui);

    // Said out loud — ending this fast really will record an overlapping row —
    // but as a note, and the button still works.
    expect(screen.getByTestId('fast-warning')).toBeTruthy();
    await tap(screen, 'fast-save');
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
  });

  it('saves the start the user typed, measured against now', async () => {
    const startedAt = new Date(Date.now() - 3 * HOUR);
    const { onSave, ui } = runningSheet(startedAt);
    const screen = await render(ui);

    await type(screen, 'fast-start-hour', '4');
    await type(screen, 'fast-start-minute', '00');
    await tap(screen, 'fast-start-pm');
    await tap(screen, 'fast-save');

    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    const [saved] = onSave.mock.calls[0];
    expect(saved.getHours()).toBe(16);
    expect(saved.getMinutes()).toBe(0);
  });

  it('refuses a start pushed into the future', async () => {
    const { onSave, ui } = runningSheet(new Date(Date.now() - HOUR));
    const screen = await render(ui);

    await tap(screen, 'fast-start-day-next');
    expect(screen.getByTestId('fast-warning')).toBeTruthy();
    await tap(screen, 'fast-save');
    expect(onSave).not.toHaveBeenCalled();
  });
});

describe('FastSheet — a re-rendering parent must not discard a typed time', () => {
  it('keeps what the user typed when the parent hands it a new prop object', async () => {
    // THE BUG THAT MADE THIS READ AS "it didn't save". Both call sites build
    // `editing` / `anchorEnd` inline, so every parent render produces a new
    // reference. While those were in the seed effect's dependency array, any
    // parent re-render — Today's own fasts listener answering, a snapshot
    // landing — reset the fields to the stored values, and Save then wrote the
    // number that was already there.
    const onSave = jest.fn().mockResolvedValue(undefined);
    const sheet = (anchor: Date) => (
      <FastSheet visible mode="add" anchorEnd={anchor} onSave={onSave} onClose={jest.fn()} />
    );
    const screen = await render(sheet(ANCHOR));

    await type(screen, 'fast-start-hour', '4');
    await type(screen, 'fast-start-minute', '00');
    await tap(screen, 'fast-start-pm');
    expect(screen.getByTestId('fast-duration')).toHaveTextContent('20h 0m');

    // A new Date carrying the SAME instant — exactly what `noonOfDay()` and
    // the inline `{ startedAt, endedAt }` produce on every render.
    await screen.rerender(sheet(new Date(ANCHOR.getTime())));
    await waitFor(() => {});

    expect(screen.getByTestId('fast-duration')).toHaveTextContent('20h 0m');
    await tap(screen, 'fast-save');
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    expect(onSave.mock.calls[0][0].getHours()).toBe(16);
  });

  it('DOES re-seed when the underlying instant genuinely changes', async () => {
    const sheet = (anchor: Date) => (
      <FastSheet visible mode="add" anchorEnd={anchor} onSave={jest.fn()} onClose={jest.fn()} />
    );
    const screen = await render(sheet(ANCHOR));
    await type(screen, 'fast-start-hour', '4');
    expect(screen.getByTestId('fast-duration')).toHaveTextContent('20h 0m');

    await screen.rerender(sheet(new Date(ANCHOR.getTime() + 2 * HOUR)));
    await waitFor(() => {});
    // Re-seeded from the new anchor: 16h again, not the edited 20h.
    expect(screen.getByTestId('fast-duration')).toHaveTextContent('16h 0m');
  });
});

describe('localeUses12Hour', () => {
  it('separates the 12-hour locales from the 24-hour one', () => {
    // Decides whether the AM/PM control renders at all. Getting it wrong for
    // pt-BR hands a Brazilian user an hour field that takes 20 next to a PM
    // toggle, with no way to know which one wins.
    expect(localeUses12Hour('en-US')).toBe(true);
    expect(localeUses12Hour('es-PR')).toBe(true);
    expect(localeUses12Hour('pt-BR')).toBe(false);
  });

  it('falls back to a 12-hour dial rather than throwing on a bad tag', () => {
    expect(localeUses12Hour('not-a-locale!!')).toBe(true);
  });
});
