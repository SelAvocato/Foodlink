import { NextResponse } from "next/server";
import { z } from "zod";
import { DonationStatus } from "@/contracts/enums";
import {
    DonationTransitionError,
    prismaTransitionStore,
    transitionDonation,
} from "@/server/donations/transition-donation";
import { AuthorizationError, requireRole } from "@/server/auth/require-role";

export const runtime = "nodejs";

const transitionBodySchema = z.strictObject({
    to: z.enum(Object.values(DonationStatus) as [string, ...string[]]),
    eventNote: z.string().trim().max(500).optional(),
    reason: z.string().trim().max(500).optional(),
    volunteerId: z.uuid().optional(),
});

function errorResponse(error: string, message: string, status: number, details?: unknown) {
    return NextResponse.json({ error, message, ...(details === undefined ? {} : { details }) }, { status });
}

export async function POST(
    request: Request,
    context: { params: Promise<{ id: string }> },
) {
    let actor: Awaited<ReturnType<typeof requireRole>>;
    try {
        actor = await requireRole(["ADMIN"]);
    } catch (error) {
        if (error instanceof AuthorizationError) {
            return errorResponse(error.code, error.message, error.code === "UNAUTHENTICATED" ? 401 : 403);
        }
        console.error("Donation transition authorization failed", { error });
        return errorResponse("INTERNAL_ERROR", "Authorization could not be verified.", 500);
    }

    const { id } = await context.params;
    if (!z.uuid().safeParse(id).success) {
        return errorResponse("INVALID_REQUEST", "The donation id is invalid.", 400);
    }

    let body: unknown;
    try {
        body = await request.json();
    } catch {
        return errorResponse("INVALID_REQUEST", "Send a valid JSON request body.", 400);
    }

    const parsed = transitionBodySchema.safeParse(body);
    if (!parsed.success) {
        return errorResponse(
            "INVALID_REQUEST",
            "The transition request is invalid.",
            400,
            z.flattenError(parsed.error),
        );
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
            return errorResponse(error.code, error.message, error.code === "UNAUTHENTICATED" ? 401 : 403);
        }
        if (error instanceof DonationTransitionError) {
            const status =
                error.code === "NOT_FOUND" ? 404 :
                error.code === "FORBIDDEN_ACTOR" ? 403 :
                error.code === "INVALID_TRANSITION" ? 409 :
                400;
            return errorResponse(error.code, error.message, status);
        }
        console.error("Donation transition failed", { donationId: id, error });
        return errorResponse("INTERNAL_ERROR", "The donation transition could not be completed.", 500);
    }
}
