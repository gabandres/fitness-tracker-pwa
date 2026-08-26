import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { EXPORT_EXCLUDED, USER_SUBCOLLECTIONS } from "../src/gdpr";

/**
 * Erasure (Art. 17) and portability (Art. 20) must cover the same data.
 *
 * These two obligations were maintained as two hand-written lists and they
 * drifted, in the way hand-mirrored lists always do: `workoutSessions`,
 * `workoutTemplates` and `exercises` were added to the delete path when
 * someone noticed they were being orphaned, and nobody added them to the
 * export path. The result held for months — a user could ask for their data
 * and get everything except their training history, and no test, type or
 * reviewer could see it, because each function reads perfectly well alone.
 *
 * `gdpr.ts` now derives both from `USER_SUBCOLLECTIONS`, so the drift is
 * structurally impossible. This spec guards the property that made that safe:
 * that the constant really is the only list, and that nothing quietly grows a
 * second one beside it.
 *
 * Deliberately source-level. The behaviour it protects is "someone adds a
 * subcollection and forgets", which is a fact about the code, not about a
 * running Firestore — so it needs no emulator and runs in milliseconds.
 */

const SRC = readFileSync(
  resolve(dirname(fileURLToPath(import.meta.url)), "../src/gdpr.ts"),
  "utf8",
);

describe("GDPR erasure/export collection parity", () => {
  it("erases every declared subcollection", () => {
    // The delete path maps over the constant rather than naming collections,
    // which is what makes "every" true by construction.
    expect(SRC).toMatch(
      /USER_SUBCOLLECTIONS\.map\(\(name\) => deleteSubcollection\(userPath, name\)\)/,
    );
  });

  it("exports every declared subcollection except the justified exclusions", () => {
    expect(SRC).toMatch(
      /USER_SUBCOLLECTIONS\.filter\(\(name\) => !EXPORT_EXCLUDED\.has\(name\)\)/,
    );
  });

  it("names no subcollection outside the constant", () => {
    // A literal passed to deleteSubcollection/dumpCollection is a second list
    // being born. Catch it at the first line, not after the next audit.
    const literalDelete = SRC.match(/deleteSubcollection\(\s*userPath\s*,\s*"/g);
    const literalDump = SRC.match(/dumpCollection\(\s*"/g);
    expect(literalDelete, "deleteSubcollection called with a string literal").toBeNull();
    expect(literalDump, "dumpCollection called with a string literal").toBeNull();
  });

  it("keeps the workout trio in both obligations — the specific past bug", () => {
    for (const name of ["workoutSessions", "workoutTemplates", "exercises"]) {
      expect(USER_SUBCOLLECTIONS).toContain(name);
      expect(EXPORT_EXCLUDED.has(name)).toBe(false);
    }
  });

  it("excludes only credential-bearing collections from export", () => {
    // Export exclusions withhold data from a user who asked for it, so the set
    // stays tiny and deliberate. `private` holds the Apple refresh token.
    expect([...EXPORT_EXCLUDED]).toEqual(["private"]);
    for (const name of EXPORT_EXCLUDED) {
      expect(USER_SUBCOLLECTIONS).toContain(name);
    }
  });

  it("declares no duplicates", () => {
    expect(new Set(USER_SUBCOLLECTIONS).size).toBe(USER_SUBCOLLECTIONS.length);
  });

  /**
   * The constant made drift between the two OBLIGATIONS impossible. It did
   * nothing about drift between the constant and the DATABASE, and that is the
   * gap #99 was: `dailyActivity`, `feedback` and `integrations` were defined in
   * `firestore.rules`, written by live code, and named in neither obligation.
   *
   * So this reads the rules file and requires every `users/{uid}` subcollection
   * in it to be declared. It is the check that would have caught #99 on the day
   * each of those collections was added, and it needs no emulator — the
   * property is a fact about two files.
   */
  it("declares every user subcollection that firestore.rules defines", () => {
    const rules = readFileSync(
      resolve(dirname(fileURLToPath(import.meta.url)), "../../firestore.rules"),
      "utf8",
    );
    // Bounded by INDENTATION, not by "everything after `users/{uid}`".
    //
    // The first cut sliced to end of file and reported `publicSlugs` and
    // `usageEvents` as missing. Both are top-level collections that merely sit
    // LOWER in the file — siblings of `users/{uid}`, not children — and adding
    // them to the erasure list would have deleted another user's slug
    // reservation. `match /users/{uid}` is indented four spaces and its
    // children six, so the block ends at the next four-space `match`.
    const lines = rules.split("\n");
    const start = lines.findIndex((l) => l.startsWith("    match /users/{uid}"));
    expect(start, "match /users/{uid} not found at the expected indent").toBeGreaterThan(-1);
    let end = lines.length;
    for (let i = start + 1; i < lines.length; i++) {
      if (/^ {4}match \//.test(lines[i])) {
        end = i;
        break;
      }
    }
    const declared = new Set<string>(USER_SUBCOLLECTIONS);
    const missing: string[] = [];
    for (const line of lines.slice(start + 1, end)) {
      const m = /^ {6}match \/([A-Za-z][A-Za-z0-9_]*)\/\{/.exec(line);
      if (m && !declared.has(m[1])) missing.push(m[1]);
    }
    expect(missing, `not in USER_SUBCOLLECTIONS: ${missing.join(", ")}`).toEqual([]);
  });

  it("keeps the three #99 collections in both obligations", () => {
    // `dailyActivity` and `feedback` are plainly the user's data. `integrations`
    // is the client-readable half of a provider link — status, not credentials;
    // the Oura token lives in `private`, which was always erased. The first
    // reading of #99 said otherwise and briefly export-excluded it.
    for (const name of ["dailyActivity", "feedback", "integrations"]) {
      expect(USER_SUBCOLLECTIONS).toContain(name);
      expect(EXPORT_EXCLUDED.has(name)).toBe(false);
    }
  });
});
