import React, { createContext, useSyncExternalStore } from 'react';
import { Platform, Pressable, Text, TextInput } from 'react-native';
import { act, fireEvent, renderWithProviders as render } from '@/test-utils';
import type { WorkoutTemplate } from '@/lib/workout';

/**
 * A GUARDED native sheet dismissed by the system on Android (train-ux
 * INDEX-v4 E1, fixed in v5).
 *
 * react-native-screens' Android formSheet cannot refuse a drag or a scrim
 * tap: `preventNativeDismiss` is iOS-only. The sheet is already off screen
 * when navigation reports the `POP`. The route used to hold that POP with
 * `usePreventRemove`, which left a route with no screen. The owner stayed
 * `visible`, so "+ New" and Edit did nothing until a restart, and the
 * "Discard?" confirm either never showed or was Cancelled into nothing.
 *
 * The fix: let navigation catch up, then the owner presents the sheet again
 * and asks on arrival. These tests drive the real `BottomSheet`, the real
 * `sheet` route and (in the first block) the real Train screen and template
 * editor through a small simulated stack. `POP` is what react-native-screens
 * dispatches from `onDismissed`; `GO_BACK` is hardware back. Neither of these
 * reaches iOS this way, so the iOS cases pin that nothing changed there.
 */

type Action = { type: string; source?: string };
type PreventCb = (e: { data: { action: Action } }) => void;
interface MockRoute {
  key: string;
  params: Record<string, string>;
  prevent: boolean;
  cb: PreventCb | null;
  navigation?: { goBack: () => void; dispatch: (a: Action) => void };
}

// The simulated root stack: what `router.push` pushes and the route's
// `navigation` pops. `mock`-prefixed so the hoisted factories may read it.
const mockStack = {
  routes: [] as MockRoute[],
  pushes: 0,
  listeners: new Set<() => void>(),
  emit() {
    mockStack.routes = [...mockStack.routes];
    for (const l of mockStack.listeners) l();
  },
  push(params: Record<string, string>) {
    mockStack.pushes += 1;
    mockStack.routes.push({ key: `sheet-route-${mockStack.pushes}`, params, prevent: false, cb: null });
    mockStack.emit();
  },
  remove(key: string) {
    mockStack.routes = mockStack.routes.filter((r) => r.key !== key);
    mockStack.emit();
  },
  /** What react-navigation does with an action aimed at a route: run the
   *  `usePreventRemove` callback when prevented, else remove the route. */
  removeVia(route: MockRoute, action: Action) {
    if (route.prevent && route.cb) route.cb({ data: { action } });
    else mockStack.remove(route.key);
  },
  reset() {
    mockStack.routes = [];
    mockStack.pushes = 0;
  },
};
const MockRouteCtx = createContext<MockRoute | null>(null);

jest.mock('expo-router', () => {
  const actual = jest.requireActual('expo-router');
  const { useContext: useCtx } = jest.requireActual('react');
  return {
    ...actual,
    router: { ...actual.router, push: ({ params }: { params: Record<string, string> }) => mockStack.push(params) },
    useLocalSearchParams: () => {
      const route = useCtx(MockRouteCtx) as MockRoute | null;
      return route ? route.params : actual.useLocalSearchParams();
    },
    useNavigation: () => {
      const route = useCtx(MockRouteCtx) as MockRoute | null;
      if (!route) return actual.useNavigation();
      // One object per route, as react-navigation's is: the route's effect
      // depends on it.
      route.navigation ??= {
        goBack: () => mockStack.removeVia(route, { type: 'GO_BACK' }),
        // From inside the prevent callback: the documented way to let the
        // held action through.
        dispatch: () => mockStack.remove(route.key),
      };
      return route.navigation;
    },
  };
});
jest.mock('expo-router/react-navigation', () => {
  const { useContext: useCtx } = jest.requireActual('react');
  return {
    usePreventRemove: (prevent: boolean, cb: PreventCb) => {
      const route = useCtx(MockRouteCtx) as MockRoute | null;
      if (route) {
        route.prevent = prevent;
        route.cb = cb;
      }
    },
  };
});

// The NATIVE path is the subject here: `jest.setup.js` swaps every
// `BottomSheet native` for the JS sheet, so undo that for this file.
jest.unmock('@/components/BottomSheet');

const mockTemplate: WorkoutTemplate = {
  id: 't1',
  name: 'Push Day',
  exercises: [{
    exerciseId: 'e1', name: 'DB Flat Press', logStyle: 'weight-reps', targetLoad: 25,
    plannedSets: [{ kind: 'working' }, { kind: 'working' }],
  }],
  createdAt: new Date('2026-07-05T02:51:12Z'),
  updatedAt: new Date('2026-08-06T16:08:19Z'),
};

jest.mock('@/hooks/useTrain', () => ({
  useTrain: () => ({
    loading: false,
    error: null,
    catalog: [],
    templates: [mockTemplate],
    drafts: [],
    pendingLoadTestFor: () => null,
    editCatalogExercise: jest.fn(),
    recentSessions: [],
    active: null,
    editingExisting: false,
    saveTemplate: jest.fn().mockResolvedValue(undefined),
    deleteTemplate: jest.fn(),
    cloneStarterTemplate: jest.fn(),
    addCatalogExercise: jest.fn(),
    startWorkout: jest.fn(),
    startFromTemplate: jest.fn(),
    reopenSession: jest.fn(),
    deleteSession: jest.fn(),
  }),
}));
jest.mock('@/lib/auth', () => ({ useAuth: () => ({ user: { uid: 'u1' }, profile: null }) }));
jest.mock('@/lib/reviewPrompt', () => ({ recordPositiveMoment: jest.fn() }));
jest.mock('@/lib/haptics', () => ({ tap: jest.fn(), success: jest.fn(), warn: jest.fn(), warning: jest.fn() }));
jest.mock('@/hooks/useRestTimer', () => ({
  useRestTimer: () => ({ remaining: 0, running: false, start: jest.fn(), stop: jest.fn() }),
}));

import SheetRoute from '@/app/sheet';
import TrainScreen from '@/app/(app)/train';
import { BottomSheet } from '@/components/BottomSheet';
import { confirm } from '@/components/ConfirmSheet';
import { __resetSheetPortal, isAnySheetActive, onSheetsIdle } from '@/lib/sheet-portal';

/** Every route on the simulated stack, rendered as the real `sheet` route. */
function MockStack() {
  const routes = useSyncExternalStore(
    (l) => {
      mockStack.listeners.add(l);
      return () => mockStack.listeners.delete(l);
    },
    () => mockStack.routes,
  );
  return (
    <>
      {routes.map((r) => (
        <MockRouteCtx.Provider key={r.key} value={r}>
          <SheetRoute />
        </MockRouteCtx.Provider>
      ))}
    </>
  );
}

const top = () => mockStack.routes[mockStack.routes.length - 1];
/** The user drags the sheet away (or taps the scrim): react-native-screens'
 *  `onDismissed` dispatches a POP from the route. */
const drag = (route: MockRoute) => act(() => mockStack.removeVia(route, { type: 'POP', source: route.key }));
/** Hardware back: react-navigation's GO_BACK. */
const back = (route: MockRoute) => act(() => mockStack.removeVia(route, { type: 'GO_BACK' }));

beforeEach(() => {
  mockStack.reset();
  __resetSheetPortal();
});

describe('Android: template editor dragged away while dirty (INDEX-v4 E1)', () => {
  beforeEach(() => {
    jest.replaceProperty(Platform, 'OS', 'android');
  });

  it('comes back with the draft and asks; Cancel keeps editing, Discard resets so Edit opens again', async () => {
    const screen = await render(<><TrainScreen /><MockStack /></>);
    await fireEvent.press(screen.getByTestId('edit-template-t1'));
    expect(mockStack.routes).toHaveLength(1);
    const first = top();
    await fireEvent.changeText(screen.getByTestId('template-name'), 'Push Day v2');
    expect(first.prevent).toBe(true);

    await drag(first);

    // The dismissed route is gone (navigation caught up), and the sheet is
    // presented again with the typed name and the discard question in it.
    expect(mockStack.routes.map((r) => r.key)).not.toContain(first.key);
    expect(mockStack.routes).toHaveLength(1);
    expect(screen.getByTestId('template-name').props.value).toBe('Push Day v2');
    expect(screen.getByTestId('confirm-go')).toBeTruthy();

    // Cancel: still editing, the draft intact, the sheet up.
    await fireEvent.press(screen.getByTestId('confirm-cancel'));
    expect(mockStack.routes).toHaveLength(1);
    expect(screen.getByTestId('template-name').props.value).toBe('Push Day v2');

    // A second drag, then Discard: the owner's `editing` resets, the route
    // leaves, and Edit presents a fresh, clean editor.
    await drag(top());
    await fireEvent.press(screen.getByTestId('confirm-go'));
    expect(mockStack.routes).toHaveLength(0);
    const before = mockStack.pushes;
    await fireEvent.press(screen.getByTestId('edit-template-t1'));
    expect(mockStack.pushes).toBe(before + 1);
    expect(screen.getByTestId('template-name').props.value).toBe('Push Day');
  });

  it('a clean editor dragged away just closes, and + New opens again', async () => {
    const screen = await render(<><TrainScreen /><MockStack /></>);
    await fireEvent.press(screen.getByTestId('edit-template-t1'));
    const first = top();
    expect(first.prevent).toBe(false);

    await drag(first);

    expect(mockStack.routes).toHaveLength(0);
    expect(screen.queryByTestId('confirm-go')).toBeNull();
    await fireEvent.press(screen.getByTestId('new-template'));
    expect(mockStack.routes).toHaveLength(1);
    expect(screen.getByTestId('template-name').props.value).toBe('');
  });
});

/** A minimal guarded owner, the shape every guarded sheet has. */
function Owner({ onAsk, backSteps, refuseClean }: {
  onAsk?: (via: string) => void;
  /** A sub-screen is open: the route holds Android back (and so any POP). */
  backSteps?: boolean;
  /** Refuse even with nothing typed (an owner whose `guarded` disagrees). */
  refuseClean?: boolean;
}) {
  const [open, setOpen] = React.useState(false);
  const [text, setText] = React.useState('');
  return (
    <>
      <Pressable testID="open" onPress={() => setOpen(true)}><Text>open</Text></Pressable>
      <BottomSheet
        native
        visible={open}
        onClose={() => setOpen(false)}
        guarded={text !== ''}
        backSteps={backSteps}
        onRequestClose={(via) => {
          onAsk?.(via);
          if (!text && !refuseClean) {
            setOpen(false);
            return true;
          }
          confirm({ title: 'Discard?', confirmText: 'Discard', destructive: true, onConfirm: () => { setText(''); setOpen(false); } });
          return false;
        }}
      >
        <TextInput testID="field" value={text} onChangeText={setText} />
      </BottomSheet>
    </>
  );
}

describe('the guard on each platform', () => {
  it('Android back on a guarded sheet still asks in place (the sheet never left)', async () => {
    jest.replaceProperty(Platform, 'OS', 'android');
    const onAsk = jest.fn();
    const screen = await render(<><Owner onAsk={onAsk} /><MockStack /></>);
    await fireEvent.press(screen.getByTestId('open'));
    await fireEvent.changeText(screen.getByTestId('field'), 'typed');
    const first = top();

    await back(first);

    expect(onAsk).toHaveBeenCalledWith('back');
    expect(top()).toBe(first);
    expect(mockStack.pushes).toBe(1);
    expect(screen.getByTestId('confirm-go')).toBeTruthy();
  });

  it('iOS: a held swipe asks in place and the route is never re-presented', async () => {
    jest.replaceProperty(Platform, 'OS', 'ios');
    const onAsk = jest.fn();
    const screen = await render(<><Owner onAsk={onAsk} /><MockStack /></>);
    await fireEvent.press(screen.getByTestId('open'));
    await fireEvent.changeText(screen.getByTestId('field'), 'typed');
    const first = top();

    // iOS refuses natively; react-native-screens then reports
    // `onNativeDismissCancelled`, which the stack also dispatches as a POP.
    await drag(first);

    expect(onAsk).toHaveBeenCalledWith('drag');
    expect(top()).toBe(first);
    expect(mockStack.pushes).toBe(1);
    await fireEvent.press(screen.getByTestId('confirm-go'));
    expect(mockStack.routes).toHaveLength(0);
  });

  it('Android: the generic owner is re-presented with its text, asked once, and reopens after Discard', async () => {
    jest.replaceProperty(Platform, 'OS', 'android');
    const onAsk = jest.fn();
    const screen = await render(<><Owner onAsk={onAsk} /><MockStack /></>);
    await fireEvent.press(screen.getByTestId('open'));
    await fireEvent.changeText(screen.getByTestId('field'), 'typed');

    await drag(top());

    expect(onAsk).toHaveBeenCalledTimes(1);
    expect(onAsk).toHaveBeenCalledWith('drag');
    expect(mockStack.pushes).toBe(2);
    expect(screen.getByTestId('field').props.value).toBe('typed');
    await fireEvent.press(screen.getByTestId('confirm-go'));
    expect(mockStack.routes).toHaveLength(0);
    await fireEvent.press(screen.getByTestId('open'));
    expect(mockStack.pushes).toBe(3);
    expect(screen.getByTestId('field').props.value).toBe('');
  });

  it('Android: the screen underneath never sees the sheets go idle while one is put back', async () => {
    // Counted idle for that instant, Train let go of its listeners and
    // re-subscribed; the fresh catalog objects then reset the Lift settings
    // draft the sheet was coming back to (emulator, v5).
    jest.replaceProperty(Platform, 'OS', 'android');
    const screen = await render(<><Owner /><MockStack /></>);
    await fireEvent.press(screen.getByTestId('open'));
    await fireEvent.changeText(screen.getByTestId('field'), 'typed');
    const idle = jest.fn();
    onSheetsIdle(idle);

    await drag(top());

    expect(idle).not.toHaveBeenCalled();
    expect(isAnySheetActive()).toBe(true);
    await fireEvent.press(screen.getByTestId('confirm-go'));
    expect(idle).toHaveBeenCalledTimes(1);
    expect(isAnySheetActive()).toBe(false);
  });

  it('Android: held only for back steps (nothing typed), a drag closes once — no bounce back up', async () => {
    jest.replaceProperty(Platform, 'OS', 'android');
    const onAsk = jest.fn();
    const screen = await render(<><Owner onAsk={onAsk} backSteps /><MockStack /></>);
    await fireEvent.press(screen.getByTestId('open'));
    expect(top().prevent).toBe(true);

    await drag(top());

    expect(onAsk).toHaveBeenCalledTimes(1);
    expect(mockStack.pushes).toBe(1);
    expect(mockStack.routes).toHaveLength(0);
    await fireEvent.press(screen.getByTestId('open'));
    expect(mockStack.pushes).toBe(2);
  });

  it('an owner that refuses a drag the route could not hold gets its sheet back, asked again', async () => {
    // Unguarded, so the route lets the dismissal through and only then asks.
    // Refused, nothing would ever present it again: the owner would stay
    // `visible` with no route — the dead editor of INDEX-v4 E1.
    jest.replaceProperty(Platform, 'OS', 'android');
    const onAsk = jest.fn();
    const screen = await render(<><Owner onAsk={onAsk} refuseClean /><MockStack /></>);
    await fireEvent.press(screen.getByTestId('open'));
    expect(top().prevent).toBe(false);

    await drag(top());

    expect(mockStack.pushes).toBe(2);
    expect(mockStack.routes).toHaveLength(1);
    expect(onAsk).toHaveBeenLastCalledWith('drag');
    await fireEvent.press(screen.getByTestId('confirm-go'));
    expect(mockStack.routes).toHaveLength(0);
    await fireEvent.press(screen.getByTestId('open'));
    expect(mockStack.pushes).toBe(3);
  });
});
