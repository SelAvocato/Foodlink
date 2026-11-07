import type { AccountStatus, Role } from "@/contracts/enums";
import { resolveReview, type ReviewInput } from "@/contracts/review";

export interface ReviewTx {
  getTarget(userId: string): Promise<{ role: Role; status: AccountStatus } | null>;
  /** True only when exactly one row changed (the conditional update lost the race otherwise). */
  updateStatus(userId: string, from: AccountStatus, to: AccountStatus): Promise<boolean>;
  reviewPendingDocuments(row: {
    userId: string;
    status: "APPROVED" | "REJECTED";
    reviewedByUserId: string;
    note: string | null;
  }): Promise<void>;
  insertReview(row: {
    userId: string;
    reviewedByUserId: string;
    resultingStatus: AccountStatus;
    reason: string | null;
  }): Promise<void>;
  insertAudit(row: {
    actorUserId: string;
    action: string;
    targetType: "user";
    targetId: string;
    details: Record<string, unknown>;
  }): Promise<void>;
}

export interface ReviewStore {
  /** Runs `work` atomically; rolls back if `work` throws. */
  transaction<T>(work: (tx: ReviewTx) => Promise<T>): Promise<T>;
}

const AUDIT_ACTIONS = {
  APPROVE: "account_approved",
  REJECT: "account_rejected",
  SUSPEND: "account_suspended",
  REACTIVATE: "account_reactivated",
} as const;

export type ReviewAccountResult =
  | { ok: true; resultingStatus: AccountStatus }
  | { ok: false; error: "NOT_FOUND" | "TARGET_NOT_REVIEWABLE" | "INVALID_TRANSITION" };

export async function reviewAccount(
  deps: { store: ReviewStore },
  input: { reviewerId: string; targetId: string; review: ReviewInput },
): Promise<ReviewAccountResult> {
  const { reviewerId, targetId, review } = input;

  return deps.store.transaction(async (tx) => {
    const target = await tx.getTarget(targetId);
    if (!target) return { ok: false, error: "NOT_FOUND" };

    // Only Donor and Volunteer accounts are reviewable, and nobody reviews themselves.
    if (targetId === reviewerId || target.role === "ADMIN") {
      return { ok: false, error: "TARGET_NOT_REVIEWABLE" };
    }

    const resolved = resolveReview(review, target.status);
    if (!resolved.ok) return { ok: false, error: "INVALID_TRANSITION" };

    const moved = await tx.updateStatus(targetId, target.status, resolved.resultingStatus);
    if (!moved) return { ok: false, error: "INVALID_TRANSITION" };

    if (review.action === "APPROVE") {
      await tx.reviewPendingDocuments({
        userId: targetId,
        status: "APPROVED",
        reviewedByUserId: reviewerId,
        note: null,
      });
    } else if (review.action === "REJECT") {
      await tx.reviewPendingDocuments({
        userId: targetId,
        status: "REJECTED",
        reviewedByUserId: reviewerId,
        note: resolved.reason ?? null,
      });
    }

    await tx.insertReview({
      userId: targetId,
      reviewedByUserId: reviewerId,
      resultingStatus: resolved.resultingStatus,
      reason: resolved.reason ?? null,
    });

    await tx.insertAudit({
      actorUserId: reviewerId,
      action: AUDIT_ACTIONS[review.action],
      targetType: "user",
      targetId,
      // The reason text never goes into the audit details.
      details: { from: target.status, to: resolved.resultingStatus },
    });

    return { ok: true, resultingStatus: resolved.resultingStatus };
  });
}
