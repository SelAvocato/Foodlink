import { prisma } from "@/server/db";
import type { PendingUsersStore } from "./pending-users";

export const prismaPendingUsersStore: PendingUsersStore = {
  async findPendingUsers(limit) {
    const users = await prisma.users.findMany({
      where: { role: { in: ["DONOR", "VOLUNTEER"] }, status: "PENDING", deleted_at: null },
      orderBy: { created_at: "asc" },
      take: limit,
      select: {
        id: true,
        role: true,
        status: true,
        full_name: true,
        email: true,
        created_at: true,
        donor_type: true,
        business_name: true,
        deleted_at: true,
        user_documents_user_documents_user_idTousers: {
          where: { deleted_at: null },
          orderBy: { created_at: "asc" },
          select: {
            id: true,
            status: true,
            mime_type: true,
            size_bytes: true,
            created_at: true,
            deleted_at: true,
            document_types: { select: { code: true } },
          },
        },
      },
    });

    return users.map((user) => ({
      id: user.id,
      role: user.role,
      status: user.status,
      fullName: user.full_name,
      email: user.email,
      createdAt: user.created_at,
      donorType: user.donor_type,
      businessName: user.business_name,
      deletedAt: user.deleted_at,
      documents: user.user_documents_user_documents_user_idTousers.map((document) => ({
        id: document.id,
        typeCode: document.document_types.code,
        status: document.status,
        mimeType: document.mime_type,
        sizeBytes: Number(document.size_bytes),
        createdAt: document.created_at,
        deletedAt: document.deleted_at,
      })),
    }));
  },
};
