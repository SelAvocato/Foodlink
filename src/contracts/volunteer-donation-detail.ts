import type { VolunteerDonationListItem } from "./volunteer-donation-list";

/**
 * One task from the detail route: the list item, with the donor phone hidden
 * (null) when the donation status does not allow contact details.
 */
export type VolunteerDonationDetail = Omit<VolunteerDonationListItem, "donorPhone"> & {
  donorPhone: string | null;
};
