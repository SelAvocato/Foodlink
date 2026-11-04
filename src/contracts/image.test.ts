import { describe, expect, it } from "vitest";
import { MAX_IMAGE_BYTES, validateImage } from "./image";

const jpeg = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);
const png = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
const webp = Uint8Array.from([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50]);
const wav = Uint8Array.from([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x41, 0x56, 0x45]);
const gif = new TextEncoder().encode("GIF89a......");
const pdf = new TextEncoder().encode("%PDF-1.7 ......");

function jpegOfSize(size: number): Uint8Array {
  const bytes = new Uint8Array(size);
  bytes.set(jpeg.subarray(0, Math.min(size, jpeg.length)));
  return bytes;
}

describe("validateImage", () => {
  it("accepts a JPEG", () => {
    expect(validateImage(jpeg)).toEqual({ ok: true, mime: "image/jpeg", ext: "jpg", size: jpeg.length });
  });
  it("accepts a PNG", () => {
    expect(validateImage(png)).toMatchObject({ ok: true, mime: "image/png", ext: "png" });
  });
  it("accepts a WebP", () => {
    expect(validateImage(webp)).toMatchObject({ ok: true, mime: "image/webp", ext: "webp" });
  });
  it("rejects a PDF", () => {
    expect(validateImage(pdf)).toEqual({ ok: false, reason: "UNSUPPORTED_TYPE" });
  });
  it("rejects a GIF", () => {
    expect(validateImage(gif)).toEqual({ ok: false, reason: "UNSUPPORTED_TYPE" });
  });
  it("rejects a RIFF file that is not WebP", () => {
    expect(validateImage(wav)).toEqual({ ok: false, reason: "UNSUPPORTED_TYPE" });
  });
  it("rejects a file shorter than any signature", () => {
    expect(validateImage(Uint8Array.from([0xff, 0xd8]))).toEqual({ ok: false, reason: "UNSUPPORTED_TYPE" });
  });
  it("rejects an empty file", () => {
    expect(validateImage(new Uint8Array(0))).toEqual({ ok: false, reason: "EMPTY" });
  });
  it("accepts a file of exactly 5 MB", () => {
    expect(validateImage(jpegOfSize(MAX_IMAGE_BYTES))).toMatchObject({ ok: true });
  });
  it("rejects a file one byte over 5 MB", () => {
    expect(validateImage(jpegOfSize(MAX_IMAGE_BYTES + 1))).toEqual({ ok: false, reason: "TOO_LARGE" });
  });
});