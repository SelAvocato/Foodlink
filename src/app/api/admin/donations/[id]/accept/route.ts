import { z } from "zod";
import { adminDonationAction } from "@/server/admin/admin-donation-action";

export const runtime = "nodejs";

const acceptBodySchema = z.strictObject({});

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  return adminDonationAction(request, context, {
    to: "ACCEPTED",
    schema: acceptBodySchema,
    invalidMessage: "The accept request is invalid.",
    internalMessage: "The donation could not be accepted.",
    logLabel: "Admin accept",
    buildPayload: () => ({}),
  });
}
