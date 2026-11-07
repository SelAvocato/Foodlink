import { validateImage } from "@/contracts/image";
import { PRIVACY_CONSENT_TYPE, PRIVACY_POLICY_VERSION } from "@/contracts/registration";
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
    latitude: number | null;
    longitude: number | null;
  }): Promise<{ id: string }>;
  insertUser(row: {
    role: "DONOR" | "VOLUNTEER";
    status: "PENDING";
    fullName: string;
    email: string;
    contactNumber: string;
    donorType: "ESTABLISHMENT" | "INDIVIDUAL" | null;
    businessName: string | null;
    addressId: string;
    availability?: string | null;
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

export interface RegisterAccountDeps {
  store: RegistrationStore;
  storage: Pick<Storage, "uploadImage" | "removeObject">;
}

export type RegisterAccountResult =
  | { ok: true; userId: string }
  | { ok: false; error: "EMAIL_TAKEN" | "INVALID_PROOF" };

/** Everything the shared flow needs, already normalized to what the transaction writes. */
export interface RegistrationPlan {
  email: string;
  password: string;
  address: Parameters<RegistrationTx["insertAddress"]>[0];
  user: {
    role: "DONOR" | "VOLUNTEER";
    fullName: string;
    contactNumber: string;
    donorType: "ESTABLISHMENT" | "INDIVIDUAL" | null;
    businessName: string | null;
    availability?: string | null;
  };
  documentTypeCode: "BUSINESS_PERMIT" | "VALID_ID";
}

export async function registerAccount(
  deps: RegisterAccountDeps,
  plan: RegistrationPlan,
  proof: Uint8Array,
): Promise<RegisterAccountResult> {
  const check = validateImage(proof);
  if (!check.ok) return { ok: false, error: "INVALID_PROOF" };

  if (await deps.store.emailExists(plan.email)) return { ok: false, error: "EMAIL_TAKEN" };

  const passwordHash = await hashPassword(plan.password);
  const { key } = await deps.storage.uploadImage({
    folder: "proofs",
    contentType: check.mime,
    data: proof,
  });

  try {
    const userId = await deps.store.transaction(async (tx) => {
      const addressRow = await tx.insertAddress(plan.address);

      const user = await tx.insertUser({
        role: plan.user.role,
        status: "PENDING",
        fullName: plan.user.fullName,
        email: plan.email,
        contactNumber: plan.user.contactNumber,
        donorType: plan.user.donorType,
        businessName: plan.user.businessName,
        addressId: addressRow.id,
        availability: plan.user.availability,
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
        documentTypeCode: plan.documentTypeCode,
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
      console.error("registerAccount: failed to remove orphaned proof", { key, cleanupError });
    }
    if (error instanceof DuplicateEmailError) return { ok: false, error: "EMAIL_TAKEN" };
    throw error;
  }
}
