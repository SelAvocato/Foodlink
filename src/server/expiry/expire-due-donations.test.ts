import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
vi.mock("@/server/db", () => ({ prisma: {} }));
import { DonationTransitionError } from "@/server/donations/transition-donation";
import { expireDueDonations, type DueDonationStore, type ExpiryTransition } from "./expire-due-donations";

const dueRows = [
    { donationId: "donation-1", status: "POSTED" as const, pickupEnd: new Date(Date.now() - 60_000) },
    { donationId: "donation-2", status: "ACCEPTED" as const, pickupEnd: new Date(Date.now() - 120_000) },
    { donationId: "donation-3", status: "ASSIGNED" as const, pickupEnd: new Date(Date.now() - 180_000) },
];

function fakeStore(rows: typeof dueRows): DueDonationStore {
    return { listDue: async () => rows };
}

describe("expireDueDonations", () => {
    it("expires every due donation and reports the counts", async () => {
        const seen: string[] = [];
        const transition: ExpiryTransition = async (id) => {
            seen.push(id);
            return { from: "POSTED", to: "EXPIRED" };
        };
        const result = await expireDueDonations({ store: fakeStore(dueRows), transition });

        expect(seen).toEqual(["donation-1", "donation-2", "donation-3"]);
        expect(result).toEqual({ expired: 3, skipped: 0, failed: 0 });
    });

    it("counts a benign race as skipped and keeps going", async () => {
        const transition: ExpiryTransition = async (id) => {
            if (id === "donation-2") {
                throw new DonationTransitionError("INVALID_TRANSITION", "Donation changed before transition completed");
            }
            return { from: "POSTED", to: "EXPIRED" };
        };
        const result = await expireDueDonations({ store: fakeStore(dueRows), transition });

        expect(result).toEqual({ expired: 2, skipped: 1, failed: 0 });
    });

    it("counts an unexpected error as failed and keeps going", async () => {
        const transition: ExpiryTransition = async (id) => {
            if (id === "donation-1") throw new Error("database exploded");
            return { from: "POSTED", to: "EXPIRED" };
        };
        const result = await expireDueDonations({ store: fakeStore(dueRows), transition });

        expect(result).toEqual({ expired: 2, skipped: 0, failed: 1 });
    });

    it("passes the null system actor to the transition", async () => {
        const actors: unknown[] = [];
        const transition: ExpiryTransition = async (_id, _to, actor) => {
            actors.push(actor);
            return { from: "POSTED", to: "EXPIRED" };
        };
        await expireDueDonations({ store: fakeStore(dueRows.slice(0, 1)), transition });

        expect(actors).toEqual([null]);
    });
});
