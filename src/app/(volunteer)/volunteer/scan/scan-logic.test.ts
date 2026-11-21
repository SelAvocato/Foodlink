import { describe, expect, it } from "vitest";
import {
  SCAN_TIMEOUT_MS,
  inspectionPath,
  isRetryable,
  scanCopy,
  stateFromResponse,
  tokenFromHash,
} from "./scan-logic";

const TOKEN = "A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q7r8S9t0UvW";
const DONATION_ID = "abcdef12-3456-4789-8abc-def012345678";

function assigned() {
  return {
    donationId: DONATION_ID,
    status: "ASSIGNED",
    nextStep: "INSPECTION",
    scannedAt: "2026-11-17T08:59:00.000Z",
    alreadyScanned: false,
  };
}

function pickedUp() {
  return {
    donationId: DONATION_ID,
    status: "PICKED_UP",
    nextStep: "DROPOFF",
    scannedAt: null,
    alreadyScanned: null,
  };
}

describe("tokenFromHash", () => {
  it("strips the leading hash", () => {
    expect(tokenFromHash("#" + TOKEN)).toBe(TOKEN);
  });

  it("accepts a fragment without the hash", () => {
    expect(tokenFromHash(TOKEN)).toBe(TOKEN);
  });

  it("trims whitespace around the token", () => {
    expect(tokenFromHash("#  " + TOKEN + "  ")).toBe(TOKEN);
  });

  it("returns null when the fragment holds no token", () => {
    expect(tokenFromHash("")).toBeNull();
    expect(tokenFromHash("#")).toBeNull();
    expect(tokenFromHash("   ")).toBeNull();
    expect(tokenFromHash("#   ")).toBeNull();
  });
});

describe("inspectionPath", () => {
  it("builds the inspection route for the donation", () => {
    expect(inspectionPath(DONATION_ID)).toBe("/volunteer/donations/" + DONATION_ID + "/inspection");
  });

  it("encodes the id", () => {
    expect(inspectionPath("a/b c")).toBe("/volunteer/donations/a%2Fb%20c/inspection");
  });
});

describe("stateFromResponse", () => {
  it("navigates to inspection for an assigned donation's 200", () => {
    expect(stateFromResponse(200, assigned())).toEqual({
      kind: "goInspection",
      donationId: DONATION_ID,
    });
  });

  it("shows already recorded for a picked up donation's 200", () => {
    expect(stateFromResponse(200, pickedUp())).toEqual({ kind: "alreadyRecorded" });
  });

  it("treats 404 and 409 as final", () => {
    expect(stateFromResponse(404, { error: "NOT_FOUND" })).toEqual({ kind: "cannotVerify" });
    expect(stateFromResponse(409, { error: "INVALID_STATE" })).toEqual({ kind: "cannotVerify" });
  });

  it("tells an expired session from a wrong role", () => {
    expect(stateFromResponse(401, { error: "UNAUTHENTICATED" })).toEqual({ kind: "sessionExpired" });
    expect(stateFromResponse(403, { error: "FORBIDDEN" })).toEqual({ kind: "wrongRole" });
  });

  it("offers a retry for a 500 and for any other status", () => {
    expect(stateFromResponse(500, { error: "INTERNAL_ERROR" })).toEqual({ kind: "networkError" });
    expect(stateFromResponse(400, null)).toEqual({ kind: "networkError" });
    expect(stateFromResponse(502, "bad gateway")).toEqual({ kind: "networkError" });
  });

  it("never leaves the page spinning when a 200 body is unusable", () => {
    expect(stateFromResponse(200, null)).toEqual({ kind: "networkError" });
    expect(stateFromResponse(200, {})).toEqual({ kind: "networkError" });
    expect(stateFromResponse(200, { nextStep: "INSPECTION" })).toEqual({ kind: "networkError" });
    expect(stateFromResponse(200, { nextStep: "DROP_OFF", donationId: DONATION_ID })).toEqual({
      kind: "networkError",
    });
  });
});

describe("isRetryable", () => {
  it("retries only an unreachable server", () => {
    expect(isRetryable({ kind: "networkError" })).toBe(true);
  });

  it("never retries a spent or invalid label", () => {
    expect(isRetryable({ kind: "cannotVerify" })).toBe(false);
    expect(isRetryable({ kind: "alreadyRecorded" })).toBe(false);
    expect(isRetryable({ kind: "goInspection", donationId: DONATION_ID })).toBe(false);
    expect(isRetryable({ kind: "sessionExpired" })).toBe(false);
    expect(isRetryable({ kind: "wrongRole" })).toBe(false);
    expect(isRetryable({ kind: "scanning" })).toBe(false);
    expect(isRetryable({ kind: "idle" })).toBe(false);
  });
});

describe("scanCopy", () => {
  it("says nothing for idle and for the navigation state", () => {
    expect(scanCopy({ kind: "idle" })).toBeNull();
    expect(scanCopy({ kind: "goInspection", donationId: DONATION_ID })).toBeNull();
  });

  it("shows the scanning text while waiting", () => {
    expect(scanCopy({ kind: "scanning" })).toEqual({
      tone: "info",
      title: null,
      body: "Checking the QR code...",
    });
  });

  it("writes the already recorded copy", () => {
    expect(scanCopy({ kind: "alreadyRecorded" })).toEqual({
      tone: "info",
      title: "Pickup already recorded",
      body: "This donation was already picked up. Repeated scans do not create another pickup.",
    });
  });

  it("writes the cannot verify copy", () => {
    expect(scanCopy({ kind: "cannotVerify" })).toEqual({
      tone: "error",
      title: "QR cannot be verified",
      body: "Wrong volunteer, invalid token, wrong stage, or expired pickup window. Scan the correct label or contact staff.",
    });
  });

  it("writes the session, role and network copy", () => {
    expect(scanCopy({ kind: "sessionExpired" })).toEqual({
      tone: "error",
      title: null,
      body: "Your session has expired. Log in again, then scan the label again.",
    });
    expect(scanCopy({ kind: "wrongRole" })).toEqual({
      tone: "error",
      title: null,
      body: "This page is for volunteers.",
    });
    expect(scanCopy({ kind: "networkError" })).toEqual({
      tone: "error",
      title: null,
      body: "Could not reach the server.",
    });
  });

  it("keeps the token out of every message", () => {
    const states = [
      { kind: "idle" },
      { kind: "scanning" },
      { kind: "goInspection", donationId: DONATION_ID },
      { kind: "alreadyRecorded" },
      { kind: "cannotVerify" },
      { kind: "sessionExpired" },
      { kind: "wrongRole" },
      { kind: "networkError" },
    ] as const;

    for (const state of states) {
      expect(JSON.stringify(scanCopy(state))).not.toContain(TOKEN);
    }
  });
});

describe("scan timeout", () => {
  it("gives a scan request ten seconds", () => {
    expect(SCAN_TIMEOUT_MS).toBe(10_000);
  });
});
