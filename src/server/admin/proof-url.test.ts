import { describe, expect, it } from "vitest";
import { getProofSignedUrl, type ProofStore } from "./proof-url";

const ADMIN_ID = "11111111-1111-4111-8111-111111111111";
const USER_ID = "22222222-2222-4222-8222-222222222222";
const OTHER_USER_ID = "33333333-3333-4333-8333-333333333333";
const DOCUMENT_ID = "44444444-4444-4444-8444-444444444444";
const OTHER_DOCUMENT_ID = "55555555-5555-4555-8555-555555555555";
const STORAGE_KEY = "proofs/66666666-6666-4666-8666-666666666666.jpg";
const SIGNED_URL = "https://storage.example.test/proofs/signed?token=fake-token";

type AuditRow = Parameters<ProofStore["insertAudit"]>[0];

class FakeProofStore implements ProofStore {
  documents: Array<{ userId: string; documentId: string; storageKey: string }> = [];
  auditRows: AuditRow[] = [];
  failAudit = false;

  async findDocument(userId: string, documentId: string): Promise<{ storageKey: string } | null> {
    const found = this.documents.find(
      (document) => document.userId === userId && document.documentId === documentId,
    );
    return found ? { storageKey: found.storageKey } : null;
  }

  async insertAudit(row: AuditRow): Promise<void> {
    if (this.failAudit) throw new Error("audit insert failed");
    this.auditRows.push(row);
  }
}

class FakeStorage {
  calls: Array<{ key: string; expiresInSeconds: number }> = [];
  fail = false;

  async getSignedUrl(key: string, expiresInSeconds: number): Promise<string> {
    this.calls.push({ key, expiresInSeconds });
    if (this.fail) throw new Error("signing failed");
    return SIGNED_URL;
  }
}

function storeWith(document: { userId: string; documentId: string; storageKey: string }): FakeProofStore {
  const store = new FakeProofStore();
  store.documents = [document];
  return store;
}

describe("getProofSignedUrl", () => {
  it("returns the signed URL for 300 seconds and writes one audit row", async () => {
    const store = storeWith({ userId: USER_ID, documentId: DOCUMENT_ID, storageKey: STORAGE_KEY });
    const storage = new FakeStorage();

    const result = await getProofSignedUrl({ store, storage }, {
      adminId: ADMIN_ID,
      userId: USER_ID,
      documentId: DOCUMENT_ID,
    });

    expect(result).toEqual({ ok: true, url: SIGNED_URL, expiresInSeconds: 300 });
    expect(storage.calls).toEqual([{ key: STORAGE_KEY, expiresInSeconds: 300 }]);
    expect(store.auditRows).toHaveLength(1);
    expect(store.auditRows[0]).toEqual({
      actorUserId: ADMIN_ID,
      action: "proof_document_viewed",
      targetType: "user_document",
      targetId: DOCUMENT_ID,
      details: { user_id: USER_ID },
    });
    expect(Object.keys(store.auditRows[0]?.details ?? {})).toEqual(["user_id"]);
  });

  it("answers NOT_FOUND for a document that belongs to another user", async () => {
    const store = storeWith({ userId: OTHER_USER_ID, documentId: DOCUMENT_ID, storageKey: STORAGE_KEY });
    const storage = new FakeStorage();

    const result = await getProofSignedUrl({ store, storage }, {
      adminId: ADMIN_ID,
      userId: USER_ID,
      documentId: DOCUMENT_ID,
    });

    expect(result).toEqual({ ok: false, error: "NOT_FOUND" });
    expect(storage.calls).toEqual([]);
    expect(store.auditRows).toEqual([]);
  });

  it("answers NOT_FOUND for an unknown document id", async () => {
    const store = storeWith({ userId: USER_ID, documentId: OTHER_DOCUMENT_ID, storageKey: STORAGE_KEY });
    const storage = new FakeStorage();

    const result = await getProofSignedUrl({ store, storage }, {
      adminId: ADMIN_ID,
      userId: USER_ID,
      documentId: DOCUMENT_ID,
    });

    expect(result).toEqual({ ok: false, error: "NOT_FOUND" });
    expect(storage.calls).toEqual([]);
    expect(store.auditRows).toEqual([]);
  });

  it("rejects when signing fails and writes no audit row", async () => {
    const store = storeWith({ userId: USER_ID, documentId: DOCUMENT_ID, storageKey: STORAGE_KEY });
    const storage = new FakeStorage();
    storage.fail = true;

    await expect(
      getProofSignedUrl({ store, storage }, { adminId: ADMIN_ID, userId: USER_ID, documentId: DOCUMENT_ID }),
    ).rejects.toThrow("signing failed");
    expect(store.auditRows).toEqual([]);
  });

  it("rejects when the audit insert fails, so no URL is returned", async () => {
    const store = storeWith({ userId: USER_ID, documentId: DOCUMENT_ID, storageKey: STORAGE_KEY });
    const storage = new FakeStorage();
    store.failAudit = true;

    await expect(
      getProofSignedUrl({ store, storage }, { adminId: ADMIN_ID, userId: USER_ID, documentId: DOCUMENT_ID }),
    ).rejects.toThrow("audit insert failed");
  });

  it("keeps the storage key and the URL out of the audit row", async () => {
    const store = storeWith({ userId: USER_ID, documentId: DOCUMENT_ID, storageKey: STORAGE_KEY });
    const storage = new FakeStorage();

    await getProofSignedUrl({ store, storage }, { adminId: ADMIN_ID, userId: USER_ID, documentId: DOCUMENT_ID });

    const row = store.auditRows[0];
    expect(Object.keys(row ?? {}).sort()).toEqual([
      "action",
      "actorUserId",
      "details",
      "targetId",
      "targetType",
    ]);
    const serialized = JSON.stringify(row);
    expect(serialized).not.toContain(STORAGE_KEY);
    expect(serialized).not.toContain(SIGNED_URL);
    expect(serialized).not.toContain("original_filename");
    expect(serialized).not.toContain("@");
  });
});
