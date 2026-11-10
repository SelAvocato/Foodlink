import { NextResponse } from "next/server";
import { errorResponse } from "@/server/http/errors";
import { isCronAuthorized } from "@/server/cron/cron-auth";
import { expireDueDonations } from "@/server/expiry/expire-due-donations";
import { prismaExpiryStore, prismaExpiryTransition } from "@/server/expiry/prisma-expiry-store";
import { safeErrorSummary } from "@/lib/safe-error";

export const runtime = "nodejs";

export async function POST(request: Request) {
  if (!isCronAuthorized(request)) {
    return errorResponse("UNAUTHENTICATED", "The cron secret is missing or invalid.", 401);
  }

  try {
    const result = await expireDueDonations({ store: prismaExpiryStore, transition: prismaExpiryTransition });
    if (result.failed > 0) {
      console.error("Expiry cron completed with failures", result);
      return NextResponse.json(result, { status: 500 });
    }
    return NextResponse.json(result, { status: 200 });
  } catch (error) {
    console.error("Expiry cron failed", { ...safeErrorSummary(error) });
    return errorResponse("INTERNAL_ERROR", "The expiry run could not be completed.", 500);
  }
}
