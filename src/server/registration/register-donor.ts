import { validateImage } from "@/contracts/image";
import { PRIVACY_CONSENT_TYPE, PRIVACY_POLICY_VERSION, type DonorRegistrationInput } from "@/contracts/registration";
import { hashPassword } from "@/lib/password";
import type { Storage } from "@/lib/storage";

/** The store throws this when the unique email index (users_email_active_uq) is violated. */
export class DuplicateEmailError extends Error { }

export interface RegistrationTx {
  insertAddress(row: {
    streetLine1: string;
    streetLine2: string | null;
    barangay: string | null;
    city: string;
    provinceOrState: string | null;
    postalCode: string | null;
    countryCode: string;
    latitude: number;
    longitude: number;
  }): Promise<{ id: string }>;
  insertUser(row: {
    role: "DONOR";
    status: "PENDING";
    fullName: string;
    email: string;
    contactNumber: string;
    donorType: "ESTABLISHMENT" | "INDIVIDUAL";
    businessName: string | null;
    addressId: string;
  }): Promise<{ id: string }>;
  insertCredentials(row: { userId: string; passwordHash: string }): Promise<void>;
  insertConsent(row: { userId: string; consentType: string; policyVersion: string }): Promise<void>;
  insertDocument(row: {
    userId: string;
    documentTypeCode: "BUSINESS_PERMIT" | "VALID_ID";
    storageKey: string;
    originalFilename: string;
    mimeType: string;
    sizeBytes: number;
  }): Promise<void>;
}

export interface RegistrationStore {
  emailExists(email: string): Promise<boolean>;
  /** Runs `work` atomically; rolls back if `work` throws. */
  transaction<T>(work: (tx: RegistrationTx) => Promise<T>): Promise<T>;
}

export interface RegisterDonorDeps {
  store: RegistrationStore;
  storage: Pick<Storage, "uploadImage" | "removeObject">;
}

export type RegisterDonorResult =
  | { ok: true; userId: string }
  | { ok: false; error: "EMAIL_TAKEN" | "INVALID_PROOF" };

export async function registerDonor(
  deps: RegisterDonorDeps,
  input: DonorRegistrationInput,
  proof: Uint8Array,
): Promise<RegisterDonorResult> {
  const check = validateImage(proof);
  if (!check.ok) return { ok: false, error: "INVALID_PROOF" };

  if (await deps.store.emailExists(input.email)) return { ok: false, error: "EMAIL_TAKEN" };

  const passwordHash = await hashPassword(input.password);
  const { key } = await deps.storage.uploadImage({
    folder: "proofs",
    contentType: check.mime,
    data: proof,
  });

  try {
    const userId = await deps.store.transaction(async (tx) => {
      const { address } = input;
      const addressRow = await tx.insertAddress({
        streetLine1: address.streetLine1,
        streetLine2: address.streetLine2 ?? null,
        barangay: address.barangay ?? null,
        city: address.city,
        provinceOrState: address.provinceOrState ?? null,
        postalCode: address.postalCode ?? null,
        countryCode: address.countryCode,
        latitude: address.latitude,
        longitude: address.longitude,
      });

      const user = await tx.insertUser({
        role: "DONOR",
        status: "PENDING",
        fullName: input.fullName,
        email: input.email,
        contactNumber: input.contactNumber,
        donorType: input.donorType,
        businessName: input.donorType === "ESTABLISHMENT" ? input.businessName : null,
        addressId: addressRow.id,
      });

      await tx.insertCredentials({ userId: user.id, passwordHash });
      await tx.insertConsent({
        userId: user.id,
        consentType: PRIVACY_CONSENT_TYPE,
        policyVersion: PRIVACY_POLICY_VERSION,
      });

      const slash = key.lastIndexOf("/");
      await tx.insertDocument({
        userId: user.id,
        documentTypeCode: input.donorType === "ESTABLISHMENT" ? "BUSINESS_PERMIT" : "VALID_ID",
        storageKey: key,
        originalFilename: slash === -1 ? key : key.slice(slash + 1),
        mimeType: check.mime,
        sizeBytes: check.size,
      });

      return user.id;
    });

    return { ok: true, userId };
  } catch (error) {
    try {
      await deps.storage.removeObject(key);
    } catch (cleanupError) {
      // The original error matters more than a failed cleanup, but record the orphaned key.
      console.error("registerDonor: failed to remove orphaned proof", { key, cleanupError });
    }
    if (error instanceof DuplicateEmailError) return { ok: false, error: "EMAIL_TAKEN" };
    throw error;
  }
}
