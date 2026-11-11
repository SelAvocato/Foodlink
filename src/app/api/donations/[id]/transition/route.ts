import { NextResponse } from "next/server";
import { z } from "zod";
import { DonationStatus } from "@/contracts/enums";
import {
    DonationTransitionError,
    prismaTransitionStore,
    transitionDonation,
} from "@/server/donations/transition-donation";
import { AuthorizationError, requireRole } from "@/server/auth/require-role";
import { authErrorResponse, errorResponse } from "@/server/http/errors";
import { parseJsonBody } from "@/server/http/parse-json";
import { transitionErrorResponse } from "@/server/donations/transition-error-response";
import { safeErrorSummary } from "@/lib/safe-error";

export const runtime = "nodejs";

const transitionBodySchema = z.strictObject({
    to: z.enum(Object.values(DonationStatus) as [string, ...string[]]),
    eventNote: z.string().trim().max(500).optional(),
    reason: z.string().trim().max(500).optional(),
    volunteerId: z.uuid().optional(),
});

export async function POST(
    request: Request,
    context: { params: Promise<{ id: string }> },
) {
    let actor: Awaited<ReturnType<typeof requireRole>>;
    try {
        actor = await requireRole(["ADMIN"]);
    } catch (error) {
        if (error instanceof AuthorizationError) {
            return authErrorResponse(error);
        }
        console.error("Donation transition authorization failed", { ...safeErrorSummary(error) });
        return errorResponse("INTERNAL_ERROR", "Authorization could not be verified.", 500);
    }

    const { id } = await context.params;
    if (!z.uuid().safeParse(id).success) {
        return errorResponse("INVALID_REQUEST", "The donation id is invalid.", 400);
    }

    const parsed = await parseJsonBody(request, transitionBodySchema, "The transition request is invalid.");
    if (!parsed.ok) {
        return parsed.response;
    }

    try {
        const { to, ...payload } = parsed.data;
        const result = await transitionDonation(
            { store: prismaTransitionStore },
            id,
            to as typeof DonationStatus[keyof typeof DonationStatus],
            actor,
            payload,
        );
        return NextResponse.json(result, { status: 200 });
    } catch (error) {
        if (error instanceof AuthorizationError) {
            return authErrorResponse(error);
        }
        if (error instanceof DonationTransitionError) {
            return transitionErrorResponse(error);
        }
        console.error("Donation transition failed", { ...safeErrorSummary(error) });
        return errorResponse("INTERNAL_ERROR", "The donation transition could not be completed.", 500);
    }
}
