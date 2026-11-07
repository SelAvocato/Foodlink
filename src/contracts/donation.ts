import type { DonationStatus, Role } from "./enums";

export type DonationActor = {
  id: string;
  role: Role;
};

export type TransitionDonationPayload = {
  acceptedById?: string;
  closedAt?: Date;
  eventNote?: string;
  metadata?: Record<string, string | number | boolean | null>;
  notificationUserIds?: string[];
  reason?: string;
  qrToken?: string;
  screeningId?: string;
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
) => Promise<{ from: DonationStatus; to: DonationStatus }>;
