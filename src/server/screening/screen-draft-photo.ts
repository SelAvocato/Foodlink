import { DonationStatus, ScreeningVerdict } from "@/contracts/enums";
import { providerResultSchema } from "@/contracts/food-screening";
import type { AllowedImageType } from "@/contracts/image";
import { safeErrorSummary } from "@/lib/safe-error";
import type { Storage } from "@/lib/storage";
import type { ScreeningProvider, ScreeningProviderInput } from "./screening-provider";

export type ScreeningDonation = {
  donorId: string;
  status: DonationStatus;
  deletedAt: Date | null;
};

/** The active FOOD_PHOTO row. The storage key stays inside this module. */
export type ActiveFoodPhoto = {
  imageId: string;
  storageKey: string;
  mimeType: AllowedImageType;
};

export type ScreeningInsert = {
  donationId: string;
  imageId: string;
  provider: string;
  modelVersion: string | null;
  verdict: ScreeningVerdict;
  confidence: number | null;
  signs: string[];
  notes: string | null;
};

export interface ScreeningStore {
  readDonation(id: string): Promise<ScreeningDonation | null>;
  /** The active FOOD_PHOTO row only; a retake soft-deletes the old one. */
  findActiveFoodPhoto(donationId: string): Promise<ActiveFoodPhoto | null>;
  /** A food_screenings row with verdict REVIEW and reviewed_at null. */
  hasPendingReview(donationId: string): Promise<boolean>;
  insertScreening(row: ScreeningInsert): Promise<{ id: string }>;
}

export type ScreeningStorage = Pick<Storage, "getSignedUrl">;

export type ScreeningTransitionInput = {
  donationId: string;
  to: "SCREENED" | "REJECTED";
  reason?: string;
  screeningId: string;
};

export type ScreeningTransitionResult =
  | { ok: true }
  | { ok: false; error: "NOT_FOUND" | "INVALID_TRANSITION" };

/** Injected so the service needs no server-only imports; Task 13 wires the real transition. */
export type ScreeningTransition = (input: ScreeningTransitionInput) => Promise<ScreeningTransitionResult>;

export type ScreenDraftPhotoDeps = {
  store: ScreeningStore;
  storage: ScreeningStorage;
  provider: ScreeningProvider;
  transition: ScreeningTransition;
  /** Defaults to DEFAULT_TIMEOUT_MS; tests pass a small value. */
  timeoutMs?: number;
};

export type ScreenDraftPhotoResult =
  | {
      ok: true;
      verdict: ScreeningVerdict;
      screeningId: string;
      donationStatus: "SCREENED" | "DRAFT";
    }
  | {
      ok: true;
      verdict: "FLAG";
      screeningId: string;
      donationStatus: "REJECTED";
      /** The exact reason string sent to the transition, returned for the donor. */
      reason: string;
    }
  | { ok: false; error: "NOT_FOUND" | "NOT_EDITABLE" | "REVIEW_PENDING" | "PHOTO_REQUIRED" | "PHOTO_CHANGED" };

const DEFAULT_TIMEOUT_MS = 10_000;
const SIGNED_URL_SECONDS = 60;

/** The PDF gives no confidence threshold; 0.7 is our choice. */
const MIN_CONFIDENCE = 0.7;

const TIMEOUT_NOTE = "Provider timed out.";
const FAILURE_NOTE = "Provider failed.";
const MALFORMED_NOTE = "Provider reply was malformed.";
const LOW_CONFIDENCE_NOTE = "Confidence below the review threshold.";

const MAX_SIGN_CHARACTERS = 80;
const CONTROL_CHARACTERS = /[\u0000-\u001F\u007F]/g;

/** Provider text is shown to people, so strip what could break markup and layout. */
function cleanSign(value: string): string {
  return value
    // A control character becomes a space so words on either side stay apart.
    .replace(CONTROL_CHARACTERS, " ")
    .replace(/[<>]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_SIGN_CHARACTERS)
    .trim();
}

function rejectionReason(signs: readonly string[]): string {
  const visible = signs.slice(0, 3);
  return visible.length === 0
    ? "Photo failed visual screening."
    : `Photo failed visual screening: ${visible.join(", ")}.`;
}

type ProviderAttempt =
  | { kind: "reply"; value: unknown }
  | { kind: "timeout" }
  | { kind: "error"; error: unknown };

async function callProvider(
  provider: ScreeningProvider,
  input: ScreeningProviderInput,
  timeoutMs: number,
): Promise<ProviderAttempt> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<ProviderAttempt>((resolve) => {
    timer = setTimeout(() => resolve({ kind: "timeout" }), timeoutMs);
  });
  // The async wrapper also catches a provider that throws before returning a promise.
  const call = (async (): Promise<ProviderAttempt> => {
    try {
      return { kind: "reply", value: await provider.screen(input) };
    } catch (error) {
      return { kind: "error", error };
    }
  })();

  try {
    return await Promise.race([call, timeout]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

type Evaluation = {
  verdict: ScreeningVerdict;
  confidence: number | null;
  signs: string[];
  notes: string | null;
};

function evaluateAttempt(attempt: ProviderAttempt): Evaluation {
  if (attempt.kind === "timeout") {
    return { verdict: ScreeningVerdict.REVIEW, confidence: null, signs: [], notes: TIMEOUT_NOTE };
  }
  if (attempt.kind === "error") {
    // The message can carry the signed URL or the storage key, so only the summary is logged.
    console.error("screenDraftPhoto: food screening provider failed", { ...safeErrorSummary(attempt.error) });
    return { verdict: ScreeningVerdict.REVIEW, confidence: null, signs: [], notes: FAILURE_NOTE };
  }

  const parsed = providerResultSchema.safeParse(attempt.value);
  if (!parsed.success) {
    return { verdict: ScreeningVerdict.REVIEW, confidence: null, signs: [], notes: MALFORMED_NOTE };
  }

  const result = parsed.data;
  const signs = result.signs.map(cleanSign).filter((sign) => sign.length > 0);
  if (result.confidence < MIN_CONFIDENCE) {
    return { verdict: ScreeningVerdict.REVIEW, confidence: result.confidence, signs, notes: LOW_CONFIDENCE_NOTE };
  }
  return { verdict: result.verdict, confidence: result.confidence, signs, notes: null };
}

/**
 * Screens the donor's food photo for a DRAFT donation. The screening row is
 * saved first, then PASS/FLAG ask the injected transition to move the donation;
 * donations.status and donation_exits are never written here.
 */
export async function screenDraftPhoto(
  deps: ScreenDraftPhotoDeps,
  args: { donorId: string; donationId: string },
): Promise<ScreenDraftPhotoResult> {
  const { donorId, donationId } = args;

  const donation = await deps.store.readDonation(donationId);
  if (!donation || donation.donorId !== donorId || donation.deletedAt !== null) {
    return { ok: false, error: "NOT_FOUND" };
  }
  if (donation.status !== DonationStatus.DRAFT) {
    return { ok: false, error: "NOT_EDITABLE" };
  }

  if (await deps.store.hasPendingReview(donationId)) {
    return { ok: false, error: "REVIEW_PENDING" };
  }

  const photo = await deps.store.findActiveFoodPhoto(donationId);
  if (!photo) {
    return { ok: false, error: "PHOTO_REQUIRED" };
  }

  // Only the short-lived URL reaches the provider; the key never leaves the server.
  const imageUrl = await deps.storage.getSignedUrl(photo.storageKey, SIGNED_URL_SECONDS);
  const attempt = await callProvider(
    deps.provider,
    { imageUrl, mimeType: photo.mimeType },
    deps.timeoutMs ?? DEFAULT_TIMEOUT_MS,
  );
  const evaluation = evaluateAttempt(attempt);

  // The provider call takes time: confirm the donation is still the same draft.
  const latest = await deps.store.readDonation(donationId);
  if (!latest || latest.donorId !== donorId || latest.deletedAt !== null) {
    return { ok: false, error: "NOT_FOUND" };
  }
  if (latest.status !== DonationStatus.DRAFT) {
    return { ok: false, error: "NOT_EDITABLE" };
  }

  // A retake during the call replaced the photo the provider looked at.
  const latestPhoto = await deps.store.findActiveFoodPhoto(donationId);
  if (!latestPhoto || latestPhoto.imageId !== photo.imageId) {
    return { ok: false, error: "PHOTO_CHANGED" };
  }

  const screening = await deps.store.insertScreening({
    donationId,
    imageId: photo.imageId,
    provider: deps.provider.name,
    modelVersion: deps.provider.modelVersion,
    verdict: evaluation.verdict,
    confidence: evaluation.confidence,
    signs: evaluation.signs,
    notes: evaluation.notes,
  });

  if (evaluation.verdict === ScreeningVerdict.REVIEW) {
    return { ok: true, verdict: evaluation.verdict, screeningId: screening.id, donationStatus: "DRAFT" };
  }

  if (evaluation.verdict === ScreeningVerdict.FLAG) {
    const reason = rejectionReason(evaluation.signs);
    // transitionDonation() opens its own transaction, so the row above stays even if this is refused.
    const outcome = await deps.transition({ donationId, to: "REJECTED", screeningId: screening.id, reason });
    if (!outcome.ok) {
      return { ok: false, error: outcome.error === "NOT_FOUND" ? "NOT_FOUND" : "NOT_EDITABLE" };
    }
    return { ok: true, verdict: evaluation.verdict, screeningId: screening.id, donationStatus: "REJECTED", reason };
  }

  const outcome = await deps.transition({ donationId, to: "SCREENED", screeningId: screening.id });
  if (!outcome.ok) {
    return { ok: false, error: outcome.error === "NOT_FOUND" ? "NOT_FOUND" : "NOT_EDITABLE" };
  }

  return { ok: true, verdict: evaluation.verdict, screeningId: screening.id, donationStatus: "SCREENED" };
}
