import { NextResponse } from "next/server";
import { z } from "zod";
import { DonationStatus } from "@/contracts/enums";
import type { TransitionDonationPayload } from "@/contracts/donation";
import { AuthorizationError, requireRole } from "@/server/auth/require-role";
import {
  DonationTransitionError,
  prismaTransitionStore,
  transitionDonation,
} from "@/server/donations/transition-donation";
import { authErrorResponse, errorResponse } from "@/server/http/errors";
import { parseJsonBody } from "@/server/http/parse-json";

export type AdminDonationActionConfig<Body extends z.ZodType> = {
  to: DonationStatus;
  schema: Body;
  invalidMessage: string;
  internalMessage: string;
  logLabel: string;
  buildPayload: (data: z.output<Body>) => TransitionDonationPayload;
};

export async function adminDonationAction<Body extends z.ZodType>(
  request: Request,
  context: { params: Promise<{ id: string }> },
  config: AdminDonationActionConfig<Body>,
) {
  try {
    const actor = await requireRole(["ADMIN"]);

    const { id } = await context.params;
    if (!z.uuid().safeParse(id).success) {
      return errorResponse("INVALID_REQUEST", "The donation id is invalid.", 400);
    }

    const parsed = await parseJsonBody(request, config.schema, config.invalidMessage);
    if (!parsed.ok) {
      return parsed.response;
    }

    const result = await transitionDonation(
      { store: prismaTransitionStore },
      id,
      config.to,
      actor,
      config.buildPayload(parsed.data),
    );
    return NextResponse.json(result, { status: 200 });
  } catch (error) {
    if (error instanceof AuthorizationError) {
      return authErrorResponse(error);
    }
    if (error instanceof DonationTransitionError) {
      const status =
        error.code === "NOT_FOUND" ? 404 :
        error.code === "FORBIDDEN_ACTOR" ? 403 :
        error.code === "INVALID_TRANSITION" ? 409 :
        400;
      return errorResponse(error.code, error.message, status);
    }
    console.error(`${config.logLabel} failed`, { error });
    return errorResponse("INTERNAL_ERROR", config.internalMessage, 500);
  }
}
