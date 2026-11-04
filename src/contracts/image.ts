// Upload rules shared by every file upload (proof documents, food, pickup,
// handover and distribution photos). They mirror the CHECK constraints in
// db/baseline/001_schema.sql: JPEG, PNG or WebP, 1 byte to 5,242,880 bytes.

export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

export const ALLOWED_IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;
export type AllowedImageType = (typeof ALLOWED_IMAGE_TYPES)[number];

const EXTENSIONS = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
} as const satisfies Record<AllowedImageType, string>;

export type ImageCheck =
  | { ok: true; mime: AllowedImageType; ext: (typeof EXTENSIONS)[AllowedImageType]; size: number }
  | { ok: false; reason: "EMPTY" | "TOO_LARGE" | "UNSUPPORTED_TYPE" };

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

function ascii(bytes: Uint8Array, start: number, end: number): string {
  return String.fromCharCode(...bytes.subarray(start, end));
}

/** Detects the real type from the first bytes. The browser's file name and Content-Type are never trusted. */
export function detectImageType(bytes: Uint8Array): AllowedImageType | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return "image/jpeg";
  }
  if (bytes.length >= 8 && PNG_SIGNATURE.every((b, i) => bytes[i] === b)) {
    return "image/png";
  }
  if (bytes.length >= 12 && ascii(bytes, 0, 4) === "RIFF" && ascii(bytes, 8, 12) === "WEBP") {
    return "image/webp";
  }
  return null;
}

export function validateImage(bytes: Uint8Array): ImageCheck {
  if (bytes.length === 0) return { ok: false, reason: "EMPTY" };
  if (bytes.length > MAX_IMAGE_BYTES) return { ok: false, reason: "TOO_LARGE" };
  const mime = detectImageType(bytes);
  if (!mime) return { ok: false, reason: "UNSUPPORTED_TYPE" };
  return { ok: true, mime, ext: EXTENSIONS[mime], size: bytes.length };
}