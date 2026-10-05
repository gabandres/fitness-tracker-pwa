/**
 * `MenuButton` — the system pull-down menu with the caller's sheet as the
 * fallback. Pinned: an older binary (no module) keeps the old tap → sheet
 * behaviour; the native view gets bridge-safe rows; a native pick runs exactly
 * the named action (never a disabled one); and the Train adapter keeps the
 * sheet and the menu offering the same rows.
 */
jest.mock('@/lib/auth', () => ({
  useAuth: () => ({ user: { uid: 'u1' }, profile: null }),
}));

jest.mock('../../modules/native-menu-button', () => {
  // In the factory: `MenuButton` reads the bridge at import time.
  const state = { view: null as unknown };
  return {
    __state: state,
    get NativeMenuButtonView() {
      return state.view;
    },
  };
});

import { Text } from 'react-native';
import { act, fireEvent, renderWithProviders as render } from '@/test-utils';
import {
  MenuButton,
  dispatchMenuAction,
  toNativeMenuActions,
  type MenuButtonAction,
} from '@/components/MenuButton';
import { IONICON_TO_SF, toMenuButtonActions } from '@/components/train/exercise-menu-native';

const bridge = jest.requireMock('../../modules/native-menu-button').__state as { view: unknown };

function actions(): (MenuButtonAction & { onPress: jest.Mock })[] {
  return [
    { key: 'add', title: 'Add exercise', sfSymbol: 'plus.circle', onPress: jest.fn() },
    { key: 'locked', title: 'Locked', disabled: true, onPress: jest.fn() },
    { key: 'discard', title: 'Discard', destructive: true, onPress: jest.fn() },
  ];
}

beforeEach(() => {
  bridge.view = null;
});

it('toNativeMenuActions drops onPress and empty optionals', () => {
  expect(toNativeMenuActions(actions())).toEqual([
    { key: 'add', title: 'Add exercise', sfSymbol: 'plus.circle' },
    { key: 'locked', title: 'Locked', disabled: true },
    { key: 'discard', title: 'Discard', destructive: true },
  ]);
});

it('dispatchMenuAction runs the named action only, never a disabled or unknown one', () => {
  const list = actions();
  expect(dispatchMenuAction(list, 'discard')).toBe(true);
  expect(list[2].onPress).toHaveBeenCalledTimes(1);
  expect(dispatchMenuAction(list, 'locked')).toBe(false);
  expect(dispatchMenuAction(list, 'nope')).toBe(false);
  expect(list[0].onPress).not.toHaveBeenCalled();
  expect(list[1].onPress).not.toHaveBeenCalled();
});

it('without the native module, a tap runs the fallback (the old sheet)', async () => {
  const onFallbackPress = jest.fn();
  const view = await render(
    <MenuButton actions={actions()} accessibilityLabel="Session menu" testID="session-menu" onFallbackPress={onFallbackPress} />,
  );
  fireEvent.press(view.getByTestId('session-menu'));
  expect(onFallbackPress).toHaveBeenCalledTimes(1);
  expect(view.getByLabelText('Session menu')).toBeTruthy();
});

it('with the native module, it hands over rows and runs the picked action', async () => {
  const { View } = require('react-native');
  const Fake = jest.fn((props: Record<string, unknown>) => <View testID="native-menu" {...props} />);
  bridge.view = Fake;
  const list = actions();
  const onFallbackPress = jest.fn();
  await render(
    <MenuButton actions={list} title="Bench" accessibilityLabel="Bench menu" testID="ex-menu-0" onFallbackPress={onFallbackPress}>
      <Text>face</Text>
    </MenuButton>,
  );
  const props = Fake.mock.calls[Fake.mock.calls.length - 1][0] as Record<string, any>;
  expect(props.actions).toEqual(toNativeMenuActions(list));
  expect(props.title).toBe('Bench');
  expect(props.buttonAccessibilityLabel).toBe('Bench menu');
  expect(props.buttonTestID).toBe('ex-menu-0');
  // Children given → no native glyph.
  expect(props.showsIcon).toBe(false);
  await act(async () => {
    props.onAction({ nativeEvent: { key: 'add' } });
  });
  expect(list[0].onPress).toHaveBeenCalledTimes(1);
  expect(onFallbackPress).not.toHaveBeenCalled();
});

it('the Train adapter translates, subtitles and maps every icon the menus use', () => {
  const t = ((k: string) => `T:${k}`) as never;
  const onPress = jest.fn();
  const out = toMenuButtonActions(
    [
      { key: 'rest', icon: 'timer-outline', labelKey: 'train.addExerciseTitle' as never, desc: '1:30 after each set', onPress },
      { key: 'x', icon: 'trash-outline', labelKey: 'train.discardWorkout' as never, destructive: true, onPress },
    ],
    t,
  );
  expect(out[0]).toEqual({ key: 'rest', title: 'T:train.addExerciseTitle', subtitle: '1:30 after each set', sfSymbol: 'timer', onPress });
  expect(out[1]).toMatchObject({ key: 'x', destructive: true, sfSymbol: 'trash' });
  for (const sf of Object.values(IONICON_TO_SF)) expect(sf).toMatch(/^[a-z0-9.]+$/);
});
