import { describe, expect, it, vi } from "vitest";
import { DonationStatus, PickupDecision, ScreeningVerdict } from "@/contracts/enums";
import type { PickupInspectionInput } from "@/contracts/volunteer-pickup-inspection";
import {
  savePickupInspection,
  type InspectionDonation,
  type InspectionScreening,
  type InspectionUpsert,
  type PickupInspectionStore,
  type PickupInspectionTx,
  type PickupPhotoRef,
} from "./pickup-inspection";

const DONATION_ID = "11111111-1111-4111-8111-111111111111";
const VOLUNTEER_ID = "33333333-3333-4333-8333-333333333333";
const OTHER_VOLUNTEER_ID = "44444444-4444-4444-8444-444444444444";
const PHOTO_ID = "photo-1";
const OTHER_PHOTO_ID = "photo-2";
const NOW = new Date("2026-11-17T09:30:00.000Z");
const DELETED_AT = new Date("2026-11-17T08:00:00.000Z");

const ALL_YES: PickupInspectionInput = {
  matchesDescription: true,
  packagingSealedClean: true,
  looksSmellsNormal: true,
};

const ONE_NO: PickupInspectionInput = {
  matchesDescription: true,
  packagingSealedClean: false,
  looksSmellsNormal: true,
  reason: "The container was open.",
};

function donation(overrides: Partial<InspectionDonation> = {}): InspectionDonation {
  return { status: DonationStatus.ASSIGNED, deletedAt: null, ...overrides };
}

type LockOverride = {
  donation?: InspectionDonation | null;
  volunteerId?: string | null;
  scan?: boolean;
  photo?: PickupPhotoRef | null;
  screening?: InspectionScreening | null;
};

class FakeStore implements PickupInspectionStore {
  donation: InspectionDonation | null = donation();
  currentVolunteerId: string | null = VOLUNTEER_ID;
  scan = true;
  photo: PickupPhotoRef | null = { imageId: PHOTO_ID };
  screening: InspectionScreening | null = {
    screeningId: "screening-1",
    verdict: ScreeningVerdict.PASS,
  };
  rows = new Map<string, InspectionUpsert>();
  upserts: InspectionUpsert[] = [];
  screeningLookups: string[] = [];
  atLock: LockOverride | undefined = undefined;

  async readDonation(): Promise<InspectionDonation | null> {
    return this.donation;
  }

  async findCurrentVolunteerId(): Promise<string | null> {
    return this.currentVolunteerId;
  }

  async hasPickupScan(donationId: string, volunteerId: string): Promise<boolean> {
    void donationId;
    void volunteerId;
    return this.scan;
  }

  async findActivePickupPhoto(): Promise<PickupPhotoRef | null> {
    return this.photo;
  }

  async findLatestScreening(imageId: string): Promise<InspectionScreening | null> {
    this.screeningLookups.push(imageId);
    return this.screening;
  }

  async transaction<T>(work: (tx: PickupInspectionTx) => Promise<T>): Promise<T> {
    const snapshot = new Map(this.rows);
    try {
      return await work(this.createTx());
    } catch (error) {
      this.rows = snapshot;
      throw error;
    }
  }

  private createTx(): PickupInspectionTx {
    const at = this.atLock;
    return {
      getDonationLocked: async () =>
        at && "donation" in at ? (at.donation ?? null) : this.donation,
      findCurrentVolunteerId: async () =>
        at && "volunteerId" in at ? (at.volunteerId ?? null) : this.currentVolunteerId,
      hasPickupScan: async () => at?.scan ?? this.scan,
      findActivePickupPhoto: async () =>
        at && "photo" in at ? (at.photo ?? null) : this.photo,
      findLatestScreening: async (imageId) => {
        this.screeningLookups.push(imageId);
        return at && "screening" in at ? (at.screening ?? null) : this.screening;
      },
      upsertInspection: async (row) => {
        this.upserts.push(row);
        this.rows.set(row.donationId, row);
      },
    };
  }
}

function save(store: PickupInspectionStore, input: PickupInspectionInput = ALL_YES) {
  return savePickupInspection(
    { store, now: () => NOW },
    { volunteerId: VOLUNTEER_ID, donationId: DONATION_ID, input },
  );
}

describe("savePickupInspection", () => {
  it("derives ACCEPTED from three yes answers and stores the row", async () => {
    const store = new FakeStore();

    const result = await save(store);

    expect(result).toEqual({ ok: true, decision: PickupDecision.ACCEPTED, inspectedAt: NOW });
    expect(store.upserts).toEqual([
      {
        donationId: DONATION_ID,
        volunteerId: VOLUNTEER_ID,
        photoImageId: PHOTO_ID,
        screeningId: "screening-1",
        matchesDescription: true,
        packagingSealedClean: true,
        looksSmellsNormal: true,
        decision: PickupDecision.ACCEPTED,
        reason: null,
        inspectedAt: NOW,
      },
    ]);
  });

  it("derives REJECTED from a no answer and keeps the reason", async () => {
    const store = new FakeStore();

    const result = await save(store, ONE_NO);

    expect(result).toEqual({ ok: true, decision: PickupDecision.REJECTED, inspectedAt: NOW });
    expect(store.upserts[0]).toMatchObject({
      decision: PickupDecision.REJECTED,
      packagingSealedClean: false,
      reason: "The container was open.",
    });
  });

  it("uses the newest screening of the active photo", async () => {
    const store = new FakeStore();

    await save(store);

    expect(store.screeningLookups).toEqual([PHOTO_ID, PHOTO_ID]);
  });

  it("allows ACCEPTED on a REVIEW screening", async () => {
    const store = new FakeStore();
    store.screening = { screeningId: "review-1", verdict: ScreeningVerdict.REVIEW };

    expect(await save(store)).toMatchObject({ ok: true, decision: PickupDecision.ACCEPTED });
  });

  it("blocks ACCEPTED on a FLAG screening", async () => {
    const store = new FakeStore();
    store.screening = { screeningId: "flag-1", verdict: ScreeningVerdict.FLAG };

    const result = await save(store);

    expect(result).toEqual({ ok: false, error: "SCREENING_BLOCKED" });
    expect(store.upserts).toEqual([]);
  });

  it("still allows REJECTED on a FLAG screening", async () => {
    const store = new FakeStore();
    store.screening = { screeningId: "flag-1", verdict: ScreeningVerdict.FLAG };

    expect(await save(store, ONE_NO)).toMatchObject({
      ok: true,
      decision: PickupDecision.REJECTED,
    });
  });

  it("replaces the row on a re-save while the donation is ASSIGNED", async () => {
    const store = new FakeStore();

    await save(store);
    await save(store, ONE_NO);

    expect(store.upserts).toHaveLength(2);
    expect(store.rows.size).toBe(1);
    expect(store.rows.get(DONATION_ID)).toMatchObject({
      decision: PickupDecision.REJECTED,
      reason: "The container was open.",
    });
  });

  it.each([
    ["an unknown donation", (store: FakeStore) => (store.donation = null)],
    ["a discarded donation", (store: FakeStore) => (store.donation = donation({ deletedAt: DELETED_AT }))],
    ["another volunteer's assignment", (store: FakeStore) => (store.currentVolunteerId = OTHER_VOLUNTEER_ID)],
    ["no current assignment", (store: FakeStore) => (store.currentVolunteerId = null)],
  ])("answers NOT_FOUND for %s", async (_label, arrange) => {
    const store = new FakeStore();
    arrange(store);

    expect(await save(store)).toEqual({ ok: false, error: "NOT_FOUND" });
    expect(store.upserts).toEqual([]);
  });

  it("hides the state from a volunteer who is not assigned", async () => {
    const store = new FakeStore();
    store.donation = donation({ status: DonationStatus.POSTED });
    store.currentVolunteerId = OTHER_VOLUNTEER_ID;

    expect(await save(store)).toEqual({ ok: false, error: "NOT_FOUND" });
  });

  it("answers INVALID_STATE when the donation is no longer ASSIGNED", async () => {
    const store = new FakeStore();
    store.donation = donation({ status: DonationStatus.PICKED_UP });

    expect(await save(store)).toEqual({ ok: false, error: "INVALID_STATE" });
    expect(store.upserts).toEqual([]);
  });

  it("answers SCAN_REQUIRED before the photo checks", async () => {
    const store = new FakeStore();
    store.scan = false;

    expect(await save(store)).toEqual({ ok: false, error: "SCAN_REQUIRED" });
    expect(store.screeningLookups).toEqual([]);
    expect(store.upserts).toEqual([]);
  });

  it.each([
    ["no active pickup photo", (store: FakeStore) => (store.photo = null)],
    ["no screening for the photo", (store: FakeStore) => (store.screening = null)],
  ])("answers PHOTO_REQUIRED for %s", async (_label, arrange) => {
    const store = new FakeStore();
    arrange(store);

    expect(await save(store)).toEqual({ ok: false, error: "PHOTO_REQUIRED" });
    expect(store.upserts).toEqual([]);
  });

  it("re-checks the state under the lock and writes nothing on a race", async () => {
    const store = new FakeStore();
    store.atLock = { donation: donation({ status: DonationStatus.PICKED_UP }) };

    expect(await save(store)).toEqual({ ok: false, error: "INVALID_STATE" });
    expect(store.upserts).toEqual([]);
  });

  it("re-checks the photo and screening under the lock", async () => {
    const store = new FakeStore();
    store.atLock = {
      photo: { imageId: OTHER_PHOTO_ID },
      screening: { screeningId: "flag-2", verdict: ScreeningVerdict.FLAG },
    };

    expect(await save(store)).toEqual({ ok: false, error: "SCREENING_BLOCKED" });
    expect(store.upserts).toEqual([]);
  });

  it("writes nothing when the transaction fails", async () => {
    const store = new FakeStore();
    vi.spyOn(store, "transaction").mockRejectedValue(new Error("deadlock"));

    await expect(save(store)).rejects.toThrow("deadlock");

    expect(store.upserts).toEqual([]);
    expect(store.rows.size).toBe(0);
  });
});
