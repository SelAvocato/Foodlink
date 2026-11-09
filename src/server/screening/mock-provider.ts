import { ScreeningVerdict } from "@/contracts/enums";
import type { ScreeningProvider } from "./screening-provider";

/**
 * The placeholder provider used until a real AI vision provider is chosen after
 * the demo. It always passes and touches neither the network nor storage.
 */
export function createMockProvider(): ScreeningProvider {
  return {
    name: "mock",
    modelVersion: "v0",
    async screen() {
      return { verdict: ScreeningVerdict.PASS, confidence: 0.99, signs: [] };
    },
  };
}
