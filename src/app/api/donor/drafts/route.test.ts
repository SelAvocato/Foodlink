import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AuthenticatedActor } from "@/contracts/authz";
import { AuthorizationError, requireRole } from "@/server/auth/require-role";
import { createDraft, listDrafts, type DraftListItem } from "@/server/drafts/donation-drafts";
import { GET, POST } from "./route";

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
vi.mock("@/server/drafts/donation-drafts", () => ({ createDraft: vi.fn(), listDrafts: vi.fn() }));
vi.mock("@/server/drafts/prisma-draft-store", () => ({ prismaDraftStore: {} }));

const VALID_DRAFT_ID = "11111111-1111-4111-8111-111111111111";

const donorActor: AuthenticatedActor = {
  id: "donor-1",
  email: "donor@example.com",
  name: "Test Donor",
  role: "DONOR",
  status: "ACTIVE",
};

const validBody = {
  foodCategoryCode: "COOKED_MEALS",
  foodName: "Chicken adobo",
  portions: 25,
};

function post(body: string): Promise<Response> {
  const request = new Request("http://localhost/api/donor/drafts", {
    method: "POST",
    body,
    headers: { "content-type": "application/json" },
  });
  return POST(request);
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requireRole).mockResolvedValue(donorActor);
  vi.mocked(createDraft).mockResolvedValue({ ok: true, donationId: VALID_DRAFT_ID });
  vi.mocked(listDrafts).mockResolvedValue([]);
});

describe("POST /api/donor/drafts", () => {
  it("answers 401 without reading the body when there is no session", async () => {
    vi.mocked(requireRole).mockRejectedValue(
      new AuthorizationError("UNAUTHENTICATED", "Sign in to access this resource."),
    );
    const json = vi.fn();

    const res = await POST({ json } as unknown as Request);

    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({
      error: "UNAUTHENTICATED",
      message: "Sign in to access this resource.",
    });
    expect(json).not.toHaveBeenCalled();
    expect(createDraft).not.toHaveBeenCalled();
  });

  it.each(["VOLUNTEER", "ADMIN"] as const)("answers 403 for a signed-in %s, without reading the body", async () => {
    vi.mocked(requireRole).mockRejectedValue(
      new AuthorizationError("FORBIDDEN", "Your role cannot access this resource."),
    );
    const json = vi.fn();

    const res = await POST({ json } as unknown as Request);

    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({
      error: "FORBIDDEN",
      message: "Your role cannot access this resource.",
    });
    expect(requireRole).toHaveBeenCalledWith(["DONOR"]);
    expect(json).not.toHaveBeenCalled();
    expect(createDraft).not.toHaveBeenCalled();
  });

  it("answers 400 for a body that is not valid JSON", async () => {
    const res = await post("not-json");

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      error: "INVALID_REQUEST",
      message: "Send a valid JSON request body.",
    });
    expect(createDraft).not.toHaveBeenCalled();
  });

  it("answers 400 for unknown body fields, including donorId and status", async () => {
    const res = await post(JSON.stringify({ ...validBody, donorId: "someone-else", status: "POSTED" }));

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("INVALID_REQUEST");
    const formErrors = body.details.formErrors.join(" ");
    expect(formErrors).toContain("donorId");
    expect(formErrors).toContain("status");
    expect(createDraft).not.toHaveBeenCalled();
  });

  it("answers 400 when a required field is missing", async () => {
    const res = await post(JSON.stringify({ foodCategoryCode: "COOKED_MEALS" }));

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("INVALID_REQUEST");
    expect(Array.isArray(body.details.fieldErrors.foodName)).toBe(true);
    expect(body.details.fieldErrors.foodName.length).toBeGreaterThan(0);
    expect(createDraft).not.toHaveBeenCalled();
  });

  it.each([
    ["DONOR_NOT_ACTIVE", 403],
    ["UNKNOWN_CATEGORY", 422],
    ["UNKNOWN_ALLERGEN", 422],
    ["UNKNOWN_DIETARY_TAG", 422],
    ["CATEGORY_NOT_ALLOWED", 422],
  ] as const)("answers %s with status %i", async (error, status) => {
    vi.mocked(createDraft).mockResolvedValue({ ok: false, error });

    const res = await post(JSON.stringify(validBody));

    expect(res.status).toBe(status);
    const body = await res.json();
    expect(body.error).toBe(error);
    expect(typeof body.message).toBe("string");
  });

  it("creates the draft for the session donor and answers 201", async () => {
    const res = await post(
      JSON.stringify({ ...validBody, description: "Lunch service surplus", allergenCodes: ["PEANUTS"] }),
    );

    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ donationId: VALID_DRAFT_ID });
    expect(requireRole).toHaveBeenCalledWith(["DONOR"]);
    expect(createDraft).toHaveBeenCalledTimes(1);
    const [deps, args] = vi.mocked(createDraft).mock.calls[0];
    expect(deps.store).toBeDefined();
    // The donor id comes from the session, never from the body.
    expect(args.donorId).toBe("donor-1");
    expect(args.input).toMatchObject({
      foodCategoryCode: "COOKED_MEALS",
      foodName: "Chicken adobo",
      portions: 25,
      description: "Lunch service surplus",
      allergenCodes: ["PEANUTS"],
    });
  });

  it("answers 500 with a generic message when the service fails unexpectedly", async () => {
    vi.mocked(createDraft).mockRejectedValue(new Error("database is down"));
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});

    const res = await post(JSON.stringify(validBody));

    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({
      error: "INTERNAL_ERROR",
      message: "The draft could not be created.",
    });
    expect(consoleError).toHaveBeenCalledTimes(1);
    consoleError.mockRestore();
  });
});

describe("GET /api/donor/drafts", () => {
  it("answers 401 when there is no session", async () => {
    vi.mocked(requireRole).mockRejectedValue(
      new AuthorizationError("UNAUTHENTICATED", "Sign in to access this resource."),
    );

    const res = await GET();

    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({
      error: "UNAUTHENTICATED",
      message: "Sign in to access this resource.",
    });
    expect(listDrafts).not.toHaveBeenCalled();
  });

  it.each(["VOLUNTEER", "ADMIN"] as const)("answers 403 for a signed-in %s", async () => {
    vi.mocked(requireRole).mockRejectedValue(
      new AuthorizationError("FORBIDDEN", "Your role cannot access this resource."),
    );

    const res = await GET();

    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({
      error: "FORBIDDEN",
      message: "Your role cannot access this resource.",
    });
    expect(requireRole).toHaveBeenCalledWith(["DONOR"]);
    expect(listDrafts).not.toHaveBeenCalled();
  });

  it("returns the wrapped list for the session donor", async () => {
    const draft: DraftListItem = {
      id: VALID_DRAFT_ID,
      foodName: "Chicken adobo",
      description: null,
      portions: 25,
      status: "DRAFT",
      foodCategoryCode: "COOKED_MEALS",
      allergenCodes: ["PEANUTS"],
      dietaryTagCodes: ["HALAL"],
      createdAt: new Date("2026-11-05T00:00:00.000Z"),
      updatedAt: new Date("2026-11-06T00:00:00.000Z"),
    };
    vi.mocked(listDrafts).mockResolvedValue([draft]);

    const res = await GET();

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      drafts: [
        {
          ...draft,
          createdAt: draft.createdAt.toISOString(),
          updatedAt: draft.updatedAt.toISOString(),
        },
      ],
    });
    expect(listDrafts).toHaveBeenCalledTimes(1);
    const [deps, args] = vi.mocked(listDrafts).mock.calls[0];
    expect(deps.store).toBeDefined();
    // GET has no object id: the list is scoped to the session donor.
    expect(args).toEqual({ donorId: "donor-1" });
  });

  it("answers 500 with a generic message when the service fails unexpectedly", async () => {
    vi.mocked(listDrafts).mockRejectedValue(new Error("database is down"));
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});

    const res = await GET();

    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({
      error: "INTERNAL_ERROR",
      message: "The draft list could not be loaded.",
    });
    expect(consoleError).toHaveBeenCalledTimes(1);
    consoleError.mockRestore();
  });
});
