import { STARTER_TEMPLATES, normalizeSupersets, supersetLabel } from '@macrolog/core';
import {
  addActionsForDraft,
  cardSummary,
  clusterParts,
  copyFirstTargets,
  kindsForPicker,
  offeredCount,
  setCountText,
  isClusterSeed,
  nextSetRow,
  orderStarters,
  reinsertAt,
  reinsertCard,
  repsToSave,
  rowUntouched,
  rowsUntouched,
  ghostBuffers,
  seedTargetLoad,
  starterPreview,
  starterPreviewParts,
  rowsSeededFromHistory,
} from '@/components/train/template-draft';
import type { SetKind, WorkoutSet } from '@/lib/workout';
import type { I18nKey, TFn } from '@/i18n';
import { en } from '@/i18n/en';
import { esPR } from '@/i18n/es-PR';

const blank = { weightText: '', repsText: '', durationText: '' };

describe('ghostBuffers (T7 — placeholders only)', () => {
  const prev: WorkoutSet[] = [
    { kind: 'warmup', weight: 95, reps: 10, done: true },
    { kind: 'working', weight: 135, reps: 8, done: true },
    { kind: 'working', weight: 135, reps: 7, done: true },
    { kind: 'working', weight: 135 }, // opened, never done: no record
  ];

  it('matches by kind, then order — a warm-up never seeds a working row', () => {
    expect(ghostBuffers(['working', 'working', 'working'], prev, 'weight-reps', 'us')).toEqual([
      { weightText: '135', repsText: '8', durationText: '' },
      { weightText: '135', repsText: '7', durationText: '' },
      null,
    ]);
  });

  it('leaves rows of a kind last session did not have blank', () => {
    expect(ghostBuffers(['activation', 'mini', 'mini'], prev, 'weight-reps', 'us')).toEqual([null, null, null]);
  });

  it('converts pounds to the training unit', () => {
    expect(ghostBuffers(['working'], [{ kind: 'working', weight: 100, reps: 5 }], 'weight-reps', 'metric')[0]?.weightText)
      .toBe('45.4');
  });

  it('seeds only what the log style shows', () => {
    expect(ghostBuffers(['working'], [{ kind: 'working', weight: 20, reps: 12 }], 'bodyweight', 'us'))
      .toEqual([{ weightText: '', repsText: '12', durationText: '' }]);
    expect(ghostBuffers(['working'], [{ kind: 'working', durationSec: 45 }], 'time', 'us'))
      .toEqual([{ weightText: '', repsText: '', durationText: '45' }]);
  });
});

describe('seedTargetLoad — the lift\'s load, not per-set weights (fix R)', () => {
  const prev: WorkoutSet[] = [
    { kind: 'warmup', weight: 95, reps: 10, done: true },
    { kind: 'working', weight: 135, reps: 8, done: true },
    { kind: 'working', weight: 140, reps: 6, done: true },
  ];
  it('takes the first performed working set, never the warm-up', () => {
    expect(seedTargetLoad(prev, 'weight-reps', 'us')).toBe('135');
  });
  it('reads a cluster\'s activation load; converts to the training unit', () => {
    expect(seedTargetLoad([{ kind: 'activation', weight: 100, reps: 12 }, { kind: 'mini', weight: 100, reps: 4 }], 'weight-reps', 'metric')).toBe('45.4');
  });
  it('is empty with no performed working set, or for a lift with no weight box', () => {
    expect(seedTargetLoad([{ kind: 'working', weight: 135 }], 'weight-reps', 'us')).toBe('');
    expect(seedTargetLoad(prev, 'bodyweight', 'us')).toBe('');
    expect(seedTargetLoad(prev, 'time', 'us')).toBe('');
  });
});

describe('rowUntouched / rowsUntouched — a ghost is not a value', () => {
  const ghost = { weightText: '135', repsText: '8', durationText: '' };
  it('a blank row is untouched, ghost or not', () => {
    expect(rowUntouched(blank)).toBe(true);
    const withGhost = { ...blank, ghost };
    expect(rowsUntouched([blank, withGhost])).toBe(true);
  });

  it('a typed number is touched — even one equal to the ghost', () => {
    expect(rowUntouched({ ...blank, repsText: '8' })).toBe(false);
    expect(rowUntouched({ ...ghost })).toBe(false);
  });
});

describe('addActionsForDraft (T9, S23-5)', () => {
  it('a NEW undeclared card offers only "+ Add set"', () => {
    expect(addActionsForDraft(undefined, true, ['working'])).toEqual({ set: true, cluster: false, block: false });
  });
  it('a legacy undeclared card of straight sets offers only "+ Add set" — no cluster rows on a straight-set lift (S23-5)', () => {
    expect(addActionsForDraft(undefined, undefined, ['working', 'working', 'working'])).toEqual({ set: true, cluster: false, block: false });
    expect(addActionsForDraft(undefined, undefined, ['warmup', 'working', 'drop'])).toEqual({ set: true, cluster: false, block: false });
  });
  it('a legacy undeclared card keeps the add-buttons its rows already use (ADR-0041 amended)', () => {
    expect(addActionsForDraft(undefined, undefined, ['activation', 'mini', 'mini'])).toEqual({ set: true, cluster: true, block: false });
    expect(addActionsForDraft(undefined, undefined, ['activation', 'continuation'])).toEqual({ set: true, cluster: false, block: true });
    expect(addActionsForDraft(undefined, undefined, ['activation', 'mini', 'activation', 'continuation'])).toEqual({ set: true, cluster: true, block: true });
  });
  it('a declared structure decides, new or not, whatever the rows', () => {
    expect(addActionsForDraft('myoreps', true, ['working'])).toEqual({ set: true, cluster: true, block: false });
    expect(addActionsForDraft('straight', undefined, ['activation', 'mini'])).toEqual({ set: true, cluster: false, block: false });
  });
});

describe('rowsSeededFromHistory — saved grey reps do not block a rescaffold on the next edit (S23-11, review R2 P2-4)', () => {
  const r = (kind: SetKind, repsText = '', extra: object = {}) => ({ kind, ...blank, repsText, ...extra });
  const prev: WorkoutSet[] = [{ kind: 'working', reps: 8 }, { kind: 'working', reps: 7 }];

  it('rows whose reps are exactly what history offers, nothing else typed, count as seeded', () => {
    expect(rowsSeededFromHistory([r('working', '8'), r('working', '7')], prev, 'weight-reps')).toBe(true);
    expect(rowsSeededFromHistory([r('working'), r('working', '7')], prev, 'weight-reps')).toBe(true);
  });

  it('a count history would not offer is typed', () => {
    expect(rowsSeededFromHistory([r('working', '10'), r('working', '7')], prev, 'weight-reps')).toBe(false);
    expect(rowsSeededFromHistory([r('working', '8'), r('working', '7'), r('working', '7')], prev, 'weight-reps')).toBe(false);
  });

  it('a typed weight or duration is typed, whatever the reps', () => {
    expect(rowsSeededFromHistory([r('working', '8', { weightText: '135' }), r('working', '7')], prev, 'weight-reps')).toBe(false);
  });

  it('no history: only blank rows are seeded', () => {
    expect(rowsSeededFromHistory([r('working'), r('working')], [], 'weight-reps')).toBe(true);
    expect(rowsSeededFromHistory([r('working', '8')], [], 'weight-reps')).toBe(false);
  });
});

describe('repsToSave — the grey reps a new card shows are saved as its targets (S23-11)', () => {
  const r = (kind: SetKind, repsText = '', extra: object = {}) => ({ kind, ...blank, repsText, ...extra });
  const ghost = { weightText: '135', repsText: '7', durationText: '' };

  it('typed reps are saved as typed, on any card', () => {
    expect(repsToSave(r('working', '10'), undefined, 'weight-reps', false)).toBe(10);
    expect(repsToSave(r('working', '10', { ghost }), undefined, 'weight-reps', true)).toBe(10);
  });

  it("a new card saves the grey reps it shows: its ghost, else last time's same-kind row", () => {
    expect(repsToSave(r('working', '', { ghost }), undefined, 'weight-reps', true)).toBe(7);
    expect(repsToSave(r('working'), { kind: 'working', reps: 8 }, 'weight-reps', true)).toBe(8);
    expect(repsToSave(r('mini', '', { ghost: { ...ghost, repsText: '4' } }), undefined, 'weight-reps', true)).toBe(4);
  });

  it("never saves a different kind's count, and never invents one", () => {
    expect(repsToSave(r('working'), { kind: 'warmup', reps: 12 }, 'weight-reps', true)).toBeUndefined();
    expect(repsToSave(r('working'), undefined, 'weight-reps', true)).toBeUndefined();
  });

  it('an existing card saves only what was typed — an unrelated save restates nothing', () => {
    expect(repsToSave(r('working', '', { ghost }), { kind: 'working', reps: 8 }, 'weight-reps', false)).toBeUndefined();
    expect(repsToSave(r('working', '', { ghost }), { kind: 'working', reps: 8 }, 'weight-reps', undefined)).toBeUndefined();
  });

  it('reps only: a timed lift saves no grey seconds', () => {
    const timed = { kind: 'working' as const, ...blank, ghost: { ...blank, durationText: '40' } };
    expect(repsToSave(timed, { kind: 'working', durationSec: 40 }, 'time', true)).toBeUndefined();
  });

  it('a bodyweight lift saves its grey reps like any other', () => {
    expect(repsToSave(r('working', '', { ghost: { ...blank, repsText: '12' } }), undefined, 'bodyweight', true)).toBe(12);
  });
});

describe('nextSetRow (T7)', () => {
  it('copies the last WORKING row, never a mini', () => {
    const rows = [
      { kind: 'working' as const, weightText: '100', repsText: '10', durationText: '' },
      { kind: 'mini' as const, weightText: '100', repsText: '4', durationText: '' },
    ];
    expect(nextSetRow(rows)).toEqual({ kind: 'working', weightText: '100', repsText: '10', durationText: '' });
  });
  it('copies only what was TYPED — a ghost is not carried; with no working row it is blank', () => {
    const ghost = { weightText: '135', repsText: '8', durationText: '' };
    expect(nextSetRow([{ kind: 'working', ...blank, ghost }])).toEqual({ kind: 'working', ...blank });
    expect(nextSetRow([{ kind: 'working', ...blank, repsText: '10', ghost }])).toEqual({ kind: 'working', ...blank, repsText: '10' });
    expect(nextSetRow([{ kind: 'activation', ...blank }])).toEqual({ kind: 'working', ...blank });
  });
});

describe('copyFirstTargets (T7)', () => {
  it('names the blank rows of row 1\'s kind, only when there are two or more', () => {
    const r = (kind: 'working' | 'mini', repsText: string) => ({ kind, weightText: '', repsText, durationText: '' });
    expect(copyFirstTargets([r('working', '8'), r('working', ''), r('working', '')])).toEqual([1, 2]);
    expect(copyFirstTargets([r('working', '8'), r('working', '8'), r('working', '')])).toEqual([]);
    expect(copyFirstTargets([r('working', ''), r('working', ''), r('working', '')])).toEqual([]);
    expect(copyFirstTargets([r('working', '8'), r('mini', ''), r('working', ''), r('working', '')])).toEqual([2, 3]);
  });
});

describe('Undo re-inserts into the list as it is now (fix R)', () => {
  it('reinsertAt puts the item back at its index, clamped; twice is once', () => {
    expect(reinsertAt(['b', 'c'], 'a', 0)).toEqual(['a', 'b', 'c']);
    expect(reinsertAt(['b'], 'z', 5)).toEqual(['b', 'z']);
    const x = { id: 1 };
    expect(reinsertAt([x], x, 0)).toEqual([x]);
  });

  type Card = { uid: string; supersetGroup?: string; pairPosition?: 1 | 2 | 3 };
  const show = (rows: Card[]) => rows.map((r) => `${r.uid}:${supersetLabel(r) ?? '-'}`);

  it('reinsertCard restores the superset the removal broke', () => {
    const before: Card[] = [{ uid: 'a', supersetGroup: 'A', pairPosition: 1 }, { uid: 'b', supersetGroup: 'A', pairPosition: 2 }, { uid: 'c' }];
    const after = normalizeSupersets(before.filter((r) => r.uid !== 'a'));
    expect(show(after)).toEqual(['b:-', 'c:-']);
    expect(show(reinsertCard(after, before[0], 0, before))).toEqual(['a:A1', 'b:A2', 'c:-']);
    // A second Undo changes nothing.
    const back = reinsertCard(after, before[0], 0, before);
    expect(reinsertCard(back, before[0], 0, before)).toHaveLength(3);
  });

  it('a partner paired with something else since keeps its newer pair', () => {
    const before: Card[] = [{ uid: 'a', supersetGroup: 'A', pairPosition: 1 }, { uid: 'b', supersetGroup: 'A', pairPosition: 2 }, { uid: 'c' }];
    const now: Card[] = [{ uid: 'b', supersetGroup: 'A', pairPosition: 1 }, { uid: 'c', supersetGroup: 'A', pairPosition: 2 }];
    expect(show(reinsertCard(now, before[0], 0, before))).toEqual(['a:-', 'b:A1', 'c:A2']);
  });
});

describe('starter order and preview (H9/J4/T19)', () => {
  it('puts every cluster starter last and keeps the rest in core order', () => {
    const ordered = orderStarters(STARTER_TEMPLATES);
    const firstCluster = ordered.findIndex(isClusterSeed);
    expect(firstCluster).toBeGreaterThan(0);
    expect(ordered.slice(firstCluster).every(isClusterSeed)).toBe(true);
    const plain = STARTER_TEMPLATES.filter((s) => !isClusterSeed(s)).map((s) => s.key);
    expect(ordered.slice(0, firstCluster).map((s) => s.key)).toEqual(plain);
  });

  it('previews the first three movements by name, then +n', () => {
    const big = STARTER_TEMPLATES.find((s) => s.exercises.length > 3)!;
    const text = starterPreview(big, 'en');
    expect(text.split(', ')).toHaveLength(3);
    expect(text).toMatch(new RegExp(`\\+${big.exercises.length - 3}$`));
  });

  it('splits the preview so the row can truncate the names and keep "+n" whole', () => {
    const big = STARTER_TEMPLATES.find((s) => s.exercises.length > 3)!;
    const { head, more } = starterPreviewParts(big, 'en');
    expect(more).toBe(big.exercises.length - 3);
    expect(head.split(', ')).toHaveLength(3);
    expect(starterPreview(big, 'en')).toBe(`${head} +${more}`);
  });
});

const tFor = (dict: Record<string, string>): TFn => (key: I18nKey, params) =>
  (dict[key] ?? key).replace(/\{(\w+)\}/g, (_, k) => String(params?.[k] ?? ''));
const tEn = tFor(en as Record<string, string>);
const row = (kind: SetKind, repsText = '', extra: object = {}) => ({ kind, ...blank, repsText, ...extra });

describe('offeredCount — what the session will offer, in its order (E-N1)', () => {
  it('a typed count wins', () => {
    expect(offeredCount(row('working', '10'), { kind: 'working', reps: 6 }, 'weight-reps', 8)).toBe('10');
  });

  it("then last time's SAME-KIND row, then the lift's target on a working row", () => {
    expect(offeredCount(row('working'), { kind: 'working', reps: 6 }, 'weight-reps', 8)).toBe('6');
    // Last time's row 1 was a warm-up: not accepted, so the target reps show.
    expect(offeredCount(row('working'), { kind: 'warmup', reps: 12 }, 'weight-reps', 8)).toBe('8');
    expect(offeredCount(row('working'), undefined, 'weight-reps', 8)).toBe('8');
  });

  it('a new card reads its ghost as last time', () => {
    const ghost = { weightText: '135', repsText: '7', durationText: '' };
    expect(offeredCount(row('working', '', { ghost }), undefined, 'weight-reps', 8)).toBe('7');
  });

  it('never lends the target to a warm-up, activation, mini or drop row; nothing → ""', () => {
    for (const k of ['warmup', 'activation', 'mini', 'drop'] as const) {
      expect(offeredCount(row(k), undefined, 'weight-reps', 8)).toBe('');
    }
    expect(offeredCount(row('working'), undefined, 'weight-reps', undefined)).toBe('');
  });

  it('a timed row offers last time\'s seconds, never a rep target', () => {
    expect(offeredCount({ kind: 'working', ...blank }, { kind: 'working', durationSec: 40 }, 'time', 8)).toBe('40');
    expect(offeredCount({ kind: 'working', ...blank }, undefined, 'time', 8)).toBe('');
  });
});

describe('clusterParts / setCountText — a cluster is one, not three (E-N2)', () => {
  const myo = [
    { kind: 'activation' as const, group: 1 }, { kind: 'mini' as const, group: 1 }, { kind: 'mini' as const, group: 1 },
  ];
  it('counts rows outside a cluster as sets and each cluster once', () => {
    expect(clusterParts(myo)).toEqual({ sets: 0, clusters: 1 });
    expect(clusterParts([{ kind: 'warmup' }, ...myo, { kind: 'activation', group: 2 }, { kind: 'mini', group: 2 }]))
      .toEqual({ sets: 1, clusters: 2 });
    expect(clusterParts([{ kind: 'working' }, { kind: 'working' }])).toEqual({ sets: 2, clusters: 0 });
  });

  it("a rest-pause block's continuations belong to it", () => {
    expect(clusterParts([{ kind: 'activation', group: 1 }, { kind: 'continuation' }, { kind: 'continuation' }]))
      .toEqual({ sets: 0, clusters: 1 });
  });

  it('says it in words, with real plurals', () => {
    expect(setCountText(tEn, 'en', myo)).toBe('1 cluster');
    expect(setCountText(tEn, 'en', [{ kind: 'working' }, { kind: 'working' }, { kind: 'working' }])).toBe('3 sets');
    expect(setCountText(tEn, 'en', [{ kind: 'warmup' }, ...myo, { kind: 'activation', group: 2 }])).toBe('1 set + 2 clusters');
    expect(setCountText(tFor(esPR as Record<string, string>), 'es-PR', [...myo, { kind: 'activation', group: 2 }])).toBe('2 clústeres');
  });
});

describe('cardSummary (E-N1, E-N2)', () => {
  const card = (sets: ReturnType<typeof row>[], targetLoad = '170') => ({ logStyle: 'weight-reps' as const, targetLoad, sets });

  it('reads the offered counts, so a card the session will run as 3 × 8 says so', () => {
    const c = card([row('working'), row('working'), row('working')]);
    expect(cardSummary(c, ['8', '8', '8'], tEn, 'en', 'lb')).toBe('3 × 8 · 170 lb');
    expect(cardSummary(c, ['8', '', '8'], tEn, 'en', 'lb')).toBe('3 sets · 170 lb');
  });

  it('a myo-reps card is "1 cluster", never "3 sets"', () => {
    const c = card([row('activation', '', { group: 1 }), row('mini', '', { group: 1 }), row('mini', '', { group: 1 })], '190');
    expect(cardSummary(c, ['12', '4', '4'], tEn, 'en', 'lb')).toBe('1 cluster · 190 lb');
  });
});

describe('kindsForPicker — the declared structure\'s kinds first (E-N6)', () => {
  const kinds = ['warmup', 'working', 'activation', 'mini', 'drop', 'continuation', 'mobility'].map((value) => ({ value: value as SetKind }));
  const order = (s: Parameters<typeof kindsForPicker>[1]) =>
    kindsForPicker(kinds, s).map((k) => `${k.kind.value}${k.fits ? '' : '*'}`);

  it('myo-reps leads with its own and marks the rest, hiding none', () => {
    expect(order('myoreps')).toEqual(['warmup', 'activation', 'mini', 'working*', 'drop*', 'continuation*', 'mobility*']);
  });

  it('rest-pause, straight, drop', () => {
    expect(order('rest-pause')).toEqual(['warmup', 'activation', 'continuation', 'working*', 'mini*', 'drop*', 'mobility*']);
    expect(order('straight')).toEqual(['warmup', 'working', 'activation*', 'mini*', 'drop*', 'continuation*', 'mobility*']);
    expect(order('drop')).toEqual(['warmup', 'working', 'drop', 'activation*', 'mini*', 'continuation*', 'mobility*']);
  });

  it('undeclared offers everything in the usual order (ADR-0041)', () => {
    expect(order(undefined)).toEqual(['warmup', 'working', 'activation', 'mini', 'drop', 'continuation', 'mobility']);
  });
});
