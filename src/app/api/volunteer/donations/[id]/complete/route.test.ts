import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AuthenticatedActor } from "@/contracts/authz";
import { AuthorizationError, requireRole } from "@/server/auth/require-role";
import { completeDistribution } from "@/server/volunteer/distribution-completion";
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
vi.mock("@/server/volunteer/distribution-completion", () => ({
  completeDistribution: vi.fn(),
}));
vi.mock("@/server/volunteer/prisma-distribution-completion-store", () => ({
  prismaDistributionCompletionStore: {},
  createDistributionCompletionTransition: vi.fn(() => "transition"),
}));

const DONATION_ID = "abcdef12-3456-4789-8abc-def012345678";
const CLOSED_AT = new Date("2026-11-18T10:00:00.000Z");
const volunteerActor: AuthenticatedActor = {
  id: "9bbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  email: "volunteer@example.com",
  name: "Test Volunteer",
  role: "VOLUNTEER",
  status: "ACTIVE",
};
const progress = {
  accountedPortions: 20,
  totalPortions: 20,
  remainingPortions: 0,
};

function post(id = DONATION_ID): Promise<Response> {
  return POST(
    new Request(`http://localhost/api/volunteer/donations/${id}/complete`, {
      method: "POST",
    }),
    { params: Promise.resolve({ id }) },
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requireRole).mockResolvedValue(volunteerActor);
  vi.mocked(completeDistribution).mockResolvedValue({
    ok: true,
    status: "CLOSED",
    closedAt: CLOSED_AT,
    progress,
  });
});

describe("POST /api/volunteer/donations/[id]/complete", () => {
  it("answers 401 before reading params without a session", async () => {
    vi.mocked(requireRole).mockRejectedValue(
      new AuthorizationError("UNAUTHENTICATED", "Sign in to access this resource."),
    );

    const res = await post("not-a-uuid");

    expect(res.status).toBe(401);
    expect(completeDistribution).not.toHaveBeenCalled();
  });

  it("answers 403 for an admin", async () => {
    vi.mocked(requireRole).mockRejectedValue(
      new AuthorizationError("FORBIDDEN", "Your role cannot access this resource."),
    );

    const res = await post();

    expect(res.status).toBe(403);
    expect(completeDistribution).not.toHaveBeenCalled();
  });

  it("rejects a non-uuid donation id before the store", async () => {
    const res = await post("not-a-uuid");

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      error: "INVALID_REQUEST",
      message: "The donation id is invalid.",
    });
    expect(completeDistribution).not.toHaveBeenCalled();
  });

  it("closes the donation for the session volunteer", async () => {
    const res = await post();

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      status: "CLOSED",
      closedAt: CLOSED_AT.toISOString(),
      progress,
    });
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    expect(completeDistribution).toHaveBeenCalledWith(
      { store: {}, transition: "transition" },
      { volunteerId: volunteerActor.id, donationId: DONATION_ID },
    );
  });

  it.each([
    ["NOT_FOUND", 404, "The donation was not found."],
    ["INVALID_STATE", 409, "Only a delivered donation can be closed."],
    [
      "RECONCILIATION_INCOMPLETE",
      409,
      "Record distribution entries that exactly match the donated portions before closing.",
    ],
  ] as const)("maps %s to %i", async (error, status, message) => {
    vi.mocked(completeDistribution).mockResolvedValue({ ok: false, error });

    const res = await post();

    expect(res.status).toBe(status);
    expect(await res.json()).toEqual({ error, message });
  });

  it("answers a generic 500 and logs only a safe summary", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.mocked(completeDistribution).mockRejectedValue(
      new Error("database password leaked"),
    );

    const res = await post();

    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({
      error: "INTERNAL_ERROR",
      message: "The donation could not be closed.",
    });
    expect(spy).toHaveBeenCalledWith("Complete distribution failed", {
      donationId: DONATION_ID,
      errorName: "Error",
    });
    expect(JSON.stringify(spy.mock.calls)).not.toContain("password");
    spy.mockRestore();
  });
});
