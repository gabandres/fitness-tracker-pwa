import { useState } from 'react';
import { act, fireEvent, render } from '@testing-library/react-native';
import { SheetTextInput } from '@/components/SheetTextInput';

/**
 * The input every `BottomSheet native` renders (components/SheetTextInput.tsx).
 * A native sheet's owner re-publishes its content one commit after its state
 * changes, so a plain controlled TextInput briefly holds the OLD value and RN
 * pushes it back to native — reverting the keystroke. Maestro 16 saved
 * "QA Term Check" as "QA Term Chkc" through it on 2026-10-04.
 *
 * jest cannot run the native side, so what is pinned here is the contract that
 * makes the revert impossible: the shown value follows the keystroke in the
 * SAME render, whatever the prop says, while the owner still has the last word.
 */

const valueOf = (s: Awaited<ReturnType<typeof render>>) => s.getByTestId('f').props.value;

beforeEach(() => jest.useFakeTimers());
afterEach(() => jest.useRealTimers());

it('shows a keystroke at once, before a lagging owner has re-published', async () => {
  const onChangeText = jest.fn();
  // `value` never moves here: the owner's publish has not arrived yet.
  const screen = await render(<SheetTextInput testID="f" value="QA" onChangeText={onChangeText} />);
  await fireEvent.changeText(screen.getByTestId('f'), 'QA ');
  expect(valueOf(screen)).toBe('QA ');
  expect(onChangeText).toHaveBeenCalledWith('QA ');
});

it('keeps what the owner accepted', async () => {
  function Owner() {
    const [v, setV] = useState('');
    return <SheetTextInput testID="f" value={v} onChangeText={setV} />;
  }
  const screen = await render(<Owner />);
  await fireEvent.changeText(screen.getByTestId('f'), 'Q');
  await fireEvent.changeText(screen.getByTestId('f'), 'QA');
  await act(async () => {
    jest.runAllTimers();
  });
  expect(valueOf(screen)).toBe('QA');
});

it('reverts a change the owner rejected without setting state', async () => {
  // FastSheet's minute field: anything over 59 is refused by returning early.
  function Owner() {
    const [v, setV] = useState('5');
    return <SheetTextInput testID="f" value={v} onChangeText={(t) => Number(t) <= 59 && setV(t)} />;
  }
  const screen = await render(<Owner />);
  await fireEvent.changeText(screen.getByTestId('f'), '65');
  await act(async () => {
    jest.runAllTimers();
  });
  expect(valueOf(screen)).toBe('5');
});

it('adopts a value the owner sets itself — a reset or a sanitised value', async () => {
  function Owner() {
    const [v, setV] = useState('12');
    return (
      <>
        <SheetTextInput testID="f" value={v} onChangeText={(t) => setV(t.replace(/[^\d]/g, ''))} />
        <SheetTextInput testID="reset" value="" onChangeText={() => setV('')} />
      </>
    );
  }
  const screen = await render(<Owner />);
  await fireEvent.changeText(screen.getByTestId('f'), '12a3');
  await act(async () => {
    jest.runAllTimers();
  });
  expect(valueOf(screen)).toBe('123');
  await fireEvent.changeText(screen.getByTestId('reset'), 'x');
  expect(valueOf(screen)).toBe('');
});

it('passes an uncontrolled input straight through', async () => {
  const screen = await render(<SheetTextInput testID="f" defaultValue="hi" />);
  expect(valueOf(screen)).toBeUndefined();
});
