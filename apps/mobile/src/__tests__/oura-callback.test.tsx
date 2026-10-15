/**
 * The Oura connect flow finishes in the APP (2026-10-15): `ouraCallback` no
 * longer exchanges the code, it forwards it to `ignia://oura/callback`, and the
 * signed-in `completeOuraLink` callable redeems it — refusing a state minted
 * for another account. This pins the client half: the return-URL parser, the
 * one-call-per-state sharing (Android delivers the same return to both the
 * auth session and this route), and the route's outcomes.
 */
import React from 'react';
import { fireEvent, renderWithProviders as render, waitFor } from '@/test-utils';

const mockCalls: unknown[] = [];
let mockRespond: (payload: unknown) => Promise<{ data: unknown }> = async () => ({ data: { ok: true } });
jest.mock('firebase/functions', () => ({
  httpsCallable: (_fns: unknown, name: string) => async (payload: unknown) => {
    mockCalls.push({ name, payload });
    return mockRespond(payload);
  },
}));
jest.mock('firebase/firestore', () => ({ doc: jest.fn(), getDoc: jest.fn(), onSnapshot: jest.fn() }));
jest.mock('@/lib/firebase', () => ({ db: {}, functions: {} }));
jest.mock('@/lib/health-sync', () => ({ partitionImportable: jest.fn(), writeImportedBlocks: jest.fn() }));
jest.mock('@/lib/ledger', () => ({}));
jest.mock('expo-web-browser', () => ({ openAuthSessionAsync: jest.fn() }));

let mockUser: { uid: string } | null = { uid: 'u1' };
jest.mock('@/lib/auth', () => ({ useAuth: () => ({ user: mockUser }) }));

let mockParams: Record<string, string> = {};
const mockBack = jest.fn();
const mockReplace = jest.fn();
jest.mock('expo-router', () => ({
  ...jest.requireActual('expo-router'),
  useLocalSearchParams: () => mockParams,
  useRouter: () => ({ back: mockBack, replace: mockReplace, push: jest.fn(), canGoBack: () => false }),
}));

import { parseOuraReturn, redeemOuraReturn } from '@/lib/oura';
import OuraCallbackRoute from '@/app/oura/callback';

const httpsError = (code: string) => Object.assign(new Error(code), { details: { code } });

let seq = 0;
const freshState = () => `uid.1790000000000.nonce${++seq}ABCDEFGHIJKL.sig`;

beforeEach(() => {
  mockCalls.length = 0;
  mockRespond = async () => ({ data: { ok: true } });
  mockUser = { uid: 'u1' };
  mockParams = {};
  jest.clearAllMocks();
});

describe('parseOuraReturn', () => {
  it('reads code and state, decoding them', () => {
    expect(parseOuraReturn('ignia://oura/callback?code=a%2Bb+c&state=u.1.n.s')).toEqual({
      code: 'a+b c',
      state: 'u.1.n.s',
    });
  });

  it('reads a denial', () => {
    expect(parseOuraReturn('ignia://oura/callback?state=s&error=access_denied')).toEqual({ error: 'access_denied' });
  });

  it('refuses anything without both code and state', () => {
    expect(parseOuraReturn('ignia://oura/callback')).toBeNull();
    expect(parseOuraReturn('ignia://oura/callback?code=x')).toBeNull();
    expect(parseOuraReturn('ignia://oura/callback?state=x')).toBeNull();
    expect(parseOuraReturn(undefined)).toBeNull();
    expect(parseOuraReturn('ignia://oura/callback?code=%E0%A4%A&state=s')).toBeNull();
  });
});

describe('redeemOuraReturn', () => {
  it('calls completeOuraLink once per state, however many paths deliver it', async () => {
    const state = freshState();
    const [a, b] = await Promise.all([
      redeemOuraReturn({ code: 'c', state }),
      redeemOuraReturn({ code: 'c', state }),
    ]);
    expect(a).toBe('linked');
    expect(b).toBe('linked');
    expect(mockCalls).toEqual([{ name: 'completeOuraLink', payload: { code: 'c', state } }]);
  });

  it('maps the server refusals to their own outcomes', async () => {
    mockRespond = async () => { throw httpsError('OURA_LINK_WRONG_ACCOUNT'); };
    expect(await redeemOuraReturn({ code: 'c', state: freshState() })).toBe('wrongAccount');
    mockRespond = async () => { throw httpsError('OURA_LINK_EXPIRED'); };
    expect(await redeemOuraReturn({ code: 'c', state: freshState() })).toBe('expired');
    mockRespond = async () => { throw new Error('network'); };
    expect(await redeemOuraReturn({ code: 'c', state: freshState() })).toBe('failed');
  });

  it('a denial never reaches the server', async () => {
    expect(await redeemOuraReturn({ error: 'access_denied' })).toBe('denied');
    expect(mockCalls).toHaveLength(0);
  });
});

describe('the oura/callback route', () => {
  it('redeems the code for the signed-in user and says it is connected', async () => {
    const state = freshState();
    mockParams = { code: 'c0de', state };
    const ui = await render(<OuraCallbackRoute />);
    await waitFor(() => expect(ui.getByTestId('oura-callback-message')).toBeTruthy());
    expect(ui.getByText('Oura connected.')).toBeTruthy();
    expect(mockCalls).toEqual([{ name: 'completeOuraLink', payload: { code: 'c0de', state } }]);
  });

  it('says so when the link was started from another account', async () => {
    mockRespond = async () => { throw httpsError('OURA_LINK_WRONG_ACCOUNT'); };
    mockParams = { code: 'c0de', state: freshState() };
    const ui = await render(<OuraCallbackRoute />);
    await waitFor(() => expect(ui.getByText(/different Ignia account/)).toBeTruthy());
  });

  it('shows the denial without calling the server', async () => {
    mockParams = { error: 'access_denied', state: freshState() };
    const ui = await render(<OuraCallbackRoute />);
    await waitFor(() => expect(ui.getByText(/you cancelled at Oura/)).toBeTruthy());
    expect(mockCalls).toHaveLength(0);
  });

  it('waits for a real session before redeeming', async () => {
    mockUser = null;
    mockParams = { code: 'c0de', state: freshState() };
    const ui = await render(<OuraCallbackRoute />);
    expect(ui.getByTestId('oura-callback-pending')).toBeTruthy();
    expect(mockCalls).toHaveLength(0);
  });

  it('Done returns to Connected apps when opened cold', async () => {
    mockParams = { code: 'c0de', state: freshState() };
    const ui = await render(<OuraCallbackRoute />);
    await waitFor(() => expect(ui.getByTestId('oura-callback-done')).toBeTruthy());
    fireEvent.press(ui.getByTestId('oura-callback-done'));
    expect(mockReplace).toHaveBeenCalledWith('/connected-apps');
  });
});
