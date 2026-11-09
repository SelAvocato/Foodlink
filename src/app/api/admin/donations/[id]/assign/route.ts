import { z } from "zod";
import { adminDonationAction } from "@/server/admin/admin-donation-action";

export const runtime = "nodejs";

const assignBodySchema = z.strictObject({
  volunteerId: z.uuid("A volunteer id is required."),
});

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  return adminDonationAction(request, context, {
    to: "ASSIGNED",
    schema: assignBodySchema,
    invalidMessage: "The assign request is invalid.",
    internalMessage: "The volunteer could not be assigned.",
    logLabel: "Admin assign",
    buildPayload: (data) => ({ volunteerId: data.volunteerId }),
  });
}
