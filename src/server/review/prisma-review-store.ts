import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/server/db";
import type { ReviewStore, ReviewTx } from "./review-account";

// updated_at is left to the set_updated_at triggers in db/baseline/001_schema.sql.
function createTransactionAdapter(tx: typeof prisma): ReviewTx {
  return {
    async getTarget(userId) {
      return tx.users.findFirst({
        where: { id: userId, deleted_at: null },
        select: { role: true, status: true },
      });
    },
    async updateStatus(userId, from, to) {
      const updated = await tx.users.updateMany({
        where: { id: userId, status: from, deleted_at: null },
        data: { status: to },
      });
      return updated.count === 1;
    },
    async reviewPendingDocuments(row) {
      await tx.user_documents.updateMany({
        where: { user_id: row.userId, status: "PENDING", deleted_at: null },
        data: {
          status: row.status,
          reviewed_by_user_id: row.reviewedByUserId,
          reviewed_at: new Date(),
          review_note: row.note,
        },
      });
    },
    async insertReview(row) {
      await tx.user_reviews.create({
        data: {
          user_id: row.userId,
          reviewed_by_user_id: row.reviewedByUserId,
          resulting_status: row.resultingStatus,
          reason: row.reason,
        },
      });
    },
    async insertAudit(row) {
      await tx.audit_logs.create({
        data: {
          actor_user_id: row.actorUserId,
          action: row.action,
          target_type: row.targetType,
          target_id: row.targetId,
          details: row.details as Prisma.InputJsonValue,
        },
      });
    },
  };
}

export const prismaReviewStore: ReviewStore = {
  async transaction(work) {
    return prisma.$transaction(async (tx) => work(createTransactionAdapter(tx as typeof prisma)));
  },
};
