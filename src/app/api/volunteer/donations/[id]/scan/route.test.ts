import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AuthenticatedActor } from "@/contracts/authz";
import { DonationStatus, QrScanStage } from "@/contracts/enums";
import { AuthorizationError, requireRole } from "@/server/auth/require-role";
import { prismaPickupScanStore } from "@/server/volunteer/prisma-pickup-scan-store";
import type { PickupScanDonation } from "@/server/volunteer/pickup-scan";
import { POST } from "./route";

vi.mock("@/server/auth/require-role", () => {
  class AuthorizationError extends Error {
    constructor(
      public readonly code: "UNAUTHENTICATED" | "INACTIVE_ACCOUNT" | "FORBIDDEN",
      message: string,
    ) {
      super(message);
      this.name = "AuthorizationError";
    }
  }
  return { AuthorizationError, requireRole: vi.fn() };
});
vi.mock("@/server/volunteer/prisma-pickup-scan-store", () => ({
  prismaPickupScanStore: {
    findByQrToken: vi.fn(),
    findCurrentVolunteerId: vi.fn(),
    recordScan: vi.fn(),
  },
}));

const DONATION_ID = "abcdef12-3456-4789-8abc-def012345678";
const OTHER_DONATION_ID = "11111111-1111-4111-8111-111111111111";
const TOKEN = "A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q7r8S9t0UvW";
const SCANNED_AT = new Date("2026-11-17T08:59:00.000Z");

const volunteerActor: AuthenticatedActor = {
  id: "volunteer-1",
  email: "volunteer@example.com",
  name: "Test Volunteer",
  role: "VOLUNTEER",
  status: "ACTIVE",
};

function donation(overrides: Partial<PickupScanDonation> = {}): PickupScanDonation {
  return {
    id: DONATION_ID,
    status: DonationStatus.ASSIGNED,
    pickupEnd: new Date("2099-01-01T10:00:00.000Z"),
    deletedAt: null,
    ...overrides,
  };
}

function post(body: unknown, id = DONATION_ID): Promise<Response> {
  return POST(
    new Request(`http://localhost/api/volunteer/donations/${id}/scan`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: typeof body === "string" ? body : JSON.stringify(body),
    }),
    { params: Promise.resolve({ id }) },
  );
}

function findByQrToken() {
  return vi.mocked(prismaPickupScanStore.findByQrToken);
}
function findCurrentVolunteerId() {
  return vi.mocked(prismaPickupScanStore.findCurrentVolunteerId);
}
function recordScan() {
  return vi.mocked(prismaPickupScanStore.recordScan);
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requireRole).mockResolvedValue(volunteerActor);
  findByQrToken().mockResolvedValue(donation());
  findCurrentVolunteerId().mockResolvedValue(volunteerActor.id);
  recordScan().mockResolvedValue({
    inserted: true,
    scannedAt: SCANNED_AT,
    scannedByUserId: volunteerActor.id,
  });
});

describe("POST /api/volunteer/donations/[id]/scan", () => {
  it("answers 401 before reading the params or the body when there is no session", async () => {
    vi.mocked(requireRole).mockRejectedValue(
      new AuthorizationError("UNAUTHENTICATED", "Sign in to access this resource."),
    );

    const res = await post("{not json", "not-a-uuid");

    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({
      error: "UNAUTHENTICATED",
      message: "Sign in to access this resource.",
    });
    expect(requireRole).toHaveBeenCalledWith(["VOLUNTEER"]);
    expect(findByQrToken()).not.toHaveBeenCalled();
    expect(recordScan()).not.toHaveBeenCalled();
  });

  it.each(["DONOR", "ADMIN"] as const)("answers 403 for a signed-in %s", async () => {
    vi.mocked(requireRole).mockRejectedValue(
      new AuthorizationError("FORBIDDEN", "Your role cannot access this resource."),
    );

    const res = await post({ token: TOKEN });

    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({
      error: "FORBIDDEN",
      message: "Your role cannot access this resource.",
    });
    expect(findByQrToken()).not.toHaveBeenCalled();
  });

  it("rejects a non-uuid donation id with 400 and never reaches the store", async () => {
    const res = await post({ token: TOKEN }, "not-a-uuid");

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      error: "INVALID_REQUEST",
      message: "The donation id is invalid.",
    });
    expect(findByQrToken()).not.toHaveBeenCalled();
  });

  it("rejects a malformed JSON body with 400", async () => {
    const res = await post("{not json");

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      error: "INVALID_REQUEST",
      message: "Send a valid JSON request body.",
    });
    expect(findByQrToken()).not.toHaveBeenCalled();
  });

  it.each([
    ["a missing token", {}],
    ["a token of the wrong length", { token: "short" }],
    ["a token with characters outside the alphabet", { token: `${"a".repeat(42)}!` }],
    ["an extra field", { token: TOKEN, volunteerId: "someone-else" }],
  ])("rejects %s with 400 and the field details", async (_label, body) => {
    const res = await post(body);

    expect(res.status).toBe(400);
    const parsed = await res.json();
    expect(parsed).toMatchObject({
      error: "INVALID_REQUEST",
      message: "The scan request is invalid.",
    });
    expect(parsed.details).toBeDefined();
    expect(findByQrToken()).not.toHaveBeenCalled();
  });

  it("records a fresh scan and answers 200 with no-store", async () => {
    const res = await post({ token: TOKEN });

    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    expect(await res.json()).toEqual({
      stage: "PICKUP",
      scannedAt: SCANNED_AT.toISOString(),
      alreadyScanned: false,
    });
    expect(findByQrToken()).toHaveBeenCalledWith(TOKEN);
    expect(recordScan()).toHaveBeenCalledWith({
      donationId: DONATION_ID,
      stage: QrScanStage.PICKUP,
      scannedByUserId: volunteerActor.id,
    });
  });

  it("answers 200 with alreadyScanned on a repeat scan", async () => {
    recordScan().mockResolvedValue({
      inserted: false,
      scannedAt: SCANNED_AT,
      scannedByUserId: volunteerActor.id,
    });

    const res = await post({ token: TOKEN });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      stage: "PICKUP",
      scannedAt: SCANNED_AT.toISOString(),
      alreadyScanned: true,
    });
  });

  it("never echoes the token in the response", async () => {
    const res = await post({ token: TOKEN });

    expect(JSON.stringify(await res.json())).not.toContain(TOKEN);
  });

  it("maps an unknown token or a foreign donation to 404", async () => {
    findByQrToken().mockResolvedValue(null);

    const res = await post({ token: TOKEN });

    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({
      error: "NOT_FOUND",
      message: "The donation was not found.",
    });
    expect(recordScan()).not.toHaveBeenCalled();
  });

  it("maps a token for another donation to 404", async () => {
    findByQrToken().mockResolvedValue(donation({ id: OTHER_DONATION_ID }));

    const res = await post({ token: TOKEN });

    expect(res.status).toBe(404);
  });

  it.each([
    ["another volunteer's assignment", "another-volunteer"],
    ["no current assignment", null],
  ])("maps %s to 404", async (_label, currentVolunteerId) => {
    findCurrentVolunteerId().mockResolvedValue(currentVolunteerId);

    const res = await post({ token: TOKEN });

    expect(res.status).toBe(404);
    expect(recordScan()).not.toHaveBeenCalled();
  });

  it.each([DonationStatus.POSTED, DonationStatus.PICKED_UP, DonationStatus.CLOSED])(
    "maps a %s donation to 409",
    async (status) => {
      findByQrToken().mockResolvedValue(donation({ status }));

      const res = await post({ token: TOKEN });

      expect(res.status).toBe(409);
      expect(await res.json()).toEqual({
        error: "INVALID_STATE",
        message: "This donation can no longer be scanned.",
      });
    },
  );

  it("maps a donation past its pickup window to 409", async () => {
    findByQrToken().mockResolvedValue(donation({ pickupEnd: new Date("2020-01-01T00:00:00.000Z") }));

    const res = await post({ token: TOKEN });

    expect(res.status).toBe(409);
    expect(recordScan()).not.toHaveBeenCalled();
  });

  it("answers 500 with a generic body and a log without the token", async () => {
    findByQrToken().mockRejectedValue(
      new Error(`query failed for token ${TOKEN} volunteer ${volunteerActor.id}`),
    );
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});

    try {
      const res = await post({ token: TOKEN });

      expect(res.status).toBe(500);
      expect(await res.json()).toEqual({
        error: "INTERNAL_ERROR",
        message: "The scan could not be recorded.",
      });
      expect(consoleError).toHaveBeenCalledTimes(1);
      const [label, details] = consoleError.mock.calls[0];
      expect(label).toBe("Pickup scan failed");
      expect(details).toMatchObject({ donationId: DONATION_ID, errorName: "Error" });
      const logged = JSON.stringify(consoleError.mock.calls);
      expect(logged).not.toContain(TOKEN);
      expect(logged).not.toContain("query failed for");
    } finally {
      consoleError.mockRestore();
    }
  });
});
