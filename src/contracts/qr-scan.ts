import { z } from "zod";

/** Matches donations_qr_token_format: 32 random bytes as base64url (43 characters). */
export const QR_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

/**
 * The token travels in the body, not the URL, so it never lands in a proxy or
 * browser history. The donation id comes from the URL and the volunteer from the
 * session, so a leaked token cannot be used to probe another donation.
 */
export const qrTokenBodySchema = z.strictObject({
  token: z.string().trim().regex(QR_TOKEN_PATTERN, "The QR token is invalid."),
});
export type QrTokenBody = z.infer<typeof qrTokenBodySchema>;
