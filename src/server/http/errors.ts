import { NextResponse } from "next/server";
import type { AuthorizationError } from "@/server/auth/require-role";

/** Same body shape as the donation transition route: { error, message, details? }. */
export function errorResponse(error: string, message: string, status: number, details?: unknown) {
  return NextResponse.json({ error, message, ...(details === undefined ? {} : { details }) }, { status });
}

/** 401 for UNAUTHENTICATED, 403 for INACTIVE_ACCOUNT and FORBIDDEN. */
export function authErrorResponse(error: AuthorizationError) {
  return errorResponse(error.code, error.message, error.code === "UNAUTHENTICATED" ? 401 : 403);
}
