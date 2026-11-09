import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AuthenticatedActor } from "@/contracts/authz";
import { AuthorizationError, requireRole } from "@/server/auth/require-role";
import { ScreeningVerdict } from "@/contracts/enums";
import { screenDraftPhoto } from "@/server/screening/screen-draft-photo";
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
vi.mock("@/server/screening/screen-draft-photo", () => ({ screenDraftPhoto: vi.fn() }));
vi.mock("@/server/screening/prisma-screening-store", () => ({ prismaScreeningStore: {} }));
vi.mock("@/server/screening/screening-transition", () => ({
  createScreeningTransition: vi.fn(() => ({})),
}));
vi.mock("@/server/screening/get-provider", () => ({ getScreeningProvider: vi.fn(() => ({})) }));
vi.mock("@/server/storage", () => ({ createServerStorage: vi.fn(() => ({})) }));

const VALID_ID = "11111111-1111-4111-8111-111111111111";
const SCREENING_ID = "22222222-2222-4222-8222-222222222222";
const REASON = "Photo failed visual screening: mold.";
const SIGNED_URL = "https://storage.example.test/object/sign?token=fake-token";
const STORAGE_KEY = "food/44444444-4444-4444-8444-444444444444.jpg";

const donorActor: AuthenticatedActor = {
  id: "donor-1",
  email: "donor@example.com",
  name: "Test Donor",
  role: "DONOR",
  status: "ACTIVE",
};

function post(id: string, request?: Request): Promise<Response> {
  const req = request ?? new Request(`http://localhost/api/donor/drafts/${id}/screening`, { method: "POST" });
  return POST(req, { params: Promise.resolve({ id }) });
}

/**
 * A params promise that counts how often it is awaited, so a refusal test can
 * prove requireRole() ran before the URL was read.
 */
function trackedContext(id: string): { context: { params: Promise<{ id: string }> }; reads: () => number } {
  let reads = 0;
  const resolved = Promise.resolve({ id });
  const thenable = {
    then(
      onFulfilled: (value: { id: string }) => unknown,
      onRejected?: (reason: unknown) => unknown,
    ) {
      reads += 1;
      return resolved.then(onFulfilled, onRejected);
    },
  };
  return { context: { params: thenable as unknown as Promise<{ id: string }> }, reads: () => reads };
}

/** A request whose body readers throw or spy on any use: the route reads no body. */
function bodyGuard(): { request: Request; bodyReaders: ReturnType<typeof vi.fn>[] } {
  const bodyReaders = [
    vi.fn(() => {
      throw new Error("json() must not be called");
    }),
    vi.fn(() => {
      throw new Error("formData() must not be called");
    }),
    vi.fn(() => {
      throw new Error("text() must not be called");
    }),
  ];
  const request = {
    json: bodyReaders[0],
    formData: bodyReaders[1],
    text: bodyReaders[2],
  } as unknown as Request;
  return { request, bodyReaders };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requireRole).mockResolvedValue(donorActor);
  vi.mocked(screenDraftPhoto).mockResolvedValue({
    ok: true,
    verdict: ScreeningVerdict.PASS,
    screeningId: SCREENING_ID,
    donationStatus: "SCREENED",
  });
});

describe("POST /api/donor/drafts/[id]/screening", () => {
  it("answers 401 without reading the params when there is no session", async () => {
    vi.mocked(requireRole).mockRejectedValue(
      new AuthorizationError("UNAUTHENTICATED", "Sign in to access this resource."),
    );
    const { context, reads } = trackedContext(VALID_ID);

    const res = await POST({} as unknown as Request, context);

    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({
      error: "UNAUTHENTICATED",
      message: "Sign in to access this resource.",
    });
    expect(reads()).toBe(0);
    expect(screenDraftPhoto).not.toHaveBeenCalled();
  });

  it.each(["VOLUNTEER", "ADMIN"] as const)(
    "answers 403 for a signed-in %s, without reading the params",
    async () => {
      vi.mocked(requireRole).mockRejectedValue(
        new AuthorizationError("FORBIDDEN", "Your role cannot access this resource."),
      );
      const { context, reads } = trackedContext(VALID_ID);

      const res = await POST({} as unknown as Request, context);

      expect(res.status).toBe(403);
      expect(await res.json()).toEqual({
        error: "FORBIDDEN",
        message: "Your role cannot access this resource.",
      });
      expect(requireRole).toHaveBeenCalledWith(["DONOR"]);
      expect(reads()).toBe(0);
      expect(screenDraftPhoto).not.toHaveBeenCalled();
    },
  );

  it("answers 400 for an id that is not a uuid", async () => {
    const res = await post("not-a-uuid");

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      error: "INVALID_REQUEST",
      message: "The draft id is invalid.",
    });
    expect(screenDraftPhoto).not.toHaveBeenCalled();
  });

  it.each([
    ["NOT_FOUND", 404, "The draft was not found."],
    ["NOT_EDITABLE", 409, "That draft can no longer be screened."],
    ["REVIEW_PENDING", 409, "Your photo is waiting for review."],
    ["PHOTO_REQUIRED", 409, "Upload a photo before screening."],
    ["PHOTO_CHANGED", 409, "The photo changed during screening. Try again."],
  ] as const)("answers %s with status %i", async (error, status, message) => {
    vi.mocked(screenDraftPhoto).mockResolvedValue({ ok: false, error });

    const res = await post(VALID_ID);

    expect(res.status).toBe(status);
    expect(await res.json()).toEqual({ error, message });
  });

  it("answers 200 with the PASS shape and no reason", async () => {
    const res = await post(VALID_ID);

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({
      donationId: VALID_ID,
      verdict: ScreeningVerdict.PASS,
      donationStatus: "SCREENED",
    });
    expect(body).not.toHaveProperty("reason");
  });

  it("answers 200 with the rejection reason for a FLAG", async () => {
    vi.mocked(screenDraftPhoto).mockResolvedValue({
      ok: true,
      verdict: ScreeningVerdict.FLAG,
      screeningId: SCREENING_ID,
      donationStatus: "REJECTED",
      reason: REASON,
    });

    const res = await post(VALID_ID);

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      donationId: VALID_ID,
      verdict: ScreeningVerdict.FLAG,
      donationStatus: "REJECTED",
      reason: REASON,
    });
  });

  it("answers 200 with the REVIEW shape and no reason", async () => {
    vi.mocked(screenDraftPhoto).mockResolvedValue({
      ok: true,
      verdict: ScreeningVerdict.REVIEW,
      screeningId: SCREENING_ID,
      donationStatus: "DRAFT",
    });

    const res = await post(VALID_ID);

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({
      donationId: VALID_ID,
      verdict: ScreeningVerdict.REVIEW,
      donationStatus: "DRAFT",
    });
    expect(body).not.toHaveProperty("reason");
  });

  it("passes the session donor id and defined dependencies to the service", async () => {
    const res = await post(VALID_ID);

    expect(res.status).toBe(200);
    expect(requireRole).toHaveBeenCalledWith(["DONOR"]);
    expect(screenDraftPhoto).toHaveBeenCalledTimes(1);
    const [deps, args] = vi.mocked(screenDraftPhoto).mock.calls[0];
    expect(deps.store).toBeDefined();
    expect(deps.storage).toBeDefined();
    expect(deps.provider).toBeDefined();
    expect(deps.transition).toBeDefined();
    // The donor id comes from the session, never from the request.
    expect(args.donorId).toBe("donor-1");
    expect(args.donationId).toBe(VALID_ID);
  });

  it("answers 404 for another donor's draft", async () => {
    vi.mocked(screenDraftPhoto).mockResolvedValue({ ok: false, error: "NOT_FOUND" });

    const res = await post(VALID_ID);

    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "NOT_FOUND", message: "The draft was not found." });
    expect(vi.mocked(screenDraftPhoto).mock.calls[0][1].donorId).toBe("donor-1");
  });

  it("never reads the request body", async () => {
    const { request, bodyReaders } = bodyGuard();

    const res = await post(VALID_ID, request);

    expect(res.status).toBe(200);
    for (const reader of bodyReaders) expect(reader).not.toHaveBeenCalled();
  });

  it("answers 500 with a generic message and logs ids plus the safe error summary only", async () => {
    vi.mocked(screenDraftPhoto).mockRejectedValue(
      new Error(`provider failed for ${STORAGE_KEY} at ${SIGNED_URL}`),
    );
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});

    try {
      const res = await post(VALID_ID);

      expect(res.status).toBe(500);
      expect(await res.json()).toEqual({
        error: "INTERNAL_ERROR",
        message: "The photo could not be screened.",
      });
      expect(consoleError).toHaveBeenCalledTimes(1);
      const [label, details] = consoleError.mock.calls[0];
      expect(label).toBe("Screening failed");
      expect(details).toMatchObject({ donationId: VALID_ID, errorName: "Error" });

      const logged = JSON.stringify(consoleError.mock.calls);
      expect(logged).not.toContain(STORAGE_KEY);
      expect(logged).not.toContain(SIGNED_URL);
      expect(logged).not.toContain("provider failed");
    } finally {
      consoleError.mockRestore();
    }
  });
});
