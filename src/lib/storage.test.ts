import { describe, expect, it, vi } from "vitest";
import { createStorage, isValidObjectKey, newObjectKey, type StorageBucket } from "./storage";

function fakeBucket(overrides: Partial<StorageBucket> = {}) {
  const bucket = {
    upload: vi.fn(async (path: string) => ({ data: { path }, error: null })),
    createSignedUrl: vi.fn(async (path: string) => ({ data: { signedUrl: `https://example.test/sign/${path}?token=t` }, error: null })),
    remove: vi.fn(async () => ({ data: [], error: null })),
    ...overrides,
  };
  return bucket satisfies StorageBucket;
}
const bytes = new Uint8Array([1, 2, 3]);

describe("newObjectKey", () => {
  it("uses the folder, a random id and the extension for the type", () => {
    const key = newObjectKey("food", "image/webp");
    expect(isValidObjectKey(key)).toBe(true);
    expect(key.startsWith("food/")).toBe(true);
    expect(key.endsWith(".webp")).toBe(true);
  });
  it("never repeats", () => {
    expect(newObjectKey("proofs", "image/png")).not.toBe(newObjectKey("proofs", "image/png"));
  });
  it("refuses an unsupported content type", () => {
    expect(() => newObjectKey("food", "application/pdf" as never)).toThrow();
  });
});

describe("isValidObjectKey", () => {
  it("rejects path tricks and unknown folders", () => {
    expect(isValidObjectKey("../secret.png")).toBe(false);
    expect(isValidObjectKey("/food/123.png")).toBe(false);
    expect(isValidObjectKey("other/6f1c7a52-3c2e-4f0e-9a52-0c9b7d3a1e11.png")).toBe(false);
    expect(isValidObjectKey("food/6f1c7a52-3c2e-4f0e-9a52-0c9b7d3a1e11.exe")).toBe(false);
    expect(isValidObjectKey("food/6f1c7a52-3c2e-4f0e-9a52-0c9b7d3a1e11.png")).toBe(true);
  });
});

describe("uploadImage", () => {
  it("uploads under a random key with the content type and never overwrites", async () => {
    const bucket = fakeBucket();
    const { key } = await createStorage(bucket).uploadImage({ folder: "proofs", contentType: "image/jpeg", data: bytes });
    expect(isValidObjectKey(key)).toBe(true);
    expect(bucket.upload).toHaveBeenCalledWith(key, bytes, { contentType: "image/jpeg", upsert: false });
  });
  it("refuses an empty file without calling storage", async () => {
    const bucket = fakeBucket();
    await expect(createStorage(bucket).uploadImage({ folder: "food", contentType: "image/png", data: new Uint8Array() })).rejects.toThrow();
    expect(bucket.upload).not.toHaveBeenCalled();
  });
  it("throws when storage reports an error", async () => {
    const bucket = fakeBucket({ upload: vi.fn(async () => ({ data: null, error: { message: "boom" } })) });
    await expect(createStorage(bucket).uploadImage({ folder: "food", contentType: "image/png", data: bytes })).rejects.toThrow("boom");
  });
});

describe("getSignedUrl", () => {
  const key = "pickup/6f1c7a52-3c2e-4f0e-9a52-0c9b7d3a1e11.jpg";
  it("returns a signed URL with the default lifetime", async () => {
    const bucket = fakeBucket();
    const url = await createStorage(bucket).getSignedUrl(key);
    expect(url).toContain(key);
    expect(bucket.createSignedUrl).toHaveBeenCalledWith(key, 300);
  });
  it("rejects an invalid key or lifetime without calling storage", async () => {
    const bucket = fakeBucket();
    const storage = createStorage(bucket);
    await expect(storage.getSignedUrl("../x.png")).rejects.toThrow();
    await expect(storage.getSignedUrl(key, 0)).rejects.toThrow();
    await expect(storage.getSignedUrl(key, 3601)).rejects.toThrow();
    expect(bucket.createSignedUrl).not.toHaveBeenCalled();
  });
  it("throws when storage reports an error", async () => {
    const bucket = fakeBucket({ createSignedUrl: vi.fn(async () => ({ data: null, error: { message: "nope" } })) });
    await expect(createStorage(bucket).getSignedUrl(key)).rejects.toThrow("nope");
  });
});

describe("removeObject", () => {
  it("removes a valid key and refuses an invalid one", async () => {
    const bucket = fakeBucket();
    const storage = createStorage(bucket);
    await storage.removeObject("food/6f1c7a52-3c2e-4f0e-9a52-0c9b7d3a1e11.png");
    expect(bucket.remove).toHaveBeenCalledTimes(1);
    await expect(storage.removeObject("bad")).rejects.toThrow();
  });
});