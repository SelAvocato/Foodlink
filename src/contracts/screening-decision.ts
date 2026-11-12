import { z } from "zod";

/**
 * One Admin decision on a pending REVIEW screening. The screening id comes from
 * the URL and the reviewer from the verified session, never from the body.
 * REJECT needs a reason (an extension to the PDF); PASS must not carry one.
 */
export const screeningDecisionSchema = z
  .strictObject({
    decision: z.enum(["PASS", "REJECT"]),
    reason: z
      .string()
      .trim()
      .min(1, "Enter a reason")
      .max(500, "Use at most 500 characters")
      .optional(),
  })
  .refine((body) => body.decision !== "REJECT" || body.reason !== undefined, {
    message: "Enter a reason",
    path: ["reason"],
  })
  .refine((body) => body.decision === "REJECT" || body.reason === undefined, {
    message: "A reason is only sent with REJECT",
    path: ["reason"],
  });
export type ScreeningDecisionBody = z.infer<typeof screeningDecisionSchema>;
