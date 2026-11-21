import { DonationStatus } from "@/contracts/enums";
import type { StorageCondition } from "@/contracts/enums";
import type { VolunteerChecklistResponse } from "@/contracts/volunteer-checklist";

export type ChecklistDonation = {
  status: DonationStatus;
  deletedAt: Date | null;
};

/** The checklist row as stored, before it is turned into the wire shape. */
export type StoredChecklist = {
  preparedAt: Date | null;
  consumeByAt: Date | null;
  storageCondition: StorageCondition | null;
  storageTemperatureC: number | null;
  packagingIntact: boolean | null;
  allergensConfirmed: boolean | null;
  notCustomerPlateLeftovers: boolean | null;
};

export interface ChecklistReadStore {
  readDonation(id: string): Promise<ChecklistDonation | null>;
  findCurrentVolunteerId(donationId: string): Promise<string | null>;
  readChecklist(donationId: string): Promise<StoredChecklist | null>;
  readAllergenNames(donationId: string): Promise<string[]>;
}

/** Every refusal is the same answer, so the donation state is never revealed. */
export type ChecklistReadResult =
  | { ok: true; checklist: VolunteerChecklistResponse }
  | { ok: false; error: "NOT_FOUND" };

const EMPTY_CHECKLIST: VolunteerChecklistResponse = {
  preparedAt: null,
  consumeByAt: null,
  storageCondition: null,
  storageTemperatureC: null,
  packagingIntact: null,
  allergensConfirmed: null,
  notCustomerPlateLeftovers: null,
  allergens: [],
};

/**
 * Reads the donor's safety checklist for the volunteer currently assigned to the
 * donation, and only while the donation is ASSIGNED. An unknown, malformed or
 * discarded id, another volunteer's assignment, an ended assignment and every
 * other status all answer NOT_FOUND. A donation with no checklist row is a valid
 * read with every field null.
 */
export async function readVolunteerChecklist(
  deps: { store: ChecklistReadStore },
  args: { volunteerId: string; donationId: string },
): Promise<ChecklistReadResult> {
  const { volunteerId, donationId } = args;

  const donation = await deps.store.readDonation(donationId);
  if (!donation || donation.deletedAt !== null) {
    return { ok: false, error: "NOT_FOUND" };
  }
  // Assignment before the status: a volunteer who is not on this donation must
  // not learn its state from the answer.
  if ((await deps.store.findCurrentVolunteerId(donationId)) !== volunteerId) {
    return { ok: false, error: "NOT_FOUND" };
  }
  if (donation.status !== DonationStatus.ASSIGNED) {
    return { ok: false, error: "NOT_FOUND" };
  }

  const checklist = await deps.store.readChecklist(donationId);
  if (!checklist) return { ok: true, checklist: EMPTY_CHECKLIST };

  const allergens = await deps.store.readAllergenNames(donationId);
  return {
    ok: true,
    checklist: {
      preparedAt: checklist.preparedAt === null ? null : checklist.preparedAt.toISOString(),
      consumeByAt: checklist.consumeByAt === null ? null : checklist.consumeByAt.toISOString(),
      storageCondition: checklist.storageCondition,
      storageTemperatureC: checklist.storageTemperatureC,
      packagingIntact: checklist.packagingIntact,
      allergensConfirmed: checklist.allergensConfirmed,
      notCustomerPlateLeftovers: checklist.notCustomerPlateLeftovers,
      allergens,
    },
  };
}
