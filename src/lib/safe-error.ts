/**
 * What may reach the log about a caught error: a short identifier-like name and,
 * when it has one, a short identifier-like code. Never the message, the stack or
 * the cause, because a storage or Prisma message can carry the storage key or a
 * signed URL, and a third-party error can hide a message in its name or code.
 */
export type SafeErrorSummary = {
  errorName: string;
  errorCode?: string;
};

/** A log-safe token: 1–64 characters of letters, digits, underscore, dot or dash. */
const SAFE_TOKEN = /^[A-Za-z0-9_.-]{1,64}$/;

function safeToken(value: unknown): string | undefined {
  return typeof value === "string" && SAFE_TOKEN.test(value) ? value : undefined;
}

/** Only an own or inherited `code` that is a safe token counts; a numeric one (an HTTP status) is dropped. */
function stringCodeOf(value: object): string | undefined {
  if (!("code" in value)) return undefined;
  const { code } = value;
  return safeToken(code);
}

export function safeErrorSummary(error: unknown): SafeErrorSummary {
  const errorName = error instanceof Error ? (safeToken(error.name) ?? "UnknownError") : "UnknownError";
  if (typeof error !== "object" || error === null) return { errorName };
  const errorCode = stringCodeOf(error);
  return errorCode === undefined ? { errorName } : { errorName, errorCode };
}
