import { beforeEach, describe, expect, it, vi } from "vitest";
import { DonationStatus, ScreeningVerdict } from "@/contracts/enums";
import {
  listScreeningQueue,
  type ReviewQueueRow,
  type ReviewQueueStore,
} from "./review-queue";

class FakeQueueStore implements ReviewQueueStore {
  rows: ReviewQueueRow[] = [];
  limits: number[] = [];

  async listPending(limit: number): Promise<ReviewQueueRow[]> {
    this.limits.push(limit);
    return this.rows;
  }
}

class FakeSigner {
  calls: string[] = [];
  failure: Error | null = null;

  readonly signPhoto = async (key: string): Promise<string> => {
    this.calls.push(key);
    if (this.failure) throw this.failure;
    return `https://signed.example/${key}?token=abc`;
  };
}

const PHOTO_KEY = "food-photos/11111111-2222-4333-8444-555555555555.jpg";

function queueRow(overrides: Partial<ReviewQueueRow> = {}): ReviewQueueRow {
  return {
    screeningId: "screen-1",
    donationId: "donation-1",
    verdict: ScreeningVerdict.REVIEW,
    reviewedAt: null,
    createdAt: new Date("2026-11-05T08:00:00.000Z"),
    confidence: 0.85,
    signs: ["no visible mold"],
    notes: null,
    donationStatus: DonationStatus.DRAFT,
    deletedAt: null,
    foodName: "Beef stew",
    portions: 12,
    categoryCode: "cooked_meals",
    checklist: null,
    photoKey: PHOTO_KEY,
    ...overrides,
  };
}

function setup(rows: ReviewQueueRow[]) {
  const store = new FakeQueueStore();
  store.rows = rows;
  const signer = new FakeSigner();
  return { store, signer };
}

type Deps = ReturnType<typeof setup>;

function queue(deps: Deps, limit = 20) {
  return listScreeningQueue(
    { store: deps.store, signPhoto: deps.signer.signPhoto },
    { limit },
  );
}

beforeEach(() => {
  vi.restoreAllMocks();
});

describe("listScreeningQueue", () => {
  it("returns the pending cases oldest first and passes the limit to the store", async () => {
    const deps = setup([
      queueRow({ screeningId: "screen-c", donationId: "donation-3", createdAt: new Date("2026-11-07T00:00:00.000Z") }),
      queueRow({ screeningId: "screen-a", donationId: "donation-1", createdAt: new Date("2026-11-05T00:00:00.000Z") }),
      queueRow({ screeningId: "screen-b", donationId: "donation-2", createdAt: new Date("2026-11-06T00:00:00.000Z") }),
    ]);

    const items = await queue(deps, 7);

    expect(deps.store.limits).toEqual([7]);
    expect(items.map((item) => item.screeningId)).toEqual(["screen-a", "screen-b", "screen-c"]);
    expect(items[0].donation).toEqual({ foodName: "Beef stew", portions: 12, categoryCode: "cooked_meals" });
    expect(items[0].confidence).toBe(0.85);
    expect(items[0].signs).toEqual(["no visible mold"]);
  });

  it("skips a row whose review is already decided", async () => {
    const deps = setup([
      queueRow({ reviewedAt: new Date("2026-11-06T00:00:00.000Z") }),
      queueRow({ screeningId: "screen-2", donationId: "donation-2" }),
    ]);

    const items = await queue(deps);

    expect(items.map((item) => item.screeningId)).toEqual(["screen-2"]);
  });

  it("skips a screening that is not the latest for its donation", async () => {
    const deps = setup([
      queueRow({ screeningId: "screen-older", createdAt: new Date("2026-11-04T00:00:00.000Z") }),
      queueRow({ screeningId: "screen-newer", createdAt: new Date("2026-11-06T00:00:00.000Z") }),
      queueRow({ screeningId: "screen-other", donationId: "donation-2" }),
    ]);

    const items = await queue(deps);

    // The older row of donation-1 is dropped; the other donation is unaffected.
    expect(items.map((item) => item.screeningId)).toEqual(["screen-other", "screen-newer"]);
  });

  it("breaks a same-timestamp tie with the screening id", async () => {
    const shared = new Date("2026-11-05T00:00:00.000Z");
    const deps = setup([
      queueRow({ screeningId: "screen-b", createdAt: shared }),
      queueRow({ screeningId: "screen-a", createdAt: shared }),
    ]);

    const items = await queue(deps);

    expect(items.map((item) => item.screeningId)).toEqual(["screen-b"]);
  });

  it.each([
    ["non-DRAFT", { donationStatus: DonationStatus.ACCEPTED }],
    ["discarded", { deletedAt: new Date("2026-11-04T00:00:00.000Z") }],
    ["another verdict", { verdict: ScreeningVerdict.PASS }],
  ])("skips a %s row", async (_label, overrides) => {
    const deps = setup([queueRow(overrides)]);

    const items = await queue(deps);

    expect(items).toEqual([]);
    expect(deps.signer.calls).toEqual([]);
  });

  it("answers photoUrl null when the donation has no photo, without calling the signer", async () => {
    const deps = setup([queueRow({ photoKey: null })]);

    const items = await queue(deps);

    expect(items).toHaveLength(1);
    expect(items[0].photoUrl).toBeNull();
    expect(deps.signer.calls).toEqual([]);
  });

  it("keeps the item and nulls photoUrl when its signer fails, logging id and safe tokens only", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    const deps = setup([queueRow()]);
    deps.signer.failure = new Error(`Storage signed URL failed: ${PHOTO_KEY}`);

    const items = await queue(deps);

    // The case is not dropped: the Admin still sees it without a photo.
    expect(items).toHaveLength(1);
    expect(items[0].screeningId).toBe("screen-1");
    expect(items[0].photoUrl).toBeNull();

    expect(consoleError).toHaveBeenCalledTimes(1);
    const [label, details] = consoleError.mock.calls[0];
    expect(label).toBe("Screening photo URL failed");
    expect(details).toEqual({ screeningId: "screen-1", errorName: "Error" });
    const logged = JSON.stringify(consoleError.mock.calls);
    // Never the raw message (it can carry the key) and never the storage key.
    expect(logged).not.toContain("Storage signed URL failed");
    expect(logged).not.toContain(PHOTO_KEY);
    consoleError.mockRestore();
  });

  it("respects the limit, keeping the oldest cases", async () => {
    const deps = setup([
      queueRow({ screeningId: "screen-1", donationId: "donation-1", createdAt: new Date("2026-11-01T00:00:00.000Z") }),
      queueRow({ screeningId: "screen-2", donationId: "donation-2", createdAt: new Date("2026-11-02T00:00:00.000Z") }),
      queueRow({ screeningId: "screen-3", donationId: "donation-3", createdAt: new Date("2026-11-03T00:00:00.000Z") }),
      queueRow({ screeningId: "screen-4", donationId: "donation-4", createdAt: new Date("2026-11-04T00:00:00.000Z") }),
      queueRow({ screeningId: "screen-5", donationId: "donation-5", createdAt: new Date("2026-11-05T00:00:00.000Z") }),
    ]);

    const items = await queue(deps, 2);

    expect(items.map((item) => item.screeningId)).toEqual(["screen-1", "screen-2"]);
  });

  it("maps items without the storage key and signs the photo for the response", async () => {
    const checklist = {
      preparedAt: new Date("2026-11-04T06:00:00.000Z"),
      consumeByAt: new Date("2026-11-06T18:00:00.000Z"),
      storageCondition: "REFRIGERATED" as const,
      storageTemperatureC: 4.5,
      packagingIntact: true,
      allergensConfirmed: true,
      notCustomerPlateLeftovers: true,
      completedAt: new Date("2026-11-04T07:00:00.000Z"),
    };
    const deps = setup([queueRow({ checklist })]);

    const items = await queue(deps);

    expect(deps.signer.calls).toEqual([PHOTO_KEY]);
    expect(items[0].photoUrl).toBe(`https://signed.example/${PHOTO_KEY}?token=abc`);
    expect(items[0].checklist).toEqual(checklist);
    // The item's keys are exactly the contract's: no photoKey, no donor data.
    expect(Object.keys(items[0]).sort()).toEqual([
      "checklist",
      "confidence",
      "createdAt",
      "donation",
      "donationId",
      "notes",
      "photoUrl",
      "screeningId",
      "signs",
    ]);
    expect(items[0]).not.toHaveProperty("photoKey");
  });
});
