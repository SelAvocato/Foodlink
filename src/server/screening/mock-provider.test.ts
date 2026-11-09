import { describe, expect, it, vi } from "vitest";
import { ScreeningVerdict } from "@/contracts/enums";
import { providerResultSchema } from "@/contracts/food-screening";
import { createMockProvider } from "./mock-provider";

const INPUT = {
  imageUrl: "https://storage.example.test/object/sign?token=fake-token",
  mimeType: "image/jpeg" as const,
};

describe("createMockProvider", () => {
  it("identifies itself as mock v0, within the database limits", () => {
    const provider = createMockProvider();

    expect(provider.name).toBe("mock");
    expect(provider.name.length).toBeLessThanOrEqual(80);
    expect(provider.modelVersion).toBe("v0");
    expect(provider.modelVersion?.length).toBeLessThanOrEqual(120);
  });

  it("always answers PASS with high confidence and no signs", async () => {
    const provider = createMockProvider();

    const first = await provider.screen(INPUT);
    const second = await provider.screen(INPUT);

    expect(first).toEqual({ verdict: ScreeningVerdict.PASS, confidence: 0.99, signs: [] });
    expect(second).toEqual(first);
    expect(providerResultSchema.safeParse(first).success).toBe(true);
  });

  it("makes no network call", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");

    try {
      await createMockProvider().screen(INPUT);

      expect(fetchSpy).not.toHaveBeenCalled();
    } finally {
      fetchSpy.mockRestore();
    }
  });
});
