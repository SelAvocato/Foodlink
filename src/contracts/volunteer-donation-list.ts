import { z } from "zod";
import { DonationStatus } from "./enums";

export const VOLUNTEER_DONATION_STATUSES = [
  DonationStatus.ASSIGNED,
  DonationStatus.PICKED_UP,
  DonationStatus.DELIVERED,
] as const;
export type VolunteerDonationStatus = (typeof VOLUNTEER_DONATION_STATUSES)[number];

export const volunteerDonationListQuerySchema = z.strictObject({
  page: z.coerce
    .number()
    .int("The page must be a whole number")
    .min(1, "Use page 1 or higher")
    .max(10000, "Use page 10000 or lower")
    .default(1),
  pageSize: z.coerce
    .number()
    .int("The page size must be a whole number")
    .min(1, "Use at least 1")
    .max(50, "Use at most 50")
    .default(20),
  status: z.enum(VOLUNTEER_DONATION_STATUSES).optional(),
});
export type VolunteerDonationListQuery = z.infer<typeof volunteerDonationListQuerySchema>;

export type VolunteerDonationListItem = {
  donationId: string;
  shortCode: string;
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

export type VolunteerDonationListRow = Omit<VolunteerDonationListItem, "shortCode">;

export type VolunteerDonationListResponse = {
  items: VolunteerDonationListItem[];
  page: number;
  pageSize: number;
  total: number;
};
