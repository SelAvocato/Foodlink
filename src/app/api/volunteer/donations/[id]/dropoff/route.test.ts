import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AuthenticatedActor } from "@/contracts/authz";
import { DonationStatus } from "@/contracts/enums";
import { AuthorizationError, requireRole } from "@/server/auth/require-role";
import { prismaDropoffScanStore } from "@/server/volunteer/prisma-dropoff-scan-store";
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
vi.mock("@/server/volunteer/prisma-dropoff-scan-store", () => ({
  prismaDropoffScanStore: {
    findByQrToken: vi.fn(),
    findCurrentVolunteerId: vi.fn(),
    findScan: vi.fn(),
    recordScan: vi.fn(),
  },
}));
vi.mock("@/server/volunteer/dropoff-transition", () => ({
  createDropoffTransition: () => vi.fn(async () => ({ ok: true })),
}));

const DONATION_ID = "abcdef12-3456-4789-8abc-def012345678";
const TOKEN = "A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q7r8S9t0UvW";
const SCANNED_AT = new Date("2026-11-18T08:59:00.000Z");

const volunteerActor: AuthenticatedActor = {
  id: "9bbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  email: "volunteer@example.com",
  name: "Test Volunteer",
  role: "VOLUNTEER",
  status: "ACTIVE",
};

function post(body: unknown, id = DONATION_ID): Promise<Response> {
  return POST(
    new Request(`http://localhost/api/volunteer/donations/${id}/dropoff`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: typeof body === "string" ? body : JSON.stringify(body),
    }),
    { params: Promise.resolve({ id }) },
  );
}

function findByQrToken() {
  return vi.mocked(prismaDropoffScanStore.findByQrToken);
}
function findCurrentVolunteerId() {
  return vi.mocked(prismaDropoffScanStore.findCurrentVolunteerId);
}
function recordScan() {
  return vi.mocked(prismaDropoffScanStore.recordScan);
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requireRole).mockResolvedValue(volunteerActor);
  findByQrToken().mockResolvedValue({
    id: DONATION_ID,
    status: DonationStatus.PICKED_UP,
    deletedAt: null,
  });
  findCurrentVolunteerId().mockResolvedValue(volunteerActor.id);
  recordScan().mockResolvedValue({
    inserted: true,
    scannedAt: SCANNED_AT,
    scannedByUserId: volunteerActor.id,
  });
});

describe("POST /api/volunteer/donations/[id]/dropoff", () => {
  it("answers 401 before reading the params or the body when there is no session", async () => {
    vi.mocked(requireRole).mockRejectedValue(
      new AuthorizationError("UNAUTHENTICATED", "Sign in to access this resource."),
    );

    const res = await post("{not json", "not-a-uuid");

    expect(res.status).toBe(401);
    expect(findByQrToken()).not.toHaveBeenCalled();
  });

  it.each(["DONOR", "ADMIN"] as const)("answers 403 for a signed-in %s", async () => {
    vi.mocked(requireRole).mockRejectedValue(
      new AuthorizationError("FORBIDDEN", "Your role cannot access this resource."),
    );

    const res = await post({ token: TOKEN });

    expect(res.status).toBe(403);
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
    expect(findByQrToken()).not.toHaveBeenCalled();
  });

  it("rejects an invalid token before the store is read", async () => {
    const res = await post({ token: "short" });

    expect(res.status).toBe(400);
    expect(findByQrToken()).not.toHaveBeenCalled();
  });

  it("records the scan with the session volunteer and answers DELIVERED", async () => {
    const res = await post({ token: TOKEN });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      stage: "DROPOFF",
      status: "DELIVERED",
      scannedAt: SCANNED_AT.toISOString(),
      alreadyScanned: false,
    });
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    expect(findByQrToken()).toHaveBeenCalledWith(TOKEN);
    expect(recordScan()).toHaveBeenCalledWith({
      donationId: DONATION_ID,
      scannedByUserId: volunteerActor.id,
    });
  });

  it("maps an unknown token to 404", async () => {
    findByQrToken().mockResolvedValue(null);

    const res = await post({ token: TOKEN });

    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({
      error: "NOT_FOUND",
      message: "The donation was not found.",
    });
  });

  it("maps a donation that is not picked up to 409", async () => {
    findByQrToken().mockResolvedValue({
      id: DONATION_ID,
      status: DonationStatus.ASSIGNED,
      deletedAt: null,
    });

    const res = await post({ token: TOKEN });

    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({
      error: "INVALID_STATE",
      message: "This donation can no longer be delivered.",
    });
    expect(recordScan()).not.toHaveBeenCalled();
  });

  it("answers a generic 500 and logs only a safe summary", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    findByQrToken().mockRejectedValue(new Error(`bad token ${TOKEN}`));

    const res = await post({ token: TOKEN });

    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({
      error: "INTERNAL_ERROR",
      message: "The drop-off could not be recorded.",
    });
    expect(spy).toHaveBeenCalledWith("Drop-off scan failed", {
      donationId: DONATION_ID,
      errorName: "Error",
    });
    expect(JSON.stringify(spy.mock.calls)).not.toContain(TOKEN);
    spy.mockRestore();
  });
});
