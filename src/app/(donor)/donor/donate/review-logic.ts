import type { ChecklistView } from "./checklist-logic";
import type { PickupDetails } from "./details-logic";

type Moment = { day: string; time: string; period: string; clock: string };

/** Parts of an instant in `timeZone` (the browser's own when omitted); null for an unreadable date. */
function momentOf(iso: string, timeZone?: string): Moment | null {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).formatToParts(date);
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((entry) => entry.type === type)?.value ?? "";
  const time = `${part("hour")}:${part("minute")}`;
  const period = part("dayPeriod");
  return {
    day: `${part("day")} ${part("month")} ${part("year")}`,
    time,
    period,
    clock: `${time} ${period}`,
  };
}

/** "4 Nov 2026, 9:00 AM", or null when the date cannot be read. */
export function formatDateTime(iso: string, timeZone?: string): string | null {
  const moment = momentOf(iso, timeZone);
  return moment === null ? null : `${moment.day}, ${moment.clock}`;
}

/**
 * One line for the pickup window: "4 Nov 2026 · 3:00–5:00 PM" on one day,
 * both full dates when it crosses midnight. null when either end is unreadable.
 */
export function formatWindow(startIso: string, endIso: string, timeZone?: string): string | null {
  const start = momentOf(startIso, timeZone);
  const end = momentOf(endIso, timeZone);
  if (start === null || end === null) return null;
  if (start.day !== end.day) return `${start.day}, ${start.clock} – ${end.day}, ${end.clock}`;
  if (start.period === end.period) return `${start.day} · ${start.time}–${end.clock}`;
  return `${start.day} · ${start.clock}–${end.clock}`;
}

/** "24 portions · Bakery · Establishment donor"; one portion is singular. */
export function summaryLine(input: {
  portions: number;
  categoryName: string;
  donorLabel: string;
}): string {
  const noun = input.portions === 1 ? "portion" : "portions";
  return `${input.portions} ${noun} · ${input.categoryName} · ${input.donorLabel}`;
}

/**
 * The "Photo & safety" lines after the photo line. The screening line is always
 * there because only a SCREENED draft reaches review; the others come from the checklist.
 */
export function safetyLines(input: {
  checklist: ChecklistView;
  requiresPreparedTime: boolean;
  allergenNames: string[];
  timeZone?: string;
}): string[] {
  const { checklist, requiresPreparedTime, allergenNames, timeZone } = input;
  const lines = ["Visual screening: Passed"];
  if (requiresPreparedTime && checklist.preparedAt !== null) {
    const prepared = formatDateTime(checklist.preparedAt, timeZone);
    if (prepared !== null) lines.push(`Prepared: ${prepared}`);
  }
  if (checklist.consumeByAt !== null) {
    const consumeBy = formatDateTime(checklist.consumeByAt, timeZone);
    if (consumeBy !== null) lines.push(`Consume by: ${consumeBy}`);
  }
  lines.push(
    allergenNames.length === 0
      ? "Allergens: None declared"
      : `Allergens: ${allergenNames.join(", ")}`,
  );
  if (checklist.packagingIntact === true && checklist.notCustomerPlateLeftovers === true) {
    lines.push("Packaging clean · No opened food or leftovers");
  }
  return lines;
}

/** The "Pickup details" lines: window, street / barangay, city. An unreadable window is left out. */
export function pickupLines(pickup: PickupDetails, timeZone?: string): string[] {
  const lines: string[] = [];
  const window = formatWindow(pickup.pickupStart, pickup.pickupEnd, timeZone);
  if (window !== null) lines.push(window);
  const { address } = pickup;
  const street = [address.streetLine1, address.streetLine2, address.barangay]
    .map((part) => (part ?? "").trim())
    .filter((part) => part !== "")
    .join(", ");
  if (street !== "") lines.push(street);
  if (address.city.trim() !== "") lines.push(address.city.trim());
  return lines;
}
