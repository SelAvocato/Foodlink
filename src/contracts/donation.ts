import type { DonationStatus, Role } from "./enums";

export type DonationActor = {
  id: string;
  role: Role;
};

export type TransitionDonationPayload = {
  acceptedById?: string;
  reason?: string;
  qrToken?: string;
  [key: string]: unknown;
};

/**
 * Runtime implementation belongs in the server layer. It must perform the
 * transition, tracking, notification and audit writes in one transaction.
 */
export type TransitionDonation = (
  id: string,
  to: DonationStatus,
  actor: DonationActor,
  payload?: TransitionDonationPayload,
) => Promise<void>;
