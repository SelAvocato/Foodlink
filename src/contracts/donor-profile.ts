import { z } from "zod";
import { AccountStatus, DonorType } from "./enums";

/**
 * document_status in db/baseline/001_schema.sql. src/contracts/enums.ts has no entry
 * for it, so the values live here, next to the only row that returns them today.
 */
export const DocumentStatus = {
  PENDING: "PENDING",
  APPROVED: "APPROVED",
  REJECTED: "REJECTED",
} as const;
export type DocumentStatus = (typeof DocumentStatus)[keyof typeof DocumentStatus];

/**
 * The row GET /api/donor/profile's SQL returns: users joined to its addresses and to
 * the newest non-deleted user_documents row (LEFT JOIN LATERAL), so proof_type_name and
 * proof_status are both null when the donor has no document. latitude and longitude
 * arrive as JavaScript numbers because the SQL casts numeric(9,6) to float8. Strict on
 * purpose: an extra column (storage_key, review_note, ...) fails here, so it can never
 * be mapped into the response by accident.
 */
export const donorProfileRowSchema = z
  .strictObject({
    full_name: z.string(),
    business_name: z.string().nullable(),
    donor_type: z.enum(DonorType),
    email: z.string(),
    status: z.enum(AccountStatus),
    contact_number: z.string(),
    street_line1: z.string(),
    street_line2: z.string().nullable(),
    barangay: z.string().nullable(),
    city: z.string(),
    latitude: z.number().nullable(),
    longitude: z.number().nullable(),
    proof_type_name: z.string().nullable(),
    proof_status: z.enum(DocumentStatus).nullable(),
  })
  .refine((row) => (row.latitude === null) === (row.longitude === null), {
    message: "latitude and longitude must both be set or both be null",
    path: ["latitude"],
  })
  .refine((row) => (row.proof_type_name === null) === (row.proof_status === null), {
    message: "proof_type_name and proof_status must both be set or both be null",
    path: ["proof_type_name"],
  });

export type DonorProfileRow = z.infer<typeof donorProfileRowSchema>;

/** The camelCase profile of the signed-in donor (Figma p15), built by the service. */
export type DonorProfile = {
  fullName: string;
  businessName: string | null;
  donorType: DonorType;
  email: string;
  status: AccountStatus;
  contactNumber: string;
  address: {
    streetLine1: string;
    streetLine2: string | null;
    barangay: string | null;
    city: string;
    latitude: number | null;
    longitude: number | null;
  };
  proof: { documentTypeName: string; status: DocumentStatus } | null;
};

/** Response body of GET /api/donor/profile. */
export type DonorProfileResponse = { profile: DonorProfile };
