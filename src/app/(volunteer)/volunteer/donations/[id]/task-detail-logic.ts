import { formatWindow } from "@/app/(donor)/donor/donate/review-logic";
import {
  NOT_SET,
  STATUS_LABELS,
  loadFailure,
  taskCode,
  type LoadFailure,
} from "@/app/(volunteer)/volunteer/assigned-tasks-logic";
import { STORAGE_LABELS, type TaskDetail } from "./inspection/pickup-inspection-logic";
import { dropoffPagePath } from "./dropoff/dropoff-logic";
import type { VolunteerChecklistResponse } from "@/contracts/volunteer-checklist";

/** A date the checklist never saved reads this instead of a time. */
const NOT_RECORDED = "not recorded";

/** Everything the p45 body shows from the task, already formatted for display. */
export type TaskView = {
  title: string;
  /** "#FL-0268 · Assigned" */
  subtitle: string;
  /** "40 portions · Cooked meal" */
  summary: string;
  donorName: string;
  donorPhone: string | null;
  address: string;
  window: string;
  /** Only an ASSIGNED task has a pickup QR to scan. */
  canScan: boolean;
  /** Only a PICKED_UP task can be dropped off. */
  dropOffHref: string | null;
};

export function buildTaskView(task: TaskDetail, timeZone?: string): TaskView {
  const noun = task.portions === 1 ? "portion" : "portions";
  const window =
    task.pickupStart !== null && task.pickupEnd !== null
      ? formatWindow(task.pickupStart, task.pickupEnd, timeZone)
      : null;
  return {
    title: task.foodName,
    subtitle: `${taskCode(task.shortCode)} · ${STATUS_LABELS[task.status]}`,
    summary: `${task.portions} ${noun} · ${task.category}`,
    donorName: task.donorName,
    donorPhone: task.donorPhone,
    address: task.pickupAddress ?? NOT_SET,
    window: window ?? NOT_SET,
    canScan: task.status === "ASSIGNED",
    dropOffHref:
      task.status === "PICKED_UP" ? dropoffPagePath(task.donationId) : null,
  };
}

type DateParts = {
  year: string;
  month: string;
  day: string;
  hour: string;
  minute: string;
  dayPeriod: string;
};

/**
 * Calendar and clock parts of an instant in `timeZone` (the runtime's own when
 * omitted). Parts, not format(), so the AM/PM separator is always a plain space.
 */
function partsOf(date: Date, timeZone?: string): DateParts | null {
  if (Number.isNaN(date.getTime())) return null;
  const formatted = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).formatToParts(date);
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    formatted.find((entry) => entry.type === type)?.value ?? "";
  return {
    year: part("year"),
    month: part("month"),
    day: part("day"),
    hour: part("hour"),
    minute: part("minute"),
    dayPeriod: part("dayPeriod"),
  };
}

function readDate(iso: string | null): Date | null {
  if (iso === null) return null;
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? null : date;
}

/**
 * "9:00 AM" when the date falls on now's calendar day in that zone, otherwise
 * "Nov 21, 9:00 AM"; a missing or unreadable date reads "not recorded".
 */
function stamp(iso: string | null, now: Date, timeZone?: string): string {
  const date = readDate(iso);
  if (date === null) return NOT_RECORDED;
  const dateParts = partsOf(date, timeZone);
  const nowParts = partsOf(now, timeZone);
  if (dateParts === null || nowParts === null) return NOT_RECORDED;
  const clock = `${dateParts.hour}:${dateParts.minute} ${dateParts.dayPeriod}`;
  const sameDay =
    dateParts.year === nowParts.year &&
    dateParts.month === nowParts.month &&
    dateParts.day === nowParts.day;
  return sameDay ? clock : `${dateParts.month} ${dateParts.day}, ${clock}`;
}

function storageLine(checklist: VolunteerChecklistResponse): string[] {
  const parts: string[] = [];
  if (checklist.storageCondition === null) {
    parts.push("Storage not recorded");
  } else {
    parts.push(STORAGE_LABELS[checklist.storageCondition]);
  }
  if (checklist.storageTemperatureC !== null) parts.push(`${checklist.storageTemperatureC}°C`);
  parts.push(
    checklist.allergens.length > 0
      ? checklist.allergens.join(", ") + " declared"
      : "No allergens declared",
  );
  return parts;
}

function packagingLine(checklist: VolunteerChecklistResponse): string {
  const packaging =
    checklist.packagingIntact === null
      ? "Packaging not recorded"
      : checklist.packagingIntact
        ? "Packaging clean"
        : "Packaging not intact";
  const leftovers =
    checklist.notCustomerPlateLeftovers === null
      ? "Not recorded"
      : checklist.notCustomerPlateLeftovers
        ? "Not opened or leftover"
        : "Opened or leftover";
  return `${packaging} · ${leftovers}`;
}

/**
 * The three "Donor safety details" lines. Every branch of the checklist is
 * written, including the nulls, so the line never silently disappears;
 * allergensConfirmed stays hidden because the allergen names say it already.
 */
export function buildSafetyLines(
  checklist: VolunteerChecklistResponse,
  now: Date,
  timeZone?: string,
): string[] {
  const prepared = `Prepared ${stamp(checklist.preparedAt, now, timeZone)}`;
  const consumeBy = `Consume by ${stamp(checklist.consumeByAt, now, timeZone)}`;
  return [
    `${prepared} · ${consumeBy}`,
    storageLine(checklist).join(" · "),
    packagingLine(checklist),
  ];
}

/** The task answer route for one donation; the id is encoded, never a token. */
export function taskDetailPath(donationId: string): string {
  return `/api/volunteer/donations/${encodeURIComponent(donationId)}`;
}

/** The donor checklist answer route, under the task route. */
export function checklistPath(donationId: string): string {
  return `${taskDetailPath(donationId)}/checklist`;
}

/** Why the task could not be shown: 404 first, then the shared session and generic failures. */
export type TaskLoadFailure = "notFound" | LoadFailure;

/** 404 (unknown, malformed id or not this volunteer's task) is not a session or network problem. */
export function taskLoadFailure(status: number): TaskLoadFailure {
  if (status === 404) return "notFound";
  return loadFailure(status);
}
