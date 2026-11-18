import { describe, expect, it } from "vitest";
import { MAX_IMAGE_BYTES } from "./image";
import { MAX_PICKUP_PHOTO_BYTES, PICKUP_PHOTO_MESSAGE } from "./volunteer-pickup-photo";

describe("pickup photo rules", () => {
  it("caps the pickup photo at 4 MB, under the Vercel body limit", () => {
    expect(MAX_PICKUP_PHOTO_BYTES).toBe(4 * 1024 * 1024);
    expect(MAX_PICKUP_PHOTO_BYTES).toBeLessThan(MAX_IMAGE_BYTES);
    expect(MAX_PICKUP_PHOTO_BYTES).toBeLessThan(4.5 * 1024 * 1024);
  });

  it("names the accepted types and the size in the message", () => {
    expect(PICKUP_PHOTO_MESSAGE).toContain("JPEG");
    expect(PICKUP_PHOTO_MESSAGE).toContain("PNG");
    expect(PICKUP_PHOTO_MESSAGE).toContain("WebP");
    expect(PICKUP_PHOTO_MESSAGE).toContain("4 MB");
  });
});
