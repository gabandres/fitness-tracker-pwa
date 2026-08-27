import React from 'react';
import { fireEvent, renderWithProviders as render } from '@/test-utils';
import type { WorkoutTemplate } from '@/lib/workout';

/**
 * ADR-0028's dose note, at the WIRING level.
 *
 * The predicate itself is unit-tested in `packages/core/src/mobility.test.ts`.
 * What this covers is the one seam a pure test cannot: the editor holds its
 * sets as DRAFT rows with string buffers (`durationText`), not as
 * `PlannedSet`s, so the mapping has to parse the buffer back. Reading
 * `durationSec` off a draft row yields `undefined` for every set, the
 * guardrail then finds nothing, and the note silently never appears — green
 * everywhere, invisible in the app.
 */

const mockTemplate: WorkoutTemplate = {
  id: 't9',
  name: 'Pre-lift flow',
  exercises: [
    {
      exerciseId: 'm1',
      name: 'Couch Stretch',
      logStyle: 'time',
      // 90 s, before any working exercise — over the 60 s ceiling.
      plannedSets: [{ kind: 'mobility', durationSec: 90 }],
    },
    {
      exerciseId: 'm2',
      name: 'Open Book',
      logStyle: 'time',
      // 45 s is under the ceiling and must NOT be flagged.
      plannedSets: [{ kind: 'mobility', durationSec: 45 }],
    },
    {
      exerciseId: 'e1',
      name: 'Back Squat',
      logStyle: 'weight-reps',
      plannedSets: [{ kind: 'working' }],
    },
    {
      exerciseId: 'm3',
      name: 'Hip Flow',
      logStyle: 'time',
      // POST position — unguarded however long, because the strength-deficit
      // finding is about what a stretch does to the lifting that follows it.
      plannedSets: [{ kind: 'mobility', durationSec: 300 }],
    },
  ],
  createdAt: new Date('2026-08-27T00:00:00Z'),
  updatedAt: new Date('2026-08-27T00:00:00Z'),
};

jest.mock('@/hooks/useTrain', () => ({
  useTrain: () => ({
    loading: false,
    error: null,
    catalog: [],
    templates: [mockTemplate],
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
jest.mock('@/lib/haptics', () => ({ tap: jest.fn(), success: jest.fn(), warn: jest.fn() }));
jest.mock('@/hooks/useRestTimer', () => ({
  useRestTimer: () => ({ remaining: 0, running: false, start: jest.fn(), stop: jest.fn() }),
}));

import TrainScreen from '@/app/(app)/train';
import { en } from '@/i18n/en';
import { esPR } from '@/i18n/es-PR';
import { ptBR } from '@/i18n/pt-BR';

it('notes the dose only on the pre-lift hold that exceeds the ceiling', async () => {
  const { getByTestId, queryByTestId } = await render(<TrainScreen />);
  await fireEvent.press(getByTestId('edit-template-t9'));

  expect(getByTestId('template-dose-note-0')).toBeTruthy();   // 90 s, pre
  expect(queryByTestId('template-dose-note-1')).toBeNull();   // 45 s, pre
  expect(queryByTestId('template-dose-note-2')).toBeNull();   // the lift
  expect(queryByTestId('template-dose-note-3')).toBeNull();   // 300 s, POST
});

it('cites the evidence and makes no claim about soreness or recovery', () => {
  // ADR-0028 decision 6 is a copy decision, not a tone preference: the
  // Cochrane review (n=2,377 in one trial) tests the soreness claim and
  // rejects it. This asserts the shipped English string, so a well-meaning
  // rewrite has to fail a test rather than pass review.
  for (const dict of [en, esPR, ptBR] as Record<string, string>[]) {
    const note = dict['train.mobilityDoseNote'];
    expect(note).toBeTruthy();
    // It cites the dose finding...
    expect(note).toMatch(/60/);
    // ...and claims none of the three things the evidence does not support,
    // in any of the three languages.
    expect(note).not.toMatch(/soreness|recover|injur|dolor|lesi[oó]n|recupera|dor |les[aã]o/i);
  }
});
