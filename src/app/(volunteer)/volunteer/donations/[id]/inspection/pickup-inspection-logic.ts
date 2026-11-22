import { z } from "zod";
import { PickupDecision, ScreeningVerdict, StorageCondition } from "@/contracts/enums";
import { VOLUNTEER_DONATION_STATUSES } from "@/contracts/volunteer-donation-list";
import type { VolunteerChecklistResponse } from "@/contracts/volunteer-checklist";

/** The pickup photo upload is slower than a read; the task allows 30 s for it only. */
export const UPLOAD_TIMEOUT_MS = 30_000;

/** Vercel rejects bodies over 4.5 MB, so the browser refuses the same 4 MB the route does. */
export const MAX_PHOTO_BYTES = 4 * 1024 * 1024;
export const ALLOWED_PHOTO_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;

export const TASKS_PATH = "/volunteer";
export const SCAN_PATH = "/volunteer/scan";

export type SubmitDecision = "accept" | "reject";
export type Answer = "yes" | "no";
export type CheckKey = "matches" | "packaging" | "looks";
export type Answers = Partial<Record<CheckKey, Answer>>;

/**
 * The three questions. The portion count comes from the loaded task; before it
 * loads the wording stays generic so no number is invented.
 */
export function checkQuestions(portions: number | null): { key: CheckKey; question: string }[] {
  return [
    {
      key: "matches",
      question:
        portions === null
          ? "Does it match the description and the portions listed?"
          : "Does it match the description and " + portions + " portions?",
    },
    { key: "packaging", question: "Is the packaging sealed and clean?" },
    { key: "looks", question: "Does it look and smell normal?" },
  ];
}

const taskDetailSchema = z.object({
  donationId: z.string(),
  shortCode: z.string(),
  foodName: z.string(),
  category: z.string(),
  portions: z.number(),
  status: z.enum(VOLUNTEER_DONATION_STATUSES),
  pickupAddress: z.string().nullable(),
  pickupStart: z.string().nullable(),
  pickupEnd: z.string().nullable(),
  donorName: z.string(),
  donorPhone: z.string().nullable(),
});

/** One task from the detail route (JSON dates are ISO strings). */
export type TaskDetail = z.infer<typeof taskDetailSchema>;

/** The task detail answer, or null when any part of the body is wrong. */
export function parseTaskDetail(body: unknown): TaskDetail | null {
  const parsed = taskDetailSchema.safeParse(body);
  return parsed.success ? parsed.data : null;
}

const checklistSchema = z.object({
  preparedAt: z.string().nullable(),
  consumeByAt: z.string().nullable(),
  storageCondition: z.enum(StorageCondition).nullable(),
  storageTemperatureC: z.number().nullable(),
  packagingIntact: z.boolean().nullable(),
  allergensConfirmed: z.boolean().nullable(),
  notCustomerPlateLeftovers: z.boolean().nullable(),
  allergens: z.array(z.string()),
});

/** The checklist answer as the route sends it, or null when any field is wrong. */
export function parseChecklist(body: unknown): VolunteerChecklistResponse | null {
  const parsed = checklistSchema.safeParse(body);
  return parsed.success ? parsed.data : null;
}

export type ChecklistState =
  | { kind: "loading" }
  | { kind: "error" }
  | { kind: "ready"; checklist: VolunteerChecklistResponse };

export const CHECKLIST_LOADING = "Donor checklist: loading...";
export const CHECKLIST_ERROR = "Donor checklist could not be loaded.";

/** Same labels the donor's own detail screen uses, so one food reads the same everywhere. */
export const STORAGE_LABELS: Record<StorageCondition, string> = {
  [StorageCondition.ROOM_TEMPERATURE]: "Room temperature",
  [StorageCondition.HOT_HELD]: "Hot-held",
  [StorageCondition.REFRIGERATED]: "Refrigerated",
  [StorageCondition.FROZEN]: "Frozen",
};

const SHORT_MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

function parseDate(iso: string | null): Date | null {
  if (iso === null) return null;
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** Local clock time in the h:mm AM/PM shape the screen shows. */
export function formatTime(date: Date): string {
  const hours = date.getHours();
  const minutes = date.getMinutes().toString().padStart(2, "0");
  const suffix = hours < 12 ? "AM" : "PM";
  const hour12 = hours % 12 === 0 ? 12 : hours % 12;
  return hour12 + ":" + minutes + " " + suffix;
}

function sameLocalDay(left: Date, right: Date): boolean {
  return (
    left.getFullYear() === right.getFullYear() &&
    left.getMonth() === right.getMonth() &&
    left.getDate() === right.getDate()
  );
}

function storagePart(condition: StorageCondition | null, temperature: number | null): string | null {
  if (condition === null && temperature === null) return null;
  if (temperature === null) return condition === null ? null : STORAGE_LABELS[condition];
  if (condition === null) return "Stored at " + temperature + "°C";
  return STORAGE_LABELS[condition] + " at " + temperature + "°C";
}

function allergenPart(checklist: VolunteerChecklistResponse): string | null {
  if (checklist.allergens.length > 0) return checklist.allergens.join(", ") + " declared";
  if (checklist.allergensConfirmed === true) return "No allergens declared";
  return null;
}

/**
 * The donor checklist line under the form. Only what the checklist answers
 * actually say is shown; an unconfirmed allergen answer stays silent. Dates are
 * formatted in the browser's local time, and consume-by drops the date only when
 * it falls on today.
 */
export function donorChecklistLine(state: ChecklistState, now: Date): string {
  if (state.kind === "loading") return CHECKLIST_LOADING;
  if (state.kind === "error") return CHECKLIST_ERROR;

  const checklist = state.checklist;
  const parts: string[] = [];

  const preparedAt = parseDate(checklist.preparedAt);
  if (preparedAt !== null) parts.push("Prepared " + formatTime(preparedAt));

  const consumeByAt = parseDate(checklist.consumeByAt);
  if (consumeByAt !== null) {
    parts.push(
      sameLocalDay(consumeByAt, now)
        ? "Consume by " + formatTime(consumeByAt)
        : "Consume by " +
            SHORT_MONTHS[consumeByAt.getMonth()] +
            " " +
            consumeByAt.getDate() +
            ", " +
            formatTime(consumeByAt),
    );
  }

  const storage = storagePart(checklist.storageCondition, checklist.storageTemperatureC);
  if (storage !== null) parts.push(storage);

  const allergens = allergenPart(checklist);
  if (allergens !== null) parts.push(allergens);

  if (checklist.packagingIntact === true) parts.push("Packaging clean");
  if (checklist.notCustomerPlateLeftovers === true) parts.push("Not opened or leftover");

  if (parts.length === 0) return "Donor checklist: nothing recorded";
  return "Donor checklist: " + parts.join(" · ");
}

export type ScreeningPanel = { title: string; body: string | null };

export const FLAG_BODY =
  "Visible spoilage was detected. Accept pickup is disabled. Reject pickup and enter the reason.";

/** The photo panel text: no photo this visit, then the three verdicts. */
export function screeningPanel(verdict: ScreeningVerdict | null): ScreeningPanel {
  switch (verdict) {
    case ScreeningVerdict.PASS:
      return {
        title: "Photo screening: Pass",
        body: "A visual aid only. Your inspection is the final gate.",
      };
    case ScreeningVerdict.REVIEW:
      return {
        title: "Photo needs human judgment",
        body: "The visual result is inconclusive (Review). Use all three checks. Reject whenever unsure.",
      };
    case ScreeningVerdict.FLAG:
      return { title: "Visual screening flagged", body: FLAG_BODY };
    default:
      return { title: "Photo screening: not done yet", body: null };
  }
}

export type AcceptanceInput = {
  photoUploaded: boolean;
  verdict: ScreeningVerdict | null;
  answers: Answers;
  saving: boolean;
  locked: boolean;
};

/** A FLAG photo, a missing photo, a No or a blank answer all disable acceptance. */
export function canAcceptPickup(input: AcceptanceInput): boolean {
  if (!input.photoUploaded || input.verdict === null) return false;
  if (input.verdict === ScreeningVerdict.FLAG) return false;
  if (input.saving || input.locked) return false;
  return (
    input.answers.matches === "yes" &&
    input.answers.packaging === "yes" &&
    input.answers.looks === "yes"
  );
}

export type RejectionInput = {
  photoUploaded: boolean;
  reason: string;
  saving: boolean;
  locked: boolean;
};

/**
 * The server will not save any inspection without an active pickup photo, a
 * rejection included, and it refuses a rejected answer with no reason.
 */
export function canRejectPickup(input: RejectionInput): boolean {
  if (!input.photoUploaded) return false;
  if (input.reason.trim() === "") return false;
  return !input.saving && !input.locked;
}

/**
 * KNOWN LIMIT: the reason categories are a team choice; the System Structure
 * only requires a reason.
 */
export const REJECT_REASONS: readonly string[] = [
  "Packaging is damaged or open",
  "Unusual smell or appearance",
  "Does not match the description or portions",
  "Other",
];

/** The free-text note under a category; the server keeps the combined reason under 500. */
export const MAX_REJECT_NOTE = 400;

/** The one reason string the server stores: a category, an optional note, or both. */
export function combineReason(category: string, note: string): string {
  const trimmedCategory = category.trim();
  const trimmedNote = note.trim();
  if (trimmedCategory === "") return trimmedNote;
  if (trimmedNote === "") return trimmedCategory;
  return trimmedCategory + ": " + trimmedNote;
}

export type RejectionConfirmInput = { category: string; canReject: boolean };

/** A rejection needs a reason and the same rules as the desktop reject button. */
export function canConfirmRejection(input: RejectionConfirmInput): boolean {
  return input.category !== "" && input.canReject;
}

export type StagedScreenInput = { staged: boolean; locked: boolean };

/** The phone's Screen button only acts on a preview that has not been uploaded yet. */
export function canScreenStaged(input: StagedScreenInput): boolean {
  return input.staged && !input.locked;
}

export type InspectionBody = {
  matchesDescription: boolean;
  packagingSealedClean: boolean;
  looksSmellsNormal: boolean;
  reason?: string;
};

/** Every unanswered question is sent as false, because the server has no "blank". */
export function inspectionBody(answers: Answers, reason: string): InspectionBody {
  const body: InspectionBody = {
    matchesDescription: answers.matches === "yes",
    packagingSealedClean: answers.packaging === "yes",
    looksSmellsNormal: answers.looks === "yes",
  };
  const trimmed = reason.trim();
  if (trimmed !== "") body.reason = trimmed;
  return body;
}

export type ErrorMessage = {
  message: string;
  href: string | null;
  linkLabel: string | null;
  /** The server was not reached or faulted, so the same step is worth another try. */
  retry: boolean;
};

/** The error code from the shared { error, message } body, or null. */
export function errorCode(body: unknown): string | null {
  if (typeof body !== "object" || body === null) return null;
  const record = body as Record<string, unknown>;
  return typeof record.error === "string" ? record.error : null;
}

/**
 * One status or code to one message. 401 and 403 are session problems, not
 * connection problems, so they never offer a retry. A 500 and any unreadable
 * answer do, because the same request may simply work next time.
 */
export function errorMessage(status: number, code: string | null): ErrorMessage {
  if (status === 401) {
    return {
      message: "Your session has expired. Log in again.",
      href: null,
      linkLabel: null,
      retry: false,
    };
  }
  if (status === 403) {
    return { message: "This page is for volunteers.", href: null, linkLabel: null, retry: false };
  }
  if (code === "SCAN_REQUIRED") {
    return {
      message: "Scan the QR label again before inspecting.",
      href: SCAN_PATH,
      linkLabel: "Scan the QR label",
      retry: false,
    };
  }
  if (code === "PHOTO_REQUIRED") {
    return {
      message: "Upload a photo of the food first.",
      href: null,
      linkLabel: null,
      retry: false,
    };
  }
  if (code === "SCREENING_BLOCKED") {
    return { message: FLAG_BODY, href: null, linkLabel: null, retry: false };
  }
  if (code === "INVALID_STATE" || code === "NOT_FOUND" || code === "INSPECTION_REQUIRED") {
    return {
      message: "This donation can no longer be inspected.",
      href: TASKS_PATH,
      linkLabel: "Back to your tasks",
      retry: false,
    };
  }
  return {
    message: "Could not reach the server.",
    href: null,
    linkLabel: null,
    retry: true,
  };
}

const photoResponseSchema = z.object({
  verdict: z.enum(ScreeningVerdict),
  screeningId: z.string(),
});

/** The verdict from the 201 photo answer, or null when the body is not the contract. */
export function parsePhotoResponse(body: unknown): ScreeningVerdict | null {
  const parsed = photoResponseSchema.safeParse(body);
  return parsed.success ? parsed.data.verdict : null;
}

const outcomeResponseSchema = z.object({
  status: z.string(),
  decision: z.enum(PickupDecision),
});

/** The decision from the 200 outcome answer, or null when the body is not the contract. */
export function parseOutcomeDecision(body: unknown): PickupDecision | null {
  const parsed = outcomeResponseSchema.safeParse(body);
  return parsed.success ? parsed.data.decision : null;
}

export type OutcomePanel = { title: string; body: string };

/** The Admin rejection notice is not built yet, so the text claims no notification. */
export function outcomePanel(decision: PickupDecision): OutcomePanel {
  if (decision === PickupDecision.ACCEPTED) {
    return {
      title: "Pickup recorded",
      body: "The food is now picked up. Take it to the distribution point.",
    };
  }
  return { title: "Pickup rejected", body: "The donation was not collected." };
}

export type PhotoCheck = { ok: true } | { ok: false; message: string };

function isAllowedPhotoType(type: string): boolean {
  return ALLOWED_PHOTO_TYPES.some((allowed) => allowed === type);
}

/** The browser-side check before anything is sent; the route checks the bytes again. */
export function checkPhotoFile(file: { type: string; size: number }): PhotoCheck {
  if (!isAllowedPhotoType(file.type)) {
    return { ok: false, message: "Choose a JPEG, PNG or WebP photo." };
  }
  if (file.size === 0) return { ok: false, message: "The photo is empty." };
  if (file.size > MAX_PHOTO_BYTES) {
    return { ok: false, message: "The photo must be 4 MB or smaller." };
  }
  return { ok: true };
}
