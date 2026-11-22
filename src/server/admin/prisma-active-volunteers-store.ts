import type { ActiveVolunteersStore } from "@/server/admin/active-volunteers";
import { prisma } from "@/server/db";

/**
 * Thin adapter: the same conditions transitionDonation uses before an assignment
 * (role VOLUNTEER, status ACTIVE, not soft-deleted), ordered by full name then id
 * so the list has a stable order. Only the list columns are selected.
 */
export const prismaActiveVolunteersStore: ActiveVolunteersStore = {
  async findActiveVolunteers(limit) {
    const users = await prisma.users.findMany({
      where: { role: "VOLUNTEER", status: "ACTIVE", deleted_at: null },
      orderBy: [{ full_name: "asc" }, { id: "asc" }],
      take: limit,
      select: {
        id: true,
        full_name: true,
        availability: true,
        role: true,
        status: true,
        deleted_at: true,
      },
    });

    return users.map((user) => ({
      id: user.id,
      fullName: user.full_name,
      availability: user.availability,
      role: user.role,
      status: user.status,
      deletedAt: user.deleted_at,
    }));
  },
};
