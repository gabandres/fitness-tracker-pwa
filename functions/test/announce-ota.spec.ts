import { describe, expect, it } from "vitest";
import {
  buildOtaPushChunks,
  interpretPushTickets,
  EXPO_PUSH_CHUNK,
  type PushRecipient,
} from "../src/announce-ota";

// The two pure halves of adminAnnounceOta (#114). The payload builder is
// pinned hard because "silent" is a property of what the message OMITS — a
// title or body sneaking in turns every OTA publish into a visible
// notification on every device, which is exactly what #112 rejected.

const recipients = (n: number): PushRecipient[] =>
  Array.from({ length: n }, (_, i) => ({ uid: `uid-${i}`, token: `ExponentPushToken[${i}]` }));

describe("buildOtaPushChunks", () => {
  it("builds a silent, normal-priority message per token", () => {
    const chunks = buildOtaPushChunks(recipients(2), "ios");
    expect(chunks).toHaveLength(1);
    expect(chunks[0]).toHaveLength(2);
    const msg = chunks[0][0];
    expect(msg).toEqual({
      to: "ExponentPushToken[0]",
      priority: "normal",
      _contentAvailable: true,
      data: { type: "ota-published", platform: "ios" },
    });
    // Silent means silent: these keys must not exist AT ALL.
    expect("title" in msg).toBe(false);
    expect("body" in msg).toBe(false);
    expect("sound" in msg).toBe(false);
  });

  it("keeps an optional message inside data, never as a visible field", () => {
    const [chunk] = buildOtaPushChunks(recipients(1), "android", "water card fix");
    expect(chunk[0].data).toEqual({
      type: "ota-published",
      platform: "android",
      message: "water card fix",
    });
    expect("title" in chunk[0]).toBe(false);
    expect("body" in chunk[0]).toBe(false);
  });

  it("chunks at Expo's 100-message cap", () => {
    const chunks = buildOtaPushChunks(recipients(250), "ios");
    expect(EXPO_PUSH_CHUNK).toBe(100);
    expect(chunks.map((c) => c.length)).toEqual([100, 100, 50]);
    // Order preserved across the chunk boundary.
    expect(chunks[1][0].to).toBe("ExponentPushToken[100]");
    expect(chunks[2][49].to).toBe("ExponentPushToken[249]");
  });

  it("returns no chunks for no recipients (the pre-native-config state)", () => {
    expect(buildOtaPushChunks([], "ios")).toEqual([]);
  });
});

describe("interpretPushTickets", () => {
  it("counts ok tickets as sent", () => {
    const r = recipients(2);
    const out = interpretPushTickets([{ status: "ok" }, { status: "ok" }], r);
    expect(out).toEqual({ sent: 2, errors: 0, clearUids: [] });
  });

  it("flags DeviceNotRegistered for a token clear, by ticket position", () => {
    const r = recipients(3);
    const out = interpretPushTickets(
      [
        { status: "ok" },
        { status: "error", details: { error: "DeviceNotRegistered" } },
        { status: "ok" },
      ],
      r,
    );
    expect(out.sent).toBe(2);
    expect(out.errors).toBe(1);
    expect(out.clearUids).toEqual(["uid-1"]);
  });

  it("counts other errors WITHOUT clearing the token", () => {
    // MessageRateExceeded / transient errors are not evidence the token is
    // dead; clearing on them would deregister a healthy device.
    const out = interpretPushTickets(
      [{ status: "error", details: { error: "MessageRateExceeded" } }, { status: "error" }],
      recipients(2),
    );
    expect(out).toEqual({ sent: 0, errors: 2, clearUids: [] });
  });

  it("tolerates a malformed ticket array", () => {
    const out = interpretPushTickets(
      [undefined as unknown as { status?: string }, { status: "ok" }],
      recipients(2),
    );
    expect(out.sent).toBe(1);
    expect(out.errors).toBe(1);
    expect(out.clearUids).toEqual([]);
  });
});
