import AsyncStorage from '@react-native-async-storage/async-storage';

/**
 * Which logs this device exported to Health WITH a log-id tag.
 *
 * Tagging started 2026-10-15 (`NutritionExport.logId`). Everything exported
 * before that carries no id, so an edit cannot delete it — and an edit that
 * deleted nothing and then wrote the new values would leave the old meal AND
 * the new one in Health, double-counting the day. So an edit only writes when
 * it knows the old export was tagged: this list says so (on Health Connect,
 * whose delete reports no count, it is the only evidence), or HealthKit's
 * delete reported removing something.
 *
 * A device preference like the connected flag, never user data — it does not
 * go to Firestore. Capped: an edit reaches back days, not years, and the cost
 * of forgetting a very old id is only that its edit leaves Health as it was.
 */
const KEY = 'ignia.health.taggedNutrition';
export const NUTRITION_TAG_CAP = 1000;

/** One tagged export: the log id and the instant its samples were dated at.
 *  The instant is what an edit re-dates the new values to when the edit
 *  itself does not carry a time (Today's editor omits it unless retimed). */
export interface NutritionTag {
  id: string;
  at: number;
}

/** Append `tag` (replacing an older one for the same id, moved to the newest
 *  end), dropping the oldest past `cap`. Pure. */
export function withTag(
  tags: readonly NutritionTag[],
  tag: NutritionTag,
  cap = NUTRITION_TAG_CAP,
): NutritionTag[] {
  const next = tags.filter((t) => t.id !== tag.id);
  next.push(tag);
  return next.length > cap ? next.slice(next.length - cap) : next;
}

const isTag = (x: unknown): x is NutritionTag =>
  !!x && typeof (x as NutritionTag).id === 'string' && Number.isFinite((x as NutritionTag).at);

async function read(): Promise<NutritionTag[]> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter(isTag) : [];
  } catch {
    return [];
  }
}

// One read-modify-write at a time, so two adds in a row cannot each read the
// same list and the second drop the first's id.
let chain: Promise<unknown> = Promise.resolve();
function serial<T>(fn: () => Promise<T>): Promise<T> {
  const run = chain.then(fn, fn);
  chain = run.catch(() => undefined);
  return run;
}

export function markNutritionTagged(id: string, at: Date): Promise<void> {
  return serial(async () => {
    await AsyncStorage.setItem(KEY, JSON.stringify(withTag(await read(), { id, at: at.getTime() })));
  });
}

export function forgetNutritionTags(ids: readonly string[]): Promise<void> {
  return serial(async () => {
    const drop = new Set(ids);
    const list = await read();
    const next = list.filter((t) => !drop.has(t.id));
    if (next.length !== list.length) await AsyncStorage.setItem(KEY, JSON.stringify(next));
  });
}

/** The tag for `id`, or null when this device never exported it tagged. */
export function getNutritionTag(id: string): Promise<NutritionTag | null> {
  return serial(async () => (await read()).find((t) => t.id === id) ?? null);
}
