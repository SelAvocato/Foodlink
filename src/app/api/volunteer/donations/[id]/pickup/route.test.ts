import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AuthenticatedActor } from "@/contracts/authz";
import { PickupDecision } from "@/contracts/enums";
import { AuthorizationError, requireRole } from "@/server/auth/require-role";
import { recordPickupOutcome } from "@/server/volunteer/pickup-outcome";
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
vi.mock("@/server/volunteer/pickup-outcome", () => ({ recordPickupOutcome: vi.fn() }));
vi.mock("@/server/volunteer/prisma-pickup-outcome-store", () => ({
  prismaPickupOutcomeStore: {},
}));
vi.mock("@/server/volunteer/pickup-outcome-transition", () => ({
  createPickupOutcomeTransition: () => vi.fn(),
}));

const DONATION_ID = "abcdef12-3456-4789-8abc-def012345678";

const volunteerActor: AuthenticatedActor = {
  id: "volunteer-1",
  email: "volunteer@example.com",
  name: "Test Volunteer",
  role: "VOLUNTEER",
  status: "ACTIVE",
};

function post(id = DONATION_ID): Promise<Response> {
  return POST(
    new Request(`http://localhost/api/volunteer/donations/${id}/pickup`, {
      method: "POST",
    }),
    { params: Promise.resolve({ id }) },
  );
}

function record() {
  return vi.mocked(recordPickupOutcome);
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requireRole).mockResolvedValue(volunteerActor);
  record().mockResolvedValue({
    ok: true,
    status: "PICKED_UP",
    decision: PickupDecision.ACCEPTED,
  });
});

describe("POST /api/volunteer/donations/[id]/pickup", () => {
  it("answers 401 before reading the params when there is no session", async () => {
    vi.mocked(requireRole).mockRejectedValue(
      new AuthorizationError("UNAUTHENTICATED", "Sign in to access this resource."),
    );

    const res = await post("not-a-uuid");

    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({
      error: "UNAUTHENTICATED",
      message: "Sign in to access this resource.",
    });
    expect(requireRole).toHaveBeenCalledWith(["VOLUNTEER"]);
    expect(record()).not.toHaveBeenCalled();
  });

  it.each(["DONOR", "ADMIN"] as const)("answers 403 for a signed-in %s", async () => {
    vi.mocked(requireRole).mockRejectedValue(
      new AuthorizationError("FORBIDDEN", "Your role cannot access this resource."),
    );

    const res = await post();

    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({
      error: "FORBIDDEN",
      message: "Your role cannot access this resource.",
    });
    expect(record()).not.toHaveBeenCalled();
  });

  it("rejects a non-uuid donation id with 400 and never reaches the service", async () => {
    const res = await post("not-a-uuid");

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      error: "INVALID_REQUEST",
      message: "The donation id is invalid.",
    });
    expect(record()).not.toHaveBeenCalled();
  });

  it("uses only the session volunteer id and the path id", async () => {
    const res = await post();

    expect(record()).toHaveBeenCalledWith(
      expect.objectContaining({
        store: expect.anything(),
        transition: expect.any(Function),
      }),
      { volunteerId: volunteerActor.id, donationId: DONATION_ID },
    );
    expect(res.status).toBe(200);
  });

  it("answers the recorded pickup status and decision without caching", async () => {
    const res = await post();

    expect(await res.json()).toEqual({
      status: "PICKED_UP",
      decision: "ACCEPTED",
    });
    expect(res.headers.get("Cache-Control")).toBe("no-store");
  });

  it("answers a rejected outcome the same way", async () => {
    record().mockResolvedValue({
      ok: true,
      status: "REJECTED_AT_PICKUP",
      decision: PickupDecision.REJECTED,
    });

    const res = await post();

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      status: "REJECTED_AT_PICKUP",
      decision: "REJECTED",
    });
  });

  it("maps NOT_FOUND to 404", async () => {
    record().mockResolvedValue({ ok: false, error: "NOT_FOUND" });

    const res = await post();

    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({
      error: "NOT_FOUND",
      message: "The donation was not found.",
    });
  });

  it.each([
    [
      "INSPECTION_REQUIRED",
      "Complete the pickup inspection before recording the pickup.",
    ],
    ["SCREENING_BLOCKED", "The photo failed visual screening. Reject the pickup."],
    ["INVALID_STATE", "This pickup was already recorded."],
  ] as const)("maps %s to 409", async (error, message) => {
    record().mockResolvedValue({ ok: false, error });

    const res = await post();

    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error, message });
  });

  it("answers a generic 500 and logs only a safe summary", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const error = new Error("duplicate key value violates unique constraint");
    record().mockRejectedValue(error);

    const res = await post();

    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({
      error: "INTERNAL_ERROR",
      message: "The pickup could not be recorded.",
    });
    expect(spy).toHaveBeenCalledWith("Pickup outcome failed", {
      donationId: DONATION_ID,
      errorName: "Error",
    });
    expect(JSON.stringify(spy.mock.calls)).not.toContain("duplicate key");
    spy.mockRestore();
  });
});
