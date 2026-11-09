import { z } from "zod";
import { adminDonationAction } from "@/server/admin/admin-donation-action";

export const runtime = "nodejs";

const cancelBodySchema = z.strictObject({
  reason: z.string().trim().min(1, "A reason is required.").max(500, "Use at most 500 characters."),
});

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  return adminDonationAction(request, context, {
    to: "CANCELLED",
    schema: cancelBodySchema,
    invalidMessage: "The cancel request is invalid.",
    internalMessage: "The donation could not be cancelled.",
    logLabel: "Admin cancel",
    buildPayload: (data) => ({ reason: data.reason }),
  });
}
