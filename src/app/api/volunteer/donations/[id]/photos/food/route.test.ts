import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AuthenticatedActor } from "@/contracts/authz";
import { DonationStatus } from "@/contracts/enums";
import { DEFAULT_SIGNED_URL_SECONDS } from "@/lib/storage";
import { AuthorizationError, requireRole } from "@/server/auth/require-role";
import { GET } from "./route";

const mocks = vi.hoisted(() => ({
  store: {
    readDonation: vi.fn(),
    findCurrentVolunteerId: vi.fn(),
    findActiveFoodPhoto: vi.fn(),
  },
  storage: { getSignedUrl: vi.fn() },
}));

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
vi.mock("@/server/volunteer/prisma-pickup-photo-store", () => ({
  prismaPickupPhotoStore: mocks.store,
}));
vi.mock("@/server/storage", () => ({ createServerStorage: () => mocks.storage }));

const DONATION_ID = "11111111-1111-4111-8111-111111111111";
const VOLUNTEER_ID = "volunteer-1";
const OTHER_VOLUNTEER_ID = "volunteer-2";
const FOOD_KEY = "food/22222222-2222-4222-8222-222222222222.jpg";
const SIGNED_URL = "https://storage.example.test/object/sign?token=fake-token";

const volunteerActor: AuthenticatedActor = {
  id: VOLUNTEER_ID,
  email: "volunteer@example.com",
  name: "Test Volunteer",
  role: "VOLUNTEER",
  status: "ACTIVE",
};

function get(id: string): Promise<Response> {
  const request = new Request(`http://localhost/api/volunteer/donations/${id}/photos/food`, {
    method: "GET",
  });
  return GET(request, { params: Promise.resolve({ id }) });
}

function trackedContext(id: string): {
  context: { params: Promise<{ id: string }> };
  reads: () => number;
} {
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

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requireRole).mockResolvedValue(volunteerActor);
  mocks.store.readDonation.mockResolvedValue({
    status: DonationStatus.ASSIGNED,
    deletedAt: null,
  });
  mocks.store.findCurrentVolunteerId.mockResolvedValue(VOLUNTEER_ID);
  mocks.store.findActiveFoodPhoto.mockResolvedValue({
    storageKey: FOOD_KEY,
    mimeType: "image/jpeg",
  });
  mocks.storage.getSignedUrl.mockResolvedValue(SIGNED_URL);
});

describe("GET /api/volunteer/donations/[id]/photos/food", () => {
  it("answers 401 without reading the params when there is no session", async () => {
    vi.mocked(requireRole).mockRejectedValue(
      new AuthorizationError("UNAUTHENTICATED", "Sign in to access this resource."),
    );
    const { context, reads } = trackedContext(DONATION_ID);

    const res = await GET({} as unknown as Request, context);

    expect(res.status).toBe(401);
    expect(reads()).toBe(0);
    expect(mocks.store.readDonation).not.toHaveBeenCalled();
  });

  it.each(["DONOR", "ADMIN"] as const)("answers 403 for a signed-in %s", async () => {
    vi.mocked(requireRole).mockRejectedValue(
      new AuthorizationError("FORBIDDEN", "Your role cannot access this resource."),
    );
    const { context, reads } = trackedContext(DONATION_ID);

    const res = await GET({} as unknown as Request, context);

    expect(res.status).toBe(403);
    expect(requireRole).toHaveBeenCalledWith(["VOLUNTEER"]);
    expect(reads()).toBe(0);
    expect(mocks.store.readDonation).not.toHaveBeenCalled();
  });

  it("answers 400 for an id that is not a uuid", async () => {
    const res = await get("not-a-uuid");

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      error: "INVALID_REQUEST",
      message: "The donation id is invalid.",
    });
    expect(mocks.store.readDonation).not.toHaveBeenCalled();
  });

  it("returns the signed URL with no-store", async () => {
    const res = await get(DONATION_ID);

    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    expect(await res.json()).toEqual({
      url: SIGNED_URL,
      expiresInSeconds: DEFAULT_SIGNED_URL_SECONDS,
      mimeType: "image/jpeg",
    });
    expect(mocks.storage.getSignedUrl).toHaveBeenCalledExactlyOnceWith(
      FOOD_KEY,
      DEFAULT_SIGNED_URL_SECONDS,
    );
  });

  it("never echoes the storage key in the response", async () => {
    const res = await get(DONATION_ID);

    expect(JSON.stringify(await res.json())).not.toContain(FOOD_KEY);
  });

  it.each([
    ["an unknown donation", () => mocks.store.readDonation.mockResolvedValue(null)],
    [
      "another volunteer's assignment",
      () => mocks.store.findCurrentVolunteerId.mockResolvedValue(OTHER_VOLUNTEER_ID),
    ],
    ["no active photo", () => mocks.store.findActiveFoodPhoto.mockResolvedValue(null)],
  ])("answers 404 for %s", async (_label, arrange) => {
    arrange();

    const res = await get(DONATION_ID);

    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({
      error: "NOT_FOUND",
      message: "The photo was not found.",
    });
  });

  it("answers 409 when the pickup is no longer active", async () => {
    mocks.store.readDonation.mockResolvedValue({
      status: DonationStatus.PICKED_UP,
      deletedAt: null,
    });

    const res = await get(DONATION_ID);

    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({
      error: "INVALID_STATE",
      message: "This pickup is no longer active.",
    });
  });

  it("answers 500 with a generic body and a log without the key or URL", async () => {
    mocks.storage.getSignedUrl.mockRejectedValue(
      new Error(`sign failed for ${FOOD_KEY} ${SIGNED_URL}`),
    );
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});

    try {
      const res = await get(DONATION_ID);

      expect(res.status).toBe(500);
      expect(await res.json()).toEqual({
        error: "INTERNAL_ERROR",
        message: "The photo could not be loaded.",
      });
      expect(consoleError).toHaveBeenCalledTimes(1);
      const [label, details] = consoleError.mock.calls[0];
      expect(label).toBe("Donor photo URL failed");
      expect(details).toMatchObject({ donationId: DONATION_ID, errorName: "Error" });
      const logged = JSON.stringify(consoleError.mock.calls);
      expect(logged).not.toContain(FOOD_KEY);
      expect(logged).not.toContain("fake-token");
    } finally {
      consoleError.mockRestore();
    }
  });
});
