/**
 * The Finish sheet and the share card after the train-ux pass (2026-10-11,
 * review F): a like-for-like volume comparison (F4), a forgotten workout's
 * length (F15), a HOLD that moves the template says why (F16), a record is
 * spoken (F12), the summary stacks at accessibility sizes (F17), and the
 * share card counts what was saved and keeps a fixed layout (F10/F11/J13).
 */
import React from 'react';
import { fireEvent, renderWithProviders as render, waitFor, within } from '@/test-utils';
import type { WorkoutSession, WorkoutTemplate } from '@/lib/workout';

jest.mock('@/components/BottomSheet', () => {
  const actual = jest.requireActual('@/components/BottomSheet');
  return {
    ...actual,
    NATIVE_SHEETS: false,
    BottomSheet: (p: object) => actual.BottomSheet({ ...p, native: false }),
  };
});
jest.mock('@/lib/auth', () => ({ useAuth: () => ({ user: { uid: 'u1' }, profile: null }) }));
jest.mock('@/lib/reviewPrompt', () => ({ recordPositiveMoment: jest.fn() }));
jest.mock('@/lib/haptics', () => ({ tap: jest.fn(), success: jest.fn(), warn: jest.fn(), warning: jest.fn() }));
const mockAnnounce = jest.fn();
const mockConfirm = jest.fn();
jest.mock('@/components/ConfirmSheet', () => ({
  ...jest.requireActual('@/components/ConfirmSheet'),
  confirm: (o: unknown) => mockConfirm(o),
  confirmNative: (o: object) => mockConfirm({ ...o, native: true }),
}));
jest.mock('@/lib/a11y', () => ({ ...jest.requireActual('@/lib/a11y'), announce: (...a: unknown[]) => mockAnnounce(...a) }));

import { FinishSheet, TrainFinishSheet } from '@/components/train/FinishSheet';
import { WorkoutShareCard, workoutShareStats } from '@/components/train/WorkoutShareCard';
import { en } from '@/i18n/en';

const t = ((key: keyof typeof en, params?: Record<string, string | number>) =>
  String(en[key]).replace(/\{(\w+)\}/g, (_, k: string) => String(params?.[k] ?? `{${k}}`))) as never;

const day = (n: number, h = 9) => new Date(2026, 9, n, h);
const set = (weight: number, reps: number) => ({ kind: 'working' as const, weight, reps, done: true });

function live(exercises: WorkoutSession['exercises'], extra: Partial<WorkoutSession> = {}): WorkoutSession {
  return { id: 'live', status: 'active', date: new Date(Date.now() - 50 * 60_000), exercises, ...extra } as WorkoutSession;
}

const ex = (exerciseId: string, sets: ReturnType<typeof set>[] | object[]) =>
  ({ exerciseId, name: exerciseId[0].toUpperCase() + exerciseId.slice(1), logStyle: 'weight-reps', cues: [], sets }) as never;

beforeEach(() => mockAnnounce.mockClear());

describe('volume vs last time is like for like (F4)', () => {
  it('compares the lifts this session logged with the same lifts last time, and says so', async () => {
    const last = {
      id: 'prev', status: 'completed', date: day(1), templateId: 'push',
      exercises: [ex('bench', [set(100, 10)]), ex('row', [set(100, 10)]), ex('curl', [set(50, 10)])],
    } as unknown as WorkoutSession;
    const session = live([ex('bench', [set(100, 11)]), ex('row', [{ kind: 'working' }]), ex('curl', [])], { templateId: 'push' });
    const ui = await render(
      <FinishSheet visible session={session} recentSessions={[last]} invalid={[]} onFinish={jest.fn()} onClose={jest.fn()} />,
    );
    // 1100 against Bench's 1000 — not against the 2500 of all three lifts.
    expect(ui.getByTestId('finish-vs-last')).toHaveTextContent('+10% volume on the same lifts vs last time');
  });
});

describe('a workout left open (F15)', () => {
  it('reads hours as hours, asks for the real length, and passes it to the finish', async () => {
    const onFinish = jest.fn().mockResolvedValue(true);
    const session = live([ex('bench', [set(100, 5)])], { date: new Date(Date.now() - 14 * 60 * 60_000) });
    const ui = await render(
      <FinishSheet visible session={session} recentSessions={[]} invalid={[]} onFinish={onFinish} onClose={jest.fn()} />,
    );
    expect(ui.getByText('14 h 0 min')).toBeTruthy();
    expect(ui.getByTestId('finish-long-open')).toHaveTextContent(/Open for 14 h 0 min\. Forgot to finish\?/);

    await fireEvent.changeText(ui.getByTestId('finish-length'), '0');
    await fireEvent.press(ui.getByTestId('finish-confirm'));
    expect(ui.getByTestId('finish-length-error')).toBeTruthy();
    expect(onFinish).not.toHaveBeenCalled();

    await fireEvent.changeText(ui.getByTestId('finish-length'), '55');
    expect(ui.getByText('55 min')).toBeTruthy();
    await fireEvent.press(ui.getByTestId('finish-confirm'));
    await waitFor(() => expect(onFinish).toHaveBeenCalledTimes(1));
    expect(onFinish.mock.calls[0][0]).toEqual(expect.objectContaining({ durationMin: 55 }));
  });

  it('a typed length guards the close like the other extras (fix R)', async () => {
    mockConfirm.mockClear();
    const onClose = jest.fn();
    const session = live([ex('bench', [set(100, 5)])], { date: new Date(Date.now() - 14 * 60 * 60_000) });
    const ui = await render(
      <FinishSheet visible session={session} recentSessions={[]} invalid={[]} onFinish={jest.fn()} onClose={onClose} />,
    );
    await fireEvent.press(ui.getByTestId('finish-keep-training'));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(mockConfirm).not.toHaveBeenCalled();
    onClose.mockClear();
    await fireEvent.changeText(ui.getByTestId('finish-length'), '55');
    await fireEvent.press(ui.getByTestId('finish-keep-training'));
    expect(onClose).not.toHaveBeenCalled();
    // The system dialog, not a branded sheet over the native sheet (S23-2).
    expect(mockConfirm).toHaveBeenCalledWith(expect.objectContaining({ title: en['train.finishDropExtrasTitle'], native: true }));
    // Whitespace alone is not a typed value.
    mockConfirm.mockClear();
    await fireEvent.changeText(ui.getByTestId('finish-length'), '  ');
    await fireEvent.press(ui.getByTestId('finish-keep-training'));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(mockConfirm).not.toHaveBeenCalled();
  });

  it('does not ask for an ordinary workout', async () => {
    const ui = await render(
      <FinishSheet visible session={live([ex('bench', [set(100, 5)])])} recentSessions={[]} invalid={[]} onFinish={jest.fn()} onClose={jest.fn()} />,
    );
    expect(ui.queryByTestId('finish-long-open')).toBeNull();
  });
});

describe('a record is spoken, not only shown (F12)', () => {
  it('announces the record heading once when the sheet opens', async () => {
    const prior = { id: 'prev', status: 'completed', date: day(1), exercises: [ex('bench', [set(100, 5)])] } as unknown as WorkoutSession;
    await render(
      <FinishSheet visible session={live([ex('bench', [set(110, 5)])])} recentSessions={[prior]} invalid={[]} onFinish={jest.fn()} onClose={jest.fn()} />,
    );
    await waitFor(() => expect(mockAnnounce).toHaveBeenCalledWith('New personal record!'));
    expect(mockAnnounce).toHaveBeenCalledTimes(1);
  });
});

describe('a HOLD that moves the template says why (F16)', () => {
  it('reads "the weight you lifted" beside a hold', async () => {
    const cluster = (w: number, act: number) => [
      { kind: 'activation' as const, group: 1, weight: w, reps: act, rir: 0, done: true },
      { kind: 'mini' as const, group: 1, weight: w, reps: 3, rir: 0, done: true },
      { kind: 'mini' as const, group: 1, weight: w, reps: 2, rir: 0, done: true },
    ];
    const template: WorkoutTemplate = {
      id: 't1', name: 'Pull A', createdAt: day(1), updatedAt: day(1),
      exercises: [{
        exerciseId: 'row', name: 'Row', targetLoad: 75,
        plannedSets: [{ kind: 'activation', group: 1 }, { kind: 'mini', group: 1 }, { kind: 'mini', group: 1 }],
      }],
    } as WorkoutTemplate;
    const session = {
      id: 'live', status: 'active', date: day(7), templateId: 't1', templateName: 'Pull A',
      exercises: [{ exerciseId: 'row', name: 'Row', logStyle: 'weight-reps', cues: [], targetLoad: 75, sets: cluster(80, 10) }],
    } as unknown as WorkoutSession;
    const train = {
      active: session, editingExisting: false, templates: [template], recentSessions: [] as WorkoutSession[],
      catalog: [{ id: 'row', name: 'Row', category: 'compound', muscles: ['back'], defaultCues: [], createdAt: day(1) }] as never,
      trainingPhase: 'cut' as const, finishWorkout: jest.fn().mockResolvedValue(true), saveTemplate: jest.fn(),
    };
    const ui = await render(<TrainFinishSheet train={train} visible onClose={() => {}} />);
    await waitFor(() => expect(ui.getByTestId('finish-call-row-headline')).toBeTruthy());
    expect(ui.getByTestId('finish-call-row-headline').props.children).toBe('80 lb · HOLD');
    expect(ui.getByTestId('finish-change-row').props.children).toBe('Template 75 lb → 80 lb (the weight you lifted)');
  });
});

describe('Finish at accessibility text sizes (QA v2 item 1)', () => {
  const at = async (fontScale: number) => {
    const rn = jest.requireActual('react-native');
    const spy = jest.spyOn(rn, 'useWindowDimensions').mockReturnValue({ width: 390, height: 844, scale: 3, fontScale });
    try {
      return await render(
        <FinishSheet visible session={live([ex('bench', [set(100, 5)])])} recentSessions={[]} invalid={[]} onFinish={jest.fn()} onClose={jest.fn()} onDiscard={jest.fn()} />,
      );
    } finally {
      spy.mockRestore();
    }
  };

  it('normal size: the footer is pinned under the scroll', async () => {
    const ui = await at(1);
    expect(within(ui.getByTestId('finish-scroll')).queryByTestId('finish-footer')).toBeNull();
    expect(ui.getByTestId('finish-footer')).toBeTruthy();
  });

  it('fontScale ≥ 1.6: the footer ends the scroll, and the title wraps with no line cap', async () => {
    const ui = await at(2);
    expect(within(ui.getByTestId('finish-scroll')).getByTestId('finish-confirm')).toBeTruthy();
    expect(within(ui.getByTestId('finish-scroll')).getByTestId('finish-discard')).toBeTruthy();
    const title = ui.getByRole('header', { name: 'Finish workout' });
    expect(title.props.numberOfLines).toBeUndefined();
  });
});

describe('the summary stacks at accessibility text sizes (F17)', () => {
  it('lays the tiles out as rows at fontScale ≥ 1.5', async () => {
    const rn = jest.requireActual('react-native');
    const spy = jest.spyOn(rn, 'useWindowDimensions').mockReturnValue({ width: 390, height: 844, scale: 3, fontScale: 2 });
    try {
      const ui = await render(
        <FinishSheet visible session={live([ex('bench', [set(100, 5)])])} recentSessions={[]} invalid={[]} onFinish={jest.fn()} onClose={jest.fn()} />,
      );
      const grid = ui.getByTestId('finish-summary');
      const flat = Object.assign({}, ...[grid.props.style].flat(Infinity).filter(Boolean));
      expect(flat.flexDirection).toBe('column');
    } finally {
      spy.mockRestore();
    }
  });
});

describe('the share card (F10, F11, J13)', () => {
  it('counts only what the save keeps and names the file for the workout', () => {
    const session = live(
      [ex('bench', [set(100, 5), { kind: 'working' }]), ex('row', [{ kind: 'working' }]), ex('curl', [])],
      { templateName: 'Push Día 1', date: day(7) },
    );
    const stats = workoutShareStats(session, [], t, 'en', 'us');
    expect(stats.exercises).toBe(1);
    expect(stats.sets).toBe(1);
    expect(stats.fileName).toBe('Ignia-push-dia-1-2026-10-07');
  });

  it('leads with volume on its own line, says "Records", and never follows Dynamic Type', async () => {
    const ui = await render(
      <WorkoutShareCard stats={{ title: 'Push A', date: 'Tue, Oct 7', volume: '12,648 lb', sets: 14, exercises: 5, prs: 2, fileName: 'x' }} />,
    );
    expect(ui.getByTestId('share-card-volume')).toHaveTextContent(/12,648 lb/);
    expect(ui.getByText('Records')).toBeTruthy();
    for (const label of ['Push A', 'Tue, Oct 7', '12,648 lb', 'Volume', '14', 'Sets', 'Records', 'Logged with Ignia']) {
      expect(ui.getByText(label).props.allowFontScaling).toBe(false);
    }
  });
});

/** Round 2 (FIX-PLAN-3, agent F): F4 copy, F8 at Finish, F12 detent. */
describe('round 2 — one coherent statement (F4) and the Android partial detent (F12)', () => {
  const { esPR } = jest.requireActual('@/i18n/es-PR') as { esPR: Record<string, string> };
  const { ptBR } = jest.requireActual('@/i18n/pt-BR') as { ptBR: Record<string, string> };

  it('F4: what is left out never says "won\'t be saved" beside "your sets are saved"', () => {
    const dropped = ['train.unstarted.one', 'train.unstarted.other', 'train.skippedSets.one', 'train.skippedSets.other', 'train.unloggedCardio'] as const;
    for (const k of dropped) expect(en[k]).not.toMatch(/saved/i);
    expect(en['train.invalidHint']).not.toMatch(/saved/i);
    for (const dict of [esPR, ptBR]) {
      for (const k of dropped) expect(dict[k]).not.toMatch(/guard|salv/i);
      expect(dict['train.invalidHint']).not.toMatch(/guard|salv/i);
    }
  });

  it('F8: the RIR notes at Finish say it in plain words, with the term in brackets, never "activation"', () => {
    for (const k of ['train.rec.invalid.rirMissing', 'train.invalidRirMissing', 'train.invalidRirEasy'] as const) {
      expect(en[k]).not.toMatch(/activation/i);
      expect(en[k]).toMatch(/reps in reserve \(RIR\)/);
    }
  });

  it('F12: under the sheet route\'s hidden band (Android, lower detent) the sheet pads its bottom so Complete is on screen', async () => {
    const { SheetHiddenBelowContext } = jest.requireActual('@/lib/sheet-detent') as typeof import('@/lib/sheet-detent');
    const sheet = (hidden: number) => (
      <SheetHiddenBelowContext.Provider value={hidden}>
        <FinishSheet visible session={live([ex('bench', [set(100, 5)])])} recentSessions={[]} invalid={[]} onFinish={jest.fn()} onClose={jest.fn()} />
      </SheetHiddenBelowContext.Provider>
    );
    const ui = await render(sheet(320));
    const flat = (st: unknown) => Object.assign({}, ...[st].flat(Infinity).filter(Boolean));
    expect(flat(ui.getByTestId('finish-below-fold').props.style).height).toBe(320);
    // At the top detent (or on iOS) there is no band and no spacer.
    await ui.rerender(sheet(0));
    expect(ui.queryByTestId('finish-below-fold')).toBeNull();
    expect(ui.getByTestId('finish-confirm')).toBeTruthy();
  });
});
