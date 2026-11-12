import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AuthenticatedActor } from "@/contracts/authz";
import { AuthorizationError, requireRole } from "@/server/auth/require-role";
import { decideScreening } from "@/server/screening/decide-screening";
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
vi.mock("@/server/screening/decide-screening", () => ({ decideScreening: vi.fn() }));
vi.mock("@/server/screening/prisma-screening-decision-store", () => ({
  prismaScreeningDecisionStore: {},
}));
vi.mock("@/server/screening/admin-screening-transition", () => ({
  createAdminScreeningTransition: vi.fn(() => vi.fn()),
}));

const VALID_ID = "11111111-1111-4111-8111-111111111111";
const DONATION_ID = "22222222-2222-4222-8222-222222222222";
const REASON = "Mold on the surface.";

const adminActor: AuthenticatedActor = {
  id: "admin-1",
  email: "admin@example.com",
  name: "Admin User",
  role: "ADMIN",
  status: "ACTIVE",
};

function post(id: string, body: string): Promise<Response> {
  const request = new Request(`http://localhost/api/admin/screenings/${id}/decision`, {
    method: "POST",
    body,
    headers: { "content-type": "application/json" },
  });
  return POST(request, { params: Promise.resolve({ id }) });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requireRole).mockResolvedValue(adminActor);
  vi.mocked(decideScreening).mockResolvedValue({
    ok: true,
    donationId: DONATION_ID,
    screeningId: VALID_ID,
    from: "DRAFT",
    to: "SCREENED",
  });
});

describe("POST /api/admin/screenings/[id]/decision", () => {
  it("answers 401 before reading the params or body when there is no session", async () => {
    vi.mocked(requireRole).mockRejectedValue(
      new AuthorizationError("UNAUTHENTICATED", "Sign in to access this resource."),
    );

    // Deliberately invalid id and body: reading either first would answer 400.
    const res = await post("not-a-uuid", "not-json");

    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({
      error: "UNAUTHENTICATED",
      message: "Sign in to access this resource.",
    });
    expect(decideScreening).not.toHaveBeenCalled();
  });

  it.each(["DONOR", "VOLUNTEER"] as const)(
    "answers 403 for a signed-in %s before reading the params or body",
    async () => {
      vi.mocked(requireRole).mockRejectedValue(
        new AuthorizationError("FORBIDDEN", "Your role cannot access this resource."),
      );

      const res = await post("not-a-uuid", "not-json");

      expect(res.status).toBe(403);
      expect(await res.json()).toEqual({
        error: "FORBIDDEN",
        message: "Your role cannot access this resource.",
      });
      expect(requireRole).toHaveBeenCalledWith(["ADMIN"]);
      expect(decideScreening).not.toHaveBeenCalled();
    },
  );

  it("answers 400 for a screening id that is not a uuid", async () => {
    const res = await post("not-a-uuid", JSON.stringify({ decision: "PASS" }));

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      error: "INVALID_REQUEST",
      message: "The screening id is invalid.",
    });
    expect(decideScreening).not.toHaveBeenCalled();
  });

  it("answers 400 for a body that is not valid JSON", async () => {
    const res = await post(VALID_ID, "not-json");

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      error: "INVALID_REQUEST",
      message: "Send a valid JSON request body.",
    });
    expect(decideScreening).not.toHaveBeenCalled();
  });

  it("answers 400 for unknown body fields, including reviewerId", async () => {
    const res = await post(VALID_ID, JSON.stringify({ decision: "PASS", reviewerId: "someone-else" }));

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("INVALID_REQUEST");
    expect(body.details.formErrors.join(" ")).toContain("reviewerId");
    expect(decideScreening).not.toHaveBeenCalled();
  });

  it("answers 400 when PASS is sent with a reason", async () => {
    const res = await post(VALID_ID, JSON.stringify({ decision: "PASS", reason: REASON }));

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("INVALID_REQUEST");
    expect(Array.isArray(body.details.fieldErrors.reason)).toBe(true);
    expect(body.details.fieldErrors.reason.length).toBeGreaterThan(0);
    expect(decideScreening).not.toHaveBeenCalled();
  });

  it("answers 400 when REJECT is sent without a reason", async () => {
    const res = await post(VALID_ID, JSON.stringify({ decision: "REJECT" }));

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("INVALID_REQUEST");
    expect(Array.isArray(body.details.fieldErrors.reason)).toBe(true);
    expect(body.details.fieldErrors.reason.length).toBeGreaterThan(0);
    expect(decideScreening).not.toHaveBeenCalled();
  });

  it("answers 404 when the screening does not exist", async () => {
    vi.mocked(decideScreening).mockResolvedValue({ ok: false, error: "NOT_FOUND" });

    const res = await post(VALID_ID, JSON.stringify({ decision: "PASS" }));

    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({
      error: "NOT_FOUND",
      message: "The screening was not found.",
    });
  });

  it("answers 409 when the screening is not awaiting a decision", async () => {
    vi.mocked(decideScreening).mockResolvedValue({ ok: false, error: "NOT_PENDING" });

    const res = await post(VALID_ID, JSON.stringify({ decision: "PASS" }));

    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({
      error: "NOT_PENDING",
      message: "That screening is not awaiting a decision.",
    });
  });

  it("answers 200 with no-store and passes the session Admin to the service on PASS", async () => {
    const res = await post(VALID_ID, JSON.stringify({ decision: "PASS" }));

    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    expect(await res.json()).toEqual({
      donationId: DONATION_ID,
      screeningId: VALID_ID,
      from: "DRAFT",
      to: "SCREENED",
    });
    expect(requireRole).toHaveBeenCalledWith(["ADMIN"]);
    expect(decideScreening).toHaveBeenCalledTimes(1);
    const [deps, input] = vi.mocked(decideScreening).mock.calls[0];
    expect(deps.store).toBeDefined();
    expect(deps.transition).toBeTypeOf("function");
    expect(input).toEqual({ screeningId: VALID_ID, actorId: "admin-1", decision: "PASS" });
  });

  it("passes a REJECT reason through to the service", async () => {
    vi.mocked(decideScreening).mockResolvedValue({
      ok: true,
      donationId: DONATION_ID,
      screeningId: VALID_ID,
      from: "DRAFT",
      to: "REJECTED",
    });

    const res = await post(VALID_ID, JSON.stringify({ decision: "REJECT", reason: `  ${REASON}  ` }));

    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    expect(await res.json()).toEqual({
      donationId: DONATION_ID,
      screeningId: VALID_ID,
      from: "DRAFT",
      to: "REJECTED",
    });
    const [, input] = vi.mocked(decideScreening).mock.calls[0];
    // The schema trims the reason before the service sees it.
    expect(input).toEqual({
      screeningId: VALID_ID,
      actorId: "admin-1",
      decision: "REJECT",
      reason: REASON,
    });
  });

  it("answers 500 with a generic message and a log-safe summary", async () => {
    vi.mocked(decideScreening).mockRejectedValue(new Error("database exploded SECRETVALUE"));
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});

    const res = await post(VALID_ID, JSON.stringify({ decision: "PASS" }));

    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body).toEqual({
      error: "INTERNAL_ERROR",
      message: "The screening decision could not be saved.",
    });
    expect(JSON.stringify(body)).not.toContain("SECRETVALUE");
    expect(consoleError).toHaveBeenCalledTimes(1);
    const [label, details] = consoleError.mock.calls[0];
    expect(label).toBe("Screening decision failed");
    expect(details).toEqual({ screeningId: VALID_ID, errorName: "Error" });
    const logged = JSON.stringify(consoleError.mock.calls);
    expect(logged).not.toContain("database exploded");
    expect(logged).not.toContain("SECRETVALUE");
    consoleError.mockRestore();
  });
});
