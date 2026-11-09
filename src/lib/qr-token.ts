import { randomBytes as nodeRandomBytes } from "node:crypto";

/** The bytes behind a QR token: 32 random values, base64url without padding. */
const QR_TOKEN_BYTES = 32;

/**
 * The QR label token stored in donations.qr_token (32 random bytes, base64url,
 * 43 characters, matches donations_qr_token_format). The random source is a
 * parameter so tests can inject bytes; production uses node:crypto.
 */
export function newQrToken(randomBytes: (size: number) => Buffer = nodeRandomBytes): string {
  return randomBytes(QR_TOKEN_BYTES).toString("base64url");
}
