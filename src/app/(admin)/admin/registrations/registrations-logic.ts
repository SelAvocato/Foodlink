import { z } from "zod";
import { DonorType, Role } from "@/contracts/enums";
import { stripMarkup } from "@/lib/plain-text";

/** The three filters on the approvals screen (Figma p30), in visual order. */
export type RegistrationsTab = "pending" | "donors" | "volunteers";

export const REGISTRATIONS_TABS: readonly RegistrationsTab[] = ["pending", "donors", "volunteers"];

/** Shown when a request fails for a reason the page has no words for. */
export const GENERIC_ERROR = "Something went wrong. Please try again.";

/** Mapped from the review route's error code; server messages are never rendered. */
const NOT_PENDING_MESSAGE = "This application is no longer pending.";
const ALREADY_REVIEWED_MESSAGE = "This application has already been reviewed.";
const INVALID_REQUEST_MESSAGE = "The request was not valid. Please try again.";

const isoDate = z.string().refine((value) => !Number.isNaN(Date.parse(value)), "Invalid date");

const addressSchema = z.strictObject({
  streetLine1: z.string(),
  streetLine2: z.string().nullable(),
  barangay: z.string().nullable(),
  city: z.string(),
});

const documentSchema = z.strictObject({
  id: z.string(),
  type: z.string(),
  status: z.string(),
  mimeType: z.string(),
  sizeBytes: z.number(),
  createdAt: isoDate,
});

const applicantSchema = z.strictObject({
  id: z.string(),
  role: z.enum(Role),
  fullName: z.string(),
  email: z.string(),
  createdAt: isoDate,
  donorType: z.enum(DonorType).nullable(),
  businessName: z.string().nullable(),
  address: addressSchema.nullable(),
  privacyConsentAt: isoDate.nullable(),
  documents: z.array(documentSchema),
});

const usersResponseSchema = z.strictObject({ users: z.array(applicantSchema) });

export type ApplicantAddress = z.infer<typeof addressSchema>;
export type ApplicantDocument = z.infer<typeof documentSchema>;
export type Applicant = z.infer<typeof applicantSchema>;

/**
 * The body GET /api/admin/users answers with, validated before anything renders it.
 * Strict on purpose: a shape drift must surface as an error state, not as blank fields.
 * Returns null for anything that is not that exact shape.
 */
export function parseApplicants(body: unknown): Applicant[] | null {
  const parsed = usersResponseSchema.safeParse(body);
  return parsed.success ? parsed.data.users : null;
}

/** The Pending tab shows the whole list; the other two keep one role. */
export function filterByTab(
  applicants: readonly Applicant[],
  tab: RegistrationsTab,
): Applicant[] {
  if (tab === "donors") return applicants.filter((a) => a.role === Role.DONOR);
  if (tab === "volunteers") return applicants.filter((a) => a.role === Role.VOLUNTEER);
  return [...applicants];
}

export function tabCounts(applicants: readonly Applicant[]): Record<RegistrationsTab, number> {
  let donors = 0;
  let volunteers = 0;
  for (const applicant of applicants) {
    if (applicant.role === Role.DONOR) donors += 1;
    else if (applicant.role === Role.VOLUNTEER) volunteers += 1;
  }
  return { pending: applicants.length, donors, volunteers };
}

function partValue(parts: Intl.DateTimeFormatPart[], type: Intl.DateTimeFormatPart["type"]): string {
  return parts.find((part) => part.type === type)?.value ?? "";
}

/**
 * en-PH prints the month first; the screen shows the day first (Figma p30),
 * so the parts are reassembled instead of trusting the locale order.
 */
function formatDayFirst(date: Date, withTime: boolean): string {
  const formatter = new Intl.DateTimeFormat("en-PH", {
    timeZone: "Asia/Manila",
    year: "numeric",
    month: "short",
    day: "numeric",
    ...(withTime ? { hour: "numeric", minute: "2-digit", hour12: true } : {}),
  });
  const parts = formatter.formatToParts(date);
  const dateText = `${partValue(parts, "day")} ${partValue(parts, "month")} ${partValue(parts, "year")}`;
  if (!withTime) return dateText;
  const timeText = `${partValue(parts, "hour")}:${partValue(parts, "minute")} ${partValue(parts, "dayPeriod")}`;
  return `${dateText}, ${timeText}`;
}

/** The calendar date in Manila as YYYY-MM-DD, so day comparisons never use UTC. */
function manilaDayKey(date: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Manila",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

/** Today / Yesterday by the Manila calendar date, otherwise the day-first date. */
export function relativeDayLabel(iso: string, now: Date): string {
  const created = new Date(iso);
  const createdDay = manilaDayKey(created);
  if (createdDay === manilaDayKey(now)) return "Today";
  // Manila has no DST, so a day back is exactly 24 hours.
  if (createdDay === manilaDayKey(new Date(now.getTime() - 24 * 60 * 60 * 1000))) return "Yesterday";
  return formatDayFirst(created, false);
}

/** The label in the list and in the detail header, from role and donorType. */
export function typeLabel(role: Role, donorType: DonorType | null): string {
  if (role === Role.VOLUNTEER) return "Volunteer";
  if (role === Role.DONOR) {
    if (donorType === DonorType.ESTABLISHMENT) return "Establishment donor";
    if (donorType === DonorType.INDIVIDUAL) return "Individual donor";
    return "Donor";
  }
  return "Admin";
}

/** The four address parts joined with commas, empty parts skipped; "Not provided" for no address. */
export function joinAddress(address: ApplicantAddress | null): string {
  if (address === null) return "Not provided";
  const parts = [address.streetLine1, address.streetLine2, address.barangay, address.city].filter(
    (part): part is string => part !== null && part.trim() !== "",
  );
  return parts.length > 0 ? parts.join(", ") : "Not provided";
}

/** "4 Nov 2026, 9:04 AM" in Manila time, or "Not recorded". */
export function formatConsent(iso: string | null): string {
  if (iso === null) return "Not recorded";
  return formatDayFirst(new Date(iso), true);
}

/** Names from document_types in db/baseline/001_schema.sql (approved by Braylle for p30). */
const DOCUMENT_TYPE_TITLES: Record<string, string> = {
  BUSINESS_PERMIT: "Business permit",
  VALID_ID: "Valid government ID",
};

/** Unknown codes fall back to a neutral title rather than crashing the screen. */
export function proofCardTitle(typeCode: string): string {
  return Object.hasOwn(DOCUMENT_TYPE_TITLES, typeCode)
    ? DOCUMENT_TYPE_TITLES[typeCode]
    : "Proof document";
}

export interface ReviewFailure {
  message: string;
  /** 404 and 409 mean the loaded list is stale and must be re-fetched. */
  reload: boolean;
}

/** Only the code is read; the server's message text is never rendered. */
function readErrorCode(body: unknown): string | null {
  if (typeof body !== "object" || body === null) return null;
  const code = (body as { error?: unknown }).error;
  return typeof code === "string" ? code : null;
}

function statusKey(status: number): string | null {
  if (status === 404) return "NOT_FOUND";
  if (status === 409) return "INVALID_TRANSITION";
  if (status === 400) return "INVALID_REQUEST";
  return null;
}

/**
 * Maps the review route's failure to what the screen shows. The status wins when it is
 * one of the three the task defines, so a 404 or 409 always reloads; anything else is generic.
 */
export function reviewMessage(status: number, body: unknown): ReviewFailure {
  const key = statusKey(status) ?? readErrorCode(body);
  switch (key) {
    case "NOT_FOUND":
      return { message: NOT_PENDING_MESSAGE, reload: true };
    case "INVALID_TRANSITION":
      return { message: ALREADY_REVIEWED_MESSAGE, reload: true };
    case "INVALID_REQUEST":
      return { message: INVALID_REQUEST_MESSAGE, reload: false };
    default:
      return { message: GENERIC_ERROR, reload: false };
  }
}

export type ReasonValidation = { ok: true; reason: string } | { ok: false; message: string };

/**
 * The same rule as reviewSchema: markup stripped first (one line, angle brackets gone),
 * then required and at most 500 characters. The stripped text is what gets sent.
 */
export function validateReason(raw: string): ReasonValidation {
  const reason = stripMarkup(raw);
  if (reason === "") return { ok: false, message: "Enter a reason" };
  if (reason.length > 500) return { ok: false, message: "Use at most 500 characters" };
  return { ok: true, reason };
}

/**
 * The signed-url route answers { url, expiresInSeconds }. The url is handed straight
 * to the blank tab: it is never stored in state, never logged, never shown.
 */
export function readSignedUrl(body: unknown): string | null {
  if (typeof body !== "object" || body === null) return null;
  const url = (body as { url?: unknown }).url;
  if (typeof url !== "string" || url === "") return null;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return null;
  return url;
}
