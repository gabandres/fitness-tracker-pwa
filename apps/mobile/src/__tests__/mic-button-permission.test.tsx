import React from 'react';
import { AppState } from 'react-native';
import { act, fireEvent, renderWithProviders as render } from '@/test-utils';

/**
 * Audit 2026-10-15 #8:
 * - any non-grant latched the mic into "Enable in Settings" for good, even an
 *   Android "Deny" the OS will still ask again about, and even after the user
 *   came back from Settings with it turned on;
 * - a recogniser that heard nothing ("no-speech") said "couldn't start
 *   listening", which blames the mic for silence.
 */
jest.mock('@/lib/auth', () => ({ useAuth: () => ({ user: { uid: 'u1' }, profile: null }) }));
const mockRequest = jest.fn();
const mockGet = jest.fn();
jest.mock('@/lib/speech', () => ({
  isSpeechAvailable: () => true,
  requestSpeechPermission: () => mockRequest(),
  getSpeechPermission: () => mockGet(),
  speechConfigFor: async () => ({ lang: 'en-US', onDevice: false }),
  startListening: jest.fn(),
  stopListening: jest.fn(),
}));
const listeners: Record<string, (ev?: unknown) => void> = {};
jest.mock('expo-speech-recognition', () => ({
  ExpoSpeechRecognitionModule: {
    addListener: (name: string, cb: (ev?: unknown) => void) => {
      listeners[name] = cb;
      return { remove: () => {} };
    },
  },
}));

import { MicButton } from '@/components/MicButton';

let appStateCb: ((s: string) => void) | null = null;
beforeEach(() => {
  mockRequest.mockReset();
  mockGet.mockReset();
  jest.spyOn(AppState, 'addEventListener').mockImplementation((_e, cb) => {
    appStateCb = cb as (s: string) => void;
    return { remove: () => {} } as never;
  });
});

it('a denial the OS can still ask about leaves the mic a mic', async () => {
  mockRequest.mockResolvedValue('denied');
  const view = await render(<MicButton onSearch={jest.fn()} onMeal={jest.fn()} />);
  await act(async () => { fireEvent.press(view.getByTestId('mic-toggle')); });
  expect(view.queryByTestId('mic-denied')).toBeNull();
  expect(view.getByTestId('mic-toggle')).toBeTruthy();
});

it('a blocked mic points at Settings, and comes back once Settings turned it on', async () => {
  mockRequest.mockResolvedValue('blocked');
  const view = await render(<MicButton onSearch={jest.fn()} onMeal={jest.fn()} />);
  await act(async () => { fireEvent.press(view.getByTestId('mic-toggle')); });
  expect(view.getByTestId('mic-denied')).toBeTruthy();
  mockGet.mockResolvedValue('granted');
  await act(async () => { appStateCb?.('active'); });
  expect(view.queryByTestId('mic-denied')).toBeNull();
});

it('hearing nothing is a quiet stop, not "couldn\'t start listening"', async () => {
  const onFailed = jest.fn();
  await render(<MicButton onSearch={jest.fn()} onMeal={jest.fn()} onFailedChange={onFailed} />);
  await act(async () => { listeners.error?.({ error: 'no-speech' }); });
  expect(onFailed).not.toHaveBeenCalledWith(true);
  await act(async () => { listeners.error?.({ error: 'network' }); });
  expect(onFailed).toHaveBeenLastCalledWith(true);
});
