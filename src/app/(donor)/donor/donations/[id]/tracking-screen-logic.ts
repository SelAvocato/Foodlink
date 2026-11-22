import type { TrackingReport } from "./tracking-logic";

/** The one refusal message for a cancel the service would not accept. */
export const NOT_CANCELLABLE_MESSAGE = "This donation can no longer be cancelled.";
/** Every other cancel failure, timeout included; the server's own text is never shown. */
export const CANCEL_FAILURE_MESSAGE = "We could not cancel this donation. Please try again.";

export type LoadDecision =
  | { kind: "ready"; report: TrackingReport }
  | { kind: "not-found" }
  | { kind: "error" };

/**
 * What one load answer means. 404 (unknown or another donor's donation) and 400
 * (malformed id) are "not found"; a 2xx body with a report is ready; anything
 * else fails — other statuses, a missing status from a timeout, a null parse.
 */
export function classifyLoad(status: number | null, report: TrackingReport | null): LoadDecision {
  if (status === 404 || status === 400) return { kind: "not-found" };
  if (status !== null && status >= 200 && status < 300 && report !== null) {
    return { kind: "ready", report };
  }
  return { kind: "error" };
}

export type CancelOutcome =
  | { kind: "ok" }
  | { kind: "refused"; message: string }
  | { kind: "error"; message: string };

/** The `error` code of the `{ error, message, details? }` body, or null. */
function errorCode(body: unknown): string | null {
  if (typeof body !== "object" || body === null) return null;
  if (!("error" in body)) return null;
  return typeof body.error === "string" ? body.error : null;
}

/**
 * The cancel dialog outcome: ok closes it; refused (409 NOT_CANCELLABLE) keeps it
 * open with the written message while the report reloads behind it; every other
 * failure keeps it open with the generic message so the donor can retry.
 */
export function classifyCancel(status: number | null, body: unknown): CancelOutcome {
  if (status !== null && status >= 200 && status < 300) return { kind: "ok" };
  if (status === 409 && errorCode(body) === "NOT_CANCELLABLE") {
    return { kind: "refused", message: NOT_CANCELLABLE_MESSAGE };
  }
  return { kind: "error", message: CANCEL_FAILURE_MESSAGE };
}

/** The pickup address as one line; null when it is missing or not text. */
export function pickupAddress(pickup: TrackingReport["pickup"]): string | null {
  const address = pickup === null ? undefined : pickup.address;
  if (typeof address !== "string") return null;
  const trimmed = address.trim();
  return trimmed === "" ? null : trimmed;
}

/** The QR label pickup lines: window first, address second (the review step's order). */
export function labelPickupLines(windowText: string | null, address: string | null): string[] {
  const lines: string[] = [];
  if (windowText !== null && windowText.trim() !== "") lines.push(windowText);
  if (address !== null && address.trim() !== "") lines.push(address);
  return lines;
}
