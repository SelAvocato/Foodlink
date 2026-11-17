import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AuthenticatedActor } from "@/contracts/authz";
import { DonationStatus } from "@/contracts/enums";
import { MAX_PICKUP_PHOTO_BYTES, PICKUP_PHOTO_MESSAGE } from "@/contracts/volunteer-pickup-photo";
import { AuthorizationError, requireRole } from "@/server/auth/require-role";
import { POST } from "./route";

const mocks = vi.hoisted(() => {
  const tx = {
    getDonationLocked: vi.fn(),
    findCurrentVolunteerId: vi.fn(),
    hasPickupScan: vi.fn(),
    hasInspection: vi.fn(),
    softDeleteActivePickupPhoto: vi.fn(),
    insertPickupPhoto: vi.fn(),
    insertScreening: vi.fn(),
  };
  const store = {
    readDonation: vi.fn(),
    findCurrentVolunteerId: vi.fn(),
    hasPickupScan: vi.fn(),
    hasInspection: vi.fn(),
    transaction: vi.fn(async (work: (adapter: typeof tx) => Promise<unknown>) => work(tx)),
  };
  const storage = { uploadImage: vi.fn(), getSignedUrl: vi.fn(), removeObject: vi.fn() };
  return { tx, store, storage };
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
vi.mock("@/server/volunteer/prisma-pickup-photo-store", () => ({
  prismaPickupPhotoStore: mocks.store,
}));
vi.mock("@/server/storage", () => ({ createServerStorage: () => mocks.storage }));

const DONATION_ID = "11111111-1111-4111-8111-111111111111";
const VOLUNTEER_ID = "volunteer-1";
const NEW_KEY = "pickup/22222222-2222-4222-8222-222222222222.jpg";
const SIGNED_URL = "https://storage.example.test/object/sign?token=fake-token";
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46]);

const volunteerActor: AuthenticatedActor = {
  id: VOLUNTEER_ID,
  email: "volunteer@example.com",
  name: "Test Volunteer",
  role: "VOLUNTEER",
  status: "ACTIVE",
};

function photoFile(bytes: Uint8Array<ArrayBuffer> = JPEG, type = "image/jpeg"): File {
  return new File([bytes], "photo.jpg", { type });
}

function multipart(fields: Record<string, string | File>): FormData {
  const form = new FormData();
  for (const [name, value] of Object.entries(fields)) form.set(name, value);
  return form;
}

function post(id: string, body: BodyInit): Promise<Response> {
  const request = new Request(`http://localhost/api/volunteer/donations/${id}/photos/pickup`, {
    method: "POST",
    body,
  });
  return POST(request, { params: Promise.resolve({ id }) });
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
  mocks.store.hasInspection.mockResolvedValue(false);
  mocks.tx.getDonationLocked.mockResolvedValue({
    status: DonationStatus.ASSIGNED,
    deletedAt: null,
  });
  mocks.tx.findCurrentVolunteerId.mockResolvedValue(VOLUNTEER_ID);
  mocks.tx.hasPickupScan.mockResolvedValue(true);
  mocks.tx.hasInspection.mockResolvedValue(false);
  mocks.tx.softDeleteActivePickupPhoto.mockResolvedValue([]);
  mocks.tx.insertPickupPhoto.mockResolvedValue({ id: "image-1" });
  mocks.tx.insertScreening.mockResolvedValue({ id: "screening-1" });

  mocks.storage.uploadImage.mockResolvedValue({ key: NEW_KEY });
  mocks.storage.getSignedUrl.mockResolvedValue(SIGNED_URL);
  mocks.storage.removeObject.mockResolvedValue(undefined);
});

describe("POST /api/volunteer/donations/[id]/photos/pickup", () => {
  it("answers 401 without reading the params or the form body when there is no session", async () => {
    vi.mocked(requireRole).mockRejectedValue(
      new AuthorizationError("UNAUTHENTICATED", "Sign in to access this resource."),
    );
    const formData = vi.fn();
    const { context, reads } = trackedContext(DONATION_ID);

    const res = await POST({ formData } as unknown as Request, context);

    expect(res.status).toBe(401);
    expect(reads()).toBe(0);
    expect(formData).not.toHaveBeenCalled();
    expect(mocks.storage.uploadImage).not.toHaveBeenCalled();
  });

  it.each(["DONOR", "ADMIN"] as const)(
    "answers 403 for a signed-in %s, without reading the params or the form body",
    async () => {
      vi.mocked(requireRole).mockRejectedValue(
        new AuthorizationError("FORBIDDEN", "Your role cannot access this resource."),
      );
      const formData = vi.fn();
      const { context, reads } = trackedContext(DONATION_ID);

      const res = await POST({ formData } as unknown as Request, context);

      expect(res.status).toBe(403);
      expect(requireRole).toHaveBeenCalledWith(["VOLUNTEER"]);
      expect(reads()).toBe(0);
      expect(formData).not.toHaveBeenCalled();
    },
  );

  it("answers 400 for an id that is not a uuid, without reading the form body", async () => {
    const formData = vi.fn();

    const res = await POST({ formData } as unknown as Request, {
      params: Promise.resolve({ id: "not-a-uuid" }),
    });

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      error: "INVALID_REQUEST",
      message: "The donation id is invalid.",
    });
    expect(formData).not.toHaveBeenCalled();
  });

  it("answers 400 when the body is not multipart form data", async () => {
    const res = await post(DONATION_ID, "not-a-form");

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      error: "INVALID_REQUEST",
      message: "Send the photo as multipart form data.",
    });
    expect(mocks.storage.uploadImage).not.toHaveBeenCalled();
  });

  it("answers 400 when the photo field is missing", async () => {
    const res = await post(DONATION_ID, multipart({ volunteerId: "someone-else" }));

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "INVALID_REQUEST", message: PICKUP_PHOTO_MESSAGE });
    expect(mocks.storage.uploadImage).not.toHaveBeenCalled();
  });

  it("answers 400 for bytes that are not a JPEG, PNG or WebP", async () => {
    const res = await post(
      DONATION_ID,
      multipart({ photo: photoFile(new TextEncoder().encode("not an image")) }),
    );

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "INVALID_REQUEST", message: PICKUP_PHOTO_MESSAGE });
    expect(mocks.storage.uploadImage).not.toHaveBeenCalled();
  });

  it("answers 400 for a photo over 4 MB", async () => {
    const res = await post(
      DONATION_ID,
      multipart({ photo: photoFile(new Uint8Array(MAX_PICKUP_PHOTO_BYTES + 1)) }),
    );

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "INVALID_REQUEST", message: PICKUP_PHOTO_MESSAGE });
    expect(mocks.storage.uploadImage).not.toHaveBeenCalled();
  });

  it.each([
    ["SCAN_REQUIRED", 409, "Scan the donation label before adding a photo."],
    ["INVALID_STATE", 409, "This pickup can no longer be updated."],
    ["NOT_FOUND", 404, "The donation was not found."],
  ] as const)("answers %s with status %i", async (error, status, message) => {
    if (error === "SCAN_REQUIRED") mocks.store.hasPickupScan.mockResolvedValue(false);
    if (error === "INVALID_STATE") {
      mocks.store.readDonation.mockResolvedValue({
        status: DonationStatus.PICKED_UP,
        deletedAt: null,
      });
    }
    if (error === "NOT_FOUND") mocks.store.findCurrentVolunteerId.mockResolvedValue(null);

    const res = await post(DONATION_ID, multipart({ photo: photoFile() }));

    expect(res.status).toBe(status);
    expect(await res.json()).toEqual({ error, message });
    expect(mocks.storage.uploadImage).not.toHaveBeenCalled();
  });

  it("uploads, screens and answers 201 with the session volunteer id", async () => {
    const res = await post(DONATION_ID, multipart({ photo: photoFile(), volunteerId: "someone-else" }));

    expect(res.status).toBe(201);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    expect(await res.json()).toEqual({ verdict: "PASS", screeningId: "screening-1" });
    expect(requireRole).toHaveBeenCalledWith(["VOLUNTEER"]);
    expect(mocks.storage.uploadImage).toHaveBeenCalledExactlyOnceWith({
      folder: "pickup",
      contentType: "image/jpeg",
      data: JPEG,
    });
    expect(mocks.tx.insertPickupPhoto).toHaveBeenCalledExactlyOnceWith({
      donationId: DONATION_ID,
      uploadedByUserId: VOLUNTEER_ID,
      storageKey: NEW_KEY,
      mimeType: "image/jpeg",
      sizeBytes: JPEG.byteLength,
    });
  });

  it("never echoes the storage key in the response", async () => {
    const res = await post(DONATION_ID, multipart({ photo: photoFile() }));

    expect(JSON.stringify(await res.json())).not.toContain(NEW_KEY);
  });

  it("answers 500 with a generic body and a log without the key", async () => {
    mocks.storage.uploadImage.mockRejectedValue(new Error(`upload failed for ${NEW_KEY}`));
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});

    try {
      const res = await post(DONATION_ID, multipart({ photo: photoFile() }));

      expect(res.status).toBe(500);
      expect(await res.json()).toEqual({
        error: "INTERNAL_ERROR",
        message: "The photo could not be saved.",
      });
      expect(consoleError).toHaveBeenCalledTimes(1);
      const [label, details] = consoleError.mock.calls[0];
      expect(label).toBe("Pickup photo upload failed");
      expect(details).toMatchObject({ donationId: DONATION_ID, errorName: "Error" });
      const logged = JSON.stringify(consoleError.mock.calls);
      expect(logged).not.toContain(NEW_KEY);
      expect(logged).not.toContain("upload failed for");
    } finally {
      consoleError.mockRestore();
    }
  });
});
