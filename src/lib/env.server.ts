import "server-only";
import { z } from "zod";
import { clientSchema, serverSchema } from "./env.schema";

const schema = serverSchema.extend(clientSchema.shape);

export type Env = z.infer<typeof schema>;

let cached: Env | undefined;

/** Validated environment. Throws one readable error listing every problem. */
export function getEnv(): Env {
  if (cached) return cached;
  const parsed = schema.safeParse(process.env);
  if (!parsed.success) {
    throw new Error(`Invalid environment variables:\n${z.prettifyError(parsed.error)}`);
  }
  cached = parsed.data;
  return cached;
}