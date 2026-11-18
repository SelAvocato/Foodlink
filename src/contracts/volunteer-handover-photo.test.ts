import { describe, expect, it } from "vitest";
import { MAX_IMAGE_BYTES } from "./image";
import {
  HANDOVER_PHOTO_MESSAGE,
  MAX_HANDOVER_PHOTO_BYTES,
} from "./volunteer-handover-photo";

describe("handover photo contract", () => {
  it("caps the upload at 4 MB, never above the shared image limit", () => {
    expect(MAX_HANDOVER_PHOTO_BYTES).toBe(Math.min(MAX_IMAGE_BYTES, 4 * 1024 * 1024));
    expect(MAX_HANDOVER_PHOTO_BYTES).toBeLessThanOrEqual(4 * 1024 * 1024);
  });

  it("names the types and the cap the way the picker hint does", () => {
    expect(HANDOVER_PHOTO_MESSAGE).toBe("Photo must be a JPEG, PNG, or WebP image up to 4 MB.");
  });
});
