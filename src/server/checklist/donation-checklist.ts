import type { SaveChecklistInput } from "@/contracts/donation-checklist";
import { DonationStatus } from "@/contracts/enums";
import type { StorageCondition } from "@/contracts/enums";

export type ChecklistViolation = "CONSUME_BY_NOT_AFTER_PREPARED" | "CONSUME_BY_NOT_AFTER_PICKUP_END";

/** The two food_categories flags that decide which answers this donation needs. */
export type ChecklistFlags = {
  requiresPreparedTime: boolean;
  requiresStorageInfo: boolean;
};

export type ChecklistAnswers = {
  preparedAt: Date | null;
  consumeByAt: Date | null;
  storageCondition: StorageCondition | null;
  storageTemperatureC: number | null;
  packagingIntact: boolean | null;
  allergensConfirmed: boolean | null;
  notCustomerPlateLeftovers: boolean | null;
};

export type ChecklistEvaluation = {
  violations: ChecklistViolation[];
  missing: string[];
  complete: boolean;
};

/** The donation row the save path locks: enough to authorise, evaluate and store. */
export type LockedDonation = {
  donorId: string;
  status: DonationStatus;
  pickupEnd: Date | null;
  deletedAt: Date | null;
  requiresPreparedTime: boolean;
  requiresStorageInfo: boolean;
};

/** The donation row the read path needs: ownership plus the category flags. */
export type ReadDonation = {
  donorId: string;
  pickupEnd: Date | null;
  requiresPreparedTime: boolean;
  requiresStorageInfo: boolean;
};

export type StoredChecklist = ChecklistAnswers & {
  completedAt: Date | null;
  updatedAt: Date;
};

export type ChecklistUpsert = ChecklistAnswers & {
  completedAt: Date | null;
};

export interface ChecklistTx {
  /** FOR UPDATE: the upsert must not race a pickup-window or status change. */
  getDonationLocked(id: string): Promise<LockedDonation | null>;
  upsertChecklist(donationId: string, row: ChecklistUpsert): Promise<void>;
}

export interface ChecklistStore {
  /** Runs `work` atomically; rolls back if `work` throws. */
  transaction<T>(work: (tx: ChecklistTx) => Promise<T>): Promise<T>;
  /** Plain reads outside any transaction: what GET needs, without taking a lock. */
  readDonation(id: string): Promise<ReadDonation | null>;
  readChecklist(donationId: string): Promise<StoredChecklist | null>;
}

/** Saving progress is allowed while the donation is a draft or already screened. */
const EDITABLE_STATUSES: readonly DonationStatus[] = [DonationStatus.DRAFT, DonationStatus.SCREENED];

/**
 * Fields the category does not use are evaluated and stored as null, so an answer
 * the category never asks for (a prepared time on packaged food) cannot count
 * towards completeness.
 */
export function normalizeAnswers(
  category: ChecklistFlags,
  answers: Partial<ChecklistAnswers>,
): ChecklistAnswers {
  return {
    preparedAt: category.requiresPreparedTime ? answers.preparedAt ?? null : null,
    consumeByAt: answers.consumeByAt ?? null,
    storageCondition: category.requiresStorageInfo ? answers.storageCondition ?? null : null,
    storageTemperatureC: category.requiresStorageInfo ? answers.storageTemperatureC ?? null : null,
    packagingIntact: answers.packagingIntact ?? null,
    allergensConfirmed: answers.allergensConfirmed ?? null,
    notCustomerPlateLeftovers: answers.notCustomerPlateLeftovers ?? null,
  };
}

/**
 * The application mirror of fn_assert_checklist_rules and the checklist CHECK
 * constraints in db/baseline/001_schema.sql. Violations refuse the save; missing
 * only keeps completed_at null, so the donor can save progress.
 */
export function evaluateChecklist(
  category: ChecklistFlags,
  answers: Partial<ChecklistAnswers>,
  pickupEnd: Date | null,
): ChecklistEvaluation {
  const normalised = normalizeAnswers(category, answers);

  const violations: ChecklistViolation[] = [];
  // CHECK checklist_consume_after_prepared: consume_by_at > prepared_at when both are set.
  if (normalised.preparedAt !== null && normalised.consumeByAt !== null && normalised.consumeByAt <= normalised.preparedAt) {
    violations.push("CONSUME_BY_NOT_AFTER_PREPARED");
  }
  // fn_assert_checklist_rules (line 890): consume_by_at <= pickup_end is refused
  // whenever the pickup window exists, completed or not.
  if (pickupEnd !== null && normalised.consumeByAt !== null && normalised.consumeByAt <= pickupEnd) {
    violations.push("CONSUME_BY_NOT_AFTER_PICKUP_END");
  }

  const missing: string[] = [];
  // CHECK checklist_confirmations_required: completed_at needs consume_by_at and
  // the three confirmations to be TRUE (a false confirmation is "not answered").
  if (normalised.consumeByAt === null) missing.push("consumeByAt");
  if (normalised.packagingIntact !== true) missing.push("packagingIntact");
  if (normalised.allergensConfirmed !== true) missing.push("allergensConfirmed");
  if (normalised.notCustomerPlateLeftovers !== true) missing.push("notCustomerPlateLeftovers");
  // fn_assert_checklist_rules (lines 895-900): the category flags decide whether
  // prepared time and storage condition + temperature are required.
  if (category.requiresPreparedTime && normalised.preparedAt === null) missing.push("preparedAt");
  if (category.requiresStorageInfo && normalised.storageCondition === null) missing.push("storageCondition");
  if (category.requiresStorageInfo && normalised.storageTemperatureC === null) missing.push("storageTemperatureC");

  return { violations, missing, complete: violations.length === 0 && missing.length === 0 };
}

export type SaveChecklistResult =
  | { ok: true; complete: boolean; missing: string[] }
  | { ok: false; error: "NOT_FOUND" | "NOT_EDITABLE" | ChecklistViolation };

/** The documented read shape: dates as ISO strings, built from the row, never the row itself. */
export type ChecklistView = {
  preparedAt: string | null;
  consumeByAt: string | null;
  storageCondition: StorageCondition | null;
  storageTemperatureC: number | null;
  packagingIntact: boolean | null;
  allergensConfirmed: boolean | null;
  notCustomerPlateLeftovers: boolean | null;
  completedAt: string | null;
  updatedAt: string;
};

export type GetChecklistResult =
  | { ok: true; checklist: ChecklistView | null; complete: boolean; missing: string[] }
  | { ok: false; error: "NOT_FOUND" };

function toView(row: StoredChecklist): ChecklistView {
  return {
    preparedAt: row.preparedAt?.toISOString() ?? null,
    consumeByAt: row.consumeByAt?.toISOString() ?? null,
    storageCondition: row.storageCondition,
    storageTemperatureC: row.storageTemperatureC,
    packagingIntact: row.packagingIntact,
    allergensConfirmed: row.allergensConfirmed,
    notCustomerPlateLeftovers: row.notCustomerPlateLeftovers,
    completedAt: row.completedAt?.toISOString() ?? null,
    updatedAt: row.updatedAt.toISOString(),
  };
}

/**
 * Saves the whole checklist (PUT semantics): any field not sent is stored as null.
 * The donation row is locked for the transaction, and nothing is written when a
 * rule is violated. donations.status is never touched here.
 */
export async function saveChecklist(
  deps: { store: ChecklistStore },
  args: { donorId: string; donationId: string; input: SaveChecklistInput },
): Promise<SaveChecklistResult> {
  const { donorId, donationId, input } = args;

  return deps.store.transaction(async (tx) => {
    const donation = await tx.getDonationLocked(donationId);
    // Another donor's draft and a discarded draft are the same NOT_FOUND.
    if (!donation || donation.donorId !== donorId || donation.deletedAt !== null) {
      return { ok: false, error: "NOT_FOUND" };
    }
    if (!EDITABLE_STATUSES.includes(donation.status)) {
      return { ok: false, error: "NOT_EDITABLE" };
    }

    const category: ChecklistFlags = {
      requiresPreparedTime: donation.requiresPreparedTime,
      requiresStorageInfo: donation.requiresStorageInfo,
    };
    const answers = normalizeAnswers(category, input);
    const evaluation = evaluateChecklist(category, answers, donation.pickupEnd);
    const firstViolation = evaluation.violations[0];
    if (firstViolation !== undefined) return { ok: false, error: firstViolation };

    await tx.upsertChecklist(donationId, {
      ...answers,
      completedAt: evaluation.complete ? new Date() : null,
    });
    return { ok: true, complete: evaluation.complete, missing: evaluation.missing };
  });
}

/**
 * Reads the checklist for the donor's own, non-deleted donation. No status
 * restriction: a closed donation can still be read, only editing is refused.
 * completeness comes from the same rules the save path uses.
 */
export async function getChecklist(
  deps: { store: ChecklistStore },
  args: { donorId: string; donationId: string },
): Promise<GetChecklistResult> {
  const { donorId, donationId } = args;

  const donation = await deps.store.readDonation(donationId);
  if (!donation || donation.donorId !== donorId) return { ok: false, error: "NOT_FOUND" };

  const stored = await deps.store.readChecklist(donationId);
  const category: ChecklistFlags = {
    requiresPreparedTime: donation.requiresPreparedTime,
    requiresStorageInfo: donation.requiresStorageInfo,
  };
  // No row yet: evaluate a blank checklist, so missing lists everything the category needs.
  const evaluation = evaluateChecklist(category, stored ?? {}, donation.pickupEnd);

  return {
    ok: true,
    checklist: stored ? toView(stored) : null,
    complete: evaluation.complete,
    missing: evaluation.missing,
  };
}
