import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AuthenticatedActor } from "@/contracts/authz";
import { AuthorizationError, requireRole } from "@/server/auth/require-role";
import { reviewAccount } from "@/server/review/review-account";
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
vi.mock("@/server/review/review-account", () => ({ reviewAccount: vi.fn() }));
vi.mock("@/server/review/prisma-review-store", () => ({ prismaReviewStore: {} }));

const VALID_ID = "11111111-1111-4111-8111-111111111111";

const adminActor: AuthenticatedActor = {
  id: "admin-1",
  email: "admin@example.com",
  name: "Admin User",
  role: "ADMIN",
  status: "ACTIVE",
};

function post(id: string, body: string): Promise<Response> {
  const request = new Request(`http://localhost/api/admin/users/${id}/review`, {
    method: "POST",
    body,
    headers: { "content-type": "application/json" },
  });
  return POST(request, { params: Promise.resolve({ id }) });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requireRole).mockResolvedValue(adminActor);
  vi.mocked(reviewAccount).mockResolvedValue({ ok: true, resultingStatus: "ACTIVE" });
});

describe("POST /api/admin/users/[id]/review", () => {
  it("answers 401 before reading the body when there is no session", async () => {
    vi.mocked(requireRole).mockRejectedValue(
      new AuthorizationError("UNAUTHENTICATED", "Sign in to access this resource."),
    );

    const res = await post(VALID_ID, JSON.stringify({ action: "APPROVE" }));

    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({
      error: "UNAUTHENTICATED",
      message: "Sign in to access this resource.",
    });
    expect(reviewAccount).not.toHaveBeenCalled();
  });

  it("answers 403 when the signed-in user is not an Admin", async () => {
    vi.mocked(requireRole).mockRejectedValue(
      new AuthorizationError("FORBIDDEN", "Your role cannot access this resource."),
    );

    const res = await post(VALID_ID, JSON.stringify({ action: "APPROVE" }));

    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({
      error: "FORBIDDEN",
      message: "Your role cannot access this resource.",
    });
    expect(reviewAccount).not.toHaveBeenCalled();
  });

  it("answers 400 for a user id that is not a uuid", async () => {
    const res = await post("not-a-uuid", JSON.stringify({ action: "APPROVE" }));

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      error: "INVALID_REQUEST",
      message: "The user id is invalid.",
    });
    expect(reviewAccount).not.toHaveBeenCalled();
  });

  it("answers 400 for a body that is not valid JSON", async () => {
    const res = await post(VALID_ID, "not-json");

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      error: "INVALID_REQUEST",
      message: "Send a valid JSON request body.",
    });
    expect(reviewAccount).not.toHaveBeenCalled();
  });

  it("answers 400 for unknown body fields, including reviewerId", async () => {
    const res = await post(
      VALID_ID,
      JSON.stringify({ action: "APPROVE", reviewerId: "someone-else" }),
    );

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("INVALID_REQUEST");
    expect(body.details.formErrors.join(" ")).toContain("reviewerId");
    expect(reviewAccount).not.toHaveBeenCalled();
  });

  it("answers 400 when REJECT is sent without a reason", async () => {
    const res = await post(VALID_ID, JSON.stringify({ action: "REJECT" }));

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("INVALID_REQUEST");
    expect(Array.isArray(body.details.fieldErrors.reason)).toBe(true);
    expect(body.details.fieldErrors.reason.length).toBeGreaterThan(0);
    expect(reviewAccount).not.toHaveBeenCalled();
  });

  it("answers 404 when the target account does not exist", async () => {
    vi.mocked(reviewAccount).mockResolvedValue({ ok: false, error: "NOT_FOUND" });

    const res = await post(VALID_ID, JSON.stringify({ action: "APPROVE" }));

    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({
      error: "NOT_FOUND",
      message: "The account was not found.",
    });
    expect(reviewAccount).toHaveBeenCalledTimes(1);
  });

  it("answers 403 when the target cannot be reviewed", async () => {
    vi.mocked(reviewAccount).mockResolvedValue({ ok: false, error: "TARGET_NOT_REVIEWABLE" });

    const res = await post(VALID_ID, JSON.stringify({ action: "APPROVE" }));

    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({
      error: "TARGET_NOT_REVIEWABLE",
      message: "That account cannot be reviewed.",
    });
    expect(reviewAccount).toHaveBeenCalledTimes(1);
  });

  it("answers 409 when the transition does not apply", async () => {
    vi.mocked(reviewAccount).mockResolvedValue({ ok: false, error: "INVALID_TRANSITION" });

    const res = await post(VALID_ID, JSON.stringify({ action: "APPROVE" }));

    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({
      error: "INVALID_TRANSITION",
      message: "That action does not apply to the account's current status.",
    });
    expect(reviewAccount).toHaveBeenCalledTimes(1);
  });

  it("returns the resulting status and sends the session actor as reviewerId", async () => {
    const res = await post(VALID_ID, JSON.stringify({ action: "APPROVE" }));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ resultingStatus: "ACTIVE" });
    expect(requireRole).toHaveBeenCalledWith(["ADMIN"]);
    expect(reviewAccount).toHaveBeenCalledTimes(1);
    const [deps, input] = vi.mocked(reviewAccount).mock.calls[0];
    expect(deps.store).toBeDefined();
    expect(input).toMatchObject({
      reviewerId: "admin-1",
      targetId: VALID_ID,
      review: { action: "APPROVE" },
    });
  });

  it("answers 500 with a generic message when the service fails unexpectedly", async () => {
    vi.mocked(reviewAccount).mockRejectedValue(new Error("database is down"));
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});

    const res = await post(VALID_ID, JSON.stringify({ action: "APPROVE" }));

    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({
      error: "INTERNAL_ERROR",
      message: "The account review could not be completed.",
    });
    expect(consoleError).toHaveBeenCalledTimes(1);
    const [label, details] = consoleError.mock.calls[0];
    expect(label).toBe("Account review failed");
    expect(details).toMatchObject({ targetId: VALID_ID, errorName: "Error" });
    consoleError.mockRestore();
  });
});
