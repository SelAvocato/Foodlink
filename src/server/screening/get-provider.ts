import { createMockProvider } from "./mock-provider";
import type { ScreeningProvider } from "./screening-provider";

/**
 * The one place that chooses the screening provider. It is the always-PASS mock
 * until a real AI vision provider is picked after the demo; no env var, no
 * network call is involved.
 */
export function getScreeningProvider(): ScreeningProvider {
  return createMockProvider();
}
