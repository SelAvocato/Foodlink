import { z } from "zod";
import { ScreeningVerdict } from "./enums";

/**
 * What a screening provider may return. Provider output is untrusted, so the
 * service parses whatever comes back with this schema and treats anything else
 * as a malformed reply.
 */
export const providerResultSchema = z.strictObject({
  verdict: z.enum(ScreeningVerdict),
  confidence: z.number().min(0).max(1),
  signs: z.array(z.string()).max(20),
});
export type ProviderResult = z.infer<typeof providerResultSchema>;
