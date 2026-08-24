import { describe, expect, it, vi } from "vitest";
import { clampDays, collectWorkouts, dateParam } from "../src/oura-workouts";

// The pagination loop and the status handling — no emulator, no secret, no
// network, and no Oura ring.
//
// This is the half of the workout fetch that can be wrong in a way nothing
// else would catch. The parsing lives in `packages/core` and is tested there;
// what is left here is an exit condition owned by a third party, a status code
// that means "reconnect" rather than "retry", and a truncation that must not
// be mistaken for a complete answer. All three are invisible to `tsc` and to
// any test that stops at "it returned something".

const UID = "xFm6lDvP7eSQdayrXqkVuHVRYIM2";
const NOW = Date.UTC(2026, 7, 24, 18, 0, 0); // 2026-08-24T18:00Z

/** A `fetch` that replays a scripted list of responses, and records the URLs
 *  it was asked for so pagination can be asserted rather than assumed. */
function stubFetch(pages: Array<{ status?: number; body?: unknown }>) {
  const urls: string[] = [];
  const impl = vi.fn(async (url: string) => {
    urls.push(url);
    const page = pages[urls.length - 1] ?? { status: 500 };
    const status = page.status ?? 200;
    return {
      status,
      ok: status >= 200 && status < 300,
      json: async () => page.body,
    } as Response;
  });
  return { impl: impl as unknown as Parameters<typeof collectWorkouts>[3], urls };
}

const record = (id: string) => ({ id, activity: "running" });

describe("collectWorkouts", () => {
  it("returns one page and stops when there is no next_token", async () => {
    const { impl, urls } = stubFetch([{ body: { data: [record("a")], next_token: null } }]);
    const out = await collectWorkouts("tok", 14, UID, impl, NOW);

    expect(out).toEqual({ linked: true, data: [record("a")], truncated: false });
    expect(urls).toHaveLength(1);
  });

  it("follows next_token and concatenates the pages in order", async () => {
    const { impl, urls } = stubFetch([
      { body: { data: [record("a")], next_token: "t1" } },
      { body: { data: [record("b")], next_token: "t2" } },
      { body: { data: [record("c")], next_token: "" } },
    ]);
    const out = await collectWorkouts("tok", 14, UID, impl, NOW);

    expect(out.data).toEqual([record("a"), record("b"), record("c")]);
    expect(out.truncated).toBe(false);
    expect(urls[1]).toContain("next_token=t1");
    expect(urls[2]).toContain("next_token=t2");
  });

  it("treats an empty-string next_token as the last page", async () => {
    // The loop's exit condition belongs to Oura. A truthiness bug here spins
    // through the whole page budget against a server answering correctly.
    const { impl, urls } = stubFetch([{ body: { data: [], next_token: "" } }]);
    await collectWorkouts("tok", 14, UID, impl, NOW);
    expect(urls).toHaveLength(1);
  });

  it("stops at the page budget and SAYS it was truncated", async () => {
    // Every page offers another. A silent prefix is indistinguishable from a
    // complete answer, and the user would see a partial history that looks
    // total.
    const forever = Array.from({ length: 20 }, (_, i) => ({
      body: { data: [record(`r${i}`)], next_token: `t${i}` },
    }));
    const { impl, urls } = stubFetch(forever);
    const out = await collectWorkouts("tok", 14, UID, impl, NOW);

    expect(out.truncated).toBe(true);
    expect(urls).toHaveLength(6);
    expect(out.data).toHaveLength(6);
  });

  it.each([401, 403])("reports %i as UNLINKED, not as a failure", async (status) => {
    // Oura rejecting a token we believed was fresh means the grant is gone at
    // their end. The honest UI is "reconnect"; "try again" would loop forever.
    const { impl } = stubFetch([{ status, body: {} }]);
    const out = await collectWorkouts("tok", 14, UID, impl, NOW);
    expect(out).toEqual({ linked: false, data: [], truncated: false });
  });

  it.each([429, 500, 503])("throws on %i, which IS worth retrying", async (status) => {
    // The distinction the two branches exist for: a transient fault must not
    // be reported as a disconnection, or a 30-second Oura blip silently
    // unlinks the user's ring in the UI.
    const { impl } = stubFetch([{ status, body: {} }]);
    await expect(collectWorkouts("tok", 14, UID, impl, NOW)).rejects.toThrow();
  });

  it("survives a page whose data is missing or not an array", async () => {
    const { impl } = stubFetch([
      { body: { next_token: "t1" } },
      { body: { data: "nonsense", next_token: "t2" } },
      { body: { data: [record("a")] } },
    ]);
    const out = await collectWorkouts("tok", 14, UID, impl, NOW);
    expect(out.data).toEqual([record("a")]);
  });

  it("sends a bearer token and never puts it in the URL", async () => {
    const { impl, urls } = stubFetch([{ body: { data: [] } }]);
    await collectWorkouts("super-secret-token", 14, UID, impl, NOW);

    expect(urls[0]).not.toContain("super-secret-token");
    const init = (impl as unknown as ReturnType<typeof vi.fn>).mock.calls[0][1] as RequestInit;
    expect((init.headers as Record<string, string>)["Authorization"]).toBe(
      "Bearer super-secret-token",
    );
  });

  it("asks for tomorrow, not today, as the end of the window", async () => {
    // `end_date` is a calendar day in the user's own timezone as Oura sees it.
    // A workout finished this evening east of UTC already falls on tomorrow's
    // date there, so an `end_date` of today drops today's run — the one the
    // user is most likely to be looking for.
    const { impl, urls } = stubFetch([{ body: { data: [] } }]);
    await collectWorkouts("tok", 14, UID, impl, NOW);

    expect(urls[0]).toContain("start_date=2026-08-10");
    expect(urls[0]).toContain("end_date=2026-08-25");
  });
});

describe("clampDays", () => {
  it("defaults to the health-store path's own window", () => {
    // Both transports must cover the same span, or one quietly sees further
    // than the other and the two disagree about what exists.
    expect(clampDays(undefined)).toBe(14);
    expect(clampDays("not a number")).toBe(14);
    expect(clampDays(null)).toBe(14);
  });

  it("bounds a caller-supplied window", () => {
    expect(clampDays(0)).toBe(1);
    expect(clampDays(-30)).toBe(1);
    expect(clampDays(1000)).toBe(60);
    expect(clampDays(30.9)).toBe(30);
  });
});

describe("dateParam", () => {
  it("formats YYYY-MM-DD in UTC", () => {
    expect(dateParam(Date.UTC(2026, 7, 24, 23, 30))).toBe("2026-08-24");
  });
});
