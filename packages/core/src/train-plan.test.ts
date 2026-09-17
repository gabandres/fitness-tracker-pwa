import { describe, it, expect } from 'vitest';
import {
  addActionsFor,
  isPristineScaffold,
  nextTemplateUp,
  previousCell,
  previousSets,
  scaffoldKindsFor,
  templateLastPerformed,
} from './train-plan';
import type { WorkoutSession, WorkoutSet, WorkoutTemplate } from './workout';

const day = (n: number) => new Date(2026, 8, n);
const NOW = day(16).getTime();

const tpl = (id: string, name = id): WorkoutTemplate =>
  ({ id, name, exercises: [], createdAt: day(1), updatedAt: day(1) }) as unknown as WorkoutTemplate;

const session = (
  templateId: string | undefined,
  date: Date,
  status: 'completed' | 'active' = 'completed',
): WorkoutSession =>
  ({ id: `s-${templateId}-${date.getTime()}`, date, status, templateId, exercises: [] }) as unknown as WorkoutSession;

const set = (s: Partial<WorkoutSet>): WorkoutSet => ({ kind: 'working', ...s }) as WorkoutSet;

describe('templateLastPerformed', () => {
  it('keeps the newest completed date per template', () => {
    const out = templateLastPerformed([
      session('a', day(10)),
      session('a', day(14)),
      session('b', day(12)),
    ]);
    expect(out.a).toEqual(day(14));
    expect(out.b).toEqual(day(12));
  });

  it('ignores sessions that are not completed', () => {
    // An abandoned session is not evidence the day was trained; counting it
    // would push its template to the back of the rotation for a workout that
    // never happened.
    expect(templateLastPerformed([session('a', day(14), 'active')])).toEqual({});
  });

  it('ignores ad-hoc sessions with no template', () => {
    expect(templateLastPerformed([session(undefined, day(14))])).toEqual({});
  });
});

describe('nextTemplateUp', () => {
  it('returns null when there are no templates', () => {
    expect(nextTemplateUp([], [], NOW)).toBeNull();
  });

  it('offers the least recently performed', () => {
    const next = nextTemplateUp(
      [tpl('a'), tpl('b'), tpl('c')],
      [session('a', day(14)), session('b', day(9)), session('c', day(12))],
      NOW,
    );
    expect(next?.template.id).toBe('b');
    expect(next?.daysAgo).toBe(7);
  });

  it('puts a never-performed template first, whatever the others did', () => {
    const next = nextTemplateUp(
      [tpl('a'), tpl('new'), tpl('c')],
      [session('a', day(1)), session('c', day(2))],
      NOW,
    );
    expect(next?.template.id).toBe('new');
    expect(next?.lastPerformed).toBeNull();
    expect(next?.daysAgo).toBeNull();
  });

  it('produces the rotation for a plain A/B/C split', () => {
    // A on Mon, B on Wed, C on Fri → A is next, and once A is logged, B is.
    const templates = [tpl('a'), tpl('b'), tpl('c')];
    const logged = [session('a', day(7)), session('b', day(9)), session('c', day(11))];
    expect(nextTemplateUp(templates, logged, NOW)?.template.id).toBe('a');
    expect(
      nextTemplateUp(templates, [...logged, session('a', day(14))], NOW)?.template.id,
    ).toBe('b');
  });

  it('breaks a tie on the template list order, so a cold account is deterministic', () => {
    expect(nextTemplateUp([tpl('a'), tpl('b')], [], NOW)?.template.id).toBe('a');
    expect(nextTemplateUp([tpl('b'), tpl('a')], [], NOW)?.template.id).toBe('b');
  });

  it('is stable when the template list reorders, unlike next-after-last', () => {
    const logged = [session('a', day(14)), session('b', day(9))];
    expect(nextTemplateUp([tpl('a'), tpl('b')], logged, NOW)?.template.id).toBe('b');
    expect(nextTemplateUp([tpl('b'), tpl('a')], logged, NOW)?.template.id).toBe('b');
  });
});

describe('previousSets', () => {
  it('returns the newest entry that actually has logged numbers', () => {
    const empty = { sets: [set({}), set({})] };
    const real = { sets: [set({ weight: 135, reps: 8 })] };
    expect(previousSets([empty, real])).toBe(real.sets);
  });

  it('returns nothing when the exercise has never been logged', () => {
    expect(previousSets([])).toEqual([]);
    expect(previousSets([{ sets: [set({ weight: 135 })] }])).toEqual([]);
  });

  it('counts a timed hold as a performance', () => {
    const held = { sets: [set({ kind: 'mobility', durationSec: 45 })] };
    expect(previousSets([held])).toBe(held.sets);
  });
});

describe('previousCell', () => {
  it('formats by log style', () => {
    expect(previousCell(set({ weight: 135, reps: 8 }), 'weight-reps')).toBe('135×8');
    expect(previousCell(set({ reps: 12 }), 'bodyweight')).toBe('12');
    expect(previousCell(set({ durationSec: 45 }), 'time')).toBe('45s');
  });

  it('converts the load into the training unit', () => {
    expect(previousCell(set({ weight: 220.5, reps: 5 }), 'weight-reps', 'metric')).toBe('100×5');
  });

  it('is null past the end of last session, and for a set with nothing in it', () => {
    expect(previousCell(undefined, 'weight-reps')).toBeNull();
    expect(previousCell(set({}), 'weight-reps')).toBeNull();
    expect(previousCell(set({ reps: 8 }), 'time')).toBeNull();
  });

  it('shows reps alone when a weight-reps set was logged without a load', () => {
    expect(previousCell(set({ reps: 8 }), 'weight-reps')).toBe('8');
  });
});

describe('scaffoldKindsFor — ADR-0040', () => {
  it('scaffolds each readable structure as its own shape', () => {
    expect(scaffoldKindsFor('straight')).toEqual(['working', 'working', 'working']);
    expect(scaffoldKindsFor('myoreps')).toEqual(['activation', 'mini', 'mini']);
    expect(scaffoldKindsFor('rest-pause')).toEqual(['activation', 'continuation']);
    expect(scaffoldKindsFor('cluster')).toEqual(['activation', 'continuation', 'continuation']);
    expect(scaffoldKindsFor('hit')).toEqual(['working']);
  });

  it('gives Auto no scaffold — it states nothing, so it states nothing in sets', () => {
    expect(scaffoldKindsFor(undefined)).toEqual([]);
  });

  it('never scaffolds an unread structure into activation sets', () => {
    // `drop` and `superset` are declared-but-unread. Scaffolding them as
    // activation+continuation would make the app look like it expresses a
    // structure whose engine refuses to read it.
    expect(scaffoldKindsFor('drop')).not.toContain('activation');
    expect(scaffoldKindsFor('superset')).not.toContain('activation');
  });
});

describe('addActionsFor', () => {
  it('offers only the buttons the structure can use', () => {
    expect(addActionsFor('straight')).toEqual({ set: true, cluster: false, block: false });
    expect(addActionsFor('myoreps')).toEqual({ set: true, cluster: true, block: false });
    expect(addActionsFor('rest-pause')).toEqual({ set: true, cluster: false, block: true });
    expect(addActionsFor('cluster')).toEqual({ set: true, cluster: false, block: true });
  });

  it('keeps every affordance for an undeclared template', () => {
    // Legacy templates predate the field and must keep the editor they were
    // written with.
    expect(addActionsFor(undefined)).toEqual({ set: true, cluster: true, block: true });
  });
});

describe('isPristineScaffold', () => {
  it('is true for rows the previous structure choice put there', () => {
    expect(isPristineScaffold([{}, {}, {}])).toBe(true);
    expect(isPristineScaffold([])).toBe(true);
  });

  it('is false the moment any number has been typed', () => {
    expect(isPristineScaffold([{}, { reps: 8 }])).toBe(false);
    expect(isPristineScaffold([{ weight: 135 }])).toBe(false);
    expect(isPristineScaffold([{ durationSec: 45 }])).toBe(false);
  });
});
