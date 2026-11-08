import { describe, expect, it, vi } from "vitest";
import { MAX_IMAGE_BYTES } from "@/contracts/image";
import {
  donorRegistrationSchema,
  PRIVACY_CONSENT_TYPE,
  PRIVACY_POLICY_VERSION,
  type DonorRegistrationInput,
} from "@/contracts/registration";
import { verifyPassword } from "@/lib/password";
import { createStorage, type StorageBucket } from "@/lib/storage";
import {
  DuplicateEmailError,
  registerDonor,
  type RegisterDonorDeps,
  type RegistrationStore,
  type RegistrationTx,
} from "./register-donor";

type AddressInsert = Parameters<RegistrationTx["insertAddress"]>[0];
type UserInsert = Parameters<RegistrationTx["insertUser"]>[0];
type CredentialsInsert = Parameters<RegistrationTx["insertCredentials"]>[0];
type ConsentInsert = Parameters<RegistrationTx["insertConsent"]>[0];
type DocumentInsert = Parameters<RegistrationTx["insertDocument"]>[0];
type Stored<T> = T & { id: string };

/** In-memory store. `emails` mirrors the unique index so a race can be simulated without a user row. */
class FakeStore implements RegistrationStore {
  addresses: Stored<AddressInsert>[] = [];
  users: Stored<UserInsert>[] = [];
  credentials: CredentialsInsert[] = [];
  consents: ConsentInsert[] = [];
  documents: DocumentInsert[] = [];
  private emails = new Set<string>();
  private seq = 0;
  race = false;
  boom = false;

  seedEmail(email: string): void {
    this.emails.add(email);
  }

  async emailExists(email: string): Promise<boolean> {
    if (this.race) return false;
    return this.emails.has(email);
  }

  async transaction<T>(work: (tx: RegistrationTx) => Promise<T>): Promise<T> {
    const snapshot = {
      addresses: [...this.addresses],
      users: [...this.users],
      credentials: [...this.credentials],
      consents: [...this.consents],
      documents: [...this.documents],
      emails: new Set(this.emails),
    };
    const nextId = (): string => {
      this.seq += 1;
      return `00000000-0000-4000-8000-${String(this.seq).padStart(12, "0")}`;
    };
    try {
      return await work({
        insertAddress: async (row) => {
          const id = nextId();
          this.addresses.push({ ...row, id });
          return { id };
        },
        insertUser: async (row) => {
          if (this.emails.has(row.email)) throw new DuplicateEmailError("email already registered");
          this.emails.add(row.email);
          const id = nextId();
          this.users.push({ ...row, id });
          return { id };
        },
        insertCredentials: async (row) => {
          this.credentials.push(row);
        },
        insertConsent: async (row) => {
          this.consents.push(row);
        },
        insertDocument: async (row) => {
          if (this.boom) throw new Error("boom");
          this.documents.push(row);
        },
      });
    } catch (error) {
      this.addresses = snapshot.addresses;
      this.users = snapshot.users;
      this.credentials = snapshot.credentials;
      this.consents = snapshot.consents;
      this.documents = snapshot.documents;
      this.emails = snapshot.emails;
      throw error;
    }
  }
}

function makeBucket(overrides: Partial<StorageBucket> = {}) {
  const files = new Map<string, Uint8Array>();
  const uploads: string[] = [];
  const bucket: StorageBucket = {
    upload: async (path, body) => {
      files.set(path, body);
      uploads.push(path);
      return { data: { path }, error: null };
    },
    createSignedUrl: async (path) => ({ data: { signedUrl: `https://example.test/${path}` }, error: null }),
    remove: async (paths) => {
      for (const path of paths) files.delete(path);
      return { data: [], error: null };
    },
    ...overrides,
  };
  return { bucket, files, uploads };
}

function setup(overrides: Partial<StorageBucket> = {}) {
  const store = new FakeStore();
  const { bucket, files, uploads } = makeBucket(overrides);
  const storage = createStorage(bucket);
  const deps: RegisterDonorDeps = { store, storage };
  return { store, files, uploads, deps };
}

const address = {
  streetLine1: "123 Katipunan Ave",
  city: "Quezon City",
  latitude: 14.676,
  longitude: 121.0437,
};
const password = "Abcdef1!";

function establishmentInput(): DonorRegistrationInput {
  return donorRegistrationSchema.parse({
    donorType: "ESTABLISHMENT",
    businessName: "Test Bakery Corp",
    fullName: "Test Donor Person",
    contactNumber: "09171234567",
    email: "donor@example.com",
    address,
    password,
    consent: true,
  });
}

function individualInput(): DonorRegistrationInput {
  return donorRegistrationSchema.parse({
    donorType: "INDIVIDUAL",
    fullName: "Test Donor Person",
    contactNumber: "09171234567",
    email: "donor@example.com",
    address,
    password,
    consent: true,
  });
}

const jpegProof = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);
const FAKE_SIGNED_URL = "https://storage.example.test/object/sign?token=fake-token";

function jpegOfSize(size: number): Uint8Array {
  const bytes = new Uint8Array(size);
  bytes.set([0xff, 0xd8, 0xff, 0xe0]);
  return bytes;
}

function expectNoRows(store: FakeStore): void {
  expect(store.addresses).toHaveLength(0);
  expect(store.users).toHaveLength(0);
  expect(store.credentials).toHaveLength(0);
  expect(store.consents).toHaveLength(0);
  expect(store.documents).toHaveLength(0);
}

describe("registerDonor", () => {
  it("registers an establishment with one row per table and the proof under proofs/", async () => {
    const { store, files, deps } = setup();
    const result = await registerDonor(deps, establishmentInput(), jpegProof);
    if (!result.ok) throw new Error(`expected success, got ${result.error}`);

    expect(store.addresses).toHaveLength(1);
    expect(store.users).toHaveLength(1);
    expect(store.users[0]).toMatchObject({
      role: "DONOR",
      status: "PENDING",
      businessName: "Test Bakery Corp",
      donorType: "ESTABLISHMENT",
    });
    expect(result.userId).toBe(store.users[0]?.id);
    expect(store.credentials).toHaveLength(1);
    expect(store.credentials[0]?.userId).toBe(result.userId);
    expect(store.consents).toHaveLength(1);
    expect(store.consents[0]).toMatchObject({
      userId: result.userId,
      consentType: PRIVACY_CONSENT_TYPE,
      policyVersion: PRIVACY_POLICY_VERSION,
    });
    expect(store.documents).toHaveLength(1);
    expect(store.documents[0]).toMatchObject({
      userId: result.userId,
      documentTypeCode: "BUSINESS_PERMIT",
      mimeType: "image/jpeg",
      sizeBytes: jpegProof.length,
    });
    expect(files.size).toBe(1);
    const key = [...files.keys()][0];
    expect(key?.startsWith("proofs/")).toBe(true);
  });

  it("registers an individual with no business name and a VALID_ID document", async () => {
    const { store, deps } = setup();
    const result = await registerDonor(deps, individualInput(), jpegProof);
    expect(result.ok).toBe(true);

    expect(store.users).toHaveLength(1);
    expect(store.users[0]).toMatchObject({
      donorType: "INDIVIDUAL",
      businessName: null,
      role: "DONOR",
      status: "PENDING",
    });
    expect(store.documents).toHaveLength(1);
    expect(store.documents[0]).toMatchObject({ documentTypeCode: "VALID_ID" });
  });

  it("stores an argon2id hash that verifies against the plain password", async () => {
    const { store, deps } = setup();
    const result = await registerDonor(deps, establishmentInput(), jpegProof);
    expect(result.ok).toBe(true);

    const row = store.credentials[0];
    if (!row) throw new Error("no credentials row");
    expect(row.passwordHash).not.toBe(password);
    expect(row.passwordHash.startsWith("$argon2id$")).toBe(true);
    expect(await verifyPassword(row.passwordHash, password)).toBe(true);
  });

  it("stores originalFilename as the last segment of storageKey, never input text", async () => {
    const { store, deps } = setup();
    const result = await registerDonor(deps, establishmentInput(), jpegProof);
    expect(result.ok).toBe(true);

    const doc = store.documents[0];
    if (!doc) throw new Error("no document row");
    expect(doc.originalFilename).toBe(doc.storageKey.split("/").at(-1));
    expect(doc.originalFilename).not.toContain("Test");
    expect(doc.originalFilename).not.toContain("Bakery");
    expect(doc.originalFilename).not.toContain("donor");
    expect(doc.originalFilename).not.toContain("Katipunan");
    expect(doc.originalFilename).not.toContain(password);
  });

  it("ignores role and status injected into the input", async () => {
    const { store, deps } = setup();
    const injected = {
      ...establishmentInput(),
      role: "ADMIN",
      status: "ACTIVE",
    } as unknown as DonorRegistrationInput;
    const result = await registerDonor(deps, injected, jpegProof);
    expect(result.ok).toBe(true);

    expect(store.users).toHaveLength(1);
    expect(store.users[0]).toMatchObject({ role: "DONOR", status: "PENDING" });
  });

  it("returns EMAIL_TAKEN from emailExists without hashing, uploading or writing rows", async () => {
    const { store, files, uploads, deps } = setup();
    store.seedEmail("donor@example.com");

    const result = await registerDonor(deps, establishmentInput(), jpegProof);
    expect(result).toEqual({ ok: false, error: "EMAIL_TAKEN" });
    expectNoRows(store);
    expect(uploads).toHaveLength(0);
    expect(files.size).toBe(0);
  });

  it("returns EMAIL_TAKEN when the unique index fires after upload and rolls back every row", async () => {
    const { store, files, uploads, deps } = setup();
    store.seedEmail("donor@example.com");
    store.race = true;

    const result = await registerDonor(deps, establishmentInput(), jpegProof);
    expect(result).toEqual({ ok: false, error: "EMAIL_TAKEN" });
    expectNoRows(store);
    expect(uploads).toHaveLength(1);
    expect(files.size).toBe(0);
  });

  it("rethrows a non-duplicate transaction error after removing the uploaded object", async () => {
    const { store, files, uploads, deps } = setup();
    store.boom = true;

    await expect(registerDonor(deps, establishmentInput(), jpegProof)).rejects.toThrow("boom");
    expectNoRows(store);
    expect(uploads).toHaveLength(1);
    expect(files.size).toBe(0);
  });

  it("still surfaces the original error when removeObject fails during cleanup", async () => {
    const { store, uploads, deps } = setup({
      // The storage error message can carry the key and a signed URL; neither may reach the log.
      remove: async (paths) => ({
        data: null,
        error: { message: `remove failed for ${paths[0] ?? "unknown"} at ${FAKE_SIGNED_URL}` },
      }),
    });
    store.boom = true;
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});

    try {
      // A leaked cleanup error would throw "Storage remove failed" instead of "boom".
      await expect(registerDonor(deps, establishmentInput(), jpegProof)).rejects.toThrow("boom");
      expect(uploads).toHaveLength(1);
      expectNoRows(store);

      expect(consoleError).toHaveBeenCalledTimes(1);
      expect(consoleError.mock.calls[0]?.[0]).toBe("registerAccount: failed to remove orphaned proof");
      expect(Object.keys(consoleError.mock.calls[0]?.[1] as object)).toEqual(["errorName"]);

      const logged = JSON.stringify(consoleError.mock.calls);
      const uploadedKey = uploads[0];
      if (!uploadedKey) throw new Error("expected one uploaded key");
      // Not even the file name part of the key may appear.
      const fileName = uploadedKey.split("/").at(-1);
      expect(fileName).toBeTruthy();
      expect(logged).not.toContain(FAKE_SIGNED_URL);
      expect(logged).not.toContain("remove failed");
      expect(logged).not.toContain(uploadedKey);
      expect(logged).not.toContain(fileName);
    } finally {
      consoleError.mockRestore();
    }
  });

  it("returns INVALID_PROOF for wrong type bytes, an empty file or 5 MB + 1 byte", async () => {
    const { store, files, uploads, deps } = setup();
    const proofs = [
      Uint8Array.from([0x47, 0x49, 0x46, 0x38, 0x39, 0x61]),
      new Uint8Array(0),
      jpegOfSize(MAX_IMAGE_BYTES + 1),
    ];

    for (const proof of proofs) {
      const result = await registerDonor(deps, establishmentInput(), proof);
      expect(result).toEqual({ ok: false, error: "INVALID_PROOF" });
    }
    expectNoRows(store);
    expect(uploads).toHaveLength(0);
    expect(files.size).toBe(0);
  });
});
