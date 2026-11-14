import type { DonorProfileUpdateInput } from "@/contracts/donor-profile-update";

/** The address row as the lock query returns it: database nulls, plain numbers for the pin. */
export type CurrentAddress = {
  streetLine1: string;
  streetLine2: string | null;
  barangay: string | null;
  city: string;
  provinceOrState: string | null;
  postalCode: string | null;
  countryCode: string;
  latitude: number | null;
  longitude: number | null;
};

/** The donor row the save locks: contact number, address pointer and the address itself. */
export type LockedProfileUser = {
  contactNumber: string;
  addressId: string | null;
  address: CurrentAddress | null;
};

/** The addresses row to insert: body fields plus the columns the contract has no field for. */
export type NewAddressRow = {
  streetLine1: string;
  streetLine2: string | null;
  barangay: string | null;
  city: string;
  provinceOrState: string | null;
  postalCode: string | null;
  countryCode: string;
  latitude: number;
  longitude: number;
};

export type ProfileUserUpdate = {
  contactNumber?: string;
  addressId?: string;
};

export interface ProfileUpdateTx {
  /** FOR UPDATE: the compare, the insert and the swap must not interleave with another save. */
  getUserLocked(userId: string): Promise<LockedProfileUser | null>;
  /** The address is never updated in place: this always inserts a NEW row. */
  insertAddress(row: NewAddressRow): Promise<{ id: string }>;
  /** Writes only the fields given; updated_at is stamped on every save. */
  updateUser(userId: string, changes: ProfileUserUpdate): Promise<void>;
  /** Deletes the row only when no other row still references it; never relies on an FK error. */
  deleteAddressIfUnshared(addressId: string): Promise<void>;
  /** One audit row: the CHANGED FIELD NAMES only, never the values. */
  insertAudit(input: { actorUserId: string; changed: readonly string[] }): Promise<void>;
}

export interface ProfileUpdateStore {
  /** Runs `work` atomically; rolls back if `work` throws. */
  transaction<T>(work: (tx: ProfileUpdateTx) => Promise<T>): Promise<T>;
}

export type UpdateDonorProfileResult =
  | { ok: true; changed: boolean }
  | { ok: false, error: "NOT_FOUND" };

/**
 * numeric(9,6) stores six decimals: compare after rounding, so a pin that only
 * differs beyond what the column can store counts as unchanged (the insert would
 * round it to the same value anyway).
 */
const round6 = (value: number) => Math.round(value * 1e6) / 1e6;

/**
 * True when the stored address already equals the body. A missing address row, or a
 * stored pin of null/null, always counts as a change: the body always carries a pin.
 */
function addressUnchanged(
  current: CurrentAddress | null,
  next: DonorProfileUpdateInput["address"],
): boolean {
  if (current === null || current.latitude === null || current.longitude === null) return false;
  return (
    current.streetLine1 === next.streetLine1 &&
    (current.streetLine2 ?? null) === (next.streetLine2 ?? null) &&
    (current.barangay ?? null) === (next.barangay ?? null) &&
    current.city === next.city &&
    round6(current.latitude) === round6(next.latitude) &&
    round6(current.longitude) === round6(next.longitude)
  );
}

/**
 * The new addresses row: the body's fields (undefined optional text becomes NULL)
 * plus province_or_state, postal_code and country_code, which the contract has no
 * field for — copied from the current row so a save never loses them. The schema
 * makes country_code NOT NULL DEFAULT 'PH', and a Donor always has an address
 * (users_donor_volunteer_need_address), so the fallback only covers a row that
 * should not exist.
 */
function newRowOf(
  current: CurrentAddress | null,
  next: DonorProfileUpdateInput["address"],
): NewAddressRow {
  return {
    streetLine1: next.streetLine1,
    streetLine2: next.streetLine2 ?? null,
    barangay: next.barangay ?? null,
    city: next.city,
    provinceOrState: current?.provinceOrState ?? null,
    postalCode: current?.postalCode ?? null,
    countryCode: current?.countryCode ?? "PH",
    latitude: next.latitude,
    longitude: next.longitude,
  };
}

/**
 * Saves the contact number and the pickup address (Figma p15 "Save changes").
 * Everything runs in ONE transaction: lock the user row, compare, then insert the
 * new address, repoint users, guarded-delete the old row and write one audit row —
 * and only for the fields that actually changed. A save that changes nothing writes
 * nothing. The user id comes from the session, never from the body.
 */
export async function updateDonorProfile(
  deps: { store: ProfileUpdateStore },
  input: { userId: string; contactNumber: string; address: DonorProfileUpdateInput["address"] },
): Promise<UpdateDonorProfileResult> {
  const { store } = deps;

  return store.transaction(async (tx) => {
    // The lock holds for the whole transaction, so two saves cannot interleave.
    const current = await tx.getUserLocked(input.userId);
    // Missing row, non-Donor or soft-deleted user: the WHERE clause covers all three.
    if (current === null) return { ok: false, error: "NOT_FOUND" } as const;

    const changed: string[] = [];
    if (current.contactNumber !== input.contactNumber) changed.push("contactNumber");
    if (!addressUnchanged(current.address, input.address)) changed.push("address");

    // Nothing changed: no insert, no update, no delete, no audit row.
    if (changed.length === 0) return { ok: true, changed: false } as const;

    // Only the changed side is written: a contact-only save never touches the
    // address row, an address-only save never touches contact_number.
    const changes: ProfileUserUpdate = {};
    if (changed.includes("contactNumber")) changes.contactNumber = input.contactNumber;

    if (changed.includes("address")) {
      // The address is never updated in place: a NEW row is inserted and users points at it.
      const inserted = await tx.insertAddress(newRowOf(current.address, input.address));
      changes.addressId = inserted.id;
    }

    await tx.updateUser(input.userId, changes);

    if (changes.addressId !== undefined && current.addressId !== null) {
      // The donor already points at the new row, so the guard only sees other references.
      await tx.deleteAddressIfUnshared(current.addressId);
    }

    // Field names only: the number, the address text and the pin never reach the log.
    await tx.insertAudit({ actorUserId: input.userId, changed });

    return { ok: true, changed: true } as const;
  });
}
