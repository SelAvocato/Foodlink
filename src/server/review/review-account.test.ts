import { describe, expect, it } from "vitest";
import type { AccountStatus, Role } from "@/contracts/enums";
import type { ReviewInput } from "@/contracts/review";
import { reviewAccount, type ReviewStore, type ReviewTx } from "./review-account";

type SeedUser = { id: string; role: Role; status: AccountStatus; deleted?: boolean };
type SeedDocument = {
  id: string;
  userId: string;
  status: "PENDING" | "APPROVED" | "REJECTED";
  reviewedByUserId: string | null;
  reviewedAt: Date | null;
  note: string | null;
  deleted?: boolean;
};
type SeedReview = {
  userId: string;
  reviewedByUserId: string;
  resultingStatus: AccountStatus;
  reason: string | null;
  reviewedAt: Date;
};
type SeedAudit = {
  actorUserId: string;
  action: string;
  targetType: "user";
  targetId: string;
  details: Record<string, unknown>;
};

/** In-memory store. Rows are replaced, never mutated, so the array snapshot restores on throw. */
class FakeReviewStore implements ReviewStore {
  users: SeedUser[] = [];
  documents: SeedDocument[] = [];
  reviews: SeedReview[] = [];
  audits: SeedAudit[] = [];
  race = false;
  auditBoom = false;

  async transaction<T>(work: (tx: ReviewTx) => Promise<T>): Promise<T> {
    const snapshot = {
      users: [...this.users],
      documents: [...this.documents],
      reviews: [...this.reviews],
      audits: [...this.audits],
    };
    try {
      return await work({
        getTarget: async (userId) => {
          const user = this.users.find((candidate) => candidate.id === userId && !candidate.deleted);
          return user ? { role: user.role, status: user.status } : null;
        },
        updateStatus: async (userId, from, to) => {
          if (this.race) return false;
          const index = this.users.findIndex(
            (candidate) => candidate.id === userId && candidate.status === from && !candidate.deleted,
          );
          if (index === -1) return false;
          const current = this.users[index];
          if (!current) return false;
          this.users[index] = { ...current, status: to };
          return true;
        },
        reviewPendingDocuments: async (row) => {
          this.documents = this.documents.map((doc) =>
            doc.userId === row.userId && doc.status === "PENDING" && !doc.deleted
              ? {
                  ...doc,
                  status: row.status,
                  reviewedByUserId: row.reviewedByUserId,
                  reviewedAt: new Date(),
                  note: row.note,
                }
              : doc,
          );
        },
        insertReview: async (row) => {
          this.reviews.push({ ...row, reviewedAt: new Date() });
        },
        insertAudit: async (row) => {
          if (this.auditBoom) throw new Error("boom");
          this.audits.push(row);
        },
      });
    } catch (error) {
      this.users = snapshot.users;
      this.documents = snapshot.documents;
      this.reviews = snapshot.reviews;
      this.audits = snapshot.audits;
      throw error;
    }
  }
}

const REVIEWER = "admin-1";
const DONOR = "donor-1";
const VOLUNTEER = "volunteer-1";
const REASON = "ID photo is blurred";

function pendingDocument(userId: string, id = "doc-1"): SeedDocument {
  return { id, userId, status: "PENDING", reviewedByUserId: null, reviewedAt: null, note: null };
}

function storeWith(user: SeedUser, documents: SeedDocument[] = []): FakeReviewStore {
  const store = new FakeReviewStore();
  store.users.push(user);
  store.documents.push(...documents);
  return store;
}

describe("reviewAccount", () => {
  it("approves a PENDING donor: ACTIVE, document approved, one review and one audit row", async () => {
    const store = storeWith({ id: DONOR, role: "DONOR", status: "PENDING" }, [pendingDocument(DONOR)]);

    const result = await reviewAccount(
      { store },
      { reviewerId: REVIEWER, targetId: DONOR, review: { action: "APPROVE" } },
    );

    expect(result).toEqual({ ok: true, resultingStatus: "ACTIVE" });
    expect(store.users[0]?.status).toBe("ACTIVE");

    const doc = store.documents[0];
    expect(doc).toMatchObject({ status: "APPROVED", reviewedByUserId: REVIEWER, note: null });
    expect(doc?.reviewedAt).toBeInstanceOf(Date);

    expect(store.reviews).toHaveLength(1);
    expect(store.reviews[0]).toMatchObject({
      userId: DONOR,
      reviewedByUserId: REVIEWER,
      resultingStatus: "ACTIVE",
      reason: null,
    });

    expect(store.audits).toHaveLength(1);
    expect(store.audits[0]).toEqual({
      actorUserId: REVIEWER,
      action: "account_approved",
      targetType: "user",
      targetId: DONOR,
      details: { from: "PENDING", to: "ACTIVE" },
    });
  });

  it("rejects a PENDING volunteer with a reason that reaches the document note and the review row", async () => {
    const store = storeWith({ id: VOLUNTEER, role: "VOLUNTEER", status: "PENDING" }, [pendingDocument(VOLUNTEER)]);

    const result = await reviewAccount(
      { store },
      { reviewerId: REVIEWER, targetId: VOLUNTEER, review: { action: "REJECT", reason: REASON } },
    );

    expect(result).toEqual({ ok: true, resultingStatus: "REJECTED" });
    expect(store.users[0]?.status).toBe("REJECTED");

    expect(store.documents[0]).toMatchObject({
      status: "REJECTED",
      reviewedByUserId: REVIEWER,
      note: REASON,
    });

    expect(store.reviews).toHaveLength(1);
    expect(store.reviews[0]).toMatchObject({ resultingStatus: "REJECTED", reason: REASON });

    expect(store.audits).toHaveLength(1);
    expect(store.audits[0]).toEqual({
      actorUserId: REVIEWER,
      action: "account_rejected",
      targetType: "user",
      targetId: VOLUNTEER,
      details: { from: "PENDING", to: "REJECTED" },
    });
    expect(JSON.stringify(store.audits[0]?.details)).not.toContain(REASON);
  });

  it("suspends an ACTIVE account and reactivates a SUSPENDED one without touching documents", async () => {
    const store = storeWith({ id: DONOR, role: "DONOR", status: "ACTIVE" }, [pendingDocument(DONOR)]);

    const suspended = await reviewAccount(
      { store },
      { reviewerId: REVIEWER, targetId: DONOR, review: { action: "SUSPEND", reason: "Posted expired food" } },
    );
    expect(suspended).toEqual({ ok: true, resultingStatus: "SUSPENDED" });
    expect(store.users[0]?.status).toBe("SUSPENDED");
    expect(store.documents[0]).toMatchObject({
      status: "PENDING",
      reviewedByUserId: null,
      reviewedAt: null,
      note: null,
    });

    const reactivated = await reviewAccount(
      { store },
      { reviewerId: REVIEWER, targetId: DONOR, review: { action: "REACTIVATE" } },
    );
    expect(reactivated).toEqual({ ok: true, resultingStatus: "ACTIVE" });
    expect(store.users[0]?.status).toBe("ACTIVE");
    expect(store.documents[0]).toMatchObject({ status: "PENDING", reviewedByUserId: null });

    expect(store.reviews).toHaveLength(2);
    expect(store.reviews[0]).toMatchObject({ resultingStatus: "SUSPENDED", reason: "Posted expired food" });
    expect(store.reviews[1]).toMatchObject({ resultingStatus: "ACTIVE", reason: null });

    expect(store.audits).toHaveLength(2);
    expect(store.audits[0]).toMatchObject({
      action: "account_suspended",
      details: { from: "ACTIVE", to: "SUSPENDED" },
    });
    expect(store.audits[1]).toMatchObject({
      action: "account_reactivated",
      details: { from: "SUSPENDED", to: "ACTIVE" },
    });
  });

  it("leaves a document that is already APPROVED exactly as it was", async () => {
    const alreadyApproved: SeedDocument = {
      id: "doc-old",
      userId: DONOR,
      status: "APPROVED",
      reviewedByUserId: "admin-0",
      reviewedAt: new Date("2026-11-01T00:00:00.000Z"),
      note: "earlier note",
    };
    const store = storeWith(
      { id: DONOR, role: "DONOR", status: "PENDING" },
      [alreadyApproved, pendingDocument(DONOR, "doc-new")],
    );

    const result = await reviewAccount(
      { store },
      { reviewerId: REVIEWER, targetId: DONOR, review: { action: "APPROVE" } },
    );
    expect(result).toEqual({ ok: true, resultingStatus: "ACTIVE" });

    expect(store.documents.find((doc) => doc.id === "doc-new")).toMatchObject({
      status: "APPROVED",
      reviewedByUserId: REVIEWER,
    });
    expect(store.documents.find((doc) => doc.id === "doc-old")).toEqual(alreadyApproved);
  });

  it.each<[string, AccountStatus, ReviewInput]>([
    ["approve an ACTIVE account", "ACTIVE", { action: "APPROVE" }],
    ["reject an ACTIVE account", "ACTIVE", { action: "REJECT", reason: REASON }],
    ["suspend a PENDING account", "PENDING", { action: "SUSPEND", reason: REASON }],
    ["reactivate an ACTIVE account", "ACTIVE", { action: "REACTIVATE" }],
    ["approve a REJECTED account", "REJECTED", { action: "APPROVE" }],
    ["reject a REJECTED account", "REJECTED", { action: "REJECT", reason: REASON }],
  ])("returns INVALID_TRANSITION and writes nothing when %s", async (_label, status, review) => {
    const store = storeWith({ id: DONOR, role: "DONOR", status }, [pendingDocument(DONOR)]);

    const result = await reviewAccount({ store }, { reviewerId: REVIEWER, targetId: DONOR, review });

    expect(result).toEqual({ ok: false, error: "INVALID_TRANSITION" });
    expect(store.users[0]?.status).toBe(status);
    expect(store.documents[0]).toMatchObject({ status: "PENDING", reviewedByUserId: null, reviewedAt: null });
    expect(store.reviews).toHaveLength(0);
    expect(store.audits).toHaveLength(0);
  });

  it("returns NOT_FOUND for an unknown id or a soft-deleted user and writes nothing", async () => {
    const store = storeWith({ id: "deleted-1", role: "DONOR", status: "PENDING", deleted: true });

    const unknown = await reviewAccount(
      { store },
      { reviewerId: REVIEWER, targetId: "missing-1", review: { action: "APPROVE" } },
    );
    const deleted = await reviewAccount(
      { store },
      { reviewerId: REVIEWER, targetId: "deleted-1", review: { action: "APPROVE" } },
    );

    expect(unknown).toEqual({ ok: false, error: "NOT_FOUND" });
    expect(deleted).toEqual({ ok: false, error: "NOT_FOUND" });
    expect(store.users[0]?.status).toBe("PENDING");
    expect(store.reviews).toHaveLength(0);
    expect(store.audits).toHaveLength(0);
  });

  it("returns TARGET_NOT_REVIEWABLE for an ADMIN target and for self-review, writing nothing", async () => {
    const store = storeWith({ id: "admin-9", role: "ADMIN", status: "ACTIVE" });
    store.users.push({ id: DONOR, role: "DONOR", status: "PENDING" });

    const adminTarget = await reviewAccount(
      { store },
      { reviewerId: REVIEWER, targetId: "admin-9", review: { action: "APPROVE" } },
    );
    const selfReview = await reviewAccount(
      { store },
      { reviewerId: DONOR, targetId: DONOR, review: { action: "APPROVE" } },
    );

    expect(adminTarget).toEqual({ ok: false, error: "TARGET_NOT_REVIEWABLE" });
    expect(selfReview).toEqual({ ok: false, error: "TARGET_NOT_REVIEWABLE" });
    expect(store.users.map((user) => user.status)).toEqual(["ACTIVE", "PENDING"]);
    expect(store.reviews).toHaveLength(0);
    expect(store.audits).toHaveLength(0);
  });

  it("returns INVALID_TRANSITION when the conditional update loses the race, writing nothing", async () => {
    const store = storeWith({ id: DONOR, role: "DONOR", status: "PENDING" }, [pendingDocument(DONOR)]);
    store.race = true;

    const result = await reviewAccount(
      { store },
      { reviewerId: REVIEWER, targetId: DONOR, review: { action: "APPROVE" } },
    );

    expect(result).toEqual({ ok: false, error: "INVALID_TRANSITION" });
    expect(store.users[0]?.status).toBe("PENDING");
    expect(store.documents[0]).toMatchObject({ status: "PENDING", reviewedByUserId: null, reviewedAt: null });
    expect(store.reviews).toHaveLength(0);
    expect(store.audits).toHaveLength(0);
  });

  it("rolls back the status, document and review rows when the audit write fails and rethrows", async () => {
    const store = storeWith({ id: DONOR, role: "DONOR", status: "PENDING" }, [pendingDocument(DONOR)]);
    store.auditBoom = true;

    await expect(
      reviewAccount({ store }, { reviewerId: REVIEWER, targetId: DONOR, review: { action: "APPROVE" } }),
    ).rejects.toThrow("boom");

    expect(store.users[0]?.status).toBe("PENDING");
    expect(store.documents[0]).toMatchObject({
      status: "PENDING",
      reviewedByUserId: null,
      reviewedAt: null,
      note: null,
    });
    expect(store.reviews).toHaveLength(0);
    expect(store.audits).toHaveLength(0);
  });
});
