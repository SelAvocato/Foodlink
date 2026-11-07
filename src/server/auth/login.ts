import "server-only";

import { createHash } from "node:crypto";
import { verify } from "@node-rs/argon2";
import { z } from "zod";
import { getEnv } from "@/lib/env.server";
import { prisma } from "@/server/db";

const loginSchema = z.object({
    email: z.string().trim().toLowerCase().email().max(254),
    password: z.string().min(1).max(256),
});

export const invalidLoginMessage = "Invalid username or password";

type LoginFailureCategory =
    | "invalid_input"
    | "user_not_found"
    | "missing_credentials"
    | "pending_account"
    | "rejected_account"
    | "suspended_account"
    | "invalid_password"
    | "account_locked"
    | "database_error";

function hashIp(ip: string | undefined) {
    if (!ip) return "unknown";
    return createHash("sha256")
        .update(`${getEnv().AUTH_SECRET}:${ip}`)
        .digest("hex")
        .slice(0, 16);
}

async function writeAuditLog(
    category: LoginFailureCategory,
    ip: string | undefined,
    userId?: string,
) {
    await prisma.audit_logs.create({
        data: {
            actor_user_id: userId,
            action: "AUTH_LOGIN_FAILURE",
            target_type: "AUTH_LOGIN",
            target_id: userId,
            details: {
                category,
                ip_hash: hashIp(ip),
            },
        },
    });
}

function clientIp(headers?: Headers) {
    return headers?.get("x-forwarded-for")?.split(",")[0]?.trim()
        ?? headers?.get("x-real-ip")
        ?? undefined;
}

function inactiveAccountMessage(status: "PENDING" | "REJECTED" | "SUSPENDED") {
    return `${status[0]}${status.slice(1).toLowerCase()} account`;
}

export class LoginError extends Error {
    constructor(
        public readonly category: LoginFailureCategory,
        message = invalidLoginMessage,
    ) {
        super(message);
        this.name = "LoginError";
    }
}

function lockoutDurationMinutes(failedAttempt: number) {
    if (failedAttempt >= 7) return 60;
    if (failedAttempt === 6) return 30;
    return 15;
}

export type AuthenticatedUser = {
    id: string;
    email: string;
    name: string;
    role: "DONOR" | "VOLUNTEER" | "ADMIN";
    status: "ACTIVE";
};

export async function authenticateLogin(
    input: unknown,
    headers?: Headers,
): Promise<AuthenticatedUser | null> {
    const parsed = loginSchema.safeParse(input);
    if (!parsed.success) {
        throw new LoginError("invalid_input");
    }

    const { email, password } = parsed.data;

    try {
        const user = await prisma.users.findFirst({
            where: { email, deleted_at: null },
            select: {
                id: true,
                email: true,
                full_name: true,
                role: true,
                status: true,
                user_credentials: {
                    select: {
                        password_hash: true,
                        failed_login_count: true,
                        locked_until: true,
                    },
                },
            },
        });

        if (!user?.user_credentials) {
            await writeAuditLog("user_not_found", clientIp(headers));
            throw new LoginError("user_not_found");
        }

        if (user.user_credentials.locked_until && user.user_credentials.locked_until > new Date()) {
            await writeAuditLog("account_locked", clientIp(headers), user.id);
            throw new LoginError("account_locked");
        }

        if (user.status !== "ACTIVE") {
            const category = `${user.status.toLowerCase()}_account` as
                | "pending_account"
                | "rejected_account"
                | "suspended_account";
            await writeAuditLog(category, clientIp(headers), user.id);
            throw new LoginError(category, inactiveAccountMessage(user.status));
        }

        const validPassword = await verify(user.user_credentials.password_hash, password);
        if (!validPassword) {
            const failedAttempt = user.user_credentials.failed_login_count + 1;
            const lockoutMinutes = failedAttempt >= 5
                ? lockoutDurationMinutes(failedAttempt)
                : 0;
            const updated = await prisma.user_credentials.updateMany({
                where: {
                    user_id: user.id,
                    failed_login_count: user.user_credentials.failed_login_count,
                },
                data: {
                    failed_login_count: { increment: 1 },
                    locked_until: lockoutMinutes
                        ? new Date(Date.now() + lockoutMinutes * 60_000)
                        : null,
                },
            });

            if (updated.count !== 1) {
                throw new LoginError("database_error");
            }

            await writeAuditLog("invalid_password", clientIp(headers), user.id);
            throw new LoginError("invalid_password");
        }

        await prisma.$transaction([
            prisma.user_credentials.update({
                where: { user_id: user.id },
                data: {
                    last_login_at: new Date(),
                    failed_login_count: 0,
                    locked_until: null,
                },
            }),
            prisma.audit_logs.create({
                data: {
                    actor_user_id: user.id,
                    action: "AUTH_LOGIN_SUCCESS",
                    target_type: "AUTH_LOGIN",
                    target_id: user.id,
                    details: { ip_hash: hashIp(clientIp(headers)) },
                },
            })
        ]);

        return {
            id: user.id,
            email: user.email,
            name: user.full_name,
            role: user.role,
            status: "ACTIVE",
        };
    } catch (error) {
        if (error instanceof LoginError) throw error;
        console.error("Authentication database failure", {
            error,
            category: "database_error",
        });
        await writeAuditLog("database_error", clientIp(headers));
        throw new LoginError("database_error");
    }
}
