import { describe, expect, it, vi } from "vitest";
import { DonationStatus } from "@/contracts/enums";
import { DEFAULT_SIGNED_URL_SECONDS } from "@/lib/storage";
import {
  getDonorPhotoUrl,
  type DonorPhoto,
  type DonorPhotoDonation,
  type DonorPhotoUrlStore,
} from "./donor-photo-url";

const DONATION_ID = "11111111-1111-4111-8111-111111111111";
const VOLUNTEER_ID = "33333333-3333-4333-8333-333333333333";
const OTHER_VOLUNTEER_ID = "44444444-4444-4444-8444-444444444444";
const STORAGE_KEY = "food/22222222-2222-4222-8222-222222222222.jpg";
const SIGNED_URL = "https://storage.example.test/object/sign?token=fake-token";
const DELETED_AT = new Date("2026-11-17T08:00:00.000Z");

function donation(overrides: Partial<DonorPhotoDonation> = {}): DonorPhotoDonation {
  return { status: DonationStatus.ASSIGNED, deletedAt: null, ...overrides };
}

function fakeStore(
  options: {
    donation?: DonorPhotoDonation | null;
    volunteerId?: string | null;
    photo?: DonorPhoto | null;
  } = {},
) {
  const store: DonorPhotoUrlStore = {
    readDonation: vi.fn(async () => (options.donation === undefined ? donation() : options.donation)),
    findCurrentVolunteerId: vi.fn(async () =>
      options.volunteerId === undefined ? VOLUNTEER_ID : options.volunteerId,
    ),
    findActiveFoodPhoto: vi.fn(
      async (): Promise<DonorPhoto | null> =>
        options.photo === undefined
          ? { storageKey: STORAGE_KEY, mimeType: "image/jpeg" }
          : options.photo,
    ),
  };
  return store;
}

function storage() {
  return { getSignedUrl: vi.fn(async () => SIGNED_URL) };
}

function run(store: DonorPhotoUrlStore, overrides: { volunteerId?: string } = {}) {
  return getDonorPhotoUrl(
    { store, storage: storage() },
    { volunteerId: overrides.volunteerId ?? VOLUNTEER_ID, donationId: DONATION_ID },
  );
}

describe("getDonorPhotoUrl", () => {
  it("returns a short-lived URL to the donor's food photo", async () => {
    const store = fakeStore();
    const urlStorage = storage();

    const result = await getDonorPhotoUrl(
      { store, storage: urlStorage },
      { volunteerId: VOLUNTEER_ID, donationId: DONATION_ID },
    );

    expect(result).toEqual({
      ok: true,
      url: SIGNED_URL,
      expiresInSeconds: DEFAULT_SIGNED_URL_SECONDS,
      mimeType: "image/jpeg",
    });
    expect(urlStorage.getSignedUrl).toHaveBeenCalledExactlyOnceWith(
      STORAGE_KEY,
      DEFAULT_SIGNED_URL_SECONDS,
    );
  });

  it("never returns the storage key", async () => {
    const result = await run(fakeStore());

    expect(JSON.stringify(result)).not.toContain(STORAGE_KEY);
  });

  it.each([
    ["an unknown donation", { donation: null }],
    ["a discarded donation", { donation: donation({ deletedAt: DELETED_AT }) }],
    ["another volunteer's assignment", { volunteerId: OTHER_VOLUNTEER_ID }],
    ["no current assignment", { volunteerId: null }],
    ["no active food photo", { photo: null }],
  ])("answers NOT_FOUND for %s", async (_label, options) => {
    expect(await run(fakeStore(options))).toEqual({ ok: false, error: "NOT_FOUND" });
  });

  it("answers INVALID_STATE when the donation is no longer ASSIGNED", async () => {
    const store = fakeStore({ donation: donation({ status: DonationStatus.PICKED_UP }) });

    expect(await run(store)).toEqual({ ok: false, error: "INVALID_STATE" });
  });

  it("hides the state from a volunteer who is not assigned", async () => {
    const store = fakeStore({
      donation: donation({ status: DonationStatus.POSTED }),
      volunteerId: OTHER_VOLUNTEER_ID,
    });

    expect(await run(store)).toEqual({ ok: false, error: "NOT_FOUND" });
  });
});
