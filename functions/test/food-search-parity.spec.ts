import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The `searchFoods` / `getFoodDetail` wire contract must be one contract.
 *
 * `functions/` is not a workspace and cannot import the un-built
 * `@macrolog/core` (ADR-0012), so `FoodDbSource`, `FoodSearchHit`,
 * `ServingOption` and `FoodDetail` are declared TWICE by hand — client side in
 * `packages/core/src/food-search.ts`, server side in
 * `functions/src/food-search.ts`. Both headers say "keep the two byte-for-byte
 * in sync"; nothing held them to it. This is that holder, and it is the third
 * of its kind here (`food-plausibility-parity`, `locales-parity`).
 *
 * The drift is invisible everywhere else. Both files compile. Both frontends
 * typecheck against core, the functions typecheck against their own copy, and
 * neither compiler can see the other's. The first symptom is a user's phone
 * reading a field the server stopped sending, or ignoring one it started
 * sending — at runtime, in production, with no error anywhere.
 *
 * WHAT PARITY MEANS HERE, and why:
 *
 * Normalized DECLARATION TEXT — comments, the `export` modifier and whitespace
 * stripped, member separators and quote style normalized — compared per type.
 * The two other candidates were weighed and rejected:
 *
 *   - Compile-time assignability (`expectTypeOf`, a `satisfies` pair, an
 *     `Equals<A, B>` conditional). The honest problem is that NOTHING WOULD RUN
 *     IT. `functions/tsconfig.json` includes `src/**\/*` only, so
 *     `npm run build` never sees this file, and vitest strips types unless run
 *     with `--typecheck`, which this package's `test` script does not pass. A
 *     type assertion here would be decorative — green forever, including while
 *     drifting. Bidirectional assignability is also blind to exactly the drift
 *     that matters most: an extra OPTIONAL field on one side is assignable in
 *     both directions, so `servings?: ServingOption[]` could exist on one side
 *     alone and pass.
 *   - A fixture round-trip. It can only exercise fields a fixture names, so it
 *     proves nothing about the field a drifting edit ADDS — the actual failure
 *     mode — and it would need the callables, hence the emulator.
 *
 * Text comparison catches the whole class at once: an added, removed, renamed
 * or retyped field, a flipped `?`, a widened or narrowed union. It also matches
 * the precedent set by `gdpr-collection-parity.spec.ts`, which is deliberately
 * source-level for the same reason: the property being protected is a fact
 * about the code, not about a running Firestore, so it needs no emulator and
 * runs in milliseconds.
 *
 * It is deliberately NOT byte-for-byte on the prose. The doc comments have
 * already diverged (the server's are abridged) and that divergence is harmless
 * — holding prose identical would make this spec fire on every comment edit,
 * and a guard that cries wolf on the happy path is a guard that gets deleted.
 * The shape is what ships; the shape is what is held.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const SERVER_PATH = resolve(HERE, "../src/food-search.ts");
const CLIENT_PATH = resolve(HERE, "../../packages/core/src/food-search.ts");

const SERVER_SRC = readFileSync(SERVER_PATH, "utf8");
const CLIENT_SRC = readFileSync(CLIENT_PATH, "utf8");

/** The four names that ARE the wire contract. */
const CONTRACT = ["FoodDbSource", "FoodSearchHit", "ServingOption", "FoodDetail"] as const;

/**
 * Pull one `type`/`interface` declaration out of a source file, comments and
 * all. Brace-balanced rather than regex-terminated so a nested object type in
 * a member can't end the capture early.
 */
function declarationOf(src: string, name: string): string {
  const head = new RegExp(`(?:export\\s+)?(?:type|interface)\\s+${name}\\b`);
  const start = src.search(head);
  if (start < 0) throw new Error(`no declaration of ${name}`);

  const brace = src.indexOf("{", start);
  const semi = src.indexOf(";", start);
  // `type X = 'a' | 'b';` — no body, ends at the first semicolon.
  if (brace < 0 || (semi >= 0 && semi < brace)) return src.slice(start, semi + 1);

  let depth = 0;
  for (let i = brace; i < src.length; i++) {
    if (src[i] === "{") depth++;
    else if (src[i] === "}" && --depth === 0) return src.slice(start, i + 1);
  }
  throw new Error(`unbalanced declaration of ${name}`);
}

/**
 * Reduce a declaration to its shape: no comments, no `export`, one quote
 * style, one member separator, no incidental whitespace. What survives is
 * exactly what goes over the wire.
 */
function normalize(decl: string): string {
  return decl
    .replace(/\/\*[\s\S]*?\*\//g, " ")   // block + JSDoc comments
    .replace(/\/\/[^\n]*/g, " ")         // line comments
    .replace(/^export\s+/, "")           // an exported type and a local one are the same type
    .replace(/'/g, '"')                  // quote style is not contract
    .replace(/,/g, ";")                  // `;` and `,` members are the same members
    .replace(/\s+/g, " ")
    .replace(/\s*([{}();:|?[\]<>=])\s*/g, "$1")
    .replace(/;(?=[};])/g, "")           // trailing separator before a close brace
    .trim();
}

const normalized = (src: string, name: string) => normalize(declarationOf(src, name));

describe("searchFoods / getFoodDetail wire contract parity", () => {
  it.each(CONTRACT)("declares %s identically on both sides", (name) => {
    expect(
      normalized(SERVER_SRC, name),
      `functions/src/food-search.ts and packages/core/src/food-search.ts disagree on ${name}. ` +
        `These four types are the callable wire contract; changing one side alone ships a ` +
        `shape mismatch to users. Mirror the edit, or change neither.`,
    ).toBe(normalized(CLIENT_SRC, name));
  });

  it("exports all four on both sides, so this spec can keep seeing them", () => {
    // `FoodDbSource`, `ServingOption` and `FoodDetail` were non-exported locals
    // on the server side until this spec needed them visible. Dropping the
    // modifier again would not break the build — it would quietly narrow what
    // is checkable from outside the file.
    for (const name of CONTRACT) {
      for (const [label, src] of [["server", SERVER_SRC], ["client", CLIENT_SRC]] as const) {
        expect(
          declarationOf(src, name).startsWith("export "),
          `${name} is not exported on the ${label} side`,
        ).toBe(true);
      }
    }
  });

  it("keeps each side's header pointing at the other", () => {
    // The mirror is only safe while the next person to edit either file is
    // told the other exists. Both headers carry that note today.
    expect(SERVER_SRC).toContain("packages/core/src/food-search.ts");
    expect(CLIENT_SRC).toContain("functions/src/food-search.ts");
  });

  it("agrees on the db-source union, member for member and in order", () => {
    // Called out separately because this union already drifted once by RENAME
    // (`FoodSource` on the server, `FoodDbSource` in core) — and because a
    // member added on one side alone is the cheapest possible way to ship a
    // hit the other side cannot dispatch on. ADR-0027 added 'menu' to both.
    const members = (src: string) =>
      declarationOf(src, "FoodDbSource")
        .split("=")[1]
        .split("|")
        .map((m) => m.replace(/[;'"\s]/g, ""));

    expect(members(SERVER_SRC)).toEqual(members(CLIENT_SRC));
    expect(members(SERVER_SRC)).toEqual(["fdc", "off", "menu"]);
  });
});
