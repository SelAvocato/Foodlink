import { DonationStatus } from "@/contracts/enums";
import type { AccountStatus, DonorType, Role } from "@/contracts/enums";
import type { CreateDraftInput, UpdateDraftInput } from "@/contracts/donation-draft";

const EDITABLE_STATUSES = [DonationStatus.DRAFT, DonationStatus.SCREENED] as const;

export interface DraftFields {
  foodName?: string;
  description?: string | null;
  portions?: number;
  foodCategoryId?: number;
}

export interface DraftTx {
  getDonor(userId: string): Promise<{ role: Role; status: AccountStatus; donorType: DonorType | null } | null>;
  getCategory(code: string): Promise<{ id: number; isActive: boolean; allowedForIndividuals: boolean } | null>;
  getAllergens(codes: string[]): Promise<{ id: number; code: string }[]>;
  getDietaryTags(codes: string[]): Promise<{ id: number; code: string }[]>;
  /** The row is inserted without a status: the database default (DRAFT) applies. */
  insertDraft(row: {
    donorId: string;
    foodCategoryId: number;
    foodName: string;
    description: string | null;
    portions: number;
  }): Promise<{ id: string }>;
  getDraft(id: string): Promise<{ donorId: string; status: DonationStatus; foodCategoryId: number } | null>;
  updateDraft(id: string, donorId: string, allowedStatuses: readonly DonationStatus[], fields: DraftFields): Promise<boolean>;
  replaceAllergens(donationId: string, allergenIds: number[]): Promise<void>;
  replaceDietaryTags(donationId: string, tagIds: number[]): Promise<void>;
  softDeleteDraft(id: string, donorId: string, allowedStatuses: readonly DonationStatus[]): Promise<boolean>;
}

/** A row as the list query returns it: donorId and deletedAt exist for filtering only. */
export interface DraftListRow {
  id: string;
  donorId: string;
  foodName: string;
  description: string | null;
  portions: number;
  status: DonationStatus;
  foodCategoryCode: string;
  allergenCodes: string[];
  dietaryTagCodes: string[];
  deletedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

/** The documented list shape: an allow-list, built from the row, never the row itself. */
export interface DraftListItem {
  id: string;
  foodName: string;
  description: string | null;
  portions: number;
  status: DonationStatus;
  foodCategoryCode: string;
  allergenCodes: string[];
  dietaryTagCodes: string[];
  createdAt: Date;
  updatedAt: Date;
}

export interface DraftStore {
  /** Runs `work` atomically; rolls back if `work` throws. */
  transaction<T>(work: (tx: DraftTx) => Promise<T>): Promise<T>;
  /** Plain read outside any transaction: the rows the caller is allowed to see. */
  listDrafts(donorId: string): Promise<DraftListRow[]>;
}

/** The Drafts tab never shows more than one screenful. */
export const DRAFT_LIST_LIMIT = 50;
const LISTABLE_STATUSES: readonly DonationStatus[] = [DonationStatus.DRAFT, DonationStatus.SCREENED];

export type CreateDraftResult =
  | { ok: true; donationId: string }
  | {
      ok: false;
      error: "DONOR_NOT_ACTIVE" | "UNKNOWN_CATEGORY" | "CATEGORY_NOT_ALLOWED" | "UNKNOWN_ALLERGEN" | "UNKNOWN_DIETARY_TAG";
    };

export type UpdateDraftResult =
  | { ok: true }
  | {
      ok: false;
      error:
        | "NOT_FOUND"
        | "NOT_EDITABLE"
        | "CATEGORY_LOCKED"
        | "UNKNOWN_CATEGORY"
        | "CATEGORY_NOT_ALLOWED"
        | "UNKNOWN_ALLERGEN"
        | "UNKNOWN_DIETARY_TAG";
    };

export type DiscardDraftResult = { ok: true } | { ok: false; error: "NOT_FOUND" | "NOT_EDITABLE" };

/** Counts must match exactly: an unknown or inactive code never comes back. */
async function resolveCodes(
  tx: DraftTx,
  kind: "allergen" | "dietaryTag",
  codes: string[],
): Promise<{ ok: true; ids: number[] } | { ok: false; error: "UNKNOWN_ALLERGEN" | "UNKNOWN_DIETARY_TAG" }> {
  const rows = kind === "allergen" ? await tx.getAllergens(codes) : await tx.getDietaryTags(codes);
  if (rows.length !== codes.length) {
    return { ok: false, error: kind === "allergen" ? "UNKNOWN_ALLERGEN" : "UNKNOWN_DIETARY_TAG" };
  }
  return { ok: true, ids: rows.map((row) => row.id) };
}

function assertCategoryAllowed(
  donorType: DonorType | null,
  category: { id: number; isActive: boolean; allowedForIndividuals: boolean },
): { ok: true } | { ok: false; error: "UNKNOWN_CATEGORY" | "CATEGORY_NOT_ALLOWED" } {
  if (!category.isActive) return { ok: false, error: "UNKNOWN_CATEGORY" };
  if (donorType === "INDIVIDUAL" && !category.allowedForIndividuals) {
    return { ok: false, error: "CATEGORY_NOT_ALLOWED" };
  }
  return { ok: true };
}

export async function createDraft(
  deps: { store: DraftStore },
  args: { donorId: string; input: CreateDraftInput },
): Promise<CreateDraftResult> {
  const { donorId, input } = args;

  return deps.store.transaction(async (tx) => {
    const donor = await tx.getDonor(donorId);
    if (!donor || donor.role !== "DONOR" || donor.status !== "ACTIVE") {
      return { ok: false, error: "DONOR_NOT_ACTIVE" };
    }

    const category = await tx.getCategory(input.foodCategoryCode);
    if (!category) return { ok: false, error: "UNKNOWN_CATEGORY" };
    const categoryCheck = assertCategoryAllowed(donor.donorType, category);
    if (!categoryCheck.ok) return categoryCheck;

    let allergenIds: number[] = [];
    if (input.allergenCodes) {
      const resolved = await resolveCodes(tx, "allergen", input.allergenCodes);
      if (!resolved.ok) return resolved;
      allergenIds = resolved.ids;
    }
    let dietaryTagIds: number[] = [];
    if (input.dietaryTagCodes) {
      const resolved = await resolveCodes(tx, "dietaryTag", input.dietaryTagCodes);
      if (!resolved.ok) return resolved;
      dietaryTagIds = resolved.ids;
    }

    const { id: donationId } = await tx.insertDraft({
      donorId,
      foodCategoryId: category.id,
      foodName: input.foodName,
      description: input.description ?? null,
      portions: input.portions,
    });
    if (input.allergenCodes) await tx.replaceAllergens(donationId, allergenIds);
    if (input.dietaryTagCodes) await tx.replaceDietaryTags(donationId, dietaryTagIds);

    return { ok: true, donationId };
  });
}

export async function updateDraft(
  deps: { store: DraftStore },
  args: { donorId: string; donationId: string; input: UpdateDraftInput },
): Promise<UpdateDraftResult> {
  const { donorId, donationId, input } = args;

  return deps.store.transaction(async (tx) => {
    const draft = await tx.getDraft(donationId);
    if (!draft || draft.donorId !== donorId) return { ok: false, error: "NOT_FOUND" };
    if (draft.status !== DonationStatus.DRAFT && draft.status !== DonationStatus.SCREENED) {
      return { ok: false, error: "NOT_EDITABLE" };
    }

    // Resolve every code before the first write so a refusal writes nothing.
    let allergenIds: number[] | null = null;
    if (input.allergenCodes) {
      const resolved = await resolveCodes(tx, "allergen", input.allergenCodes);
      if (!resolved.ok) return resolved;
      allergenIds = resolved.ids;
    }
    let dietaryTagIds: number[] | null = null;
    if (input.dietaryTagCodes) {
      const resolved = await resolveCodes(tx, "dietaryTag", input.dietaryTagCodes);
      if (!resolved.ok) return resolved;
      dietaryTagIds = resolved.ids;
    }

    const fields: DraftFields = {};
    if (input.foodCategoryCode !== undefined) {
      const category = await tx.getCategory(input.foodCategoryCode);
      if (!category) return { ok: false, error: "UNKNOWN_CATEGORY" };
      if (category.id !== draft.foodCategoryId) {
        // The same category as the current one is not a change, even in SCREENED.
        if (draft.status !== DonationStatus.DRAFT) return { ok: false, error: "CATEGORY_LOCKED" };
        const donor = await tx.getDonor(donorId);
        if (!donor) return { ok: false, error: "NOT_FOUND" };
        const categoryCheck = assertCategoryAllowed(donor.donorType, category);
        if (!categoryCheck.ok) return categoryCheck;
        fields.foodCategoryId = category.id;
      }
    }
    if (input.foodName !== undefined) fields.foodName = input.foodName;
    if (input.description !== undefined) fields.description = input.description;
    if (input.portions !== undefined) fields.portions = input.portions;

    if (Object.keys(fields).length > 0) {
      const moved = await tx.updateDraft(donationId, donorId, EDITABLE_STATUSES, fields);
      if (!moved) return { ok: false, error: "NOT_EDITABLE" };
    }
    if (allergenIds !== null) await tx.replaceAllergens(donationId, allergenIds);
    if (dietaryTagIds !== null) await tx.replaceDietaryTags(donationId, dietaryTagIds);

    return { ok: true };
  });
}

export async function discardDraft(
  deps: { store: DraftStore },
  args: { donorId: string; donationId: string },
): Promise<DiscardDraftResult> {
  const { donorId, donationId } = args;

  return deps.store.transaction(async (tx) => {
    const draft = await tx.getDraft(donationId);
    if (!draft || draft.donorId !== donorId) return { ok: false, error: "NOT_FOUND" };
    if (draft.status !== DonationStatus.DRAFT && draft.status !== DonationStatus.SCREENED) {
      return { ok: false, error: "NOT_EDITABLE" };
    }

    const discarded = await tx.softDeleteDraft(donationId, donorId, EDITABLE_STATUSES);
    if (!discarded) return { ok: false, error: "NOT_EDITABLE" };
    return { ok: true };
  });
}

/**
 * The donor's live drafts (DRAFT or SCREENED, not discarded), newest updated_at
 * first, at most DRAFT_LIST_LIMIT rows. Every filter is re-checked here so a
 * sloppy store still cannot leak another donor's rows.
 */
export async function listDrafts(
  deps: { store: DraftStore },
  args: { donorId: string },
): Promise<DraftListItem[]> {
  const rows = await deps.store.listDrafts(args.donorId);

  return rows
    .filter(
      (row) =>
        row.donorId === args.donorId &&
        row.deletedAt === null &&
        LISTABLE_STATUSES.includes(row.status),
    )
    .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime())
    .slice(0, DRAFT_LIST_LIMIT)
    .map((row) => ({
      id: row.id,
      foodName: row.foodName,
      description: row.description,
      portions: row.portions,
      status: row.status,
      foodCategoryCode: row.foodCategoryCode,
      allergenCodes: [...row.allergenCodes],
      dietaryTagCodes: [...row.dietaryTagCodes],
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    }));
}
