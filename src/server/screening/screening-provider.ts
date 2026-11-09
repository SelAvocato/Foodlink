import type { AllowedImageType } from "@/contracts/image";

export type ScreeningProviderInput = {
  /** A short-lived signed URL; never log it. */
  imageUrl: string;
  mimeType: AllowedImageType;
};

/**
 * A visual screening provider. The reply is untrusted on purpose: validate it
 * with providerResultSchema before using anything in it.
 */
export type ScreeningProvider = {
  /** Saved as food_screenings.provider (varchar 80). */
  name: string;
  /** Saved as food_screenings.model_version (varchar 120); null when unknown. */
  modelVersion: string | null;
  screen(input: ScreeningProviderInput): Promise<unknown>;
};
