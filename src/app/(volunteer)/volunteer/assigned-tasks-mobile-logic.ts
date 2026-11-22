import type { TaskItem } from "./assigned-tasks-logic";

const WEEKDAYS = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
] as const;

const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
] as const;

/** "Wednesday, 4 November" from the local calendar; no Intl so tests are time-zone independent. */
export function mobileDateLine(now: Date): string {
  return `${WEEKDAYS[now.getDay()]}, ${now.getDate()} ${MONTHS[now.getMonth()]}`;
}

/** "1 portion" or "N portions". */
export function portionsText(n: number): string {
  return `${n} ${n === 1 ? "portion" : "portions"}`;
}

/**
 * The small amber label on a mobile card. An ASSIGNED task counts down to the
 * end of its pickup window; PICKED_UP and DELIVERED have fixed labels.
 */
export function cardLabel(item: TaskItem, now: Date): string {
  if (item.status === "PICKED_UP") return "PICKED UP";
  if (item.status === "DELIVERED") return "DELIVERED · REPORT INCOMPLETE";
  if (item.pickupEnd === null) return "PICKUP";

  const end = new Date(item.pickupEnd);
  if (Number.isNaN(end.getTime())) return "PICKUP";

  const remainingMs = end.getTime() - now.getTime();
  if (remainingMs <= 0) return "PICKUP · WINDOW ENDED";

  const totalMinutes = Math.floor(remainingMs / 60_000);
  if (totalMinutes < 1) return "PICKUP · LESS THAN 1M";

  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours >= 1) return `PICKUP · ENDS IN ${hours}H ${minutes}M`;
  return `PICKUP · ENDS IN ${minutes}M`;
}
