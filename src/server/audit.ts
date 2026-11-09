import "server-only";

import { prisma } from "@/server/db";

export type AuditDetails = Record<string, string | number | boolean | null>;

export type AuditLogInput = {
  actorUserId?: string | null;
  action: string;
  targetType: string;
  targetId?: string | null;
  details?: AuditDetails;
};

export interface AuditClient {
  audit_logs: {
    create(args: {
      data: {
        actor_user_id: string | null;
        action: string;
        target_type: string;
        target_id: string | null;
        details: AuditDetails;
      };
    }): Promise<unknown>;
  };
}

export async function writeAuditLog(input: AuditLogInput, client?: AuditClient) {
  const target = client ?? prisma;
  await target.audit_logs.create({
    data: {
      actor_user_id: input.actorUserId ?? null,
      action: input.action,
      target_type: input.targetType,
      target_id: input.targetId ?? null,
      details: input.details ?? {},
    },
  });
}
