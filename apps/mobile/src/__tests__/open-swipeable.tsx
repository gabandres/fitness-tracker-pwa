/**
 * `jest.mock('react-native-gesture-handler/ReanimatedSwipeable', () => require('./open-swipeable').openSwipeableModule())`
 *
 * A `ReanimatedSwipeable` that is already swiped open. Gesture Handler 3 keeps
 * a closed row's actions at `pointerEvents: 'none'` until the swipe reveals
 * them — on a device and under the testing library alike — and a jest render
 * cannot perform the swipe. These suites test what the revealed action DOES,
 * so they start from the open row; `close()` and the other methods are no-ops.
 */
import { forwardRef, useImperativeHandle, type ReactNode } from 'react';
import { View } from 'react-native';

type Props = {
  children?: ReactNode;
  renderLeftActions?: () => ReactNode;
  renderRightActions?: () => ReactNode;
};

export function openSwipeableModule() {
  const OpenSwipeable = forwardRef<object, Props>(function OpenSwipeable(props, ref) {
    useImperativeHandle(ref, () => ({ close() {}, openLeft() {}, openRight() {}, reset() {} }));
    return (
      <View>
        {props.renderLeftActions?.()}
        {props.children}
        {props.renderRightActions?.()}
      </View>
    );
  });
  return { __esModule: true, default: OpenSwipeable };
}
