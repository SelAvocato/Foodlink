import "server-only";

import { prisma } from "@/server/db";
import type { CleanupStore } from "@/server/cleanup/run-cleanup";

export const prismaCleanupStore: CleanupStore = {
  async run(otpDays, notificationDays) {
    await prisma.$executeRaw`CALL sp_cleanup_expired_records(${otpDays}, ${notificationDays})`;
  },
};
