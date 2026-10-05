import { requireOptionalNativeModule } from 'expo';

/**
 * IntentInbox — what Live Activity buttons and Siri intents left for the app.
 *
 * The writer is `targets/_shared/IntentInbox.swift` (read its header for why
 * these actions are handed to JS instead of finished natively). This is the
 * reader: `take` removes and returns entries of the kinds asked for, `peek`
 * returns them without removing, and `subscribeIntentInbox` rings whenever a
 * writer appended — immediately when the intent ran in this app's process,
 * which a `LiveActivityIntent` always does.
 *
 * Optional native module, like every bridge here: absent on Android, in Expo
 * Go, on web, and in iOS binaries older than the one that introduced it. Every
 * function then resolves to "nothing pending" and the subscription is a no-op.
 */

/** Every kind a writer can post. Keep in step with the `post(...)` calls in
 *  `targets/_shared/LiveActivityIntents.swift` and `AppActionIntents.swift`. */
export type IntentInboxKind = 'rest' | 'fastEnd' | 'fastStart' | 'fastStop' | 'weight';

export type IntentInboxAction =
  /** Rest timer +30 s (`endsAtMs` > 0) or Skip (`endsAtMs` === 0). */
  | { kind: 'rest'; atMs: number; endsAtMs: number }
  /** "End" on the fasting Live Activity. `startedAtMs` names the fast it ended. */
  | { kind: 'fastEnd'; atMs: number; startedAtMs: number; endedAtMs: number }
  /** Siri "Start fast". */
  | { kind: 'fastStart'; atMs: number }
  /** Siri "End fast". */
  | { kind: 'fastStop'; atMs: number }
  /** Siri "Log weight", in the unit the app displays. */
  | { kind: 'weight'; atMs: number; value?: number };

interface IntentInboxNativeModule {
  take(kinds: string[]): Promise<string>;
  peek(kinds: string[]): Promise<string>;
  addListener(event: 'onChange', listener: () => void): { remove(): void };
}

const native = requireOptionalNativeModule<IntentInboxNativeModule>('IntentInbox');

export const isIntentInboxAvailable = native != null;

const num = (v: unknown): number | null =>
  typeof v === 'number' && Number.isFinite(v) ? v : null;

/**
 * The native JSON array → typed actions. Anything malformed is DROPPED rather
 * than guessed at: an entry with no usable instant cannot be safely applied to
 * a fast or a timer, and dropping one costs a tap, not a wrong write.
 *
 * Exported for `src/__tests__/` — the one piece with logic, testable without a
 * device.
 */
export function parseIntentInbox(raw: string): IntentInboxAction[] {
  let list: unknown;
  try {
    list = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(list)) return [];
  const out: IntentInboxAction[] = [];
  for (const e of list) {
    if (!e || typeof e !== 'object') continue;
    const o = e as Record<string, unknown>;
    const atMs = num(o.atMs);
    if (atMs == null || atMs <= 0) continue;
    switch (o.kind) {
      case 'rest': {
        const endsAtMs = num(o.endsAtMs);
        if (endsAtMs != null && endsAtMs >= 0) out.push({ kind: 'rest', atMs, endsAtMs });
        break;
      }
      case 'fastEnd': {
        const startedAtMs = num(o.startedAtMs);
        const endedAtMs = num(o.endedAtMs);
        if (startedAtMs != null && startedAtMs > 0 && endedAtMs != null && endedAtMs > 0) {
          out.push({ kind: 'fastEnd', atMs, startedAtMs, endedAtMs });
        }
        break;
      }
      case 'fastStart':
      case 'fastStop':
        out.push({ kind: o.kind, atMs });
        break;
      case 'weight': {
        const value = num(o.value);
        out.push(value != null && value > 0 ? { kind: 'weight', atMs, value } : { kind: 'weight', atMs });
        break;
      }
      default:
        break;
    }
  }
  return out;
}

/** Remove and return the pending actions of these kinds. Never rejects. */
export async function takeIntentInbox(kinds: readonly IntentInboxKind[]): Promise<IntentInboxAction[]> {
  try {
    const raw = await native?.take([...kinds]);
    return raw ? parseIntentInbox(raw) : [];
  } catch {
    return [];
  }
}

/** The pending actions of these kinds, left in place. Never rejects. */
export async function peekIntentInbox(kinds: readonly IntentInboxKind[]): Promise<IntentInboxAction[]> {
  try {
    const raw = await native?.peek([...kinds]);
    return raw ? parseIntentInbox(raw) : [];
  } catch {
    return [];
  }
}

/**
 * Call `onChange` whenever a writer appends. Returns the unsubscribe.
 *
 * A doorbell only — it carries nothing. The caller drains with `take`, and must
 * ALSO drain on foreground and on mount, because a doorbell rung while the app
 * was suspended or not yet listening is simply lost.
 */
export function subscribeIntentInbox(onChange: () => void): () => void {
  try {
    const sub = native?.addListener('onChange', onChange);
    return () => sub?.remove();
  } catch {
    return () => {};
  }
}
