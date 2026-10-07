/**
 * The two progression-configuration writers (2026-10-07).
 *
 * `editExercise` carries the per-lift settings, every one of which has a
 * default the engine falls back to — so "back to the default" must DELETE the
 * field, not store a `null` the rules would reject or a stale value the engine
 * would keep reading. `setTrainingSettings` writes only the keys it is given,
 * and clears the volume gate the same way.
 */
const mockSetDoc = jest.fn();
const mockUpdateDoc = jest.fn();
const mockDeleteDoc = jest.fn();
const mockAddBreadcrumb = jest.fn();

// Hand-built rather than spread over `requireActual`: the real package is ESM
// and jest cannot parse it here. Only the symbols `ledger.ts` imports are
// needed, and only `path` is read off a ref by the code under test.
jest.mock('firebase/firestore', () => ({
  setDoc: (...a: unknown[]) => mockSetDoc(...(a as [])),
  updateDoc: (...a: unknown[]) => mockUpdateDoc(...(a as [])),
  deleteDoc: (...a: unknown[]) => mockDeleteDoc(...(a as [])),
  doc: (...a: unknown[]) => {
    const parts = (a as unknown[]).slice(1).map(String);
    return { path: parts.join('/'), id: parts[parts.length - 1] };
  },
  collection: (...a: unknown[]) => ({ path: (a as unknown[]).slice(1).map(String).join('/') }),
  writeBatch: () => ({ set: jest.fn(), update: jest.fn(), commit: jest.fn() }),
  deleteField: () => ({ __delete: true }),
  documentId: () => '__name__',
  getDoc: jest.fn(),
  getDocs: jest.fn(),
  limit: jest.fn(),
  onSnapshot: jest.fn(),
  orderBy: jest.fn(),
  query: jest.fn(),
  where: jest.fn(),
  // A class, not a plain object: `pruneUndefined` tells a Timestamp apart
  // with `instanceof`, and editExercise prunes.
  Timestamp: class {
    static now() { return { toDate: () => new Date(0) }; }
    static fromDate(d: Date) { return { toDate: () => d }; }
  },
}));

jest.mock('@/lib/sentry', () => ({
  addBreadcrumb: (...a: unknown[]) => mockAddBreadcrumb(...(a as [])),
}));

jest.mock('@/lib/firebase', () => ({ db: {}, auth: {} }));
jest.mock('@/lib/health-sync', () => ({ exportDaily: jest.fn(), exportNutrition: jest.fn() }));

import { editExercise, setTrainingSettings } from '@/lib/ledger';

beforeEach(() => {
  mockUpdateDoc.mockReset();
  mockUpdateDoc.mockResolvedValue(undefined);
});

const lastPatch = () => mockUpdateDoc.mock.calls[0]?.[1] as Record<string, unknown>;
const DELETE = { __delete: true };

describe('editExercise — lift settings', () => {
  it('writes set values and deletes the fields sent as null', async () => {
    await editExercise('u1', 'x1', {
      category: 'isolation',
      repRange: { min: 8, max: 15 },
      availableLoads: null,
      smithBarEffectiveLb: null,
      loadable: true,
      microplates: null,
    });
    expect(mockUpdateDoc.mock.calls[0][0].path).toBe('users/u1/exercises/x1');
    expect(lastPatch()).toEqual({
      category: 'isolation',
      repRange: { min: 8, max: 15 },
      availableLoads: DELETE,
      smithBarEffectiveLb: DELETE,
      loadable: true,
      microplates: DELETE,
    });
  });

  it('still clears the retired rep band, and leaves absent keys alone', async () => {
    await editExercise('u1', 'x1', { targetRepBand: null, category: null });
    expect(lastPatch()).toEqual({ targetRepBand: DELETE, category: DELETE });
  });

  it('prunes undefined rather than sending it', async () => {
    await editExercise('u1', 'x1', { name: 'Row', effortStandard: undefined });
    expect(lastPatch()).toEqual({ name: 'Row' });
  });
});

describe('setTrainingSettings', () => {
  it('writes only the keys it is given', async () => {
    await setTrainingSettings('u1', { trainingPhase: 'bulk' });
    expect(mockUpdateDoc.mock.calls[0][0].path).toBe('users/u1');
    expect(lastPatch()).toEqual({ trainingPhase: 'bulk' });
  });

  it('sets the switch and the gate together', async () => {
    await setTrainingSettings('u1', { autoApplyProgression: false, volumeGateLb: 185 });
    expect(lastPatch()).toEqual({ autoApplyProgression: false, volumeGateLb: 185 });
  });

  it('clears the gate with a field delete', async () => {
    await setTrainingSettings('u1', { volumeGateLb: null });
    expect(lastPatch()).toEqual({ volumeGateLb: DELETE });
  });

  it('writes nothing for an empty patch', async () => {
    await setTrainingSettings('u1', {});
    expect(mockUpdateDoc).not.toHaveBeenCalled();
  });
});
