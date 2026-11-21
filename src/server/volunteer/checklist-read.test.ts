import { describe, expect, it, vi } from "vitest";
import { DonationStatus, StorageCondition } from "@/contracts/enums";
import {
  readVolunteerChecklist,
  type ChecklistDonation,
  type ChecklistReadStore,
  type StoredChecklist,
} from "./checklist-read";

const DONATION_ID = "11111111-1111-4111-8111-111111111111";
const VOLUNTEER_ID = "33333333-3333-4333-8333-333333333333";
const OTHER_VOLUNTEER_ID = "44444444-4444-4444-8444-444444444444";

// Local constructor times, never fixed Z strings.
const PREPARED_AT = new Date(2026, 10, 21, 9, 30);
const CONSUME_BY_AT = new Date(2026, 10, 21, 18, 0);
const DELETED_AT = new Date(2026, 10, 20, 8, 0);

function donation(overrides: Partial<ChecklistDonation> = {}): ChecklistDonation {
  return { status: DonationStatus.ASSIGNED, deletedAt: null, ...overrides };
}

function storedChecklist(overrides: Partial<StoredChecklist> = {}): StoredChecklist {
  return {
    preparedAt: PREPARED_AT,
    consumeByAt: CONSUME_BY_AT,
    storageCondition: StorageCondition.REFRIGERATED,
    storageTemperatureC: 4.5,
    packagingIntact: true,
    allergensConfirmed: true,
    notCustomerPlateLeftovers: true,
    ...overrides,
  };
}

function fakeStore(
  options: {
    donation?: ChecklistDonation | null;
    volunteerId?: string | null;
    checklist?: StoredChecklist | null;
    allergens?: string[];
  } = {},
) {
  const store: ChecklistReadStore = {
    readDonation: vi.fn(async () => (options.donation === undefined ? donation() : options.donation)),
    findCurrentVolunteerId: vi.fn(async () =>
      options.volunteerId === undefined ? VOLUNTEER_ID : options.volunteerId,
    ),
    readChecklist: vi.fn(async () =>
      options.checklist === undefined ? storedChecklist() : options.checklist,
    ),
    readAllergenNames: vi.fn(async () => options.allergens ?? ["Milk", "Peanuts"]),
  };
  return store;
}

function run(store: ChecklistReadStore, overrides: { volunteerId?: string; donationId?: string } = {}) {
  return readVolunteerChecklist(
    { store },
    {
      volunteerId: overrides.volunteerId ?? VOLUNTEER_ID,
      donationId: overrides.donationId ?? DONATION_ID,
    },
  );
}

describe("readVolunteerChecklist", () => {
  it("returns the full checklist with the allergen names", async () => {
    const result = await run(fakeStore());

    expect(result).toEqual({
      ok: true,
      checklist: {
        preparedAt: PREPARED_AT.toISOString(),
        consumeByAt: CONSUME_BY_AT.toISOString(),
        storageCondition: StorageCondition.REFRIGERATED,
        storageTemperatureC: 4.5,
        packagingIntact: true,
        allergensConfirmed: true,
        notCustomerPlateLeftovers: true,
        allergens: ["Milk", "Peanuts"],
      },
    });
  });

  it("answers 200 with every field null when there is no checklist row", async () => {
    const store = fakeStore({ checklist: null });

    expect(await run(store)).toEqual({
      ok: true,
      checklist: {
        preparedAt: null,
        consumeByAt: null,
        storageCondition: null,
        storageTemperatureC: null,
        packagingIntact: null,
        allergensConfirmed: null,
        notCustomerPlateLeftovers: null,
        allergens: [],
      },
    });
    expect(store.readAllergenNames).not.toHaveBeenCalled();
  });

  it("keeps nulls for a checklist that is only partly filled", async () => {
    const store = fakeStore({
      checklist: storedChecklist({
        preparedAt: null,
        consumeByAt: null,
        storageCondition: null,
        storageTemperatureC: null,
        packagingIntact: null,
        allergensConfirmed: null,
        notCustomerPlateLeftovers: null,
      }),
    });

    const result = await run(store);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.checklist.preparedAt).toBeNull();
      expect(result.checklist.consumeByAt).toBeNull();
      expect(result.checklist.storageCondition).toBeNull();
      expect(result.checklist.storageTemperatureC).toBeNull();
      expect(result.checklist.packagingIntact).toBeNull();
      expect(result.checklist.allergensConfirmed).toBeNull();
      expect(result.checklist.notCustomerPlateLeftovers).toBeNull();
    }
  });

  it("returns an empty allergen list when none are declared", async () => {
    const result = await run(fakeStore({ allergens: [] }));

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.checklist.allergens).toEqual([]);
  });

  it.each([
    ["an unknown donation", () => fakeStore({ donation: null })],
    ["a malformed id", () => fakeStore({ donation: null })],
    ["a discarded donation", () => fakeStore({ donation: donation({ deletedAt: DELETED_AT }) })],
    ["another volunteer's assignment", () => fakeStore({ volunteerId: OTHER_VOLUNTEER_ID })],
    ["an ended assignment", () => fakeStore({ volunteerId: null })],
  ])("answers NOT_FOUND for %s", async (_label, makeStore) => {
    expect(await run(makeStore())).toEqual({ ok: false, error: "NOT_FOUND" });
  });

  it.each([
    DonationStatus.PICKED_UP,
    DonationStatus.DELIVERED,
    DonationStatus.POSTED,
    DonationStatus.CANCELLED,
  ])("answers NOT_FOUND for a %s donation", async (status) => {
    const store = fakeStore({ donation: donation({ status }) });

    expect(await run(store)).toEqual({ ok: false, error: "NOT_FOUND" });
    expect(store.readChecklist).not.toHaveBeenCalled();
  });

  it("returns no key beyond the eight checklist fields", async () => {
    const result = await run(fakeStore());

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(Object.keys(result.checklist).sort()).toEqual([
        "allergens",
        "allergensConfirmed",
        "consumeByAt",
        "notCustomerPlateLeftovers",
        "packagingIntact",
        "preparedAt",
        "storageCondition",
        "storageTemperatureC",
      ]);
    }
  });

  it("never returns the volunteer id", async () => {
    const result = await run(fakeStore());

    expect(JSON.stringify(result)).not.toContain(VOLUNTEER_ID);
  });
});
