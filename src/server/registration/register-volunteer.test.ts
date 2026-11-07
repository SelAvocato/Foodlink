import { describe, expect, it, vi } from "vitest";
import { MAX_IMAGE_BYTES } from "@/contracts/image";
import {
  PRIVACY_CONSENT_TYPE,
  PRIVACY_POLICY_VERSION,
  volunteerRegistrationSchema,
  type VolunteerRegistrationInput,
} from "@/contracts/registration";
import { verifyPassword } from "@/lib/password";
import { createStorage, type StorageBucket } from "@/lib/storage";
import {
  DuplicateEmailError,
  type RegistrationStore,
  type RegistrationTx,
} from "./register-account";
import { registerVolunteer, type RegisterVolunteerDeps } from "./register-volunteer";

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
  const deps: RegisterVolunteerDeps = { store, storage };
  return { store, files, uploads, deps };
}

const password = "Abcdef1!";
const addressWithoutPin = {
  streetLine1: "123 Katipunan Ave",
  city: "Quezon City",
};
const addressWithPin = {
  ...addressWithoutPin,
  latitude: 14.676,
  longitude: 121.0437,
};

function volunteerInput(overrides: Record<string, unknown> = {}): VolunteerRegistrationInput {
  return volunteerRegistrationSchema.parse({
    fullName: "Test Volunteer Person",
    contactNumber: "09171234567",
    email: "volunteer@example.com",
    address: addressWithoutPin,
    password,
    consent: true,
    ...overrides,
  });
}

const jpegProof = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);

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

describe("registerVolunteer", () => {
  it("registers a volunteer without a pin as VOLUNTEER/PENDING with null coordinates", async () => {
    const { store, deps } = setup();
    const result = await registerVolunteer(deps, volunteerInput(), jpegProof);
    if (!result.ok) throw new Error(`expected success, got ${result.error}`);

    expect(store.users).toHaveLength(1);
    expect(store.users[0]).toMatchObject({
      role: "VOLUNTEER",
      status: "PENDING",
      donorType: null,
      businessName: null,
    });
    expect(store.addresses).toHaveLength(1);
    expect(store.addresses[0]).toMatchObject({ latitude: null, longitude: null });
    expect(store.users[0]).toMatchObject({
      addressId: store.addresses[0]?.id,
      email: "volunteer@example.com",
      fullName: "Test Volunteer Person",
    });
    expect(result.userId).toBe(store.users[0]?.id);
  });

  it("forwards the map pin coordinates to insertAddress when both are sent", async () => {
    const { store, deps } = setup();
    const result = await registerVolunteer(deps, volunteerInput({ address: addressWithPin }), jpegProof);
    expect(result.ok).toBe(true);

    expect(store.addresses).toHaveLength(1);
    expect(store.addresses[0]).toMatchObject({ latitude: 14.676, longitude: 121.0437 });
  });

  it("passes availability through and stores null when it is absent", async () => {
    const { store, deps } = setup();
    const withNote = await registerVolunteer(deps, volunteerInput({ availability: "Weekend mornings" }), jpegProof);
    expect(withNote.ok).toBe(true);
    expect(store.users[0]).toMatchObject({ availability: "Weekend mornings" });

    const { store: freshStore, deps: freshDeps } = setup();
    const withoutNote = await registerVolunteer(freshDeps, volunteerInput(), jpegProof);
    expect(withoutNote.ok).toBe(true);
    expect(freshStore.users[0]).toMatchObject({ availability: null });

    const { store: emptyStore, deps: emptyDeps } = setup();
    const emptyNote = await registerVolunteer(emptyDeps, volunteerInput({ availability: "" }), jpegProof);
    expect(emptyNote.ok).toBe(true);
    expect(emptyStore.users[0]).toMatchObject({ availability: null });
  });

  it("stores the proof as a VALID_ID document with the random file name only", async () => {
    const { store, files, deps } = setup();
    const result = await registerVolunteer(deps, volunteerInput(), jpegProof);
    expect(result.ok).toBe(true);

    const doc = store.documents[0];
    if (!doc) throw new Error("no document row");
    expect(doc).toMatchObject({
      documentTypeCode: "VALID_ID",
      mimeType: "image/jpeg",
      sizeBytes: jpegProof.length,
    });
    expect(files.has(doc.storageKey)).toBe(true);
    expect(doc.storageKey.startsWith("proofs/")).toBe(true);
    expect(doc.originalFilename).toBe(doc.storageKey.split("/").at(-1));
    expect(doc.originalFilename).not.toContain("Test");
    expect(doc.originalFilename).not.toContain("Volunteer");
    expect(doc.originalFilename).not.toContain("Katipunan");
    expect(doc.originalFilename).not.toContain(password);
  });

  it("stores an argon2id hash that verifies against the plain password", async () => {
    const { store, deps } = setup();
    const result = await registerVolunteer(deps, volunteerInput(), jpegProof);
    expect(result.ok).toBe(true);

    const row = store.credentials[0];
    if (!row) throw new Error("no credentials row");
    expect(row.passwordHash).not.toBe(password);
    expect(row.passwordHash.startsWith("$argon2id$")).toBe(true);
    expect(await verifyPassword(row.passwordHash, password)).toBe(true);
  });

  it("records the privacy consent with the shared constants", async () => {
    const { store, deps } = setup();
    const result = await registerVolunteer(deps, volunteerInput(), jpegProof);
    if (!result.ok) throw new Error(`expected success, got ${result.error}`);

    expect(store.consents).toHaveLength(1);
    expect(store.consents[0]).toMatchObject({
      userId: result.userId,
      consentType: PRIVACY_CONSENT_TYPE,
      policyVersion: PRIVACY_POLICY_VERSION,
    });
  });

  it("returns INVALID_PROOF for wrong type bytes, an empty file or 5 MB + 1 byte", async () => {
    const { store, files, uploads, deps } = setup();
    const proofs = [
      Uint8Array.from([0x47, 0x49, 0x46, 0x38, 0x39, 0x61]),
      new Uint8Array(0),
      jpegOfSize(MAX_IMAGE_BYTES + 1),
    ];

    for (const proof of proofs) {
      const result = await registerVolunteer(deps, volunteerInput(), proof);
      expect(result).toEqual({ ok: false, error: "INVALID_PROOF" });
    }
    expectNoRows(store);
    expect(uploads).toHaveLength(0);
    expect(files.size).toBe(0);
  });

  it("returns EMAIL_TAKEN from emailExists without uploading or writing rows", async () => {
    const { store, files, uploads, deps } = setup();
    store.seedEmail("volunteer@example.com");

    const result = await registerVolunteer(deps, volunteerInput(), jpegProof);
    expect(result).toEqual({ ok: false, error: "EMAIL_TAKEN" });
    expectNoRows(store);
    expect(uploads).toHaveLength(0);
    expect(files.size).toBe(0);
  });

  it("returns EMAIL_TAKEN when the unique index fires after upload and removes the object", async () => {
    const { store, files, uploads, deps } = setup();
    store.seedEmail("volunteer@example.com");
    store.race = true;

    const result = await registerVolunteer(deps, volunteerInput(), jpegProof);
    expect(result).toEqual({ ok: false, error: "EMAIL_TAKEN" });
    expectNoRows(store);
    expect(uploads).toHaveLength(1);
    expect(files.size).toBe(0);
  });

  it("rethrows a non-duplicate transaction error after removing the uploaded object", async () => {
    const { store, files, uploads, deps } = setup();
    store.boom = true;

    await expect(registerVolunteer(deps, volunteerInput(), jpegProof)).rejects.toThrow("boom");
    expectNoRows(store);
    expect(uploads).toHaveLength(1);
    expect(files.size).toBe(0);
  });

  it("still surfaces the original error when removeObject fails during cleanup", async () => {
    const { store, uploads, deps } = setup({
      remove: async () => ({ data: null, error: { message: "remove failed" } }),
    });
    store.boom = true;
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});

    try {
      // A leaked cleanup error would throw "Storage remove failed" instead of "boom".
      await expect(registerVolunteer(deps, volunteerInput(), jpegProof)).rejects.toThrow("boom");
      expect(uploads).toHaveLength(1);
      expectNoRows(store);
      expect(consoleError).toHaveBeenCalledTimes(1);
      expect(consoleError.mock.calls[0]?.[0]).toContain("registerAccount");
      expect(consoleError.mock.calls[0]?.[1]).toMatchObject({ key: uploads[0] });
    } finally {
      consoleError.mockRestore();
    }
  });
});
