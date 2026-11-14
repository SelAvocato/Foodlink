import { describe, expect, it } from "vitest";
import type {
  CurrentAddress,
  LockedProfileUser,
  NewAddressRow,
  ProfileUpdateStore,
  ProfileUpdateTx,
  ProfileUserUpdate,
} from "./donor-profile-update";
import { updateDonorProfile } from "./donor-profile-update";

const USER_ID = "user-1";

const BODY = {
  contactNumber: "+639171234567",
  address: {
    streetLine1: "12 Mabini St",
    streetLine2: "Block 5",
    barangay: "Poblacion",
    city: "Quezon City",
    latitude: 14.5995,
    longitude: 120.9842,
  },
};

type AuditEntry = { actorUserId: string; changed: string[] };

/**
 * In-memory store: every effect is staged while the work function runs and applied
 * only when it resolves, so a throw mid-transaction leaves nothing behind — the same
 * all-or-nothing rule prisma.$transaction gives the real store. The committed
 * `effects` log also preserves the order the service used inside the transaction.
 */
class FakeUpdateStore implements ProfileUpdateStore {
  /** The one user this fake knows: null models missing / non-Donor / soft-deleted. */
  user: LockedProfileUser | null;
  /** What the service asked the lock for, in order. */
  lockReads: string[] = [];
  effects: string[] = [];
  inserted: NewAddressRow[] = [];
  updates: { userId: string; changes: ProfileUserUpdate }[] = [];
  deleted: string[] = [];
  audits: AuditEntry[] = [];
  transactionRuns = 0;
  /** When set, that method throws instead of staging — a mid-transaction failure. */
  failAt: string | null = null;

  private staged: (() => void)[] = [];
  private nextAddressId = 0;

  constructor(user: LockedProfileUser | null) {
    this.user = user;
  }

  async transaction<T>(work: (tx: ProfileUpdateTx) => Promise<T>): Promise<T> {
    this.transactionRuns += 1;
    try {
      const result = await work(this);
      const staged = this.staged;
      this.staged = [];
      for (const apply of staged) apply();
      return result;
    } catch (error) {
      this.staged = []; // rollback: a failed transaction commits nothing
      throw error;
    }
  }

  async getUserLocked(userId: string): Promise<LockedProfileUser | null> {
    this.lockReads.push(userId);
    return this.user;
  }

  async insertAddress(row: NewAddressRow): Promise<{ id: string }> {
    this.maybeFail("insertAddress");
    const id = `address-new-${++this.nextAddressId}`;
    this.stage(() => {
      this.effects.push("insert");
      this.inserted.push(row);
    });
    return { id };
  }

  async updateUser(userId: string, changes: ProfileUserUpdate): Promise<void> {
    this.maybeFail("updateUser");
    this.stage(() => {
      this.effects.push("update");
      this.updates.push({ userId, changes: { ...changes } });
      if (this.user !== null) {
        if (changes.contactNumber !== undefined) this.user.contactNumber = changes.contactNumber;
        if (changes.addressId !== undefined) this.user.addressId = changes.addressId;
      }
    });
  }

  async deleteAddressIfUnshared(addressId: string): Promise<void> {
    this.maybeFail("deleteAddressIfUnshared");
    this.stage(() => {
      this.effects.push("delete");
      this.deleted.push(addressId);
    });
  }

  async insertAudit(input: { actorUserId: string; changed: readonly string[] }): Promise<void> {
    this.maybeFail("insertAudit");
    this.stage(() => {
      this.effects.push("audit");
      this.audits.push({ actorUserId: input.actorUserId, changed: [...input.changed] });
    });
  }

  private maybeFail(method: string): void {
    if (this.failAt === method) throw new Error(`fake ${method} failure`);
  }

  private stage(apply: () => void): void {
    this.staged.push(apply);
  }
}

/** The stored address exactly as the body sends it, plus the three copied columns. */
function sameAddress(): CurrentAddress {
  return {
    streetLine1: "12 Mabini St",
    streetLine2: "Block 5",
    barangay: "Poblacion",
    city: "Quezon City",
    provinceOrState: "Metro Manila",
    postalCode: "1101",
    countryCode: "PH",
    latitude: 14.5995,
    longitude: 120.9842,
  };
}

/** A stored address that differs from the body: other street, no pin. */
function otherAddress(): CurrentAddress {
  return {
    streetLine1: "10 Old St",
    streetLine2: null,
    barangay: null,
    city: "Quezon City",
    provinceOrState: "Metro Manila",
    postalCode: "1101",
    countryCode: "PH",
    latitude: null,
    longitude: null,
  };
}

/** The stored donor: a different contact number, address already equal to the body. */
function storedUser(overrides: Partial<LockedProfileUser> = {}): LockedProfileUser {
  return {
    contactNumber: "+639170000000",
    addressId: "address-old",
    address: sameAddress(),
    ...overrides,
  };
}

function save(store: ProfileUpdateStore) {
  return updateDonorProfile({ store }, { userId: USER_ID, ...BODY });
}

describe("updateDonorProfile", () => {
  it("writes only the contact number when the address is unchanged", async () => {
    const store = new FakeUpdateStore(storedUser());

    const result = await save(store);

    expect(result).toEqual({ ok: true, changed: true });
    // No insert, no repoint, no delete: the address row is not churned for a phone change.
    expect(store.effects).toEqual(["update", "audit"]);
    expect(store.inserted).toEqual([]);
    expect(store.deleted).toEqual([]);
    expect(store.updates).toEqual([
      { userId: USER_ID, changes: { contactNumber: "+639171234567" } },
    ]);
    expect(store.audits).toEqual([{ actorUserId: USER_ID, changed: ["contactNumber"] }]);
    expect(store.transactionRuns).toBe(1);
    expect(store.lockReads).toEqual([USER_ID]);
  });

  it("swaps the address row when only the address changed, and leaves the number alone", async () => {
    const store = new FakeUpdateStore(
      storedUser({ contactNumber: BODY.contactNumber, address: otherAddress() }),
    );

    const result = await save(store);

    expect(result).toEqual({ ok: true, changed: true });
    expect(store.effects).toEqual(["insert", "update", "delete", "audit"]);
    // users points at the NEW id; the old id goes to the guarded delete.
    expect(store.updates).toEqual([
      { userId: USER_ID, changes: { addressId: "address-new-1" } },
    ]);
    expect(store.deleted).toEqual(["address-old"]);
    expect(store.audits).toEqual([{ actorUserId: USER_ID, changed: ["address"] }]);
    expect(store.transactionRuns).toBe(1);
  });

  it("writes both sides and audits both field names when both changed", async () => {
    const store = new FakeUpdateStore(storedUser({ address: otherAddress() }));

    const result = await save(store);

    expect(result).toEqual({ ok: true, changed: true });
    expect(store.effects).toEqual(["insert", "update", "delete", "audit"]);
    expect(store.updates).toEqual([
      {
        userId: USER_ID,
        changes: { contactNumber: "+639171234567", addressId: "address-new-1" },
      },
    ]);
    expect(store.deleted).toEqual(["address-old"]);
    expect(store.audits).toEqual([
      { actorUserId: USER_ID, changed: ["contactNumber", "address"] },
    ]);
    expect(store.transactionRuns).toBe(1);
  });

  it("writes nothing at all when nothing changed", async () => {
    const store = new FakeUpdateStore(storedUser({ contactNumber: BODY.contactNumber }));

    const result = await save(store);

    expect(result).toEqual({ ok: true, changed: false });
    expect(store.transactionRuns).toBe(1); // the lock still ran, inside one transaction
    expect(store.lockReads).toEqual([USER_ID]);
    expect(store.effects).toEqual([]);
    expect(store.inserted).toEqual([]);
    expect(store.updates).toEqual([]);
    expect(store.deleted).toEqual([]);
    expect(store.audits).toEqual([]);
  });

  it("copies the address columns the contract has no field for from the old row", async () => {
    const store = new FakeUpdateStore(
      storedUser({ contactNumber: BODY.contactNumber, address: otherAddress() }),
    );

    await save(store);

    // Body fields come from the body; province_or_state, postal_code and country_code
    // come from the old row, so nothing the screen cannot edit is ever lost.
    expect(store.inserted).toEqual([
      {
        streetLine1: "12 Mabini St",
        streetLine2: "Block 5",
        barangay: "Poblacion",
        city: "Quezon City",
        provinceOrState: "Metro Manila",
        postalCode: "1101",
        countryCode: "PH",
        latitude: 14.5995,
        longitude: 120.9842,
      },
    ]);
  });

  it("treats a stored address with no pin as changed once the body sets one", async () => {
    const store = new FakeUpdateStore(
      storedUser({ contactNumber: BODY.contactNumber, address: { ...sameAddress(), latitude: null, longitude: null } }),
    );

    const result = await save(store);

    expect(result).toEqual({ ok: true, changed: true });
    expect(store.effects).toEqual(["insert", "update", "delete", "audit"]);
    expect(store.audits).toEqual([{ actorUserId: USER_ID, changed: ["address"] }]);
  });

  it("counts a pin that only differs beyond six decimals as unchanged", async () => {
    const store = new FakeUpdateStore(storedUser({ contactNumber: BODY.contactNumber }));

    // numeric(9,6) could only ever store 14.599500, so the insert would change nothing.
    const result = await updateDonorProfile(
      { store },
      { userId: USER_ID, ...BODY, address: { ...BODY.address, latitude: 14.5995000001 } },
    );

    expect(result).toEqual({ ok: true, changed: false });
    expect(store.effects).toEqual([]);
    expect(store.transactionRuns).toBe(1);
  });

  it("audits only the field names, never the number, the address or the pin", async () => {
    const store = new FakeUpdateStore(storedUser({ address: otherAddress() }));

    await save(store);

    expect(store.audits).toHaveLength(1);
    expect(store.audits[0]).toEqual({
      actorUserId: USER_ID,
      changed: ["contactNumber", "address"],
    });
    const logged = JSON.stringify(store.audits);
    for (const secret of [
      "+639171234567",
      "+639170000000",
      "Mabini",
      "Old St",
      "14.5995",
      "Metro Manila",
    ]) {
      expect(logged).not.toContain(secret);
    }
  });

  it("answers NOT_FOUND with no writes when the locked row is missing", async () => {
    const store = new FakeUpdateStore(null);

    const result = await save(store);

    expect(result).toEqual({ ok: false, error: "NOT_FOUND" });
    expect(store.transactionRuns).toBe(1);
    expect(store.lockReads).toEqual([USER_ID]);
    expect(store.effects).toEqual([]);
    expect(store.inserted).toEqual([]);
    expect(store.updates).toEqual([]);
    expect(store.deleted).toEqual([]);
    expect(store.audits).toEqual([]);
  });

  it("commits nothing when the transaction fails after the insert", async () => {
    const store = new FakeUpdateStore(storedUser({ address: otherAddress() }));
    store.failAt = "updateUser";

    await expect(save(store)).rejects.toThrow("fake updateUser failure");

    // One transaction run, rolled back: the staged insert, delete and audit are gone.
    expect(store.transactionRuns).toBe(1);
    expect(store.effects).toEqual([]);
    expect(store.inserted).toEqual([]);
    expect(store.updates).toEqual([]);
    expect(store.deleted).toEqual([]);
    expect(store.audits).toEqual([]);
  });
});
