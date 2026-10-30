// Provisional: mirror the Prisma schema. Update here if the schema changes.
export const Role = {
    DONOR: "DONOR",
    RECEIVER: "RECEIVER",
    VOLUNTEER: "VOLUNTEER",
    ADMIN: "ADMIN",
} as const;
export type Role = (typeof Role)[keyof typeof Role];

export const AccountStatus = {
  PENDING: "PENDING",
  ACTIVE: "ACTIVE",
  REJECTED: "REJECTED",
  SUSPENDED: "SUSPENDED",
} as const;
export type AccountStatus = (typeof AccountStatus)[keyof typeof AccountStatus];

export const DonationStatus = {
    DRAFT: "DRAFT",
    SCREENED: "SCREENED",
    POSTED: "POSTED",
    CLAIMED: "CLAIMED",
    WORKER_ASSIGNED: "WORKER_ASSIGNED",
    PICKED_UP: "PICKED_UP",
    DELIVERED: "DELIVERED",
    RECEIVED: "RECEIVED",
    CLOSED: "CLOSED",
    // exit states
    REJECTED: "REJECTED",
    EXPIRED: "EXPIRED",
    CANCELLED: "CANCELLED",
} as const;
export type DonationStatus = (typeof DonationStatus)[keyof typeof DonationStatus];