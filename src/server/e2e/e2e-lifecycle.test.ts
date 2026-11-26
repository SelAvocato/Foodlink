import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const dotenv = require("dotenv");
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { existsSync, readFileSync } = require("node:fs");
  const hasLocalEnv = existsSync(".env.local");
  if (hasLocalEnv) process.loadEnvFile(".env.local");
  const localEnv = hasLocalEnv ? dotenv.parse(readFileSync(".env.local")) : {};
  const databaseUrl =
    localEnv.DIRECT_URL ||
    localEnv.DATABASE_URL ||
    process.env.DIRECT_URL ||
    process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("Set DIRECT_URL or DATABASE_URL in .env.local or the CI environment");
  }
  process.env.DATABASE_URL = databaseUrl;
});

vi.mock("server-only", () => ({}));

import { saveChecklistSchema } from "@/contracts/donation-checklist";
import { createDraftSchema } from "@/contracts/donation-draft";
import { savePickupSchema } from "@/contracts/donation-pickup";
import { donorRegistrationSchema, volunteerRegistrationSchema } from "@/contracts/registration";
import { reviewSchema } from "@/contracts/review";
import { pickupInspectionSchema } from "@/contracts/volunteer-pickup-inspection";
import { createDistributionEntrySchema } from "@/contracts/volunteer-distribution";
import { createStorage } from "@/lib/storage";
import { addCalendarMonths } from "@/lib/min-shelf-life";
import { prisma } from "@/server/db";
import { createDraft } from "@/server/drafts/donation-drafts";
import { prismaTransitionStore, transitionDonation } from "@/server/donations/transition-donation";
import { saveChecklist } from "@/server/checklist/donation-checklist";
import { savePickup } from "@/server/pickup/donation-pickup";
import { saveFoodPhoto } from "@/server/photos/donation-photo";
import { createPostTransition } from "@/server/posting/post-transition";
import { postDonation } from "@/server/posting/post-donation";
import { prismaRegistrationStore } from "@/server/registration/prisma-registration-store";
import { registerDonor } from "@/server/registration/register-donor";
import { registerVolunteer } from "@/server/registration/register-volunteer";
import { prismaReviewStore } from "@/server/review/prisma-review-store";
import { reviewAccount } from "@/server/review/review-account";
import { getScreeningProvider } from "@/server/screening/get-provider";
import { screenDraftPhoto } from "@/server/screening/screen-draft-photo";
import { prismaScreeningStore } from "@/server/screening/prisma-screening-store";
import { createScreeningTransition } from "@/server/screening/screening-transition";
import { createDistributionCompletionTransition } from "@/server/volunteer/prisma-distribution-completion-store";
import { createDropoffTransition } from "@/server/volunteer/dropoff-transition";
import { createPickupOutcomeTransition } from "@/server/volunteer/pickup-outcome-transition";
import { createDistributionEntry } from "@/server/volunteer/distribution-entries";
import { completeDistribution } from "@/server/volunteer/distribution-completion";
import { recordDropoffScan } from "@/server/volunteer/dropoff-scan";
import { saveHandoverPhoto } from "@/server/volunteer/handover-photo";
import { savePickupInspection } from "@/server/volunteer/pickup-inspection";
import { savePickupPhoto } from "@/server/volunteer/pickup-photo";
import { recordPickupOutcome } from "@/server/volunteer/pickup-outcome";
import { recordPickupScan } from "@/server/volunteer/pickup-scan";
import { prismaDistributionCompletionStore } from "@/server/volunteer/prisma-distribution-completion-store";
import { prismaDistributionEntryStore } from "@/server/volunteer/prisma-distribution-entry-store";
import { prismaDropoffScanStore } from "@/server/volunteer/prisma-dropoff-scan-store";
import { prismaHandoverPhotoStore } from "@/server/volunteer/prisma-handover-photo-store";
import { prismaPickupInspectionStore } from "@/server/volunteer/prisma-pickup-inspection-store";
import { prismaPickupOutcomeStore } from "@/server/volunteer/prisma-pickup-outcome-store";
import { prismaPickupPhotoStore } from "@/server/volunteer/prisma-pickup-photo-store";
import { prismaPickupScanStore } from "@/server/volunteer/prisma-pickup-scan-store";
import { prismaChecklistStore } from "@/server/checklist/prisma-checklist-store";
import { prismaDraftStore } from "@/server/drafts/prisma-draft-store";
import { prismaPhotoStore } from "@/server/photos/prisma-photo-store";
import { prismaPickupStore } from "@/server/pickup/prisma-pickup-store";
import { prismaPostingStore } from "@/server/posting/prisma-posting-store";

const runId = randomUUID().slice(0, 8);
const achievementName = `E2E Volunteer Tasks ${runId}`;

let donationId: string | null = null;
let achievementId: number | null = null;
const userIds: string[] = [];

function pngBytes(): Uint8Array {
  return new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x00]);
}

function expectSuccess<T extends { ok: boolean }>(result: T): Extract<T, { ok: true }> {
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error(`Expected success, got ${JSON.stringify(result)}`);
  return result as Extract<T, { ok: true }>;
}

const storage = createStorage({
  async upload(path) {
    return { data: { path }, error: null };
  },
  async createSignedUrl(path, expiresIn) {
    return { data: { signedUrl: `https://storage.test/${path}?expires=${expiresIn}` }, error: null };
  },
  async remove(paths) {
    return { data: paths.length, error: null };
  },
});

afterAll(async () => {
  try {
    const targetDonationId = donationId ?? "00000000-0000-0000-0000-000000000000";
    await prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(`SET LOCAL session_replication_role = 'replica';`);

      const addressRows = await tx.$queryRaw<{ id: string }[]>`
        SELECT DISTINCT id
        FROM (
          SELECT address_id AS id FROM users WHERE id = ANY(${userIds}::uuid[])
          UNION
          SELECT pickup_address_id AS id FROM donations WHERE id = ${targetDonationId}::uuid
        ) rows
        WHERE id IS NOT NULL`;
      const addressIds = addressRows.map((row) => row.id);

      await tx.$executeRaw`DELETE FROM donation_tracking_events WHERE donation_id = ${targetDonationId}::uuid`;
      await tx.$executeRaw`DELETE FROM donation_exits WHERE donation_id = ${targetDonationId}::uuid`;
      await tx.$executeRaw`DELETE FROM donation_assignments WHERE donation_id = ${targetDonationId}::uuid`;
      await tx.$executeRaw`DELETE FROM donation_qr_scans WHERE donation_id = ${targetDonationId}::uuid`;
      await tx.$executeRaw`DELETE FROM donation_pickup_inspections WHERE donation_id = ${targetDonationId}::uuid`;
      await tx.$executeRaw`DELETE FROM food_screenings WHERE donation_id = ${targetDonationId}::uuid`;
      await tx.$executeRaw`DELETE FROM donation_images WHERE donation_id = ${targetDonationId}::uuid`;
      await tx.$executeRaw`DELETE FROM donation_safety_checklists WHERE donation_id = ${targetDonationId}::uuid`;
      await tx.$executeRaw`DELETE FROM donation_allergens WHERE donation_id = ${targetDonationId}::uuid`;
      await tx.$executeRaw`DELETE FROM donation_dietary_tags WHERE donation_id = ${targetDonationId}::uuid`;
      await tx.$executeRaw`DELETE FROM unusable_portions WHERE donation_id = ${targetDonationId}::uuid`;
      await tx.$executeRaw`DELETE FROM distribution_entries WHERE donation_id = ${targetDonationId}::uuid`;
      await tx.$executeRaw`DELETE FROM audit_logs WHERE target_id = ${targetDonationId} OR target_id = ANY(${userIds}::text[]) OR actor_user_id = ANY(${userIds}::uuid[])`;
      await tx.$executeRaw`DELETE FROM notifications WHERE related_donation_id = ${targetDonationId}::uuid OR user_id = ANY(${userIds}::uuid[])`;
      if (achievementId !== null) {
        await tx.$executeRaw`DELETE FROM user_achievements WHERE achievement_id = ${achievementId}::smallint`;
        await tx.$executeRaw`DELETE FROM achievements WHERE id = ${achievementId}::smallint`;
      }
      await tx.$executeRaw`DELETE FROM user_reviews WHERE user_id = ANY(${userIds}::uuid[]) OR reviewed_by_user_id = ANY(${userIds}::uuid[])`;
      await tx.$executeRaw`DELETE FROM user_documents WHERE user_id = ANY(${userIds}::uuid[])`;
      await tx.$executeRaw`DELETE FROM user_consents WHERE user_id = ANY(${userIds}::uuid[])`;
      await tx.$executeRaw`DELETE FROM user_credentials WHERE user_id = ANY(${userIds}::uuid[])`;
      await tx.$executeRaw`DELETE FROM donations WHERE id = ${targetDonationId}::uuid`;
      await tx.$executeRaw`DELETE FROM users WHERE id = ANY(${userIds}::uuid[])`;
      if (addressIds.length > 0) {
        await tx.$executeRaw`DELETE FROM addresses WHERE id = ANY(${addressIds}::uuid[])`;
      }
    });
  } finally {
    await prisma.$disconnect();
  }
});

describe("FoodLink PostgreSQL lifecycle (C10)", () => {
  it(
    "registers, screens, posts, assigns, picks up, delivers and closes one donation",
    async () => {
      const proof = pngBytes();
      const password = "E2eTest!2026";

      const adminRows = await prisma.$queryRaw<{ id: string }[]>`
        INSERT INTO users (role, status, full_name, email, contact_number)
        VALUES ('ADMIN', 'ACTIVE', ${`E2E Admin ${runId}`}, ${`e2e-admin-${runId}@foodlink.test`}, '+639123456789')
        RETURNING id`;
      const adminId = adminRows[0].id;
      userIds.push(adminId);

      const donorInput = donorRegistrationSchema.parse({
        donorType: "INDIVIDUAL",
        fullName: `E2E Donor ${runId}`,
        contactNumber: "+639123456789",
        email: `e2e-donor-${runId}@foodlink.test`,
        address: {
          streetLine1: "1 E2E Donor Street",
          barangay: "Test Barangay",
          city: "Manila",
          countryCode: "PH",
          latitude: 14.5995,
          longitude: 120.9842,
        },
        password,
        consent: true,
      });
      const donorRegistration = expectSuccess(
        await registerDonor({ store: prismaRegistrationStore, storage }, donorInput, proof),
      );
      const donorId = donorRegistration.userId;
      userIds.push(donorId);

      const volunteerInput = volunteerRegistrationSchema.parse({
        fullName: `E2E Volunteer ${runId}`,
        contactNumber: "+639123456789",
        email: `e2e-volunteer-${runId}@foodlink.test`,
        address: {
          streetLine1: "2 E2E Volunteer Street",
          barangay: "Test Barangay",
          city: "Manila",
          countryCode: "PH",
        },
        availability: "Weekdays",
        password,
        consent: true,
      });
      const volunteerRegistration = expectSuccess(
        await registerVolunteer({ store: prismaRegistrationStore, storage }, volunteerInput, proof),
      );
      const volunteerId = volunteerRegistration.userId;
      userIds.push(volunteerId);

      const pendingRows = await prisma.$queryRaw<{ status: string }[]>`
        SELECT status::text AS status FROM users WHERE id = ANY(${userIds}::uuid[]) ORDER BY created_at, id`;
      expect(pendingRows.map((row) => row.status).sort()).toEqual(["ACTIVE", "PENDING", "PENDING"]);

      const approval = reviewSchema.parse({ action: "APPROVE" });
      expectSuccess(
        await reviewAccount(
          { store: prismaReviewStore },
          { reviewerId: adminId, targetId: donorId, review: approval },
        ),
      );
      expectSuccess(
        await reviewAccount(
          { store: prismaReviewStore },
          { reviewerId: adminId, targetId: volunteerId, review: approval },
        ),
      );

      const activeRows = await prisma.$queryRaw<{ status: string }[]>`
        SELECT status::text AS status FROM users WHERE id = ANY(${userIds}::uuid[])`;
      expect(activeRows.every((row) => row.status === "ACTIVE")).toBe(true);

      const created = expectSuccess(
        await createDraft(
          { store: prismaDraftStore },
          {
            donorId,
            input: createDraftSchema.parse({
              foodCategoryCode: "PACKAGED_FOOD",
              foodName: "E2E Sealed Canned Goods",
              portions: 10,
            }),
          },
        ),
      );
      donationId = created.donationId;

      expectSuccess(
        await saveFoodPhoto(
          { store: prismaPhotoStore, storage },
          { donorId, donationId, file: { contentType: "image/png", data: proof } },
        ),
      );

      const pickupStart = new Date(Date.now() + 2 * 60 * 60 * 1000);
      const pickupEnd = new Date(pickupStart.getTime() + 2 * 60 * 60 * 1000);
      // Sealed packaged food needs more than five months left at checklist save.
      const consumeBy = addCalendarMonths(pickupEnd, 6);

      expectSuccess(
        await savePickup(
          { store: prismaPickupStore },
          {
            donorId,
            donationId,
            input: savePickupSchema.parse({
              address: {
                streetLine1: "3 E2E Pickup Street",
                barangay: "Test Barangay",
                city: "Manila",
                countryCode: "PH",
              },
              pickupStart: pickupStart.toISOString(),
              pickupEnd: pickupEnd.toISOString(),
            }),
          },
        ),
      );

      const checklist = expectSuccess(
        await saveChecklist(
          { store: prismaChecklistStore },
          {
            donorId,
            donationId,
            input: saveChecklistSchema.parse({
              consumeByAt: consumeBy.toISOString(),
              packagingIntact: true,
              allergensConfirmed: true,
              notCustomerPlateLeftovers: true,
            }),
          },
        ),
      );
      expect(checklist.complete).toBe(true);

      const screened = expectSuccess(
        await screenDraftPhoto(
          {
            store: prismaScreeningStore,
            storage,
            provider: getScreeningProvider(),
            transition: createScreeningTransition(),
          },
          { donorId, donationId },
        ),
      );
      expect(screened.verdict).toBe("PASS");
      expect(screened.donationStatus).toBe("SCREENED");

      const posted = expectSuccess(
        await postDonation(
          { store: prismaPostingStore, transition: createPostTransition() },
          { donorId, donationId },
        ),
      );
      expect(posted.expiresAt).toBe(pickupEnd.toISOString());

      const tokenRows = await prisma.$queryRaw<{ qr_token: string }[]>`
        SELECT qr_token FROM donations WHERE id = ${donationId}::uuid`;
      const qrToken = tokenRows[0].qr_token;
      expect(qrToken).toMatch(/^[A-Za-z0-9_-]{43}$/);
      expect(Buffer.from(qrToken, "base64url")).toHaveLength(32);

      await transitionDonation(
        { store: prismaTransitionStore },
        donationId,
        "ACCEPTED",
        { id: adminId, role: "ADMIN" },
      );

      const achievementRows = await prisma.$queryRaw<{ id: number }[]>`
        INSERT INTO achievements (code, name, role, metric, threshold, is_active)
        VALUES (
          ${`E2E_TASKS_${runId}`},
          ${achievementName},
          'VOLUNTEER'::user_role,
          'TASKS_COMPLETED'::achievement_metric,
          1,
          true
        )
        RETURNING id`;
      achievementId = achievementRows[0].id;

      await transitionDonation(
        { store: prismaTransitionStore },
        donationId,
        "ASSIGNED",
        { id: adminId, role: "ADMIN" },
        { volunteerId },
      );

      const pickupScan = expectSuccess(
        await recordPickupScan(
          { store: prismaPickupScanStore },
          { volunteerId, donationId, token: qrToken },
        ),
      );
      expect(pickupScan.response.alreadyScanned).toBe(false);

      const pickupPhoto = expectSuccess(
        await savePickupPhoto(
          { store: prismaPickupPhotoStore, storage, provider: getScreeningProvider() },
          { volunteerId, donationId, file: { contentType: "image/png", data: proof } },
        ),
      );
      expect(pickupPhoto.verdict).toBe("PASS");

      const inspection = expectSuccess(
        await savePickupInspection(
          { store: prismaPickupInspectionStore },
          {
            volunteerId,
            donationId,
            input: pickupInspectionSchema.parse({
              matchesDescription: true,
              packagingSealedClean: true,
              looksSmellsNormal: true,
            }),
          },
        ),
      );
      expect(inspection.decision).toBe("ACCEPTED");

      const pickedUp = expectSuccess(
        await recordPickupOutcome(
          { store: prismaPickupOutcomeStore, transition: createPickupOutcomeTransition() },
          { volunteerId, donationId },
        ),
      );
      expect(pickedUp.status).toBe("PICKED_UP");

      expectSuccess(
        await saveHandoverPhoto(
          { store: prismaHandoverPhotoStore, storage },
          { volunteerId, donationId, file: { contentType: "image/png", data: proof } },
        ),
      );

      const delivered = expectSuccess(
        await recordDropoffScan(
          { store: prismaDropoffScanStore, transition: createDropoffTransition() },
          { volunteerId, donationId, token: qrToken },
        ),
      );
      expect(delivered.response.status).toBe("DELIVERED");

      const distributionDate = new Date().toISOString().slice(0, 10);
      const firstEntry = expectSuccess(
        await createDistributionEntry(
          { store: prismaDistributionEntryStore },
          {
            volunteerId,
            donationId,
            input: createDistributionEntrySchema.parse({
              date: distributionDate,
              place: "Barangay 1 Community Center",
              groupServed: "families",
              peopleServed: 4,
              portionsDistributed: 6,
              portionsUnusable: 2,
              unusableReason: "damaged",
            }),
          },
        ),
      );
      expect(firstEntry.progress.accountedPortions).toBe(8);

      const secondEntry = expectSuccess(
        await createDistributionEntry(
          { store: prismaDistributionEntryStore },
          {
            volunteerId,
            donationId,
            input: createDistributionEntrySchema.parse({
              date: distributionDate,
              place: "Barangay 2 Community Center",
              groupServed: "mixed_community",
              peopleServed: 2,
              portionsDistributed: 2,
            }),
          },
        ),
      );
      expect(secondEntry.progress.accountedPortions).toBe(10);
      expect(secondEntry.progress.remainingPortions).toBe(0);

      const completed = expectSuccess(
        await completeDistribution(
          {
            store: prismaDistributionCompletionStore,
            transition: createDistributionCompletionTransition(),
          },
          { volunteerId, donationId },
        ),
      );
      expect(completed.status).toBe("CLOSED");
      expect(completed.progress.accountedPortions).toBe(10);

      const donationRows = await prisma.$queryRaw<{ status: string; closed_at: Date | null; portions: number }[]>`
        SELECT status::text AS status, closed_at, portions FROM donations WHERE id = ${donationId}::uuid`;
      expect(donationRows[0].status).toBe("CLOSED");
      expect(donationRows[0].closed_at).toBeInstanceOf(Date);
      expect(donationRows[0].portions).toBe(10);

      const events = await prisma.$queryRaw<{ transition: string }[]>`
        SELECT from_status::text || '->' || to_status::text AS transition
        FROM donation_tracking_events
        WHERE donation_id = ${donationId}::uuid
        ORDER BY id`;
      expect(events.map((row) => row.transition)).toEqual([
        "DRAFT->SCREENED",
        "SCREENED->POSTED",
        "POSTED->ACCEPTED",
        "ACCEPTED->ASSIGNED",
        "ASSIGNED->PICKED_UP",
        "PICKED_UP->DELIVERED",
        "DELIVERED->CLOSED",
      ]);

      const auditRows = await prisma.$queryRaw<{ action: string }[]>`
        SELECT action FROM audit_logs
        WHERE target_id = ${donationId} OR actor_user_id = ANY(${userIds}::uuid[])
        ORDER BY id`;
      const actions = auditRows.map((row) => row.action);
      expect(actions.filter((action) => action === "account_approved")).toHaveLength(2);
      expect(actions.filter((action) => action === "DONATION_TRANSITION")).toHaveLength(7);

      const totals = await prisma.$queryRaw<{ distributed: bigint; unusable: bigint; portions: number }[]>`
        SELECT
          COALESCE((SELECT sum(portions_distributed) FROM distribution_entries WHERE donation_id = ${donationId}::uuid), 0) AS distributed,
          COALESCE((SELECT sum(portions) FROM unusable_portions WHERE donation_id = ${donationId}::uuid), 0) AS unusable,
          portions
        FROM donations WHERE id = ${donationId}::uuid`;
      expect(Number(totals[0].distributed)).toBe(8);
      expect(Number(totals[0].unusable)).toBe(2);
      expect(totals[0].portions).toBe(10);

      const awards = await prisma.$queryRaw<{ achievement_id: number; metadata: unknown }[]>`
        SELECT achievement_id, metadata
        FROM user_achievements
        WHERE user_id = ${volunteerId}::uuid AND achievement_id = ${achievementId}::smallint`;
      expect(awards).toHaveLength(1);
      expect(awards[0].metadata).toMatchObject({
        metric: "TASKS_COMPLETED",
        value: 1,
        threshold: 1,
      });

      const achievementNotifications = await prisma.$queryRaw<{ count: bigint }[]>`
        SELECT count(*) AS count
        FROM notifications
        WHERE user_id = ${volunteerId}::uuid
          AND notification_type = 'ACHIEVEMENT_EARNED'
          AND related_donation_id = ${donationId}::uuid
          AND title = ${`Achievement unlocked: ${achievementName}`}`;
      expect(Number(achievementNotifications[0].count)).toBe(1);
    },
    120_000,
  );
});
