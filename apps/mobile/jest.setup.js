/**
 * Global test setup.
 *
 * Everything mocked here is a native or network boundary the JS test
 * environment cannot provide. Each mock is deliberately thin: the point is to
 * let the component under test run, not to simulate Firebase.
 */

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
