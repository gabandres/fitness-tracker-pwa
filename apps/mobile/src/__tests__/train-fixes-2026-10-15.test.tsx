/**
 * The owner's 2026-10-15 status check, the parts a screen owns:
 * bug B (the Zone 2 RPE hint) and bug D (the two per-lift rests, editable).
 */
import React from 'react';
import { renderWithProviders as render } from '@/test-utils';
import { CardioBlockCard } from '@/components/train/CardioBlockCard';
import { withShownRests } from '@/components/train/TemplateEditorModal';

jest.mock('@/lib/auth', () => ({ useAuth: () => ({ user: { uid: 'u1' }, profile: null }) }));

const noop = () => {};

describe('bug B — the RPE box on a Zone 2 block', () => {
  const card = (label: string) => render(
    <CardioBlockCard block={{ modality: 'walk', label, durationSec: 1200, source: 'manual' }} index={0} onPatch={noop} onCommit={noop} onRemove={noop} />,
  );

  it('is blank, and its hint says what Zone 2 feels like', async () => {
    const ui = await card('Zone 2');
    expect(ui.getByTestId('cardio-rpe-0').props.defaultValue).toBe('');
    expect(ui.getByTestId('cardio-rpe-0').props.placeholder).toBe('Zone 2 ≈ 2–4');
  });

  it('any other block keeps the whole scale as its hint', async () => {
    const ui = await card('Intervals');
    expect(ui.getByTestId('cardio-rpe-0').props.placeholder).toBe('1 easy · 10 all-out');
  });
});

describe('bug D — the editor writes the two per-lift rests as shown', () => {
  const row = { exerciseId: 's', name: 'Smith squat', plannedSets: [], restClusterSec: 90, restAfterSec: 105, restAfterMaxSec: 120 };
  const shown = (over: object) => ({ restClusterSec: '90', restAfterSec: '105', restAfterOpened: '105', restAfterMaxSec: 120, ...over });

  it('a typed cluster rest is written (Smith squat 105 s)', () => {
    expect(withShownRests(row as never, shown({ restClusterSec: '105' })).restClusterSec).toBe(105);
  });

  it('an untouched rest-to-next keeps its range; a new number replaces it', () => {
    expect(withShownRests(row as never, shown({}))).toMatchObject({ restAfterSec: 105, restAfterMaxSec: 120 });
    const changed = withShownRests(row as never, shown({ restAfterSec: '60' }));
    expect(changed.restAfterSec).toBe(60);
    expect('restAfterMaxSec' in changed).toBe(false);
  });

  it('a cleared field is removed — the old value does not come back', () => {
    const out = withShownRests(row as never, shown({ restClusterSec: '', restAfterSec: '' }));
    expect('restClusterSec' in out).toBe(false);
    expect('restAfterSec' in out).toBe(false);
    expect('restAfterMaxSec' in out).toBe(false);
  });
});
