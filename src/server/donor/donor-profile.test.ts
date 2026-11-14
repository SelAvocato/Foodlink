import { describe, expect, it } from "vitest";
import type { DonorProfileStore } from "./donor-profile";
import { getDonorProfile } from "./donor-profile";

const USER_ID = "user-1";

class FakeProfileStore implements DonorProfileStore {
  row: unknown = null;
  calls: string[] = [];

  async findProfile(userId: string): Promise<unknown> {
    this.calls.push(userId);
    return this.row;
  }
}

/** A complete row as the SQL returns it: an ESTABLISHMENT donor with a pin and a proof. */
function row(overrides: Record<string, unknown> = {}) {
  return {
    full_name: "Maria Santos",
    business_name: "Test Bakery",
    donor_type: "ESTABLISHMENT",
    email: "donor@example.com",
    status: "ACTIVE",
    contact_number: "+639171234567",
    street_line1: "12 Mabini St",
    street_line2: "Block 5",
    barangay: "Poblacion",
    city: "Quezon City",
    latitude: 14.5995,
    longitude: 120.9842,
    proof_type_name: "Business Permit",
    proof_status: "APPROVED",
    ...overrides,
  };
}

describe("getDonorProfile", () => {
  it("maps an ESTABLISHMENT donor completely and sends the session user id to the store", async () => {
    const store = new FakeProfileStore();
    store.row = row();

    const result = await getDonorProfile({ store }, { userId: USER_ID });

    expect(store.calls).toEqual([USER_ID]);
    // toEqual on the whole object: no extra key may appear in the result.
    expect(result).toEqual({
      ok: true,
      profile: {
        fullName: "Maria Santos",
        businessName: "Test Bakery",
        donorType: "ESTABLISHMENT",
        email: "donor@example.com",
        status: "ACTIVE",
        contactNumber: "+639171234567",
        address: {
          streetLine1: "12 Mabini St",
          streetLine2: "Block 5",
          barangay: "Poblacion",
          city: "Quezon City",
          latitude: 14.5995,
          longitude: 120.9842,
        },
        proof: { documentTypeName: "Business Permit", status: "APPROVED" },
      },
    });
  });

  it("returns businessName null for an INDIVIDUAL donor", async () => {
    const store = new FakeProfileStore();
    store.row = row({ donor_type: "INDIVIDUAL", business_name: null });

    const result = await getDonorProfile({ store }, { userId: USER_ID });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.profile.donorType).toBe("INDIVIDUAL");
      expect(result.profile.businessName).toBeNull();
    }
  });

  it("returns latitude and longitude null when the address has no map pin", async () => {
    const store = new FakeProfileStore();
    store.row = row({ latitude: null, longitude: null });

    const result = await getDonorProfile({ store }, { userId: USER_ID });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.profile.address).toEqual({
        streetLine1: "12 Mabini St",
        streetLine2: "Block 5",
        barangay: "Poblacion",
        city: "Quezon City",
        latitude: null,
        longitude: null,
      });
    }
  });

  it("returns proof null when the donor has no non-deleted document", async () => {
    const store = new FakeProfileStore();
    store.row = row({ proof_type_name: null, proof_status: null });

    const result = await getDonorProfile({ store }, { userId: USER_ID });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.profile.proof).toBeNull();
      // The whole result still has exactly the expected keys.
      expect(result).toEqual({
        ok: true,
        profile: {
          fullName: "Maria Santos",
          businessName: "Test Bakery",
          donorType: "ESTABLISHMENT",
          email: "donor@example.com",
          status: "ACTIVE",
          contactNumber: "+639171234567",
          address: {
            streetLine1: "12 Mabini St",
            streetLine2: "Block 5",
            barangay: "Poblacion",
            city: "Quezon City",
            latitude: 14.5995,
            longitude: 120.9842,
          },
          proof: null,
        },
      });
    }
  });

  it("throws when the row carries columns the SQL must never return", async () => {
    const store = new FakeProfileStore();
    // storage_key and review_note are not in the projection; the strict schema rejects
    // them, so neither can leak into a response even if a future SELECT adds them.
    store.row = row({ storage_key: "proofs/uuid.jpg", review_note: "too blurry" });

    await expect(getDonorProfile({ store }, { userId: USER_ID })).rejects.toThrow(
      "The donor profile row has an unexpected shape.",
    );
  });

  it("throws when latitude is a string instead of a number", async () => {
    const store = new FakeProfileStore();
    store.row = row({ latitude: "14.5995" });

    await expect(getDonorProfile({ store }, { userId: USER_ID })).rejects.toThrow(
      "The donor profile row has an unexpected shape.",
    );
  });

  it("throws when only one coordinate is set", async () => {
    const store = new FakeProfileStore();
    store.row = row({ longitude: null });

    await expect(getDonorProfile({ store }, { userId: USER_ID })).rejects.toThrow(
      "The donor profile row has an unexpected shape.",
    );
  });

  it("throws when only one proof field is set", async () => {
    const store = new FakeProfileStore();
    store.row = row({ proof_status: null });

    await expect(getDonorProfile({ store }, { userId: USER_ID })).rejects.toThrow(
      "The donor profile row has an unexpected shape.",
    );
  });

  it.each([
    ["null", null],
    ["undefined", undefined],
  ])("answers NOT_FOUND when the store returns %s", async (_label, value) => {
    const store = new FakeProfileStore();
    store.row = value;

    expect(await getDonorProfile({ store }, { userId: USER_ID })).toEqual({
      ok: false,
      error: "NOT_FOUND",
    });
  });
});
