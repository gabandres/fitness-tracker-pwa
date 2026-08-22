/**
 * Global test setup.
 *
 * Everything mocked here is a native or network boundary the JS test
 * environment cannot provide. Each mock is deliberately thin: the point is to
 * let the component under test run, not to simulate Firebase.
 */

// react-native-gesture-handler installs itself through a native module at
// import time (`RNGestureHandlerModule.install()`), which throws
// "install is not a function" in the JS test environment. It ships an official
// jest setup that stubs exactly that. On the path of every Train test since
// the template editor's drag-to-reorder (react-native-sortables is built on
// gesture-handler), and of any screen that mounts a GestureHandlerRootView.
require('react-native-gesture-handler/jestSetup');

// react-native-sortables (drag-to-reorder in the template editor) is a
// gesture/worklet boundary, which is what this file exists to stub. It builds
// its drag handlers through `isWorkletFunction`, which Reanimated 4 exports and
// the mock jest-expo substitutes does not — every Train test that mounted the
// editor died with "isWorkletFunction is not a function", inside the library
// rather than inside anything under test. Rendering children straight through
// keeps every existing assertion meaningful (the cards, the set table and the
// accordion are all still really rendered); the DRAG itself is not assertable
// here anyway — RNTL runs no gesture and no layout pass — so it is proven on
// device by `.maestro/regression/18-train-template.yaml` instead.
jest.mock('react-native-sortables', () => {
  const React = require('react');
  const { View } = require('react-native');
  const passthrough = ({ children }) => React.createElement(View, null, children);
  return { __esModule: true, default: { Flex: passthrough, Grid: passthrough, Handle: passthrough } };
});

// AsyncStorage backs the theme context, which BottomSheet imports — so it is
// on the path of every screen test. Ships an official jest mock.
jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);

// react-native-keyboard-controller binds a native event emitter at MODULE
// scope, so merely importing BottomSheet throws outside a dev build. The sheet
// is on the path of every screen test, so this mock is load-bearing.
jest.mock('react-native-keyboard-controller', () => ({
  useReanimatedKeyboardAnimation: () => ({ height: { value: 0 }, progress: { value: 0 } }),
  KeyboardProvider: ({ children }) => children,
  KeyboardAwareScrollView: ({ children }) => children,
  // The five input screens take their KeyboardAvoidingView from here rather
  // than from react-native — see the note at the top of each. A mock that
  // omits it renders `undefined`, and RNTL reports that as "Element type is
  // invalid", which reads like a broken screen rather than a missing mock.
  KeyboardAvoidingView: ({ children }) => children,
}));

// Reanimated 4 (SDK 57) split its worklets runtime into `react-native-worklets`,
// and `react-native-reanimated/mock` is no longer self-contained: it loads the
// real index, which loads `NativeWorklets.native.ts`, which calls
// `loadUnpackers()` against a native module that does not exist under jest. The
// symptom is a throw from inside node_modules on any suite that touches an
// animated screen — three of them on the SDK 57 bump.
//
// Worklets ships its own complete jest mock; point at it directly. The package
// also ships `jest/resolver.js` for this, but jest-expo already sets a
// `resolver` to emulate Expo's Metro aliases, and a config may only have one.
jest.mock('react-native-worklets', () => require('react-native-worklets/lib/module/mock'));

// Reanimated ships its own complete jest mock. Use it wholesale — a
// hand-written partial silently drops hooks (useSharedValue, useReducedMotion)
// that this app's motion helpers depend on.
jest.mock('react-native-reanimated', () => {
  const mock = require('react-native-reanimated/mock');
  return {
    ...mock,
    // Not in the shipped mock; the app's motion.tsx calls it on every screen.
    useReducedMotion: () => false,
  };
});

// Sentry: the real SDK opens a native transport on import.
jest.mock('@/lib/sentry', () => ({
  addBreadcrumb: jest.fn(),
  captureError: jest.fn(),
  setSentryUser: jest.fn(),
}));

// Haptics go through a native module and are pure side effect.
jest.mock('@/lib/haptics', () => ({
  // `tap` was MISSING here until 2026-08-21, and the gap was invisible: it
  // only bites a test that presses a control whose handler calls it, and the
  // failure reads `haptics.tap is not a function` from inside the component,
  // which looks like a bug in the screen rather than in this list. Keep this
  // in sync with `src/lib/haptics.ts` — an incomplete mock of a pure
  // side-effect module fails LOUD in an unrelated place.
  tap: jest.fn(),
  success: jest.fn(),
  warning: jest.fn(),
  selection: jest.fn(),
  impact: jest.fn(),
}));

// The home-screen widget writes to an App Group / Android widget store.
jest.mock('@/lib/widget', () => ({
  clearWidget: jest.fn().mockResolvedValue(undefined),
  pushWidget: jest.fn().mockResolvedValue(undefined),
}));

// Health sync talks to HealthKit / Health Connect.
jest.mock('@/lib/health-sync', () => ({
  exportDaily: jest.fn().mockResolvedValue(undefined),
  useHealthSync: () => ({ connected: false, connect: jest.fn(), disconnect: jest.fn() }),
  useHealthAutoImport: jest.fn(),
}));

// expo-router's focus effect is a navigation-container hook; outside a
// navigator it throws. Tests that care about focus gating drive the subscribe
// callbacks directly instead.
jest.mock('expo-router', () => {
  const actual = jest.requireActual('expo-router');
  return {
    ...actual,
    useFocusEffect: (cb) => {
      const React = require('react');
      React.useEffect(() => {
        const cleanup = cb();
        return typeof cleanup === 'function' ? cleanup : undefined;
      }, [cb]);
    },
    useRouter: () => ({ push: jest.fn(), replace: jest.fn(), back: jest.fn() }),
  };
});

// React 19 requires this flag for act() to work outside a DOM renderer.
// Without it every state update logs "not configured to support act(...)" and
// updates land outside act, which is how a test starts asserting against a
// half-rendered tree.
global.IS_REACT_ACT_ENVIRONMENT = true;
