import { describe, expect, it, vi } from "vitest";
import { DonationStatus } from "@/contracts/enums";
import {
  readVolunteerDonationDetail,
  type VolunteerDonationDetailRow,
  type VolunteerDonationDetailStore,
} from "./donation-detail";

const VOLUNTEER_ID = "33333333-3333-4333-8333-333333333333";
const DONATION_ID = "abcdef12-3456-4789-8abc-def012345678";

// Local constructor times, never fixed Z strings.
const PICKUP_START = new Date(2026, 10, 21, 15, 0);
const PICKUP_END = new Date(2026, 10, 21, 18, 0);

function row(overrides: Partial<VolunteerDonationDetailRow> = {}): VolunteerDonationDetailRow {
  return {
    donationId: DONATION_ID,
    foodName: "Chicken adobo",
    category: "Cooked meals",
    portions: 25,
    status: DonationStatus.ASSIGNED,
    pickupAddress: "12 Mabini St, Quezon City",
    pickupStart: PICKUP_START,
    pickupEnd: PICKUP_END,
    donorName: "Test Bakery",
    donorPhone: "+639170000000",
    ...overrides,
  };
}

function fakeStore(task: VolunteerDonationDetailRow | null = row()) {
  const findTask = vi.fn<VolunteerDonationDetailStore["findTask"]>(async () => task);
  const store: VolunteerDonationDetailStore = { findTask };
  return { store, findTask };
}

function run(store: VolunteerDonationDetailStore) {
  return readVolunteerDonationDetail(
    { store },
    { volunteerId: VOLUNTEER_ID, donationId: DONATION_ID },
  );
}

describe("readVolunteerDonationDetail", () => {
  it("asks for the signed-in volunteer, the id and the list statuses", async () => {
    const { store, findTask } = fakeStore();

    await run(store);

    expect(findTask).toHaveBeenCalledTimes(1);
    expect(findTask).toHaveBeenCalledWith({
      volunteerId: VOLUNTEER_ID,
      donationId: DONATION_ID,
      statuses: [DonationStatus.ASSIGNED, DonationStatus.PICKED_UP, DonationStatus.DELIVERED],
    });
  });

  it("derives the short code from the donation id", async () => {
    const { store } = fakeStore();

    const result = await run(store);

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.task.shortCode).toBe("ABCDEF12");
  });

  it("maps every task field and keeps the store dates", async () => {
    const { store } = fakeStore();

    const result = await run(store);

    expect(result).toEqual({
      ok: true,
      task: {
        donationId: DONATION_ID,
        shortCode: "ABCDEF12",
        foodName: "Chicken adobo",
        category: "Cooked meals",
        portions: 25,
        status: DonationStatus.ASSIGNED,
        pickupAddress: "12 Mabini St, Quezon City",
        pickupStart: PICKUP_START,
        pickupEnd: PICKUP_END,
        donorName: "Test Bakery",
        donorPhone: "+639170000000",
      },
    });
  });

  it.each([DonationStatus.ASSIGNED, DonationStatus.PICKED_UP, DonationStatus.DELIVERED])(
    "returns the donor phone while the status is %s",
    async (status) => {
      const { store } = fakeStore(row({ status }));

      const result = await run(store);

      expect(result.ok).toBe(true);
      if (result.ok) expect(result.task.donorPhone).toBe("+639170000000");
    },
  );

  it("answers NOT_FOUND when the store finds no task", async () => {
    const { store } = fakeStore(null);

    const result = await run(store);

    expect(result).toEqual({ ok: false, error: "NOT_FOUND" });
  });

  it("keeps exactly the task fields and none of the private ones", async () => {
    const { store } = fakeStore(
      Object.assign(row(), {
        volunteerId: VOLUNTEER_ID,
        donorId: "donor-id",
        donorEmail: "donor@example.com",
        addressId: "address-id",
        qrToken: "qr-token-value",
        storageKey: "food-photos/secret.jpg",
        description: "Secret description",
      }),
    );

    const result = await run(store);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(Object.keys(result.task).sort()).toEqual(
      [
        "category",
        "donationId",
        "donorName",
        "donorPhone",
        "foodName",
        "pickupAddress",
        "pickupEnd",
        "pickupStart",
        "portions",
        "shortCode",
        "status",
      ].sort(),
    );
    const serialized = JSON.stringify(result.task);
    for (const leaked of [
      VOLUNTEER_ID,
      "donor-id",
      "donor@example.com",
      "address-id",
      "qr-token-value",
      "secret.jpg",
      "Secret description",
    ]) {
      expect(serialized).not.toContain(leaked);
    }
  });
});
