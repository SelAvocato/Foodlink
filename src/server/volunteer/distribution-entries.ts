import { DonationStatus } from "@/contracts/enums";
import {
  progressFromTotals,
  type CreateDistributionEntryInput,
  type DistributionEntryMutationResponse,
  type DistributionEntryView,
  type DistributionProgress,
  type GroupServed,
  type UnusableReason,
  type UpdateDistributionEntryInput,
} from "@/contracts/volunteer-distribution";

export type DistributionDonation = {
  id: string;
  status: DonationStatus;
  deletedAt: Date | null;
  portions: number;
};

export type DistributionEntryWrite = {
  donationId: string;
  recordedByUserId: string;
  date: string;
  place: string;
  groupServed: GroupServed;
  peopleServed: number;
  portionsDistributed: number;
  portionsUnusable: number;
  unusableReason: UnusableReason | null;
  notes: string | null;
};

export type DistributionEntryUpdate = DistributionEntryWrite & { entryId: string };

export type DistributionTotals = {
  distributed: number;
  unusable: number;
};

export type DistributionEntryTx = {
  getDonationLocked(id: string): Promise<DistributionDonation | null>;
  findCurrentVolunteerId(donationId: string): Promise<string | null>;
  findEntry(donationId: string, entryId: string): Promise<DistributionEntryView | null>;
  insertEntry(input: DistributionEntryWrite): Promise<DistributionEntryView>;
  updateEntry(input: DistributionEntryUpdate): Promise<DistributionEntryView | null>;
  deleteEntry(donationId: string, entryId: string): Promise<boolean>;
  getTotals(donationId: string): Promise<DistributionTotals>;
};

export interface DistributionEntryStore {
  readDonation(id: string): Promise<DistributionDonation | null>;
  findCurrentVolunteerId(donationId: string): Promise<string | null>;
  transaction<T>(work: (tx: DistributionEntryTx) => Promise<T>): Promise<T>;
}

export type DistributionEntryError =
  | "NOT_FOUND"
  | "INVALID_STATE"
  | "INVALID_ENTRY"
  | "PORTIONS_EXCEEDED";

export type DistributionEntryResult =
  | ({ ok: true } & DistributionEntryMutationResponse)
  | { ok: false; error: DistributionEntryError };

export type DistributionDeleteResult =
  | { ok: true; entry: DistributionEntryView; progress: DistributionProgress }
  | { ok: false; error: DistributionEntryError };

type NormalizedEntry = {
  date: string;
  place: string;
  groupServed: GroupServed;
  peopleServed: number;
  portionsDistributed: number;
  portionsUnusable: number;
  unusableReason: UnusableReason | null;
  notes: string | null;
};

function normalize(input: {
  date: string;
  place: string;
  groupServed: GroupServed;
  peopleServed: number;
  portionsDistributed: number;
  portionsUnusable: number;
  unusableReason?: UnusableReason;
  notes?: string;
}): NormalizedEntry {
  return {
    date: input.date,
    place: input.place,
    groupServed: input.groupServed,
    peopleServed: input.peopleServed,
    portionsDistributed: input.portionsDistributed,
    portionsUnusable: input.portionsUnusable,
    unusableReason: input.unusableReason ?? null,
    notes: input.notes ?? null,
  };
}

function mergeEntry(
  existing: DistributionEntryView,
  input: UpdateDistributionEntryInput,
): NormalizedEntry {
  const portionsUnusable = input.portionsUnusable ?? existing.portionsUnusable;
  return normalize({
    date: input.date ?? existing.date,
    place: input.place ?? existing.place,
    groupServed: input.groupServed ?? existing.groupServed,
    peopleServed: input.peopleServed ?? existing.peopleServed,
    portionsDistributed: input.portionsDistributed ?? existing.portionsDistributed,
    portionsUnusable,
    unusableReason:
      portionsUnusable === 0
        ? input.unusableReason
        : (input.unusableReason ?? existing.unusableReason ?? undefined),
    notes: input.notes ?? existing.notes ?? undefined,
  });
}

function isValidEntry(entry: NormalizedEntry): boolean {
  if (entry.peopleServed < 1) return false;
  if (entry.portionsDistributed < 1) return false;
  if (entry.portionsUnusable < 0) return false;
  if (entry.portionsUnusable > 0 && !entry.unusableReason) return false;
  if (entry.portionsUnusable === 0 && entry.unusableReason) return false;
  if (entry.unusableReason === "other" && !entry.notes) return false;
  return true;
}

async function authorize(
  deps: { store: DistributionEntryStore },
  volunteerId: string,
  donationId: string,
): Promise<
  | { ok: true; donation: DistributionDonation }
  | { ok: false; error: DistributionEntryError }
> {
  const donation = await deps.store.readDonation(donationId);
  if (!donation || donation.deletedAt !== null) return { ok: false, error: "NOT_FOUND" };
  if ((await deps.store.findCurrentVolunteerId(donationId)) !== volunteerId) {
    return { ok: false, error: "NOT_FOUND" };
  }
  if (donation.status !== DonationStatus.DELIVERED) {
    return { ok: false, error: "INVALID_STATE" };
  }
  return { ok: true, donation };
}

async function authorizeLocked(
  tx: DistributionEntryTx,
  volunteerId: string,
  donationId: string,
): Promise<
  | { ok: true; donation: DistributionDonation }
  | { ok: false; error: DistributionEntryError }
> {
  const donation = await tx.getDonationLocked(donationId);
  if (!donation || donation.deletedAt !== null) return { ok: false, error: "NOT_FOUND" };
  if ((await tx.findCurrentVolunteerId(donationId)) !== volunteerId) {
    return { ok: false, error: "NOT_FOUND" };
  }
  if (donation.status !== DonationStatus.DELIVERED) {
    return { ok: false, error: "INVALID_STATE" };
  }
  return { ok: true, donation };
}

function progress(
  donation: DistributionDonation,
  totals: DistributionTotals,
): DistributionProgress {
  return progressFromTotals(donation.portions, totals.distributed, totals.unusable);
}

export async function createDistributionEntry(
  deps: { store: DistributionEntryStore },
  args: { volunteerId: string; donationId: string; input: CreateDistributionEntryInput },
): Promise<DistributionEntryResult> {
  const allowed = await authorize(deps, args.volunteerId, args.donationId);
  if (!allowed.ok) return allowed;

  const entry = normalize(args.input);
  if (!isValidEntry(entry)) return { ok: false, error: "INVALID_ENTRY" };

  return deps.store.transaction(async (tx) => {
    const locked = await authorizeLocked(tx, args.volunteerId, args.donationId);
    if (!locked.ok) return locked;

    const before = await tx.getTotals(args.donationId);
    if (
      before.distributed + before.unusable + entry.portionsDistributed + entry.portionsUnusable >
      locked.donation.portions
    ) {
      return { ok: false, error: "PORTIONS_EXCEEDED" };
    }

    const inserted = await tx.insertEntry({
      donationId: args.donationId,
      recordedByUserId: args.volunteerId,
      ...entry,
    });
    const after = await tx.getTotals(args.donationId);
    return {
      ok: true,
      entry: inserted,
      progress: progress(locked.donation, after),
    };
  });
}

export async function updateDistributionEntry(
  deps: { store: DistributionEntryStore },
  args: {
    volunteerId: string;
    donationId: string;
    entryId: string;
    input: UpdateDistributionEntryInput;
  },
): Promise<DistributionEntryResult> {
  const allowed = await authorize(deps, args.volunteerId, args.donationId);
  if (!allowed.ok) return allowed;

  return deps.store.transaction(async (tx) => {
    const locked = await authorizeLocked(tx, args.volunteerId, args.donationId);
    if (!locked.ok) return locked;

    const existing = await tx.findEntry(args.donationId, args.entryId);
    if (!existing) return { ok: false, error: "NOT_FOUND" };

    const merged = mergeEntry(existing, args.input);
    if (!isValidEntry(merged)) return { ok: false, error: "INVALID_ENTRY" };

    const before = await tx.getTotals(args.donationId);
    const nextTotal =
      before.distributed -
      existing.portionsDistributed +
      merged.portionsDistributed +
      before.unusable -
      existing.portionsUnusable +
      merged.portionsUnusable;
    if (nextTotal > locked.donation.portions) {
      return { ok: false, error: "PORTIONS_EXCEEDED" };
    }

    const updated = await tx.updateEntry({
      entryId: args.entryId,
      donationId: args.donationId,
      recordedByUserId: args.volunteerId,
      ...merged,
    });
    if (!updated) return { ok: false, error: "NOT_FOUND" };

    const after = await tx.getTotals(args.donationId);
    return {
      ok: true,
      entry: updated,
      progress: progress(locked.donation, after),
    };
  });
}

export async function deleteDistributionEntry(
  deps: { store: DistributionEntryStore },
  args: { volunteerId: string; donationId: string; entryId: string },
): Promise<DistributionDeleteResult> {
  const allowed = await authorize(deps, args.volunteerId, args.donationId);
  if (!allowed.ok) return allowed;

  return deps.store.transaction(async (tx) => {
    const locked = await authorizeLocked(tx, args.volunteerId, args.donationId);
    if (!locked.ok) return locked;

    const existing = await tx.findEntry(args.donationId, args.entryId);
    if (!existing) return { ok: false, error: "NOT_FOUND" };

    const deleted = await tx.deleteEntry(args.donationId, args.entryId);
    if (!deleted) return { ok: false, error: "NOT_FOUND" };

    const after = await tx.getTotals(args.donationId);
    return {
      ok: true,
      entry: existing,
      progress: progress(locked.donation, after),
    };
  });
}
