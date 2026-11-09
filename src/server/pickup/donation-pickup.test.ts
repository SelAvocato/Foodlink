import { describe, expect, it } from "vitest";
import { savePickupSchema, type SavePickupInput } from "@/contracts/donation-pickup";
import { DonationStatus } from "@/contracts/enums";
import {
  getPickup,
  savePickup,
  type LockedPickupDonation,
  type PickupStore,
  type PickupTx,
  type ReadPickupDonation,
  type StoredPickup,
} from "./donation-pickup";

const NOW = new Date("2026-11-10T08:00:00.000Z");
const DONOR_ID = "donor-1";
const OTHER_DONOR_ID = "donor-2";
const DONATION_ID = "donation-1";

const ADDRESS = {
  streetLine1: "123 Katipunan Ave",
  streetLine2: "Block 5",
  barangay: "Loyola Heights",
  city: "Quezon City",
  provinceOrState: "Metro Manila",
  postalCode: "1108",
  countryCode: "PH",
  latitude: 14.676,
  longitude: 121.0437,
};

type SeedDonation = LockedPickupDonation & { id: string };
type AddressRow = SavePickupInput["address"] & { id: string };
type PickupRow = { addressId: string; pickupStart: Date; pickupEnd: Date };

/**
 * In-memory store. `transaction` snapshots the rows and restores them when
 * `work` throws, so a refusal or a failure leaves nothing behind.
 */
class FakePickupStore implements PickupStore {
  donations: SeedDonation[] = [];
  addresses: AddressRow[] = [];
  pickups = new Map<string, PickupRow>();
  /** Rows in users, host_organization or another donation that still point at an address. */
  externalRefs = new Set<string>();
  pickupWrites: { donationId: string; row: PickupRow }[] = [];
  deletedAddresses: string[] = [];
  transactionCalls = 0;
  plainReadCalls = 0;
  private seq = 0;

  async transaction<T>(work: (tx: PickupTx) => Promise<T>): Promise<T> {
    this.transactionCalls += 1;
    const snapshot = {
      donations: this.donations.map((row) => ({ ...row })),
      addresses: [...this.addresses],
      pickups: new Map(this.pickups),
      writes: [...this.pickupWrites],
      deleted: [...this.deletedAddresses],
    };
    try {
      return await work({
        getDonationLocked: async (id) => {
          const donation = this.donations.find((candidate) => candidate.id === id);
          if (!donation) return null;
          return {
            donorId: donation.donorId,
            status: donation.status,
            deletedAt: donation.deletedAt,
            pickupAddressId: donation.pickupAddressId,
            consumeByAt: donation.consumeByAt,
          };
        },
        insertAddress: async (row) => {
          this.seq += 1;
          const id = `00000000-0000-4000-8000-${String(this.seq).padStart(12, "0")}`;
          const stored: AddressRow = { ...row, id };
          this.addresses.push(stored);
          return { id };
        },
        setPickup: async (donationId, row) => {
          this.pickupWrites.push({ donationId, row: { ...row } });
          this.pickups.set(donationId, { ...row });
          const donation = this.donations.find((candidate) => candidate.id === donationId);
          if (donation) donation.pickupAddressId = row.addressId;
        },
        deleteAddressIfUnshared: async (addressId) => {
          // Mirrors the guarded DELETE: any remaining reference keeps the row.
          const shared =
            this.externalRefs.has(addressId) ||
            this.donations.some((candidate) => candidate.pickupAddressId === addressId);
          if (shared) return;
          this.addresses = this.addresses.filter((row) => row.id !== addressId);
          this.deletedAddresses.push(addressId);
        },
      });
    } catch (error) {
      this.donations = snapshot.donations;
      this.addresses = snapshot.addresses;
      this.pickups = snapshot.pickups;
      this.pickupWrites = snapshot.writes;
      this.deletedAddresses = snapshot.deleted;
      throw error;
    }
  }

  /** Like the Prisma adapter: deleted donations are filtered out on the plain read. */
  async readDonation(id: string): Promise<ReadPickupDonation | null> {
    this.plainReadCalls += 1;
    const donation = this.donations.find((candidate) => candidate.id === id && candidate.deletedAt === null);
    if (!donation) return null;
    return { donorId: donation.donorId };
  }

  async readPickup(donationId: string): Promise<StoredPickup | null> {
    this.plainReadCalls += 1;
    const pickup = this.pickups.get(donationId);
    if (!pickup) return null;
    const address = this.addresses.find((row) => row.id === pickup.addressId);
    if (!address) return null;
    return {
      address: {
        streetLine1: address.streetLine1,
        streetLine2: address.streetLine2 ?? null,
        barangay: address.barangay ?? null,
        city: address.city,
        provinceOrState: address.provinceOrState ?? null,
        postalCode: address.postalCode ?? null,
        countryCode: address.countryCode,
        latitude: address.latitude ?? null,
        longitude: address.longitude ?? null,
      },
      pickupStart: pickup.pickupStart,
      pickupEnd: pickup.pickupEnd,
    };
  }
}

function seedDonation(store: FakePickupStore, overrides: Partial<SeedDonation> = {}): void {
  store.donations.push({
    id: DONATION_ID,
    donorId: DONOR_ID,
    status: DonationStatus.DRAFT,
    deletedAt: null,
    pickupAddressId: null,
    consumeByAt: null,
    ...overrides,
  });
}

function makeStore(overrides: Partial<SeedDonation> = {}): FakePickupStore {
  const store = new FakePickupStore();
  seedDonation(store, overrides);
  return store;
}

function input(fields: Record<string, unknown> = {}): SavePickupInput {
  return savePickupSchema.parse({
    address: ADDRESS,
    pickupStart: "2026-11-10T09:00:00Z",
    pickupEnd: "2026-11-10T11:00:00Z",
    ...fields,
  });
}

function save(store: FakePickupStore, fields: Record<string, unknown> = {}) {
  return savePickup(
    { store, now: () => NOW },
    { donorId: DONOR_ID, donationId: DONATION_ID, input: input(fields) },
  );
}

describe("savePickup", () => {
  it("inserts one address and sets the pickup on the first save, in one transaction", async () => {
    const store = makeStore();

    const result = await save(store);

    expect(result).toEqual({ ok: true });
    expect(store.transactionCalls).toBe(1);
    expect(store.addresses).toEqual([{ ...ADDRESS, id: expect.any(String) }]);
    expect(store.pickupWrites).toEqual([
      {
        donationId: DONATION_ID,
        row: {
          addressId: store.addresses[0].id,
          pickupStart: new Date("2026-11-10T09:00:00.000Z"),
          pickupEnd: new Date("2026-11-10T11:00:00.000Z"),
        },
      },
    ]);
    expect(store.donations[0].pickupAddressId).toBe(store.addresses[0].id);
    expect(store.deletedAddresses).toEqual([]);
    // donations.status is never written here.
    expect(store.donations[0].status).toBe(DonationStatus.DRAFT);
  });

  it("inserts a new address and deletes the previous unshared one on a second save", async () => {
    const store = makeStore();
    await save(store);
    const firstId = store.addresses[0].id;

    const result = await save(store, { address: { ...ADDRESS, streetLine1: "456 Commonwealth Ave" } });

    expect(result).toEqual({ ok: true });
    expect(store.addresses).toHaveLength(1);
    expect(store.addresses[0].streetLine1).toBe("456 Commonwealth Ave");
    expect(store.deletedAddresses).toEqual([firstId]);
    expect(store.donations[0].pickupAddressId).toBe(store.addresses[0].id);
    expect(store.pickupWrites).toHaveLength(2);
  });

  it("keeps the previous address when another row still references it", async () => {
    const store = makeStore();
    await save(store);
    const firstId = store.addresses[0].id;
    // A user profile, the host row or another donation points at the old row.
    store.externalRefs.add(firstId);

    const result = await save(store, { address: { ...ADDRESS, streetLine1: "456 Commonwealth Ave" } });

    expect(result).toEqual({ ok: true });
    expect(store.addresses).toHaveLength(2);
    expect(store.addresses.map((row) => row.id)).toContain(firstId);
    expect(store.deletedAddresses).toEqual([]);
    expect(store.donations[0].pickupAddressId).not.toBe(firstId);
  });

  it.each([
    ["equal to now", "2026-11-10T08:00:00Z"],
    ["in the past", "2026-11-10T07:59:59Z"],
  ])("refuses a pickup start %s and writes nothing", async (_label, pickupStart) => {
    const store = makeStore();

    const result = await save(store, { pickupStart });

    expect(result).toEqual({ ok: false, error: "PICKUP_START_NOT_IN_FUTURE" });
    expect(store.transactionCalls).toBe(1);
    expect(store.addresses).toEqual([]);
    expect(store.pickupWrites).toEqual([]);
  });

  it("accepts a pickup start one second after now", async () => {
    const store = makeStore();

    const result = await save(store, { pickupStart: "2026-11-10T08:00:01Z" });

    expect(result).toEqual({ ok: true });
    expect(store.addresses).toHaveLength(1);
  });

  it("refuses a consume-by time equal to the pickup end and writes nothing", async () => {
    const store = makeStore({ consumeByAt: new Date("2026-11-10T11:00:00.000Z") });

    const result = await save(store);

    // fn_assert_checklist_rules (line 890): consume_by_at <= pickup_end is refused.
    expect(result).toEqual({ ok: false, error: "CONSUME_BY_NOT_AFTER_PICKUP_END" });
    expect(store.transactionCalls).toBe(1);
    expect(store.addresses).toEqual([]);
    expect(store.pickupWrites).toEqual([]);
  });

  it("accepts a consume-by time one second after the pickup end", async () => {
    const store = makeStore({ consumeByAt: new Date("2026-11-10T11:00:01.000Z") });

    const result = await save(store);

    expect(result).toEqual({ ok: true });
    expect(store.addresses).toHaveLength(1);
  });

  it("skips the consume-by check when the donation has no checklist row", async () => {
    // The LEFT JOIN finds no row: consume_by_at stays null and the rule cannot fire.
    const store = makeStore({ consumeByAt: null });

    const result = await save(store);

    expect(result).toEqual({ ok: true });
    expect(store.addresses).toHaveLength(1);
  });

  it.each([
    ["missing", () => new FakePickupStore()],
    ["deleted", () => makeStore({ deletedAt: new Date("2026-11-09T00:00:00.000Z") })],
    ["another donor's", () => makeStore({ donorId: OTHER_DONOR_ID })],
  ])("answers NOT_FOUND for a %s donation and writes nothing", async (_label, make) => {
    const store = make();

    const result = await save(store);

    expect(result).toEqual({ ok: false, error: "NOT_FOUND" });
    expect(store.transactionCalls).toBe(1);
    expect(store.addresses).toEqual([]);
    expect(store.pickupWrites).toEqual([]);
  });

  it("answers NOT_EDITABLE for a POSTED donation and writes nothing", async () => {
    const store = makeStore({ status: DonationStatus.POSTED });

    const result = await save(store);

    expect(result).toEqual({ ok: false, error: "NOT_EDITABLE" });
    expect(store.transactionCalls).toBe(1);
    expect(store.addresses).toEqual([]);
    expect(store.pickupWrites).toEqual([]);
  });

  it.each([DonationStatus.DRAFT, DonationStatus.SCREENED])(
    "saves the pickup while the donation is %s",
    async (status) => {
      const store = makeStore({ status });

      const result = await save(store);

      expect(result).toEqual({ ok: true });
      expect(store.addresses).toHaveLength(1);
      expect(store.pickupWrites).toHaveLength(1);
    },
  );
});

describe("getPickup", () => {
  it("returns null when no pickup is set, with plain reads and no lock", async () => {
    const store = makeStore();

    const result = await getPickup({ store }, { donorId: DONOR_ID, donationId: DONATION_ID });

    expect(result).toEqual({ ok: true, pickup: null });
    expect(store.transactionCalls).toBe(0);
    expect(store.plainReadCalls).toBeGreaterThan(0);
  });

  it("returns the full shape with ISO times, the address and no ids", async () => {
    const store = makeStore();
    await save(store);

    const result = await getPickup({ store }, { donorId: DONOR_ID, donationId: DONATION_ID });

    expect(result).toEqual({
      ok: true,
      pickup: {
        address: {
          streetLine1: "123 Katipunan Ave",
          streetLine2: "Block 5",
          barangay: "Loyola Heights",
          city: "Quezon City",
          provinceOrState: "Metro Manila",
          postalCode: "1108",
          countryCode: "PH",
          latitude: 14.676,
          longitude: 121.0437,
        },
        pickupStart: "2026-11-10T09:00:00.000Z",
        pickupEnd: "2026-11-10T11:00:00.000Z",
      },
    });
    if (result.ok && result.pickup) {
      expect(Object.keys(result.pickup)).toEqual(["address", "pickupStart", "pickupEnd"]);
      expect(Object.keys(result.pickup.address)).toEqual([
        "streetLine1",
        "streetLine2",
        "barangay",
        "city",
        "provinceOrState",
        "postalCode",
        "countryCode",
        "latitude",
        "longitude",
      ]);
      const json = JSON.stringify(result.pickup);
      expect(json).not.toContain("addressId");
      expect(json).not.toContain("donorId");
      expect(json).not.toContain("pickup_address_id");
    }
  });

  it("returns null coordinates when the address has no map pin", async () => {
    const store = makeStore();
    await save(store, { address: { streetLine1: "123 Katipunan Ave", city: "Quezon City" } });

    const result = await getPickup({ store }, { donorId: DONOR_ID, donationId: DONATION_ID });

    expect(result).toMatchObject({
      ok: true,
      pickup: { address: { latitude: null, longitude: null, streetLine2: null, barangay: null } },
    });
  });

  it.each([
    ["missing", () => new FakePickupStore()],
    ["deleted", () => makeStore({ deletedAt: new Date("2026-11-09T00:00:00.000Z") })],
    ["another donor's", () => makeStore({ donorId: OTHER_DONOR_ID })],
  ])("answers NOT_FOUND for a %s donation", async (_label, make) => {
    const store = make();

    const result = await getPickup({ store }, { donorId: DONOR_ID, donationId: DONATION_ID });

    expect(result).toEqual({ ok: false, error: "NOT_FOUND" });
    expect(store.transactionCalls).toBe(0);
  });

  it("reads the pickup regardless of the donation status", async () => {
    const store = makeStore();
    await save(store);
    store.donations[0].status = DonationStatus.POSTED;
    const transactionsAfterSave = store.transactionCalls;

    const result = await getPickup({ store }, { donorId: DONOR_ID, donationId: DONATION_ID });

    expect(result).toEqual({ ok: true, pickup: expect.objectContaining({ pickupStart: expect.any(String) }) });
    // The read never takes the lock the save path takes.
    expect(store.transactionCalls).toBe(transactionsAfterSave);
  });
});
