/**
 * The receipt's Undo ("Logged Oatmeal · Undo") does not go through
 * `useLogWrites.deleteEntry` — it calls `undoAdds`. So the Health half of an
 * undo lives there too, and this pins it: every undone id's tagged samples are
 * removed from Apple Health / Health Connect (audit #22).
 */
const mockForgetNutrition = jest.fn(async (_ids: readonly string[]) => undefined);
const mockDeleteLog = jest.fn(async (_uid: string, _id: string) => undefined);

jest.mock('@/lib/ledger', () => ({
  addLogWithId: jest.fn(),
  deleteLog: (uid: string, id: string) => mockDeleteLog(uid, id),
}));
jest.mock('@/lib/health-sync', () => ({
  exportNutrition: jest.fn(),
  forgetNutrition: (ids: readonly string[]) => mockForgetNutrition(ids),
}));
jest.mock('../../modules/quick-add-tile', () => ({ setTileState: jest.fn() }));
jest.mock('../../modules/quick-add-credentials', () => ({
  setQuickAddCredentials: jest.fn(),
  clearQuickAddCredentials: jest.fn(),
}));
jest.mock('@/lib/widget', () => ({
  APP_GROUP: 'group.test',
  assertWatchSnapshot: jest.fn(),
  readWidgetSnapshot: jest.fn(),
  saveWidgetSnapshot: jest.fn(),
}));
jest.mock('@/lib/firebase', () => ({
  auth: { currentUser: { uid: 'u1' }, onAuthStateChanged: jest.fn() },
  onSessionTokenChanged: jest.fn(),
  NATIVE_REST_CONFIG: { apiKey: 'k', projectId: 'p' },
}));

import { undoAdds } from '@/lib/pending-logs';

it('takes every undone meal back out of Health, as well as out of the ledger', async () => {
  await undoAdds('u1', ['a', 'b']);
  expect(mockForgetNutrition).toHaveBeenCalledWith(['a', 'b']);
  expect(mockDeleteLog).toHaveBeenCalledWith('u1', 'a');
  expect(mockDeleteLog).toHaveBeenCalledWith('u1', 'b');
});
