const mockRequestWeeklyReport = jest.fn(async () => ({ id: 'r1', markdown: '# ok', generatedAt: 0 }));
const mockCallable = jest.fn(async (data: unknown) => ({ data: { id: 'r1', markdown: '# ok', generatedAt: 0, echo: data } }));

jest.mock('@/lib/firebase', () => ({ functions: {} }));
jest.mock('firebase/functions', () => ({ httpsCallable: jest.fn(() => mockCallable) }));
jest.mock('@/lib/auth', () => ({ useAuth: () => ({ user: { uid: 'u1' } }) }));
jest.mock('@/lib/ledger', () => ({
  getLogStats: jest.fn(async () => ({ totalLogs: 100, earliestLogAt: new Date('2026-06-05T00:00:00') })),
  getRecentSessions: jest.fn(async () => []),
  subscribeLatestReport: jest.fn(() => () => {}),
}));
jest.mock('@/i18n', () => ({ useLocale: () => 'pt-BR' }));
jest.mock('@/hooks/useCoach', () => ({
  useCoach: () => ({
    loading: false,
    logs: [{ calories: 1800, protein: 140, date: new Date() }],
    tdee: { source: 'formula', trueTdee: 2400, newDailyTarget: 1900, weightChangeTrend: 0 },
    profile: { heightIn: 68, age: 30, sex: 'male', activityLevel: 'moderate', targetPaceLbsPerWeek: 1, goalWeightLbs: 170 },
    dailyWeights: {},
  }),
}));
jest.mock('@/lib/weeklyReport', () => ({
  ...jest.requireActual('@/lib/weeklyReport'),
  requestWeeklyReport: (...args: unknown[]) => mockRequestWeeklyReport(...(args as [])),
}));

import { act, renderHook } from '@testing-library/react-native';
import {
  buildCoachRequest,
  parseCoachRequest,
  parseWeeklyReportRequest,
  type TdeeResult,
} from '@macrolog/core';
import { streamCoach } from '@/lib/coach';
import { useWeeklyReport } from '@/hooks/useWeeklyReport';

/**
 * The v2 wire shape (2026-10-15). The app used to send the coach and the
 * weekly report a free-text `{ systemInstruction, prompt }`, which made both
 * callables a general Gemini proxy for anyone with an account. It now sends
 * numbers-only context that the server validates and renders itself. These
 * pin what actually leaves the app: the v2 body, and never the legacy keys.
 * The server's validator (`parse*Request`, the same file the server carries)
 * is the judge of "valid".
 */

const tdee: TdeeResult = { source: 'formula', trueTdee: 2400, newDailyTarget: 1900, weightChangeTrend: 0 };

describe('streamCoach', () => {
  const sent: string[] = [];
  class FakeXhr {
    readyState = 0;
    status = 0;
    responseText = '';
    onprogress: (() => void) | null = null;
    onreadystatechange: (() => void) | null = null;
    onerror: (() => void) | null = null;
    open = jest.fn();
    setRequestHeader = jest.fn();
    send(body: string) {
      sent.push(body);
      this.status = 200;
      this.responseText = 'event: meta\ndata: {"remaining":2,"limit":3}\n\ndata: {"text":"Hi"}\n\nevent: done\ndata: {}\n\n';
      this.readyState = 4;
      this.onreadystatechange?.();
    }
  }
  const realXhr = global.XMLHttpRequest;
  beforeAll(() => {
    (global as unknown as { XMLHttpRequest: unknown }).XMLHttpRequest = FakeXhr;
  });
  afterAll(() => {
    global.XMLHttpRequest = realXhr;
  });

  it('POSTs the v2 request verbatim — no system instruction, no prompt', async () => {
    const request = buildCoachRequest({
      logs: [{ calories: 600, protein: 40, date: new Date('2026-06-01T12:00:00') }],
      tdee,
      profile: null,
      locale: 'es-PR',
      question: 'Am I eating enough protein?',
    });
    const chunks: string[] = [];
    await streamCoach({ request, idToken: 't', onChunk: (c) => chunks.push(c) });

    expect(chunks).toEqual(['Hi']);
    const body = JSON.parse(sent[0]) as Record<string, unknown>;
    expect(Object.keys(body).sort()).toEqual(['context', 'locale', 'question', 'v']);
    expect(body).not.toHaveProperty('systemInstruction');
    expect(body).not.toHaveProperty('prompt');
    expect(body.question).toBe('Am I eating enough protein?');
    expect(parseCoachRequest(body)).toEqual({ ok: true, value: request });
  });
});

describe('weekly report', () => {
  it('generate() sends a v2 request the server validator accepts', async () => {
    const hook = await renderHook(() => useWeeklyReport());
    await act(async () => {
      await hook.result.current.generate();
    });

    expect(mockRequestWeeklyReport).toHaveBeenCalledTimes(1);
    const body = JSON.parse(JSON.stringify((mockRequestWeeklyReport.mock.calls[0] as unknown[])[0])) as Record<string, unknown>;
    expect(body).not.toHaveProperty('systemInstruction');
    expect(body).not.toHaveProperty('prompt');
    expect(body.v).toBe(2);
    expect(body.locale).toBe('pt-BR');
    const parsed = parseWeeklyReportRequest(body);
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(parsed.value.context.milestone?.totalLogs).toBe(100);
    expect(hook.result.current.errorCode).toBeNull();
  });

  it('requestWeeklyReport hands the request to the callable unchanged', async () => {
    const { requestWeeklyReport } = jest.requireActual('@/lib/weeklyReport') as typeof import('@/lib/weeklyReport');
    const { buildWeeklyReportRequest } = jest.requireActual('@macrolog/core') as typeof import('@macrolog/core');
    const request = buildWeeklyReportRequest({ logs: [], tdee, profile: null });
    await requestWeeklyReport(request);
    expect(mockCallable).toHaveBeenCalledWith(request);
  });
});
