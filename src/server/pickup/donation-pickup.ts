import type { SavePickupInput } from "@/contracts/donation-pickup";
import { DonationStatus } from "@/contracts/enums";

/** The address as the read path returns it: database nulls, plain numbers for the pin. */
export type PickupAddressView = {
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

/** The donation row the save path locks: ownership, status, previous pickup, consume-by. */
export type LockedPickupDonation = {
  donorId: string;
  status: DonationStatus;
  deletedAt: Date | null;
  pickupAddressId: string | null;
  consumeByAt: Date | null;
};

/** The donation row the read path needs: ownership only. */
export type ReadPickupDonation = {
  donorId: string;
};

export type StoredPickup = {
  address: PickupAddressView;
  pickupStart: Date;
  pickupEnd: Date;
};

export interface PickupTx {
  /** FOR UPDATE OF d: the checks, the insert and the swap must not interleave. */
  getDonationLocked(id: string): Promise<LockedPickupDonation | null>;
  insertAddress(row: SavePickupInput["address"]): Promise<{ id: string }>;
  setPickup(donationId: string, row: { addressId: string; pickupStart: Date; pickupEnd: Date }): Promise<void>;
  /** Deletes the row only when no other row still references it; never relies on an FK error. */
  deleteAddressIfUnshared(addressId: string): Promise<void>;
}

export interface PickupStore {
  /** Runs `work` atomically; rolls back if `work` throws. */
  transaction<T>(work: (tx: PickupTx) => Promise<T>): Promise<T>;
  /** Plain reads outside any transaction: what GET needs, without taking a lock. */
  readDonation(id: string): Promise<ReadPickupDonation | null>;
  readPickup(donationId: string): Promise<StoredPickup | null>;
}

/** Saving the pickup is allowed while the donation is a draft or already screened. */
const EDITABLE_STATUSES: readonly DonationStatus[] = [DonationStatus.DRAFT, DonationStatus.SCREENED];

export type SavePickupResult =
  | { ok: true }
  | { ok: false; error: "NOT_FOUND" | "NOT_EDITABLE" | "PICKUP_START_NOT_IN_FUTURE" | "CONSUME_BY_NOT_AFTER_PICKUP_END" };

/**
 * Saves the whole pickup (PUT semantics): a NEW addresses row is inserted and the
 * donation points at it, so a profile or seed address is never changed. The
 * previous pickup address is deleted only when nothing else references it. The
 * rules run under the donation row lock, the trigger donations_recheck_checklist
 * never surfaces as a raw error, and donations.status is never written here.
 */
export async function savePickup(
  deps: { store: PickupStore; now?: () => Date },
  args: { donorId: string; donationId: string; input: SavePickupInput },
): Promise<SavePickupResult> {
  const { store, now = () => new Date() } = deps;
  const { donorId, donationId, input } = args;

  return store.transaction(async (tx) => {
    const donation = await tx.getDonationLocked(donationId);
    // Another donor's draft and a discarded draft are the same NOT_FOUND.
    if (!donation || donation.donorId !== donorId || donation.deletedAt !== null) {
      return { ok: false, error: "NOT_FOUND" };
    }
    if (!EDITABLE_STATUSES.includes(donation.status)) {
      return { ok: false, error: "NOT_EDITABLE" };
    }
    // The PDF requires the window to start in the future: the start must be strictly
    // after the clock. (The schema only checks that the end is after the start.)
    if (input.pickupStart <= now()) {
      return { ok: false, error: "PICKUP_START_NOT_IN_FUTURE" };
    }
    // fn_assert_checklist_rules (line 890): consume_by_at <= pickup_end is refused
    // whenever a checklist exists, completed or not, so the trigger below the
    // update (donations_recheck_checklist) never raises.
    if (donation.consumeByAt !== null && donation.consumeByAt <= input.pickupEnd) {
      return { ok: false, error: "CONSUME_BY_NOT_AFTER_PICKUP_END" };
    }

    const address = await tx.insertAddress(input.address);
    await tx.setPickup(donationId, {
      addressId: address.id,
      pickupStart: input.pickupStart,
      pickupEnd: input.pickupEnd,
    });
    // The donation already points at the new row, so the guards below only see
    // other references (users, host_organization, other donations).
    if (donation.pickupAddressId !== null) {
      await tx.deleteAddressIfUnshared(donation.pickupAddressId);
    }
    return { ok: true };
  });
}

export type PickupView = {
  address: PickupAddressView;
  pickupStart: string;
  pickupEnd: string;
};

export type GetPickupResult =
  | { ok: true; pickup: PickupView | null }
  | { ok: false; error: "NOT_FOUND" };

/**
 * Reads the pickup for the donor's own, non-deleted donation. Plain reads, no
 * lock and no status restriction: a closed donation can still be read. The view
 * carries no address id and no donor id, only the documented fields.
 */
export async function getPickup(
  deps: { store: PickupStore },
  args: { donorId: string; donationId: string },
): Promise<GetPickupResult> {
  const { donorId, donationId } = args;

  const donation = await deps.store.readDonation(donationId);
  if (!donation || donation.donorId !== donorId) return { ok: false, error: "NOT_FOUND" };

  const stored = await deps.store.readPickup(donationId);
  if (!stored) return { ok: true, pickup: null };

  return {
    ok: true,
    pickup: {
      address: {
        streetLine1: stored.address.streetLine1,
        streetLine2: stored.address.streetLine2,
        barangay: stored.address.barangay,
        city: stored.address.city,
        provinceOrState: stored.address.provinceOrState,
        postalCode: stored.address.postalCode,
        countryCode: stored.address.countryCode,
        latitude: stored.address.latitude,
        longitude: stored.address.longitude,
      },
      pickupStart: stored.pickupStart.toISOString(),
      pickupEnd: stored.pickupEnd.toISOString(),
    },
  };
}
