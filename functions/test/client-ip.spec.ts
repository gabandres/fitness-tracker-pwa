import { describe, expect, it } from "vitest";
import { clientIp } from "../src/client-ip";

// Pure — no emulator. The property under test is "the throttle keys on the
// hop Cloud Run appended, never on a value the client wrote".
describe("clientIp", () => {
  it("uses the LAST forwarded-for entry — the one the trusted proxy appended", () => {
    expect(clientIp("1.1.1.1, 2.2.2.2, 203.0.113.9", "10.0.0.1")).toBe("203.0.113.9");
  });

  it("ignores a client-forged first entry: two requests with different fakes share a key", () => {
    const a = clientIp("9.9.9.1, 203.0.113.9", undefined);
    const b = clientIp("9.9.9.2, 203.0.113.9", undefined);
    expect(a).toBe(b);
    expect(a).toBe("203.0.113.9");
  });

  it("trims whitespace and skips empty trailing segments", () => {
    expect(clientIp("  1.1.1.1 ,  203.0.113.9  ", undefined)).toBe("203.0.113.9");
    expect(clientIp("1.1.1.1, 203.0.113.9,", undefined)).toBe("203.0.113.9");
  });

  it("accepts a repeated header (array form)", () => {
    expect(clientIp(["1.1.1.1", "203.0.113.9"], undefined)).toBe("203.0.113.9");
  });

  it("falls back to req.ip, then to 'unknown'", () => {
    expect(clientIp(undefined, "10.0.0.1")).toBe("10.0.0.1");
    expect(clientIp("", "10.0.0.1")).toBe("10.0.0.1");
    expect(clientIp(" , ", "10.0.0.1")).toBe("10.0.0.1");
    expect(clientIp(undefined, undefined)).toBe("unknown");
    expect(clientIp(undefined, "")).toBe("unknown");
  });
});
