/**
 * Minimal Server-Sent Events frame parser shared by both frontends. The AI
 * coach streams from the `consultationStream` Cloud Function as SSE; the web
 * app reads it via `fetch` + a ReadableStream reader, the Expo app via an
 * incremental `XMLHttpRequest`. Both accumulate bytes into a string buffer and
 * hand it here to split off complete frames — so the wire format is parsed in
 * exactly one place. Pure and dependency-free.
 *
 * A frame is the text between blank lines; within it, `event:` and `data:`
 * lines carry the type and payload (our payloads are single-line JSON).
 */
export interface SseEvent {
  /** The `event:` field, defaulting to `"message"` when omitted (SSE spec). */
  event: string;
  /** The concatenated `data:` field(s), trimmed. */
  data: string;
}

/**
 * Split `buffer` into complete SSE frames. Returns the parsed `events` and the
 * `rest` (an unterminated trailing frame not yet followed by a blank line) —
 * feed `rest` back in prepended to the next chunk. Handles both `\n\n` and
 * `\r\n\r\n` frame delimiters. Empty/whitespace-only frames are dropped.
 */
export function parseSseFrames(buffer: string): { events: SseEvent[]; rest: string } {
  const events: SseEvent[] = [];
  // Normalise CRLF so a single delimiter search covers both wire styles.
  let rest = buffer.replace(/\r\n/g, '\n');
  let sep: number;
  while ((sep = rest.indexOf('\n\n')) !== -1) {
    const frame = rest.slice(0, sep);
    rest = rest.slice(sep + 2);
    if (!frame.trim()) continue;
    let event = 'message';
    let data = '';
    for (const line of frame.split('\n')) {
      if (line.startsWith('event:')) event = line.slice(6).trim();
      else if (line.startsWith('data:')) data += line.slice(5).trim();
    }
    events.push({ event, data });
  }
  return { events, rest };
}
