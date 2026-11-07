import "server-only";

import { getServerSession } from "next-auth";
import type { AuthenticatedActor, RequireRole } from "@/contracts/authz";
import type { Role } from "@/contracts/enums";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/server/db";

export class AuthorizationError extends Error {
    constructor(
        public readonly code: "UNAUTHENTICATED" | "INACTIVE_ACCOUNT" | "FORBIDDEN",
        message: string,
    ) {
        super(message);
        this.name = "AuthorizationError";
    }
}

export const requireRole: RequireRole = async (allowedRoles: readonly Role[]): Promise<AuthenticatedActor> => {
    const session = await getServerSession(authOptions);
    const sessionUserId = session?.user?.id;
    if (!sessionUserId) {
        throw new AuthorizationError("UNAUTHENTICATED", "Sign in to access this resource.");
    }

    const user = await prisma.users.findFirst({
        where: { id: sessionUserId, deleted_at: null },
        select: { id: true, email: true, full_name: true, role: true, status: true },
    });
    if (!user || user.status !== "ACTIVE") {
        throw new AuthorizationError("INACTIVE_ACCOUNT", "Your account is not active.");
    }
    if (!allowedRoles.includes(user.role)) {
        throw new AuthorizationError("FORBIDDEN", "Your role cannot access this resource.");
    }

    return {
        id: user.id,
        email: user.email,
        name: user.full_name,
        role: user.role,
        status: user.status,
    };
};
