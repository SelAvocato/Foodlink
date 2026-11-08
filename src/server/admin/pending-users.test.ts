import { describe, expect, it } from "vitest";
import { listPendingUsers, type PendingUserRow, type PendingUsersStore } from "./pending-users";

class FakePendingUsersStore implements PendingUsersStore {
  rows: PendingUserRow[] = [];

  async findPendingUsers(): Promise<PendingUserRow[]> {
    return [...this.rows];
  }
}

function document(overrides: Partial<PendingUserDocumentFields> = {}): PendingUserDocumentFields {
  return {
    id: "doc-1",
    typeCode: "VALID_ID",
    status: "PENDING",
    mimeType: "image/jpeg",
    sizeBytes: 1024,
    createdAt: new Date("2026-11-01T00:00:00.000Z"),
    deletedAt: null,
    ...overrides,
  };
}

type PendingUserDocumentFields = NonNullable<PendingUserRow["documents"]>[number];

function user(overrides: Partial<PendingUserRow> = {}): PendingUserRow {
  return {
    id: "user-1",
    role: "DONOR",
    status: "PENDING",
    fullName: "Test Donor",
    email: "donor@example.com",
    createdAt: new Date("2026-11-02T00:00:00.000Z"),
    donorType: "ESTABLISHMENT",
    businessName: "Test Bakery Corp",
    deletedAt: null,
    documents: [document()],
    ...overrides,
  };
}

describe("listPendingUsers", () => {
  it("returns only PENDING Donor and Volunteer accounts, oldest first", async () => {
    const store = new FakePendingUsersStore();
    const newer = user({ id: "newer", createdAt: new Date("2026-11-05T00:00:00.000Z") });
    const older = user({
      id: "older",
      role: "VOLUNTEER",
      donorType: null,
      businessName: null,
      createdAt: new Date("2026-11-01T00:00:00.000Z"),
    });
    const admin = user({ id: "admin", role: "ADMIN", donorType: null, businessName: null });
    const active = user({ id: "active", status: "ACTIVE" });
    const softDeleted = user({ id: "deleted", deletedAt: new Date("2026-11-03T00:00:00.000Z") });
    store.rows = [newer, older, admin, active, softDeleted];

    const users = await listPendingUsers({ store }, { limit: 50 });

    expect(users.map((row) => row.id)).toEqual(["older", "newer"]);
  });

  it("respects the limit after sorting", async () => {
    const store = new FakePendingUsersStore();
    store.rows = [
      user({ id: "a", createdAt: new Date("2026-11-03T00:00:00.000Z") }),
      user({ id: "b", createdAt: new Date("2026-11-01T00:00:00.000Z") }),
      user({ id: "c", createdAt: new Date("2026-11-02T00:00:00.000Z") }),
    ];

    const users = await listPendingUsers({ store }, { limit: 2 });

    expect(users.map((row) => row.id)).toEqual(["b", "c"]);
  });

  it("maps documents to the response shape and drops soft-deleted ones", async () => {
    const store = new FakePendingUsersStore();
    const live = document({ id: "doc-live" });
    const gone = document({ id: "doc-gone", deletedAt: new Date("2026-11-04T00:00:00.000Z") });
    store.rows = [user({ documents: [gone, live] })];

    const users = await listPendingUsers({ store }, { limit: 50 });

    expect(users).toHaveLength(1);
    expect(users[0]?.documents).toEqual([
      {
        id: "doc-live",
        type: "VALID_ID",
        status: "PENDING",
        mimeType: "image/jpeg",
        sizeBytes: 1024,
        createdAt: new Date("2026-11-01T00:00:00.000Z"),
      },
    ]);
  });

  it("keeps donorType and businessName for donors and nulls them for volunteers", async () => {
    const store = new FakePendingUsersStore();
    store.rows = [
      user({ id: "donor-1" }),
      user({ id: "volunteer-1", role: "VOLUNTEER", donorType: null, businessName: null }),
    ];

    const users = await listPendingUsers({ store }, { limit: 50 });

    expect(users[0]).toMatchObject({ donorType: "ESTABLISHMENT", businessName: "Test Bakery Corp" });
    expect(users[1]).toMatchObject({ donorType: null, businessName: null });
  });

  it("builds response objects from an allow-list even if a store row carries extra fields", async () => {
    const store = new FakePendingUsersStore();
    const leakyDocument = Object.assign(document(), {
      storageKey: "proofs/secret-key.jpg",
      originalFilename: "private-name.jpg",
    });
    const leakyUser = Object.assign(user({ documents: [leakyDocument] }), {
      passwordHash: "secret-hash",
      contactNumber: "0000",
    });
    store.rows = [leakyUser];

    const users = await listPendingUsers({ store }, { limit: 50 });

    expect(Object.keys(users[0] ?? {}).sort()).toEqual([
      "businessName",
      "createdAt",
      "documents",
      "donorType",
      "email",
      "fullName",
      "id",
      "role",
    ]);
    expect(Object.keys(users[0]?.documents[0] ?? {}).sort()).toEqual([
      "createdAt",
      "id",
      "mimeType",
      "sizeBytes",
      "status",
      "type",
    ]);
    const serialized = JSON.stringify(users);
    expect(serialized).not.toContain("secret-key");
    expect(serialized).not.toContain("private-name");
    expect(serialized).not.toContain("secret-hash");
  });

  it("returns an empty list when the store has nothing", async () => {
    const store = new FakePendingUsersStore();

    expect(await listPendingUsers({ store }, { limit: 50 })).toEqual([]);
  });
});
