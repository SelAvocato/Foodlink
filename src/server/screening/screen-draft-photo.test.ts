import { beforeEach, describe, expect, it, vi } from "vitest";
import { DonationStatus, ScreeningVerdict } from "@/contracts/enums";
import type { AllowedImageType } from "@/contracts/image";
import {
  screenDraftPhoto,
  type ActiveFoodPhoto,
  type ScreenDraftPhotoDeps,
  type ScreeningDonation,
  type ScreeningInsert,
  type ScreeningStore,
  type ScreeningTransitionInput,
  type ScreeningTransitionResult,
  type ScreeningTx,
} from "./screen-draft-photo";
import type { ScreeningProvider } from "./screening-provider";

const DONATION_ID = "11111111-1111-4111-8111-111111111111";
const DONOR_ID = "donor-1";
const OTHER_DONOR_ID = "donor-2";
const IMAGE_ID = "22222222-2222-4222-8222-222222222222";
const NEW_IMAGE_ID = "33333333-3333-4333-8333-333333333333";
const STORAGE_KEY = "food/44444444-4444-4444-8444-444444444444.jpg";
const SIGNED_URL = "https://storage.example.test/object/sign?token=fake-token";

type PhotoRow = ActiveFoodPhoto & { donationId: string };
type ScreeningRow = ScreeningInsert & { id: string };

class FakeStore implements ScreeningStore {
  donations = new Map<string, ScreeningDonation>();
  photos: PhotoRow[] = [];
  screenings: ScreeningRow[] = [];
  reviewPending = false;
  insertError: Error | null = null;
  /** Shared order log: proves the provider runs outside and the transition after. */
  events: string[] = [];
  /** Fired when the locked transaction starts (after the provider call) to simulate an interleaving. */
  onTransaction: (() => void) | null = null;
  private seq = 0;

  seedDraft(overrides: Partial<ScreeningDonation> = {}): void {
    this.donations.set(DONATION_ID, {
      donorId: DONOR_ID,
      status: DonationStatus.DRAFT,
      deletedAt: null,
      ...overrides,
    });
  }

  seedPhoto(overrides: Partial<PhotoRow> = {}): void {
    this.photos = [
      {
        donationId: DONATION_ID,
        imageId: IMAGE_ID,
        storageKey: STORAGE_KEY,
        mimeType: "image/jpeg",
        ...overrides,
      },
    ];
  }

  async readDonation(id: string): Promise<ScreeningDonation | null> {
    return this.donations.get(id) ?? null;
  }

  async findActiveFoodPhoto(donationId: string): Promise<ActiveFoodPhoto | null> {
    const photo = this.photos.find((row) => row.donationId === donationId);
    return photo
      ? { imageId: photo.imageId, storageKey: photo.storageKey, mimeType: photo.mimeType }
      : null;
  }

  async hasPendingReview(donationId: string): Promise<boolean> {
    return (
      this.reviewPending ||
      this.screenings.some((row) => row.donationId === donationId && row.verdict === ScreeningVerdict.REVIEW)
    );
  }

  /** The tx methods read the same state; the fake has no real lock to take. */
  async transaction<T>(work: (tx: ScreeningTx) => Promise<T>): Promise<T> {
    this.events.push("tx:start");
    if (this.onTransaction) this.onTransaction();
    try {
      return await work({
        getDonationLocked: (id) => this.readDonation(id),
        findActiveFoodPhoto: (donationId) => this.findActiveFoodPhoto(donationId),
        hasPendingReview: (donationId) => this.hasPendingReview(donationId),
        insertScreening: (row) => this.insertScreening(row),
      });
    } finally {
      this.events.push("tx:end");
    }
  }

  async insertScreening(row: ScreeningInsert): Promise<{ id: string }> {
    if (this.insertError) throw this.insertError;
    this.seq += 1;
    const id = `00000000-0000-4000-8000-${String(this.seq).padStart(12, "0")}`;
    this.screenings.push({ ...row, id, signs: [...row.signs] });
    return { id };
  }
}

class FakeStorage {
  calls: { key: string; expiresInSeconds: number }[] = [];
  url = SIGNED_URL;

  async getSignedUrl(key: string, expiresInSeconds: number = 300): Promise<string> {
    this.calls.push({ key, expiresInSeconds });
    return this.url;
  }
}

class FakeProvider implements ScreeningProvider {
  name = "fake-provider";
  modelVersion: string | null = "v-test";
  calls: { imageUrl: string; mimeType: AllowedImageType }[] = [];
  events: string[] = [];
  reply: () => Promise<unknown> = async () => ({
    verdict: ScreeningVerdict.PASS,
    confidence: 0.99,
    signs: [],
  });

  async screen(input: { imageUrl: string; mimeType: AllowedImageType }): Promise<unknown> {
    this.calls.push(input);
    this.events.push("provider");
    return this.reply();
  }
}

class FakeTransition {
  calls: ScreeningTransitionInput[] = [];
  result: ScreeningTransitionResult = { ok: true };
  events: string[] = [];

  async run(input: ScreeningTransitionInput): Promise<ScreeningTransitionResult> {
    this.calls.push({ ...input });
    this.events.push("transition");
    return this.result;
  }
}

function makeDeps(overrides: { timeoutMs?: number } = {}) {
  const events: string[] = [];
  const store = new FakeStore();
  const storage = new FakeStorage();
  const provider = new FakeProvider();
  const transition = new FakeTransition();
  store.events = events;
  provider.events = events;
  transition.events = events;
  const deps: ScreenDraftPhotoDeps = {
    store,
    storage,
    provider,
    transition: (input) => transition.run(input),
    ...overrides,
  };

  store.seedDraft();
  store.seedPhoto();

  return { deps, store, storage, provider, transition, events };
}

function passResult(confidence = 0.99): unknown {
  return { verdict: ScreeningVerdict.PASS, confidence, signs: [] };
}

beforeEach(() => {
  vi.restoreAllMocks();
});

describe("screenDraftPhoto", () => {
  it("creates a 60-second signed URL and passes the URL and mime type to the provider", async () => {
    const { deps, storage, provider } = makeDeps();

    const result = await screenDraftPhoto(deps, { donorId: DONOR_ID, donationId: DONATION_ID });

    expect(result.ok).toBe(true);
    expect(storage.calls).toEqual([{ key: STORAGE_KEY, expiresInSeconds: 60 }]);
    expect(provider.calls).toEqual([{ imageUrl: SIGNED_URL, mimeType: "image/jpeg" }]);
    expect(JSON.stringify(result)).not.toContain(STORAGE_KEY);
    expect(JSON.stringify(result)).not.toContain(SIGNED_URL);
  });

  it("on PASS saves one row and transitions the draft to SCREENED with that screening id", async () => {
    const { deps, store, transition } = makeDeps();

    const result = await screenDraftPhoto(deps, { donorId: DONOR_ID, donationId: DONATION_ID });

    expect(result).toEqual({
      ok: true,
      verdict: ScreeningVerdict.PASS,
      screeningId: expect.any(String),
      donationStatus: "SCREENED",
    });
    expect(store.screenings).toHaveLength(1);
    expect(store.screenings[0]).toMatchObject({
      donationId: DONATION_ID,
      imageId: IMAGE_ID,
      provider: "fake-provider",
      modelVersion: "v-test",
      verdict: ScreeningVerdict.PASS,
      confidence: 0.99,
      signs: [],
      notes: null,
    });
    expect(transition.calls).toEqual([
      { donationId: DONATION_ID, to: "SCREENED", screeningId: store.screenings[0].id },
    ]);
    expect(transition.calls[0]).not.toHaveProperty("reason");
  });

  it("returns no reason on outcomes other than REJECTED", async () => {
    const { deps, provider } = makeDeps();

    const pass = await screenDraftPhoto(deps, { donorId: DONOR_ID, donationId: DONATION_ID });
    expect(pass.ok).toBe(true);
    expect(pass).not.toHaveProperty("reason");

    provider.reply = async () => ({ verdict: ScreeningVerdict.REVIEW, confidence: 0.9, signs: [] });
    const review = await screenDraftPhoto(deps, { donorId: DONOR_ID, donationId: DONATION_ID });
    expect(review.ok).toBe(true);
    expect(review).not.toHaveProperty("reason");
  });

  it("on FLAG stores the row and rejects the donation with the screening id and signs in the reason", async () => {
    const { deps, store, provider, transition } = makeDeps();
    provider.reply = async () => ({
      verdict: ScreeningVerdict.FLAG,
      confidence: 0.95,
      signs: ["mold", "pest droppings"],
    });

    const result = await screenDraftPhoto(deps, { donorId: DONOR_ID, donationId: DONATION_ID });

    expect(result).toEqual({
      ok: true,
      verdict: ScreeningVerdict.FLAG,
      screeningId: expect.any(String),
      donationStatus: "REJECTED",
      reason: "Photo failed visual screening: mold, pest droppings.",
    });
    expect(store.screenings).toHaveLength(1);
    expect(store.screenings[0]).toMatchObject({
      verdict: ScreeningVerdict.FLAG,
      confidence: 0.95,
      signs: ["mold", "pest droppings"],
      notes: null,
    });
    expect(transition.calls).toEqual([
      {
        donationId: DONATION_ID,
        to: "REJECTED",
        screeningId: store.screenings[0].id,
        reason: "Photo failed visual screening: mold, pest droppings.",
      },
    ]);
  });

  it("names only the first three signs in the rejection reason", async () => {
    const { deps, provider, transition } = makeDeps();
    provider.reply = async () => ({
      verdict: ScreeningVerdict.FLAG,
      confidence: 0.9,
      signs: ["mold", "discoloration", "bad smell", "pests", "damaged packaging"],
    });

    await screenDraftPhoto(deps, { donorId: DONOR_ID, donationId: DONATION_ID });

    expect(transition.calls[0].reason).toBe(
      "Photo failed visual screening: mold, discoloration, bad smell.",
    );
  });

  it("rejects with a reason without signs when FLAG reports none", async () => {
    const { deps, provider, transition } = makeDeps();
    provider.reply = async () => ({ verdict: ScreeningVerdict.FLAG, confidence: 0.9, signs: [] });

    const result = await screenDraftPhoto(deps, { donorId: DONOR_ID, donationId: DONATION_ID });

    expect(result).toMatchObject({
      ok: true,
      donationStatus: "REJECTED",
      reason: "Photo failed visual screening.",
    });
    expect(transition.calls[0].reason).toBe("Photo failed visual screening.");
  });

  it("on REVIEW saves the verdict and leaves the donation in DRAFT", async () => {
    const { deps, store, provider, transition } = makeDeps();
    provider.reply = async () => ({
      verdict: ScreeningVerdict.REVIEW,
      confidence: 0.9,
      signs: ["unclear packaging"],
    });

    const result = await screenDraftPhoto(deps, { donorId: DONOR_ID, donationId: DONATION_ID });

    expect(result).toEqual({
      ok: true,
      verdict: ScreeningVerdict.REVIEW,
      screeningId: expect.any(String),
      donationStatus: "DRAFT",
    });
    expect(store.screenings).toHaveLength(1);
    expect(store.screenings[0]).toMatchObject({
      verdict: ScreeningVerdict.REVIEW,
      confidence: 0.9,
      signs: ["unclear packaging"],
      notes: null,
    });
    expect(transition.calls).toEqual([]);
  });

  it("turns a provider error into REVIEW and never stores or logs provider text", async () => {
    const { deps, store, provider, transition } = makeDeps();
    const providerMessage = `provider leaked ${SIGNED_URL} and ${STORAGE_KEY}`;
    provider.reply = async () => {
      throw Object.assign(new Error(providerMessage), { code: "ETIMEDOUT" });
    };
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});

    try {
      const result = await screenDraftPhoto(deps, { donorId: DONOR_ID, donationId: DONATION_ID });

      expect(result).toMatchObject({ ok: true, verdict: ScreeningVerdict.REVIEW, donationStatus: "DRAFT" });
      expect(store.screenings).toHaveLength(1);
      expect(store.screenings[0]).toMatchObject({
        verdict: ScreeningVerdict.REVIEW,
        confidence: null,
        signs: [],
        notes: "Provider failed.",
      });
      expect(JSON.stringify(store.screenings)).not.toContain(providerMessage);
      expect(JSON.stringify(store.screenings)).not.toContain(SIGNED_URL);
      expect(transition.calls).toEqual([]);

      expect(consoleError).toHaveBeenCalledTimes(1);
      const [label, details] = consoleError.mock.calls[0];
      expect(label).toBe("screenDraftPhoto: food screening provider failed");
      expect(details).toEqual({ errorName: "Error", errorCode: "ETIMEDOUT" });

      const logged = JSON.stringify(consoleError.mock.calls);
      expect(logged).not.toContain(providerMessage);
      expect(logged).not.toContain(SIGNED_URL);
      expect(logged).not.toContain(STORAGE_KEY);
    } finally {
      consoleError.mockRestore();
    }
  });

  it("turns a provider that hangs past the timeout into REVIEW with the timeout note", async () => {
    const { deps, store, provider, transition } = makeDeps({ timeoutMs: 10 });
    provider.reply = () => new Promise<unknown>(() => {});

    const result = await screenDraftPhoto(deps, { donorId: DONOR_ID, donationId: DONATION_ID });

    expect(result).toMatchObject({ ok: true, verdict: ScreeningVerdict.REVIEW, donationStatus: "DRAFT" });
    expect(store.screenings).toHaveLength(1);
    expect(store.screenings[0]).toMatchObject({
      notes: "Provider timed out.",
      confidence: null,
      signs: [],
    });
    expect(transition.calls).toEqual([]);
  });

  it.each<[string, unknown]>([
    ["null", null],
    ["a string", "PASS"],
    ["an empty object", {}],
    ["an unknown verdict", { verdict: "MAYBE", confidence: 0.9, signs: [] }],
    ["confidence above 1", { verdict: "PASS", confidence: 1.2, signs: [] }],
    ["confidence below 0", { verdict: "PASS", confidence: -0.1, signs: [] }],
    ["signs that are not an array", { verdict: "PASS", confidence: 0.9, signs: "mold" }],
    ["a sign that is not a string", { verdict: "PASS", confidence: 0.9, signs: ["mold", 3] }],
    ["an extra field", { verdict: "PASS", confidence: 0.9, signs: [], notes: "extra" }],
    ["missing signs", { verdict: "PASS", confidence: 0.9 }],
  ])("turns a malformed reply (%s) into REVIEW with the malformed note", async (_label, reply) => {
    const { deps, store, provider, transition } = makeDeps();
    provider.reply = async () => reply;

    const result = await screenDraftPhoto(deps, { donorId: DONOR_ID, donationId: DONATION_ID });

    expect(result).toMatchObject({ ok: true, verdict: ScreeningVerdict.REVIEW, donationStatus: "DRAFT" });
    expect(store.screenings[0]).toMatchObject({
      verdict: ScreeningVerdict.REVIEW,
      confidence: null,
      signs: [],
      notes: "Provider reply was malformed.",
    });
    expect(transition.calls).toEqual([]);
  });

  it("turns confidence below the threshold into REVIEW but keeps the reported confidence and signs", async () => {
    const { deps, store, provider, transition } = makeDeps();
    provider.reply = async () => ({ verdict: ScreeningVerdict.PASS, confidence: 0.69, signs: ["mold"] });

    const result = await screenDraftPhoto(deps, { donorId: DONOR_ID, donationId: DONATION_ID });

    expect(result).toMatchObject({ ok: true, verdict: ScreeningVerdict.REVIEW, donationStatus: "DRAFT" });
    expect(store.screenings[0]).toMatchObject({
      verdict: ScreeningVerdict.REVIEW,
      confidence: 0.69,
      signs: ["mold"],
      notes: "Confidence below the review threshold.",
    });
    expect(transition.calls).toEqual([]);
  });

  it("keeps the provider verdict at exactly the 0.7 confidence threshold", async () => {
    const { deps, store, provider, transition } = makeDeps();
    provider.reply = async () => passResult(0.7);

    const result = await screenDraftPhoto(deps, { donorId: DONOR_ID, donationId: DONATION_ID });

    expect(result).toMatchObject({ ok: true, verdict: ScreeningVerdict.PASS, donationStatus: "SCREENED" });
    expect(store.screenings[0]).toMatchObject({ verdict: ScreeningVerdict.PASS, confidence: 0.7 });
    expect(transition.calls).toHaveLength(1);
  });

  it("turns FLAG with low confidence into REVIEW and does not reject the donation", async () => {
    const { deps, store, provider, transition } = makeDeps();
    provider.reply = async () => ({ verdict: ScreeningVerdict.FLAG, confidence: 0.5, signs: ["mold"] });

    const result = await screenDraftPhoto(deps, { donorId: DONOR_ID, donationId: DONATION_ID });

    expect(result).toMatchObject({ ok: true, verdict: ScreeningVerdict.REVIEW, donationStatus: "DRAFT" });
    expect(store.screenings[0]).toMatchObject({
      verdict: ScreeningVerdict.REVIEW,
      confidence: 0.5,
      notes: "Confidence below the review threshold.",
    });
    expect(transition.calls).toEqual([]);
  });

  it("cleans signs before storing them and before building the reason", async () => {
    const { deps, store, provider, transition } = makeDeps();
    const longSign = "a".repeat(120);
    provider.reply = async () => ({
      verdict: ScreeningVerdict.FLAG,
      confidence: 0.9,
      signs: ["<mold>", "bad\u0000sign", longSign, "", "   ", "  oily\tresidue  "],
    });

    await screenDraftPhoto(deps, { donorId: DONOR_ID, donationId: DONATION_ID });

    const cleaned = ["mold", "bad sign", "a".repeat(80), "oily residue"];
    expect(store.screenings[0].signs).toEqual(cleaned);
    expect(transition.calls[0].reason).toBe(
      `Photo failed visual screening: ${cleaned.slice(0, 3).join(", ")}.`,
    );
  });

  it.each<[string, ScreeningDonation | undefined]>([
    ["missing", undefined],
    [
      "deleted",
      { donorId: DONOR_ID, status: DonationStatus.DRAFT, deletedAt: new Date("2026-11-08T00:00:00.000Z") },
    ],
    ["owned by another donor", { donorId: OTHER_DONOR_ID, status: DonationStatus.DRAFT, deletedAt: null }],
  ])("answers NOT_FOUND for a %s donation, without a signed URL or provider call", async (_label, donation) => {
    const { deps, store, storage, provider } = makeDeps();
    store.donations.clear();
    store.seedPhoto();
    if (donation) store.donations.set(DONATION_ID, donation);

    const result = await screenDraftPhoto(deps, { donorId: DONOR_ID, donationId: DONATION_ID });

    expect(result).toEqual({ ok: false, error: "NOT_FOUND" });
    expect(storage.calls).toEqual([]);
    expect(provider.calls).toEqual([]);
    expect(store.screenings).toEqual([]);
  });

  it.each([DonationStatus.SCREENED, DonationStatus.POSTED])(
    "answers NOT_EDITABLE for a %s donation, without a signed URL or provider call",
    async (status) => {
      const { deps, store, storage, provider } = makeDeps();
      store.seedDraft({ status });

      const result = await screenDraftPhoto(deps, { donorId: DONOR_ID, donationId: DONATION_ID });

      expect(result).toEqual({ ok: false, error: "NOT_EDITABLE" });
      expect(storage.calls).toEqual([]);
      expect(provider.calls).toEqual([]);
      expect(store.screenings).toEqual([]);
    },
  );

  it("answers REVIEW_PENDING while a REVIEW row waits for an Admin", async () => {
    const { deps, store, storage, provider } = makeDeps();
    store.reviewPending = true;

    const result = await screenDraftPhoto(deps, { donorId: DONOR_ID, donationId: DONATION_ID });

    expect(result).toEqual({ ok: false, error: "REVIEW_PENDING" });
    expect(storage.calls).toEqual([]);
    expect(provider.calls).toEqual([]);
    expect(store.screenings).toEqual([]);
  });

  it("answers PHOTO_REQUIRED when the draft has no active food photo", async () => {
    const { deps, store, storage, provider } = makeDeps();
    store.photos = [];

    const result = await screenDraftPhoto(deps, { donorId: DONOR_ID, donationId: DONATION_ID });

    expect(result).toEqual({ ok: false, error: "PHOTO_REQUIRED" });
    expect(storage.calls).toEqual([]);
    expect(provider.calls).toEqual([]);
  });

  it("answers PHOTO_CHANGED when a retake replaces the screened photo during the call", async () => {
    const { deps, store, provider, transition } = makeDeps();
    provider.reply = async () => {
      store.seedPhoto({
        imageId: NEW_IMAGE_ID,
        storageKey: "food/55555555-5555-4555-8555-555555555555.jpg",
      });
      return passResult();
    };

    const result = await screenDraftPhoto(deps, { donorId: DONOR_ID, donationId: DONATION_ID });

    expect(result).toEqual({ ok: false, error: "PHOTO_CHANGED" });
    expect(store.screenings).toEqual([]);
    expect(transition.calls).toEqual([]);
  });

  it("answers NOT_FOUND and inserts nothing when the donation is discarded during the call", async () => {
    const { deps, store, provider, transition } = makeDeps();
    provider.reply = async () => {
      store.seedDraft({ deletedAt: new Date("2026-11-08T12:00:00.000Z") });
      return passResult();
    };

    const result = await screenDraftPhoto(deps, { donorId: DONOR_ID, donationId: DONATION_ID });

    expect(result).toEqual({ ok: false, error: "NOT_FOUND" });
    expect(store.screenings).toEqual([]);
    expect(transition.calls).toEqual([]);
  });

  it("answers NOT_EDITABLE and inserts nothing when the donation leaves DRAFT during the call", async () => {
    const { deps, store, provider, transition } = makeDeps();
    provider.reply = async () => {
      store.seedDraft({ status: DonationStatus.SCREENED });
      return passResult();
    };

    const result = await screenDraftPhoto(deps, { donorId: DONOR_ID, donationId: DONATION_ID });

    expect(result).toEqual({ ok: false, error: "NOT_EDITABLE" });
    expect(store.screenings).toEqual([]);
    expect(transition.calls).toEqual([]);
  });

  it("answers PHOTO_CHANGED when the photo changes between the provider call and the locked insert", async () => {
    const { deps, store, transition } = makeDeps();
    store.onTransaction = () =>
      store.seedPhoto({ imageId: NEW_IMAGE_ID, storageKey: "food/55555555-5555-4555-8555-555555555555.jpg" });

    const result = await screenDraftPhoto(deps, { donorId: DONOR_ID, donationId: DONATION_ID });

    expect(result).toEqual({ ok: false, error: "PHOTO_CHANGED" });
    expect(store.screenings).toEqual([]);
    expect(transition.calls).toEqual([]);
  });

  it("answers NOT_FOUND when the donation is discarded inside the lock, inserting nothing", async () => {
    const { deps, store, transition } = makeDeps();
    store.onTransaction = () => store.seedDraft({ deletedAt: new Date("2026-11-09T12:00:00.000Z") });

    const result = await screenDraftPhoto(deps, { donorId: DONOR_ID, donationId: DONATION_ID });

    expect(result).toEqual({ ok: false, error: "NOT_FOUND" });
    expect(store.screenings).toEqual([]);
    expect(transition.calls).toEqual([]);
  });

  it("answers NOT_EDITABLE when the donation leaves DRAFT inside the lock, inserting nothing", async () => {
    const { deps, store, transition } = makeDeps();
    store.onTransaction = () => store.seedDraft({ status: DonationStatus.SCREENED });

    const result = await screenDraftPhoto(deps, { donorId: DONOR_ID, donationId: DONATION_ID });

    expect(result).toEqual({ ok: false, error: "NOT_EDITABLE" });
    expect(store.screenings).toEqual([]);
    expect(transition.calls).toEqual([]);
  });

  it("answers REVIEW_PENDING when a concurrent screening saved a REVIEW inside the lock", async () => {
    const { deps, store, transition } = makeDeps();
    const concurrent: ScreeningRow = {
      id: "00000000-0000-4000-8000-999999999999",
      donationId: DONATION_ID,
      imageId: IMAGE_ID,
      provider: "other-request",
      modelVersion: "v0",
      verdict: ScreeningVerdict.REVIEW,
      confidence: 0.9,
      signs: ["unclear"],
      notes: null,
    };
    store.onTransaction = () => store.screenings.push(concurrent);

    const result = await screenDraftPhoto(deps, { donorId: DONOR_ID, donationId: DONATION_ID });

    expect(result).toEqual({ ok: false, error: "REVIEW_PENDING" });
    expect(store.screenings).toEqual([concurrent]);
    expect(transition.calls).toEqual([]);
  });

  it.each([["PASS"], ["FLAG"], ["REVIEW"]] as const)(
    "runs the provider outside the transaction and the transition only after it commits (%s)",
    async (verdict) => {
      const { deps, provider, events } = makeDeps();
      provider.reply = async () => ({ verdict, confidence: 0.95, signs: [] });

      const result = await screenDraftPhoto(deps, { donorId: DONOR_ID, donationId: DONATION_ID });

      expect(result.ok).toBe(true);
      expect(events).toEqual(
        verdict === "REVIEW"
          ? ["provider", "tx:start", "tx:end"]
          : ["provider", "tx:start", "tx:end", "transition"],
      );
    },
  );

  it("maps a refused transition to NOT_EDITABLE and keeps the screening row", async () => {
    const { deps, store, transition } = makeDeps();
    transition.result = { ok: false, error: "INVALID_TRANSITION" };

    const result = await screenDraftPhoto(deps, { donorId: DONOR_ID, donationId: DONATION_ID });

    expect(result).toEqual({ ok: false, error: "NOT_EDITABLE" });
    expect(store.screenings).toHaveLength(1);
    expect(transition.calls).toHaveLength(1);
  });

  it("maps a transition that cannot find the donation to NOT_FOUND", async () => {
    const { deps, transition } = makeDeps();
    transition.result = { ok: false, error: "NOT_FOUND" };

    const result = await screenDraftPhoto(deps, { donorId: DONOR_ID, donationId: DONATION_ID });

    expect(result).toEqual({ ok: false, error: "NOT_FOUND" });
  });
});
