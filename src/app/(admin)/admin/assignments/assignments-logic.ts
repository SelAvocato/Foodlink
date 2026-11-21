import { z } from "zod";
import { formatDateTime, formatWindow } from "@/app/(donor)/donor/donate/review-logic";

export const REQUEST_TIMEOUT_MS = 10_000;
export const ACCEPTED_LIMIT = 50;
export const VOLUNTEER_LIMIT = 100;

const DASH = "—";

/** "#" + the first 8 characters of the id, uppercased — the code p12 and p13 show. */
export function donationCode(donationId: string): string {
  return `#${donationId.slice(0, 8).toUpperCase()}`;
}

/** Where ?donation= sends the screen: no param, a lone uuid, or junk. */
export type AssignmentsRoute =
  | { kind: "list" }
  | { kind: "detail"; donationId: string }
  | { kind: "not-found" };

/** A present but unparseable id is not-found, never a silent fall back to the list. */
export function parseDonationParam(value: string | string[] | undefined): AssignmentsRoute {
  if (value === undefined) return { kind: "list" };
  if (typeof value !== "string") return { kind: "not-found" };
  const parsed = z.uuid().safeParse(value);
  if (!parsed.success) return { kind: "not-found" };
  return { kind: "detail", donationId: parsed.data.toLowerCase() };
}

/** One accepted-donation row, already formatted for display. */
export type AcceptedRowView = {
  donationId: string;
  /** "#9FC03951" */
  code: string;
  foodName: string;
  portions: number;
  donorName: string;
  /** The pickup end as text, or a dash. */
  pickupEnd: string;
};

const acceptedItemSchema = z.object({
  donationId: z.string(),
  foodName: z.string(),
  portions: z.number(),
  donorName: z.string(),
  pickupEnd: z.string(),
});

const acceptedResponseSchema = z.object({ donations: z.array(acceptedItemSchema) });

/** The accepted-list answer as view rows, or null on any wrong shape. */
export function parseAcceptedListResponse(
  body: unknown,
  timeZone?: string,
): AcceptedRowView[] | null {
  const parsed = acceptedResponseSchema.safeParse(body);
  if (!parsed.success) return null;
  return parsed.data.donations.map((item) => ({
    donationId: item.donationId,
    code: donationCode(item.donationId),
    foodName: item.foodName,
    portions: item.portions,
    donorName: item.donorName,
    pickupEnd: formatDateTime(item.pickupEnd, timeZone) ?? DASH,
  }));
}

/** One row of the active-volunteer list as the picker shows it. */
export type VolunteerView = {
  volunteerId: string;
  fullName: string;
  availability: string | null;
};

const volunteerSchema = z.object({
  volunteerId: z.string(),
  fullName: z.string(),
  availability: z.string().nullable(),
});

const volunteersResponseSchema = z.object({ volunteers: z.array(volunteerSchema) });

/** The volunteer answer as rows, or null on any wrong shape. */
export function parseVolunteersResponse(body: unknown): VolunteerView[] | null {
  const parsed = volunteersResponseSchema.safeParse(body);
  return parsed.success ? parsed.data.volunteers : null;
}

/** The static row line; "Active" alone when the account records no availability. */
export function availabilityLine(availability: string | null): string {
  if (availability === null || availability.trim() === "") return "Active";
  return `Active · Availability: ${availability}`;
}

/** Browser-side name search over the loaded list: trimmed, case-insensitive. */
export function filterVolunteers(
  volunteers: readonly VolunteerView[],
  search: string,
): VolunteerView[] {
  const query = search.trim().toLowerCase();
  if (query === "") return [...volunteers];
  return volunteers.filter((volunteer) => volunteer.fullName.toLowerCase().includes(query));
}

/**
 * fn_donation_report's parts this screen reads (snake_case, ADMIN view). Loose
 * because the function keeps adding keys; only the fields below are ever copied
 * into the view model, so donor.phone and the other ADMIN-only columns never
 * reach the screen.
 */
const reportSchema = z.looseObject({
  donation: z.looseObject({
    food_name: z.string(),
    portions: z.number(),
    status: z.string(),
  }),
  donor: z.looseObject({
    name: z.string(),
  }),
  pickup: z
    .looseObject({
      address: z.string().nullable(),
      pickup_start: z.string().nullable(),
      pickup_end: z.string().nullable(),
    })
    .nullable(),
});

/** The header card, already formatted for display. */
export type DetailView = {
  foodName: string;
  donorName: string;
  portions: number;
  /** The pickup address as one line of text, or a dash. */
  address: string;
  /** The pickup window as text, or a dash. */
  window: string;
  /** The pickup end as text, or a dash. */
  pickupEnd: string;
  status: string;
  /** False when the report has no pickup window; the amber strip is then omitted. */
  hasPickup: boolean;
};

/** The header card from the report, or null when the report is not the expected shape. */
export function parseDetailResponse(report: unknown, timeZone?: string): DetailView | null {
  const parsed = reportSchema.safeParse(report);
  if (!parsed.success) return null;
  const { donation, donor, pickup } = parsed.data;
  const start = pickup === null ? null : pickup.pickup_start;
  const end = pickup === null ? null : pickup.pickup_end;
  const address = pickup === null ? null : pickup.address;
  return {
    foodName: donation.food_name,
    donorName: donor.name,
    portions: donation.portions,
    address: address === null || address.trim() === "" ? DASH : address,
    window: start !== null && end !== null ? (formatWindow(start, end, timeZone) ?? DASH) : DASH,
    pickupEnd: end !== null ? (formatDateTime(end, timeZone) ?? DASH) : DASH,
    status: donation.status,
    hasPickup: start !== null && end !== null,
  };
}

/** The picker only belongs to a donation still waiting for a volunteer. */
export function isAwaitingAssignment(status: string): boolean {
  return status === "ACCEPTED";
}

export type DetailFailure = "not-found" | "error";

/**
 * Only an HTTP 404 is "not found". Every other refusal (401, 403, 400, 500),
 * a network failure, a timeout or an unreadable body (null) is retryable.
 */
export function detailFailure(status: number | null): DetailFailure {
  return status === 404 ? "not-found" : "error";
}

export type AssignFailureView = {
  tone: "warning" | "error";
  title: string;
  message: string;
  /** What the screen does about it: an automatic reload, a banner action, or nothing. */
  action: "reload-volunteers" | "reload-detail" | "none";
};

/**
 * The statuses transitionErrorResponse produces for assign: NOT_FOUND 404,
 * FORBIDDEN_ACTOR 403, INVALID_TRANSITION 409, VOLUNTEER_NOT_ACTIVE 422,
 * otherwise 400 (401 is the auth gate, 500 the wrapper's internal error).
 */
export function assignFailure(status: number): AssignFailureView {
  if (status === 422) {
    return {
      tone: "warning",
      title: "Volunteer not available",
      message: "That volunteer is no longer active. Reload the volunteer list and choose another.",
      action: "reload-volunteers",
    };
  }
  if (status === 409) {
    return {
      tone: "warning",
      title: "Donation changed",
      message: "This donation changed or its pickup window has passed. Reload and try again.",
      action: "reload-detail",
    };
  }
  if (status === 404) {
    return {
      tone: "warning",
      title: "Donation not found",
      message: "This donation could not be found.",
      action: "none",
    };
  }
  return {
    tone: "error",
    title: "Assignment not saved",
    message: "The assignment could not be saved. Try again.",
    action: "none",
  };
}
