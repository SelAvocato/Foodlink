import type { DonationStatus, Role } from "./enums";

export type DonationActor = {
  id: string;
  role: Role;
};

export type TransitionDonationPayload = {
  eventNote?: string;
  metadata?: Record<string, string | number | boolean | null>;
  reason?: string;
  qrToken?: string;
  screeningId?: string;
  volunteerId?: string;
};

export type TransitionStore = {
  transaction<T>(work: (tx: TransitionTx) => Promise<T>): Promise<T>;
};

export type TransitionTx = {
  getDonation(id: string): Promise<{
    status: DonationStatus;
    donorId: string;
    pickupEnd: Date | null;
    currentVolunteerId: string | null;
  } | null>;
  updateDonation(input: {
    id: string;
    from: DonationStatus;
    to: DonationStatus;
    now: Date;
    actorId: string | null;
    closedAt: Date | null;
    qrToken: string | null;
  }): Promise<boolean>;
  getActiveVolunteer(id: string): Promise<{ id: string; status: "ACTIVE"; role: "VOLUNTEER" } | null>;
  hasDistribution(donationId: string): Promise<boolean>;
  getCompletionTotals(donationId: string): Promise<{ portions: number; distributed: number; unusable: number }>;
  insertAssignment(input: { donationId: string; volunteerId: string; assignedById: string; assignedAt: Date }): Promise<void>;
  insertExit(input: { donationId: string; status: DonationStatus; actorId: string | null; actorRole: Role | null; reason: string | null; screeningId?: string }): Promise<void>;
  insertTracking(input: { donationId: string; from: DonationStatus; to: DonationStatus; actorId: string | null; note?: string; metadata: Record<string, string | number | boolean | null> }): Promise<void>;
  insertNotifications(rows: Array<{ userId: string; type: string; title: string; body: string; donationId: string }>): Promise<void>;
  insertAudit(input: { actorId: string | null; targetId: string; details: Record<string, string | number | boolean | null> }): Promise<void>;
};

/**
 * Runtime implementation belongs in the server layer. It must perform the
 * transition, tracking, notification and audit writes in one transaction.
 */
export type TransitionDonation = (
  deps: { store: TransitionStore },
  id: string,
  to: DonationStatus,
  actor: DonationActor | null,
  payload?: TransitionDonationPayload,
) => Promise<{ from: DonationStatus; to: DonationStatus }>;
