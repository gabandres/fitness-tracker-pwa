import { FieldValue, type Firestore } from "firebase-admin/firestore";

/**
 * Per-day AI usage ledger — the token counts every Gemini call returns in
 * `usageMetadata`, kept instead of logged-and-forgotten.
 *
 *     aiUsage/{YYYY-MM-DD}
 *       kinds.{photo|consultation|weeklyReport}.{calls,promptTokens,outputTokens,thoughtTokens,images}
 *       models.{model}.{calls,promptTokens,outputTokens,thoughtTokens}
 *
 * Written with `FieldValue.increment` under `set(..., { merge: true })`, so a
 * day costs a handful of writes however busy it is, and a lost write loses one
 * call's tokens rather than the day. Read only by the admin console's Cost
 * page (`cost-model.ts`); there is no client rule for this collection.
 *
 * Why it exists: `analyze-photo.ts` documents two costing mistakes that came
 * from reading `usageMetadata` once by hand and throwing it away. With the
 * numbers kept per day, the cost of a scan or a coach call is a division,
 * not a benchmark.
 */

export type AiUsageKind = "photo" | "consultation" | "weeklyReport";

export interface AiUsageSample {
  kind: AiUsageKind;
  model: string;
  promptTokens?: number;
  outputTokens?: number;
  thoughtTokens?: number;
  images?: number;
}

export interface UsageMetadataLike {
  promptTokenCount?: number;
  candidatesTokenCount?: number;
  thoughtsTokenCount?: number;
}

function dayKey(d = new Date()): string {
  return d.toISOString().slice(0, 10);
}

/** Model ids carry dots; Firestore field paths cannot. */
function modelField(model: string): string {
  return model.replace(/[.~*/[\]]/g, "_");
}

/**
 * Fire-and-forget. Never throws — a failed ledger write must not fail the
 * call that already cost the tokens.
 */
export function recordAiUsage(db: Firestore, sample: AiUsageSample): Promise<void> {
  const { kind, model } = sample;
  const p = Math.max(0, Math.floor(sample.promptTokens ?? 0));
  const o = Math.max(0, Math.floor(sample.outputTokens ?? 0));
  const t = Math.max(0, Math.floor(sample.thoughtTokens ?? 0));
  const img = Math.max(0, Math.floor(sample.images ?? 0));
  const m = modelField(model);
  const inc = FieldValue.increment;
  const patch: Record<string, unknown> = {
    day: dayKey(),
    updatedAt: FieldValue.serverTimestamp(),
    [`kinds.${kind}.calls`]: inc(1),
    [`kinds.${kind}.promptTokens`]: inc(p),
    [`kinds.${kind}.outputTokens`]: inc(o),
    [`kinds.${kind}.thoughtTokens`]: inc(t),
    [`kinds.${kind}.images`]: inc(img),
    [`models.${m}.calls`]: inc(1),
    [`models.${m}.promptTokens`]: inc(p),
    [`models.${m}.outputTokens`]: inc(o),
    [`models.${m}.thoughtTokens`]: inc(t),
    [`models.${m}.id`]: model,
  };
  return db
    .collection("aiUsage")
    .doc(dayKey())
    .set(patch, { merge: true })
    .then(() => undefined)
    .catch((err) => {
      console.error(`aiUsage: record(${kind}, ${model}) failed; tokens not ledgered`, err);
    });
}

/** Convenience for the `usageMetadata` object `@google/genai` returns. */
export function usageFromMetadata(u: UsageMetadataLike | undefined | null): Pick<AiUsageSample, "promptTokens" | "outputTokens" | "thoughtTokens"> {
  return {
    promptTokens: u?.promptTokenCount ?? 0,
    outputTokens: u?.candidatesTokenCount ?? 0,
    thoughtTokens: u?.thoughtsTokenCount ?? 0,
  };
}
