// Provisional: mirror the Prisma schema. Update here if the schema changes.
export const Role = {
  DONOR: "DONOR",
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

export const DonorType = {
  ESTABLISHMENT: "ESTABLISHMENT",
  INDIVIDUAL: "INDIVIDUAL",
} as const;
export type DonorType = (typeof DonorType)[keyof typeof DonorType];

export const ScreeningVerdict = {
  PASS: "PASS",
  FLAG: "FLAG",
  REVIEW: "REVIEW",
} as const;
export type ScreeningVerdict = (typeof ScreeningVerdict)[keyof typeof ScreeningVerdict];

export const DonationStatus = {
  DRAFT: "DRAFT",
  SCREENED: "SCREENED",
  POSTED: "POSTED",
  ACCEPTED: "ACCEPTED",
  ASSIGNED: "ASSIGNED",
  PICKED_UP: "PICKED_UP",
  DELIVERED: "DELIVERED",
  CLOSED: "CLOSED",
  // exit states
  REJECTED: "REJECTED",
  DECLINED: "DECLINED",
  REJECTED_AT_PICKUP: "REJECTED_AT_PICKUP",
  CANCELLED: "CANCELLED",
  EXPIRED: "EXPIRED",
} as const;
export type DonationStatus = (typeof DonationStatus)[keyof typeof DonationStatus];