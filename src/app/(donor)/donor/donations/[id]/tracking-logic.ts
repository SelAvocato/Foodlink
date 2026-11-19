import { z } from "zod";
import { DonationStatus, StorageCondition } from "@/contracts/enums";
import type { TimelineStep } from "@/components/shared/timeline";
import type { Tone } from "@/components/shared/tones";
import { formatDateTime } from "@/app/(donor)/donor/donate/review-logic";
import { statusLabel } from "@/app/(donor)/donor/donations/donations-logic";

/**
 * fn_donation_report's jsonb as the donor detail route returns it (snake_case).
 * Only the keys this screen reads are validated; everything else stays loose because
 * the function keeps adding keys and the route passes them through unchanged. Every
 * key that can be null in SQL is nullable here.
 */
const timelineEntrySchema = z.looseObject({
  type: z.string().nullable(),
  from: z.string().nullable(),
  to: z.string().nullable(),
  at: z.string().nullable(),
});

const volunteerSchema = z.looseObject({
  first_name: z.string().nullable(),
  phone: z.string().nullable(),
});

const pickupSchema = z.looseObject({
  pickup_start: z.string().nullable(),
  pickup_end: z.string().nullable(),
});

const safetyChecklistSchema = z.looseObject({
  prepared_at: z.string().nullable(),
  consume_by_at: z.string().nullable(),
  storage_condition: z.string().nullable(),
  storage_temperature_c: z.number().nullable(),
  packaging_intact: z.boolean().nullable(),
  completed_at: z.string().nullable(),
});

const exitSchema = z.looseObject({
  reason: z.string().nullable(),
  occurred_at: z.string().nullable(),
});

const reportSchema = z.looseObject({
  donation: z.looseObject({
    status: z.string(),
    food_name: z.string().nullable(),
    category: z.string().nullable(),
    portions: z.number().nullable(),
    closed_at: z.string().nullable(),
  }),
  volunteer: volunteerSchema.nullable(),
  pickup: pickupSchema.nullable(),
  safety_checklist: safetyChecklistSchema.nullable(),
  allergens: z.array(z.string()).nullable(),
  exit: exitSchema.nullable(),
  distribution: z.looseObject({
    entries: z.array(z.unknown()).nullable(),
  }),
  impact: z.looseObject({
    portions_donated: z.number().nullable(),
    portions_distributed: z.number().nullable(),
  }),
  timeline: z.array(timelineEntrySchema).nullable(),
});

const bodySchema = z.looseObject({
  report: reportSchema.nullable(),
});

export type TrackingReport = z.infer<typeof reportSchema>;

/** The report inside the route's `{ report }` body, or null when the body is malformed. */
export function parseTrackingResponse(body: unknown): TrackingReport | null {
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) return null;
  return parsed.data.report;
}

/** "#9FC03951": the first 8 characters of the donation id, upper case. */
export function shortCode(id: string): string {
  return `#${id.slice(0, 8).toUpperCase()}`;
}

/** The earliest transition into `status`, ignoring reassignment rows. */
function findTransition(
  timeline: TrackingReport["timeline"],
  status: string,
): { at: string | null } | null {
  let found: { at: string | null } | null = null;
  let earliest = Number.POSITIVE_INFINITY;

  for (const entry of timeline ?? []) {
    if (entry.type !== "TRANSITION" || entry.to !== status) continue;
    const time = entry.at === null ? Number.NaN : Date.parse(entry.at);
    if (Number.isNaN(time)) {
      // An unreadable time still marks the step done; a readable one still wins.
      if (found === null) found = { at: entry.at };
      continue;
    }
    if (time < earliest) {
      earliest = time;
      found = { at: entry.at };
    }
  }

  return found;
}

/** "<time> · <suffix>", dropping whichever part is missing. */
function detailWithTime(
  at: string | null | undefined,
  timeZone: string | undefined,
  suffix?: string | null,
): string {
  const time = at === null || at === undefined ? null : formatDateTime(at, timeZone);
  if (time === null) return suffix ?? "";
  return suffix === null || suffix === undefined ? time : `${time} · ${suffix}`;
}

const JOURNEY: { title: string; status: DonationStatus }[] = [
  { title: "Posted", status: DonationStatus.POSTED },
  { title: "Accepted", status: DonationStatus.ACCEPTED },
  { title: "Volunteer assigned", status: DonationStatus.ASSIGNED },
  { title: "Picked up", status: DonationStatus.PICKED_UP },
  { title: "Delivered", status: DonationStatus.DELIVERED },
];

const PENDING_PICKUP = "Pending · Pickup photo and timestamp appear here";
const PENDING_HANDOVER = "Pending · Handover photo and timestamp appear here";
const PENDING_DISTRIBUTION = "Pending · Live distribution entries appear here";

function distributedDetail(report: TrackingReport): string {
  const count = report.distribution.entries?.length ?? 0;
  const distributed = report.impact.portions_distributed ?? 0;
  const donated = report.impact.portions_donated ?? 0;
  const entryWord = count === 1 ? "entry" : "entries";
  const portionWord = donated === 1 ? "portion" : "portions";
  return `${count} ${entryWord} · ${distributed} of ${donated} ${portionWord} distributed`;
}

/**
 * The six-step journey, plus one final step for an exit or an expired donation.
 * A step is done only when the matching TRANSITION entry exists; the earliest one
 * supplies the time. Distributed is done when distribution entries exist.
 */
export function buildJourney(report: TrackingReport, timeZone?: string): TimelineStep[] {
  const volunteerName = report.volunteer?.first_name?.trim() ?? "";
  const steps: TimelineStep[] = [];

  for (const step of JOURNEY) {
    const transition = findTransition(report.timeline, step.status);
    if (transition === null) {
      const detail =
        step.status === DonationStatus.PICKED_UP
          ? PENDING_PICKUP
          : step.status === DonationStatus.DELIVERED
            ? PENDING_HANDOVER
            : "Pending";
      steps.push({ title: step.title, detail, done: false });
      continue;
    }

    let suffix: string | null = null;
    if (step.status === DonationStatus.POSTED) {
      suffix = report.safety_checklist?.completed_at ? "Safety checklist confirmed" : null;
    } else if (step.status === DonationStatus.ACCEPTED) {
      suffix = "Organization accepted";
    } else if (step.status === DonationStatus.ASSIGNED) {
      suffix = volunteerName === "" ? null : `${volunteerName} will collect your food`;
    }

    steps.push({
      title: step.title,
      detail: detailWithTime(transition.at, timeZone, suffix),
      done: true,
    });
  }

  const entries = report.distribution.entries?.length ?? 0;
  steps.push(
    entries > 0
      ? { title: "Distributed", detail: distributedDetail(report), done: true }
      : { title: "Distributed", detail: PENDING_DISTRIBUTION, done: false },
  );

  const status = report.donation.status;
  if (report.exit !== null) {
    const reason = report.exit.reason?.trim() ? report.exit.reason : null;
    steps.push({
      title: statusLabel(status),
      detail: detailWithTime(report.exit.occurred_at, timeZone, reason),
      done: true,
    });
  } else if (status === DonationStatus.EXPIRED) {
    steps.push({
      title: statusLabel(status),
      detail: detailWithTime(report.donation.closed_at, timeZone, "Pickup window passed"),
      done: true,
    });
  }

  // After an exit only what really happened is shown, never "Pending" steps.
  if (report.exit !== null || status === DonationStatus.EXPIRED) {
    return steps.filter((step) => step.done);
  }
  return steps;
}

const SUCCESS_STATUSES: readonly string[] = [DonationStatus.DELIVERED, DonationStatus.CLOSED];
const ERROR_STATUSES: readonly string[] = [
  DonationStatus.REJECTED,
  DonationStatus.DECLINED,
  DonationStatus.REJECTED_AT_PICKUP,
  DonationStatus.CANCELLED,
  DonationStatus.EXPIRED,
];
const WARNING_STATUSES: readonly string[] = [
  DonationStatus.POSTED,
  DonationStatus.ACCEPTED,
  DonationStatus.ASSIGNED,
  DonationStatus.PICKED_UP,
];

/** Status colour tone; unknown codes are neutral rather than a guess. */
export function statusTone(status: string): Tone {
  if (SUCCESS_STATUSES.includes(status)) return "success";
  if (ERROR_STATUSES.includes(status)) return "error";
  if (WARNING_STATUSES.includes(status)) return "warning";
  return "neutral";
}

export type TrackingActions = {
  showQr: boolean;
  canCancel: boolean;
  cancelUnavailableNote: boolean;
};

/** Which tracking actions the current status offers. */
export function trackingActions(status: string): TrackingActions {
  return {
    showQr:
      status === DonationStatus.POSTED ||
      status === DonationStatus.ACCEPTED ||
      status === DonationStatus.ASSIGNED,
    canCancel: status === DonationStatus.POSTED || status === DonationStatus.ACCEPTED,
    cancelUnavailableNote:
      status === DonationStatus.ASSIGNED ||
      status === DonationStatus.PICKED_UP ||
      status === DonationStatus.DELIVERED,
  };
}

/** "Ends in 2h 15m"; null once the window ended, or when the end is missing/unreadable. */
export function pickupCountdown(
  pickupEnd: string | null,
  now: Date | string,
): string | null {
  if (pickupEnd === null) return null;
  const end = Date.parse(pickupEnd);
  const current = now instanceof Date ? now.getTime() : Date.parse(now);
  if (Number.isNaN(end) || Number.isNaN(current)) return null;

  const diff = end - current;
  if (diff <= 0) return null;

  const totalMinutes = Math.ceil(diff / 60_000);
  const days = Math.floor(totalMinutes / 1440);
  const hours = Math.floor((totalMinutes % 1440) / 60);
  const minutes = totalMinutes % 60;

  if (days > 0) return `Ends in ${days}d${hours > 0 ? ` ${hours}h` : ""}`;
  if (hours > 0) return `Ends in ${hours}h${minutes > 0 ? ` ${minutes}m` : ""}`;
  return `Ends in ${minutes}m`;
}

/** The volunteer block as lines: name, then the phone or the privacy note. */
export function volunteerText(volunteer: TrackingReport["volunteer"]): string[] {
  if (volunteer === null) return ["No volunteer assigned yet."];

  const name = volunteer.first_name?.trim() ?? "";
  const lines = name === "" ? [] : [name];
  lines.push(
    volunteer.phone === null
      ? "Phone hidden until pickup day, within the pickup window."
      : volunteer.phone,
  );
  return lines;
}

const STORAGE_LABELS: Record<StorageCondition, string> = {
  [StorageCondition.ROOM_TEMPERATURE]: "Room temperature",
  [StorageCondition.HOT_HELD]: "Hot-held",
  [StorageCondition.REFRIGERATED]: "Refrigerated",
  [StorageCondition.FROZEN]: "Frozen",
};

/** A known condition reads as a label; an unknown value is shown exactly as it came. */
function storageLabel(value: string): string {
  return (STORAGE_LABELS as Record<string, string>)[value] ?? value;
}

/** The food and safety lines: portions and category, then the checklist answers. */
export function foodSafetyLines(report: TrackingReport, timeZone?: string): string[] {
  const lines: string[] = [];

  const portions = report.donation.portions;
  const category = report.donation.category?.trim() ?? "";
  const summary: string[] = [];
  if (portions !== null) {
    summary.push(`${portions} ${portions === 1 ? "portion" : "portions"}`);
  }
  if (category !== "") summary.push(category);
  if (summary.length > 0) lines.push(summary.join(" · "));

  const checklist = report.safety_checklist;
  if (checklist !== null) {
    if (checklist.prepared_at !== null) {
      const prepared = formatDateTime(checklist.prepared_at, timeZone);
      if (prepared !== null) lines.push(`Prepared: ${prepared}`);
    }
    if (checklist.consume_by_at !== null) {
      const consumeBy = formatDateTime(checklist.consume_by_at, timeZone);
      if (consumeBy !== null) lines.push(`Consume by: ${consumeBy}`);
    }
    if (checklist.storage_condition !== null) {
      const condition = storageLabel(checklist.storage_condition);
      const temperature = checklist.storage_temperature_c;
      lines.push(
        temperature === null
          ? `Storage: ${condition}`
          : `Storage: ${condition} · ${temperature}°C`,
      );
    }
  }

  const allergens = (report.allergens ?? []).filter((name) => name.trim() !== "");
  lines.push(
    allergens.length === 0 ? "Allergens: None declared" : `Allergens: ${allergens.join(", ")}`,
  );

  if (checklist?.packaging_intact === true) lines.push("Packaging clean and sealed");
  if (checklist?.packaging_intact === false) lines.push("Packaging not clean or sealed");

  return lines;
}
