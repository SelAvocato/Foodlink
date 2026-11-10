import "server-only";

import { timingSafeEqual } from "node:crypto";
import { getEnv } from "@/lib/env.server";

export function isCronAuthorized(request: Request): boolean {
  const expected = getEnv().CRON_SECRET;
  const header = request.headers.get("authorization") ?? "";
  const match = /^Bearer\s+(.+)$/.exec(header.trim());
  if (!match) return false;

  const provided = Buffer.from(match[1], "utf8");
  const expectedBuffer = Buffer.from(expected, "utf8");
  if (provided.length !== expectedBuffer.length) return false;
  return timingSafeEqual(provided, expectedBuffer);
}
