import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/server/db";
import type { ProofStore } from "./proof-url";

export const prismaProofStore: ProofStore = {
  async findDocument(userId, documentId) {
    const document = await prisma.user_documents.findFirst({
      where: {
        id: documentId,
        user_id: userId,
        deleted_at: null,
        // The owner must not be soft-deleted either.
        users_user_documents_user_idTousers: { deleted_at: null },
      },
      select: { storage_key: true },
    });
    return document ? { storageKey: document.storage_key } : null;
  },

  async insertAudit(row) {
    await prisma.audit_logs.create({
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
