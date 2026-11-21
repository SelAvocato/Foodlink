import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AuthenticatedActor } from "@/contracts/authz";
import { DonationStatus, PickupDecision, ScreeningVerdict } from "@/contracts/enums";
import { AuthorizationError, requireRole } from "@/server/auth/require-role";
import { PUT } from "./route";

const mocks = vi.hoisted(() => {
  const tx = {
    getDonationLocked: vi.fn(),
    findCurrentVolunteerId: vi.fn(),
    hasPickupScan: vi.fn(),
    findActivePickupPhoto: vi.fn(),
    findLatestScreening: vi.fn(),
    upsertInspection: vi.fn(),
  };
  const store = {
    readDonation: vi.fn(),
    findCurrentVolunteerId: vi.fn(),
    hasPickupScan: vi.fn(),
    findActivePickupPhoto: vi.fn(),
    findLatestScreening: vi.fn(),
    transaction: vi.fn(async (work: (adapter: typeof tx) => Promise<unknown>) => work(tx)),
  };
  return { tx, store };
});

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
vi.mock("@/server/volunteer/prisma-pickup-inspection-store", () => ({
  prismaPickupInspectionStore: mocks.store,
}));

const DONATION_ID = "11111111-1111-4111-8111-111111111111";
const VOLUNTEER_ID = "volunteer-1";
const PHOTO_ID = "photo-1";

const ALL_YES = {
  matchesDescription: true,
  packagingSealedClean: true,
  looksSmellsNormal: true,
};

const ONE_NO = { ...ALL_YES, packagingSealedClean: false, reason: "The container was open." };

const volunteerActor: AuthenticatedActor = {
  id: VOLUNTEER_ID,
  email: "volunteer@example.com",
  name: "Test Volunteer",
  role: "VOLUNTEER",
  status: "ACTIVE",
};

function put(body: unknown, id = DONATION_ID): Promise<Response> {
  const request = new Request(`http://localhost/api/volunteer/donations/${id}/inspection`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
  return PUT(request, { params: Promise.resolve({ id }) });
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

  mocks.store.readDonation.mockResolvedValue({ status: DonationStatus.ASSIGNED, deletedAt: null });
  mocks.store.findCurrentVolunteerId.mockResolvedValue(VOLUNTEER_ID);
  mocks.store.hasPickupScan.mockResolvedValue(true);
  mocks.store.findActivePickupPhoto.mockResolvedValue({ imageId: PHOTO_ID });
  mocks.store.findLatestScreening.mockResolvedValue({
    screeningId: "screening-1",
    verdict: ScreeningVerdict.PASS,
  });

  mocks.tx.getDonationLocked.mockResolvedValue({
    status: DonationStatus.ASSIGNED,
    deletedAt: null,
  });
  mocks.tx.findCurrentVolunteerId.mockResolvedValue(VOLUNTEER_ID);
  mocks.tx.hasPickupScan.mockResolvedValue(true);
  mocks.tx.findActivePickupPhoto.mockResolvedValue({ imageId: PHOTO_ID });
  mocks.tx.findLatestScreening.mockResolvedValue({
    screeningId: "screening-1",
    verdict: ScreeningVerdict.PASS,
  });
  mocks.tx.upsertInspection.mockResolvedValue(undefined);
});

describe("PUT /api/volunteer/donations/[id]/inspection", () => {
  it("answers 401 without reading the params or the body when there is no session", async () => {
    vi.mocked(requireRole).mockRejectedValue(
      new AuthorizationError("UNAUTHENTICATED", "Sign in to access this resource."),
    );
    const { context, reads } = trackedContext("not-a-uuid");

    const res = await PUT(
      new Request("http://localhost/api/volunteer/donations/x/inspection", {
        method: "PUT",
        body: "{not json",
      }),
      context,
    );

    expect(res.status).toBe(401);
    expect(reads()).toBe(0);
    expect(mocks.store.readDonation).not.toHaveBeenCalled();
  });

  it.each(["DONOR", "ADMIN"] as const)("answers 403 for a signed-in %s", async () => {
    vi.mocked(requireRole).mockRejectedValue(
      new AuthorizationError("FORBIDDEN", "Your role cannot access this resource."),
    );

    const res = await put(ALL_YES);

    expect(res.status).toBe(403);
    expect(requireRole).toHaveBeenCalledWith(["VOLUNTEER"]);
    expect(mocks.store.readDonation).not.toHaveBeenCalled();
  });

  it("answers 400 for an id that is not a uuid", async () => {
    const res = await put(ALL_YES, "not-a-uuid");

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      error: "INVALID_REQUEST",
      message: "The donation id is invalid.",
    });
    expect(mocks.store.readDonation).not.toHaveBeenCalled();
  });

  it("answers 400 for malformed JSON", async () => {
    const res = await put("{not json");

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      error: "INVALID_REQUEST",
      message: "Send a valid JSON request body.",
    });
    expect(mocks.store.readDonation).not.toHaveBeenCalled();
  });

  it.each([
    ["missing answers", { reason: "No." }],
    ["a non-boolean answer", { ...ALL_YES, matchesDescription: "yes" }],
    ["a no without a reason", { ...ALL_YES, looksSmellsNormal: false }],
    ["a client decision", { ...ALL_YES, decision: PickupDecision.ACCEPTED }],
    ["a client volunteer id", { ...ALL_YES, volunteerId: "someone-else" }],
  ])("answers 400 for %s", async (_label, body) => {
    const res = await put(body);

    expect(res.status).toBe(400);
    const parsed = await res.json();
    expect(parsed).toMatchObject({
      error: "INVALID_REQUEST",
      message: "The inspection is invalid.",
    });
    expect(parsed.details).toBeDefined();
    expect(mocks.store.readDonation).not.toHaveBeenCalled();
  });

  it("stores ACCEPTED and answers 200 with no-store", async () => {
    const res = await put(ALL_YES);

    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    const body = await res.json();
    expect(body).toEqual({ decision: PickupDecision.ACCEPTED, inspectedAt: expect.any(String) });
    expect(Number.isNaN(Date.parse(body.inspectedAt))).toBe(false);

    expect(mocks.tx.upsertInspection).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        donationId: DONATION_ID,
        volunteerId: VOLUNTEER_ID,
        photoImageId: PHOTO_ID,
        screeningId: "screening-1",
        matchesDescription: true,
        packagingSealedClean: true,
        looksSmellsNormal: true,
        decision: PickupDecision.ACCEPTED,
        reason: null,
      }),
    );
  });

  it("stores REJECTED and keeps the reason", async () => {
    const res = await put(ONE_NO);

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ decision: PickupDecision.REJECTED });
    expect(mocks.tx.upsertInspection).toHaveBeenCalledWith(
      expect.objectContaining({
        decision: PickupDecision.REJECTED,
        packagingSealedClean: false,
        reason: "The container was open.",
      }),
    );
  });

  it("stores REJECTED when every answer is yes but a reason is sent", async () => {
    const res = await put({ ...ALL_YES, reason: "Not sure about it." });

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ decision: PickupDecision.REJECTED });
    expect(mocks.tx.upsertInspection).toHaveBeenCalledWith(
      expect.objectContaining({
        decision: PickupDecision.REJECTED,
        matchesDescription: true,
        packagingSealedClean: true,
        looksSmellsNormal: true,
        reason: "Not sure about it.",
      }),
    );
  });

  it.each([
    ["NOT_FOUND", 404, "The donation was not found.", () => mocks.store.readDonation.mockResolvedValue(null)],
    [
      "INVALID_STATE",
      409,
      "This pickup can no longer be inspected.",
      () =>
        mocks.store.readDonation.mockResolvedValue({
          status: DonationStatus.PICKED_UP,
          deletedAt: null,
        }),
    ],
    [
      "SCAN_REQUIRED",
      409,
      "Scan the donation label before the inspection.",
      () => mocks.store.hasPickupScan.mockResolvedValue(false),
    ],
    [
      "PHOTO_REQUIRED",
      409,
      "Add the pickup photo before the inspection.",
      () => mocks.store.findActivePickupPhoto.mockResolvedValue(null),
    ],
    [
      "SCREENING_BLOCKED",
      409,
      "The photo failed visual screening. Reject the pickup or retake the photo.",
      () =>
        mocks.store.findLatestScreening.mockResolvedValue({
          screeningId: "flag-1",
          verdict: ScreeningVerdict.FLAG,
        }),
    ],
  ] as const)("answers %s with status %i", async (error, status, message, arrange) => {
    arrange();

    const res = await put(ALL_YES);

    expect(res.status).toBe(status);
    expect(await res.json()).toEqual({ error, message });
    expect(mocks.tx.upsertInspection).not.toHaveBeenCalled();
  });

  it("answers 500 with a generic body and a log without the answers", async () => {
    mocks.tx.upsertInspection.mockRejectedValue(
      new Error("deadlock while saving The container was open."),
    );
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});

    try {
      const res = await put(ONE_NO);

      expect(res.status).toBe(500);
      expect(await res.json()).toEqual({
        error: "INTERNAL_ERROR",
        message: "The inspection could not be saved.",
      });
      expect(consoleError).toHaveBeenCalledTimes(1);
      const [label, details] = consoleError.mock.calls[0];
      expect(label).toBe("Pickup inspection failed");
      expect(details).toMatchObject({ donationId: DONATION_ID, errorName: "Error" });
      const logged = JSON.stringify(consoleError.mock.calls);
      expect(logged).not.toContain("container was open");
      expect(logged).not.toContain("deadlock while saving");
    } finally {
      consoleError.mockRestore();
    }
  });
});
