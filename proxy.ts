import { getToken } from "next-auth/jwt";
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { getEnv } from "@/lib/env.server";

const protectedPaths: ReadonlyArray<{ prefix: string; roles: readonly string[] }> = [
    { prefix: "/admin", roles: ["ADMIN"] },
    { prefix: "/api/admin", roles: ["ADMIN"] },
    { prefix: "/volunteer", roles: ["VOLUNTEER"] },
    { prefix: "/api/volunteer", roles: ["VOLUNTEER"] },
];

export async function proxy(request: NextRequest) {
    const rule = protectedPaths.find(({ prefix }) =>
        request.nextUrl.pathname === prefix || request.nextUrl.pathname.startsWith(`${prefix}/`),
    );
    if (!rule) return NextResponse.next();

    const token = await getToken({ req: request, secret: getEnv().AUTH_SECRET });
    if (!token?.id) {
        return NextResponse.redirect(new URL("/login", request.url));
    }
    if (token.status !== "ACTIVE" || typeof token.role !== "string" || !rule.roles.includes(token.role)) {
        return NextResponse.redirect(new URL("/login?error=forbidden", request.url));
    }
    return NextResponse.next();
}

export const config = {
    matcher: ["/admin/:path*", "/api/admin/:path*", "/volunteer/:path*", "/api/volunteer/:path*"],
};
