import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { isExpoPushToken } from "../src/announce-ota";

const src = (f: string) =>
  readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), `../src/${f}`), "utf8");

describe("Expo push tokens are validated before chunking", () => {
  it("accepts both spellings, rejects everything else", () => {
    expect(isExpoPushToken("ExponentPushToken[xxxxxxxxxxxxxxxxxxxxxx]")).toBe(true);
    expect(isExpoPushToken("ExpoPushToken[abc-DEF_123]")).toBe(true);
    for (const bad of ["", "ExponentPushToken[]", "https://evil/hook", "ExponentPushToken[a b]", 42, null]) {
      expect(isExpoPushToken(bad)).toBe(false);
    }
  });
});

describe("mail goes to the Auth record, never the client-writable profile email", () => {
  it("weekly digest, welcome and day-1 nudge read no profile `email`", () => {
    for (const f of ["weekly-digest.ts", "user-lifecycle.ts", "day1-nudge.ts"]) {
      const s = src(f);
      expect(s, f).not.toMatch(/data\["email"\]/);
      expect(s, f).not.toMatch(/after\.email/);
    }
  });
});

describe("password reset keys its IP budget on the trusted hop", () => {
  it("uses clientIp, not the spoofable rawRequest.ip", () => {
    const s = src("password-reset.ts");
    expect(s).toMatch(/clientIp\(request\.rawRequest\?\.headers\?\.\["x-forwarded-for"\]/);
    expect(s).not.toMatch(/const ip = request\.rawRequest\?\.ip \|\|/);
  });
});
