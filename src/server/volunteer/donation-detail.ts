import { DonationStatus } from "@/contracts/enums";
import {
  VOLUNTEER_DONATION_STATUSES,
  type VolunteerDonationStatus,
} from "@/contracts/volunteer-donation-list";
import type { VolunteerDonationDetail } from "@/contracts/volunteer-donation-detail";

/** The task as stored, before the short code and the phone rule are applied. */
export type VolunteerDonationDetailRow = {
  donationId: string;
  foodName: string;
  category: string;
  portions: number;
  status: VolunteerDonationStatus;
  pickupAddress: string | null;
  pickupStart: Date | null;
  pickupEnd: Date | null;
  donorName: string;
  donorPhone: string;
};

export interface VolunteerDonationDetailStore {
  findTask(input: {
    volunteerId: string;
    donationId: string;
    statuses: readonly VolunteerDonationStatus[];
  }): Promise<VolunteerDonationDetailRow | null>;
}

/** Every refusal is the same answer, so the donation state is never revealed. */
export type VolunteerDonationDetailResult =
  | { ok: true; task: VolunteerDonationDetail }
  | { ok: false; error: "NOT_FOUND" };

// Same rule as donation-list.ts, whose constant is not exported.
const SHORT_CODE_LENGTH = 8;

/** Contact details only go to the volunteer while the food is still in their hands. */
const PHONE_VISIBLE_STATUSES: readonly VolunteerDonationStatus[] = [
  DonationStatus.ASSIGNED,
  DonationStatus.PICKED_UP,
];

/**
 * Reads one task for the volunteer currently assigned to it. The store already
 * filters by volunteer, active assignment, deletion and the list statuses, so a
 * miss is one NOT_FOUND for every reason. The donor phone is dropped for any
 * status that is not ASSIGNED or PICKED_UP.
 */
export async function readVolunteerDonationDetail(
  deps: { store: VolunteerDonationDetailStore },
  args: { volunteerId: string; donationId: string },
): Promise<VolunteerDonationDetailResult> {
  const { volunteerId, donationId } = args;

  const row = await deps.store.findTask({
    volunteerId,
    donationId,
    statuses: VOLUNTEER_DONATION_STATUSES,
  });
  if (!row) return { ok: false, error: "NOT_FOUND" };

  const phoneVisible = PHONE_VISIBLE_STATUSES.includes(row.status);

  return {
    ok: true,
    task: {
      donationId: row.donationId,
      shortCode: row.donationId.slice(0, SHORT_CODE_LENGTH).toUpperCase(),
      foodName: row.foodName,
      category: row.category,
      portions: row.portions,
      status: row.status,
      pickupAddress: row.pickupAddress,
      pickupStart: row.pickupStart,
      pickupEnd: row.pickupEnd,
      donorName: row.donorName,
      donorPhone: phoneVisible ? row.donorPhone : null,
    },
  };
}
