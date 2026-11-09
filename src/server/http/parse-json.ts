import { NextResponse } from "next/server";
import { z } from "zod";
import { errorResponse } from "@/server/http/errors";

export type ParsedBody<S extends z.ZodType> =
  | { ok: true; data: z.output<S> }
  | { ok: false; response: NextResponse };

export async function parseJsonBody<S extends z.ZodType>(
  request: Request,
  schema: S,
  message = "The request is invalid.",
): Promise<ParsedBody<S>> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return { ok: false, response: errorResponse("INVALID_REQUEST", "Send a valid JSON request body.", 400) };
  }

  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return { ok: false, response: errorResponse("INVALID_REQUEST", message, 400, z.flattenError(parsed.error)) };
  }
  return { ok: true, data: parsed.data };
}
