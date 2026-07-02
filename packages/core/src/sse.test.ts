import { describe, it, expect } from 'vitest';
import { parseSseFrames } from './sse';

describe('parseSseFrames', () => {
  it('parses a data-only frame as a "message" event', () => {
    const { events, rest } = parseSseFrames('data: {"text":"hi"}\n\n');
    expect(events).toEqual([{ event: 'message', data: '{"text":"hi"}' }]);
    expect(rest).toBe('');
  });

  it('parses a typed event frame', () => {
    const { events } = parseSseFrames('event: meta\ndata: {"remaining":2,"limit":3}\n\n');
    expect(events).toEqual([{ event: 'meta', data: '{"remaining":2,"limit":3}' }]);
  });

  it('parses multiple frames in one buffer', () => {
    const { events } = parseSseFrames(
      'event: meta\ndata: {"remaining":2}\n\ndata: {"text":"a"}\n\ndata: {"text":"b"}\n\n',
    );
    expect(events.map((e) => e.event)).toEqual(['meta', 'message', 'message']);
    expect(events[2].data).toBe('{"text":"b"}');
  });

  it('returns an unterminated trailing frame as rest', () => {
    const { events, rest } = parseSseFrames('data: {"text":"done"}\n\ndata: {"text":"par');
    expect(events).toHaveLength(1);
    expect(rest).toBe('data: {"text":"par');
  });

  it('reassembles a frame split across two chunks via rest', () => {
    const first = parseSseFrames('data: {"te');
    expect(first.events).toHaveLength(0);
    const second = parseSseFrames(first.rest + 'xt":"hi"}\n\n');
    expect(second.events).toEqual([{ event: 'message', data: '{"text":"hi"}' }]);
  });

  it('handles CRLF frame delimiters', () => {
    const { events } = parseSseFrames('event: done\r\ndata: {}\r\n\r\n');
    expect(events).toEqual([{ event: 'done', data: '{}' }]);
  });

  it('drops empty/whitespace frames', () => {
    const { events } = parseSseFrames('\n\ndata: {"text":"x"}\n\n');
    expect(events).toHaveLength(1);
  });
});
