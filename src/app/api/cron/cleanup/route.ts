import { NextResponse } from "next/server";
import { errorResponse } from "@/server/http/errors";
import { isCronAuthorized } from "@/server/cron/cron-auth";
import { runCleanup } from "@/server/cleanup/run-cleanup";
import { prismaCleanupStore } from "@/server/cleanup/prisma-cleanup-store";

export const runtime = "nodejs";

export async function POST(request: Request) {
  if (!isCronAuthorized(request)) {
    return errorResponse("UNAUTHENTICATED", "The cron secret is missing or invalid.", 401);
  }

  try {
    const result = await runCleanup({ store: prismaCleanupStore });
    return NextResponse.json(result, { status: 200 });
  } catch (error) {
    console.error("Cleanup cron failed", { error });
    return errorResponse("INTERNAL_ERROR", "The cleanup run could not be completed.", 500);
  }
}
