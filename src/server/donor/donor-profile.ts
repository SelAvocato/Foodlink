import { donorProfileRowSchema, type DonorProfile } from "@/contracts/donor-profile";

export interface DonorProfileStore {
  /**
   * The profile row of one user (users + addresses + newest non-deleted document),
   * or null when the user has no row, is not a Donor or is soft-deleted (the WHERE
   * clause checks role and deleted_at in the same statement).
   */
  findProfile(userId: string): Promise<unknown>;
}

export type DonorProfileResult =
  | { ok: true; profile: DonorProfile }
  | { ok: false; error: "NOT_FOUND" };

/**
 * The signed-in donor's own profile (Figma p15). There is no id in the request: the
 * user id is the session actor's, passed in by the route. A missing row is an expected
 * NOT_FOUND; a row that does not match the schema means the SQL and the contract
 * disagree, which is a bug and fails loudly as a 500.
 */
export async function getDonorProfile(
  deps: { store: DonorProfileStore },
  input: { userId: string },
): Promise<DonorProfileResult> {
  const row = await deps.store.findProfile(input.userId);
  if (row === null || row === undefined) return { ok: false, error: "NOT_FOUND" };

  const parsed = donorProfileRowSchema.safeParse(row);
  if (!parsed.success) {
    // Not a client error: a column that should never reach here (or a wrong type) did.
    throw new Error("The donor profile row has an unexpected shape.");
  }

  // Explicit field by field: nothing is spread out of the row, so an unknown column
  // cannot ride along into the response.
  const data = parsed.data;
  return {
    ok: true,
    profile: {
      fullName: data.full_name,
      businessName: data.business_name,
      donorType: data.donor_type,
      email: data.email,
      status: data.status,
      contactNumber: data.contact_number,
      address: {
        streetLine1: data.street_line1,
        streetLine2: data.street_line2,
        barangay: data.barangay,
        city: data.city,
        latitude: data.latitude,
        longitude: data.longitude,
      },
      proof:
        data.proof_type_name === null || data.proof_status === null
          ? null
          : { documentTypeName: data.proof_type_name, status: data.proof_status },
    },
  };
}
