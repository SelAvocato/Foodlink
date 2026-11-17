import { z } from "zod";
import { screeningDecisionSchema, type ScreeningDecisionBody } from "@/contracts/screening-decision";
import { StorageCondition } from "@/contracts/enums";

/** Shown when a request fails for a reason the page has no words for. */
export const GENERIC_ERROR = "Something went wrong. Please try again.";

/** Mapped from the decision route's status and code; server messages are never rendered. */
export const NOT_ADMIN_MESSAGE = "You are not signed in as an Admin.";
export const CASE_GONE_MESSAGE = "This case no longer exists.";
export const ALREADY_DECIDED_MESSAGE = "Someone already decided this case.";
export const SAVE_FAILED_MESSAGE = "The decision could not be saved. Please try again.";

const isoDate = z.string().refine((value) => !Number.isNaN(Date.parse(value)), "Invalid date");

const checklistSchema = z.strictObject({
  preparedAt: isoDate.nullable(),
  consumeByAt: isoDate.nullable(),
  storageCondition: z.enum(StorageCondition).nullable(),
  storageTemperatureC: z.number().nullable(),
  packagingIntact: z.boolean().nullable(),
  allergensConfirmed: z.boolean().nullable(),
  notCustomerPlateLeftovers: z.boolean().nullable(),
  completedAt: isoDate.nullable(),
});

const queueItemSchema = z.strictObject({
  screeningId: z.string(),
  donationId: z.string(),
  createdAt: isoDate,
  confidence: z.number().nullable(),
  signs: z.array(z.string()),
  notes: z.string().nullable(),
  donation: z.strictObject({
    foodName: z.string(),
    portions: z.number(),
    categoryCode: z.string(),
  }),
  checklist: checklistSchema.nullable(),
  photoUrl: z.string().nullable(),
});

const queueResponseSchema = z.strictObject({ screenings: z.array(queueItemSchema) });

export type ScreeningCaseChecklist = z.infer<typeof checklistSchema>;
export type ScreeningCase = z.infer<typeof queueItemSchema>;

/**
 * The body GET /api/admin/screenings answers with, validated before anything
 * renders it. Strict on purpose: a shape drift must surface as an error state,
 * not as blank fields. Returns null for anything that is not that exact shape.
 * The photoUrl is only ever rendered; it is never logged or persisted.
 */
export function parseScreeningQueue(body: unknown): ScreeningCase[] | null {
  const parsed = queueResponseSchema.safeParse(body);
  return parsed.success ? parsed.data.screenings : null;
}

/** The schema has no display-code column, so the short code is derived from the id. */
const SHORT_CODE_LENGTH = 8;

/** The first 8 characters of the donation id, upper case (the same rule as p12). */
export function shortCode(donationId: string): string {
  return donationId.slice(0, SHORT_CODE_LENGTH).toUpperCase();
}

/** The case title: "#CODE · {food name}". */
export function caseTitle(item: ScreeningCase): string {
  return `#${shortCode(item.donationId)} · ${item.donation.foodName}`;
}

/** "{n} awaiting review" for the queue count line. */
export function countLabel(count: number): string {
  return `${count} awaiting review`;
}

/**
 * The confidence line: the rounded percentage, the band, and the fixed note.
 * The band follows the rounded percent, so the label always agrees with the
 * number beside it: Low under 50%, Medium 50% to 79%, High 80% and up. Null has
 * its own line.
 */
export function confidenceLabel(confidence: number | null): string {
  if (confidence === null) return "Not available · Human assessment needed";
  const percent = Math.round(confidence * 100);
  const band = percent < 50 ? "Low" : percent < 80 ? "Medium" : "High";
  return `${percent}% · ${band} · Human assessment needed`;
}

const REASON_SEPARATOR = " · ";

/** The AI notes joined with the signs, empty parts skipped; "No reason given" when both are empty. */
export function reasonText(notes: string | null, signs: readonly string[]): string {
  const parts = [notes ?? "", ...signs]
    .map((part) => part.trim())
    .filter((part) => part !== "");
  return parts.length > 0 ? parts.join(REASON_SEPARATOR) : "No reason given";
}

/** Known codes from the storage_condition enum; an unknown code shows as itself. */
const STORAGE_CONDITION_LABELS: Record<string, string> = {
  ROOM_TEMPERATURE: "Room temperature",
  HOT_HELD: "Hot held",
  REFRIGERATED: "Refrigerated",
  FROZEN: "Frozen",
};

/** Object.hasOwn keeps inherited names such as "__proto__" from resolving to a label. */
export function storageConditionLabel(code: string): string {
  return Object.hasOwn(STORAGE_CONDITION_LABELS, code) ? STORAGE_CONDITION_LABELS[code] : code;
}

function partValue(parts: Intl.DateTimeFormatPart[], type: Intl.DateTimeFormatPart["type"]): string {
  return parts.find((part) => part.type === type)?.value ?? "";
}

/**
 * Copies the p30 rule (registrations-logic.ts): en-PH prints the month first,
 * so the parts are reassembled day first in Manila time.
 */
function dayFirst(iso: string): string {
  const parts = new Intl.DateTimeFormat("en-PH", {
    timeZone: "Asia/Manila",
    year: "numeric",
    month: "short",
    day: "numeric",
  }).formatToParts(new Date(iso));
  return `${partValue(parts, "day")} ${partValue(parts, "month")} ${partValue(parts, "year")}`;
}

function yesNo(value: boolean | null): string {
  if (value === null) return "Not set";
  return value ? "Yes" : "No";
}

function dateOrNotSet(iso: string | null): string {
  return iso === null ? "Not set" : dayFirst(iso);
}

/** Both parts of the storage answer; whichever is missing is skipped, both missing is "Not set". */
function storageText(
  condition: StorageCondition | null,
  temperatureC: number | null,
): string {
  const parts: string[] = [];
  if (condition !== null) parts.push(storageConditionLabel(condition));
  if (temperatureC !== null) parts.push(`${temperatureC}°C`);
  return parts.length > 0 ? parts.join(" · ") : "Not set";
}

/** One line per checklist field, in the order the screen shows them. */
export function checklistLines(checklist: ScreeningCaseChecklist): string[] {
  return [
    `Prepared: ${dateOrNotSet(checklist.preparedAt)}`,
    `Consume by: ${dateOrNotSet(checklist.consumeByAt)}`,
    `Storage: ${storageText(checklist.storageCondition, checklist.storageTemperatureC)}`,
    `Packaging intact: ${yesNo(checklist.packagingIntact)}`,
    `Allergens confirmed: ${yesNo(checklist.allergensConfirmed)}`,
    `Not customer plate leftovers: ${yesNo(checklist.notCustomerPlateLeftovers)}`,
    `Completed: ${dateOrNotSet(checklist.completedAt)}`,
  ];
}

/** The body POSTed for a pass: no reason, as the contract requires. */
export function passBody(): ScreeningDecisionBody {
  return { decision: "PASS" };
}

export type RejectValidation =
  | { ok: true; body: ScreeningDecisionBody }
  | { ok: false; message: string };

/**
 * A reject is validated with the route's own contract, after trimming: a blank
 * or whitespace-only reason never reaches the server, and the stripped text the
 * schema produces is exactly what gets sent.
 */
export function validateReject(rawReason: string): RejectValidation {
  const parsed = screeningDecisionSchema.safeParse({
    decision: "REJECT",
    reason: rawReason.trim(),
  });
  if (!parsed.success) {
    return { ok: false, message: parsed.error.issues[0]?.message ?? "Enter a reason" };
  }
  return { ok: true, body: parsed.data };
}

export interface DecisionFailure {
  message: string;
  /** 404 and 409 NOT_PENDING mean the loaded queue is stale and must be re-read. */
  refill: boolean;
}

/** Only the code is read; the server's message text is never rendered. */
function readErrorCode(body: unknown): string | null {
  if (typeof body !== "object" || body === null) return null;
  const code = (body as { error?: unknown }).error;
  return typeof code === "string" ? code : null;
}

/** Maps the decision route's failure to what the screen shows. */
export function decisionMessage(status: number, body: unknown): DecisionFailure {
  if (status === 401 || status === 403) {
    return { message: NOT_ADMIN_MESSAGE, refill: false };
  }
  if (status === 404) {
    return { message: CASE_GONE_MESSAGE, refill: true };
  }
  if (status === 409 && readErrorCode(body) === "NOT_PENDING") {
    return { message: ALREADY_DECIDED_MESSAGE, refill: true };
  }
  return { message: SAVE_FAILED_MESSAGE, refill: false };
}

export interface ActiveCase {
  current: ScreeningCase | null;
  /** The pinned case left the queue: it stays on screen, but it can no longer be decided here. */
  gone: boolean;
}

/**
 * What to show for the case under review against a freshly read queue. The
 * pinned case is what the Admin is reviewing, so a re-read must not silently
 * swap it for the next one: still pending gives its fresh copy (which carries
 * the newly signed photoUrl), gone gives the pinned copy as it is, and nothing
 * pinned gives the first case of the queue.
 */
export function reconcileActive(
  pinned: ScreeningCase | null,
  cases: ScreeningCase[],
): ActiveCase {
  if (pinned === null) return { current: cases[0] ?? null, gone: false };
  const fresh = cases.find((item) => item.screeningId === pinned.screeningId);
  if (fresh !== undefined) return { current: fresh, gone: false };
  return { current: pinned, gone: true };
}

/** After the Admin's own decision: the first case that is not the one decided, or none. */
export function nextAfterDecision(
  cases: ScreeningCase[],
  decidedId: string,
): ScreeningCase | null {
  return cases.find((item) => item.screeningId !== decidedId) ?? null;
}

/**
 * Whether the load error section (with Try again) replaces the queue: the queue
 * itself failed to load, or a refresh failed while an empty ready queue has no
 * case left to show. A retained pinned case always keeps the ready screen.
 */
export function showQueueError(
  status: "loading" | "ready" | "error",
  caseCount: number,
  hasCurrent: boolean,
  refreshFailed: boolean,
): boolean {
  if (status === "error") return true;
  return status === "ready" && caseCount === 0 && !hasCurrent && refreshFailed;
}
