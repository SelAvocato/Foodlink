import { z } from "zod";
import { QR_TOKEN_PATTERN } from "@/contracts/volunteer-pickup-scan";

/** The schema has no display-code column: the code is the first 8 id characters. */
export function donationShortCode(donationId: string): string {
  return donationId.slice(0, 8).toUpperCase();
}

/** The code as the label shows it, e.g. "#9FC03951". */
export function labelCode(donationId: string): string {
  return `#${donationShortCode(donationId)}`;
}

/** The saved image carries the short code only, never the token or the full id. */
export function imageFileName(donationId: string): string {
  return `foodlink-${donationShortCode(donationId)}.png`;
}

/** What the QR encodes: a scan URL whose fragment is the token (never sent to a server). */
export function qrPayload(origin: string, token: string): string {
  return `${origin.replace(/\/+$/, "")}/volunteer/scan#${token}`;
}

export const QR_LOAD_ERROR = "We could not load your QR label. Your donation is still posted.";

const qrSchema = z.looseObject({
  donationId: z.string().min(1),
  qrToken: z.string().regex(QR_TOKEN_PATTERN),
});

/** The token from the 200 body, or null when it is not the expected response. */
export function parseQrResponse(body: unknown, donationId: string): string | null {
  const parsed = qrSchema.safeParse(body);
  if (!parsed.success || parsed.data.donationId !== donationId) return null;
  return parsed.data.qrToken;
}

/** "24 portions"; one portion is singular. */
export function portionsText(portions: number): string {
  return `${portions} ${portions === 1 ? "portion" : "portions"}`;
}

/** The label's pickup line: the first pickup line is the window. Empty when there is none. */
export function pickupText(lines: string[]): string {
  return lines.length === 0 ? "" : `Pickup: ${lines[0]}`;
}
