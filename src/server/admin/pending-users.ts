import type { AccountStatus, DonorType, Role } from "@/contracts/enums";

export interface PendingUserDocumentRow {
  id: string;
  typeCode: string;
  status: string;
  mimeType: string;
  sizeBytes: number;
  createdAt: Date;
  deletedAt: Date | null;
}

export interface PendingUserRow {
  id: string;
  role: Role;
  status: AccountStatus;
  fullName: string;
  email: string;
  createdAt: Date;
  donorType: DonorType | null;
  businessName: string | null;
  deletedAt: Date | null;
  documents: PendingUserDocumentRow[];
}

export interface PendingUsersStore {
  findPendingUsers(limit: number): Promise<PendingUserRow[]>;
}

export interface PendingUserDocument {
  id: string;
  type: string;
  status: string;
  mimeType: string;
  sizeBytes: number;
  createdAt: Date;
}

export interface PendingUser {
  id: string;
  role: Role;
  fullName: string;
  email: string;
  createdAt: Date;
  donorType: DonorType | null;
  businessName: string | null;
  documents: PendingUserDocument[];
}

/** Donor and Volunteer accounts waiting for review, oldest first, at most `limit`. */
export async function listPendingUsers(
  deps: { store: PendingUsersStore },
  input: { limit: number },
): Promise<PendingUser[]> {
  const rows = await deps.store.findPendingUsers(input.limit);

  return rows
    .filter(
      (row) =>
        (row.role === "DONOR" || row.role === "VOLUNTEER") &&
        row.status === "PENDING" &&
        row.deletedAt === null,
    )
    .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
    .slice(0, input.limit)
    .map((row) => ({
      id: row.id,
      role: row.role,
      fullName: row.fullName,
      email: row.email,
      createdAt: row.createdAt,
      donorType: row.donorType,
      businessName: row.businessName,
      documents: row.documents
        .filter((document) => document.deletedAt === null)
        .map((document) => ({
          id: document.id,
          type: document.typeCode,
          status: document.status,
          mimeType: document.mimeType,
          sizeBytes: document.sizeBytes,
          createdAt: document.createdAt,
        })),
    }));
}
