/** Sealed packaged food and sealed beverages must have more than this many months left. */
export const MIN_SHELF_LIFE_MONTHS = 5;

export const SHELF_LIFE_MESSAGE = "The consume-by date must be more than 5 months from today.";

const MIN_SHELF_LIFE_CATEGORY_CODES: ReadonlySet<string> = new Set(["PACKAGED_FOOD", "BEVERAGES"]);

export function requiresMinShelfLife(categoryCode: string): boolean {
  return MIN_SHELF_LIFE_CATEGORY_CODES.has(categoryCode);
}

/** `from` plus whole calendar months in UTC; the day is clamped to the end of the target month. */
export function addCalendarMonths(from: Date, months: number): Date {
  const result = new Date(from.getTime());
  const day = result.getUTCDate();
  result.setUTCDate(1);
  result.setUTCMonth(result.getUTCMonth() + months);
  const lastDay = new Date(
    Date.UTC(result.getUTCFullYear(), result.getUTCMonth() + 1, 0),
  ).getUTCDate();
  result.setUTCDate(Math.min(day, lastDay));
  return result;
}

/** True when the category needs the minimum shelf life and the consume-by is not strictly after it. */
export function isConsumeByTooSoon(
  categoryCode: string,
  consumeByAt: Date | null,
  now: Date,
): boolean {
  if (!requiresMinShelfLife(categoryCode) || consumeByAt === null) return false;
  return consumeByAt.getTime() <= addCalendarMonths(now, MIN_SHELF_LIFE_MONTHS).getTime();
}
