import { z } from "zod";
import { roundPin, type MapPinPoint } from "@/lib/map-pin";
import { fromIsoToLocalInput, toIsoWithOffset } from "./checklist-logic";
import { messageForError, PLACEHOLDER_FOOD_NAME } from "./photo-step-logic";

/** The step's form state, as the inputs show it: local strings, never dates. */
export type DetailsForm = {
  foodName: string;
  portions: string;
  pickupStart: string;
  pickupEnd: string;
  streetLine1: string;
  barangay: string;
  city: string;
};

/** The step's fields before any load lands; the real values replace it in one apply. */
export function initialDetailsForm(): DetailsForm {
  return {
    foodName: "",
    portions: "",
    pickupStart: "",
    pickupEnd: "",
    streetLine1: "",
    barangay: "",
    city: "",
  };
}

/** One message per field; a key that is absent is a field the donor got right. */
export type DetailsErrors = {
  foodName?: string;
  portions?: string;
  pickupStart?: string;
  pickupEnd?: string;
  streetLine1?: string;
  city?: string;
};

/** The contract's own bounds (src/contracts/donation-draft.ts); a value outside them is never stored. */
const MIN_PORTIONS = 1;
const MAX_PORTIONS = 100000;
const MAX_FOOD_NAME = 160;
const MAX_STREET_LINE_1 = 200;
const MAX_CITY = 120;

/** A datetime-local value as a local Date; empty or unreadable is null. */
function parseLocalDate(value: string): Date | null {
  if (value.trim() === "") return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** A stored ISO datetime as a Date; missing or unreadable is null. */
function parseIsoDate(value: string | null): Date | null {
  if (value === null) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** "" and non-numeric input first, then the range; one message, the first that applies. */
function portionsProblem(value: string): string | null {
  if (value.trim() === "") return "Enter the number of portions.";
  const parsed = Number(value);
  if (!Number.isInteger(parsed)) return "Portions must be a whole number.";
  if (parsed < MIN_PORTIONS) return "Enter at least 1 portion.";
  if (parsed > MAX_PORTIONS) return "Use at most 100000 portions.";
  return null;
}

/**
 * The client's pre-check before any request; the server enforces every rule
 * again. `consumeByIso` is the checklist's consume-by (null when the checklist
 * has none, so the rule that needs it is skipped), and `now` is injected so the
 * future rule never depends on the clock of the machine running the tests.
 */
export function validateDetails(
  form: DetailsForm,
  consumeByIso: string | null,
  now: Date,
): DetailsErrors {
  const errors: DetailsErrors = {};

  const name = form.foodName.trim();
  if (name === "") {
    errors.foodName = "Enter the food name.";
  } else if (name.length > MAX_FOOD_NAME) {
    errors.foodName = "Use at most 160 characters.";
  }

  const portions = portionsProblem(form.portions);
  if (portions !== null) errors.portions = portions;

  const start = parseLocalDate(form.pickupStart);
  if (start === null) {
    errors.pickupStart = "Enter a valid pickup start time.";
  } else if (start.getTime() <= now.getTime()) {
    errors.pickupStart = "The pickup window must start in the future.";
  }

  const end = parseLocalDate(form.pickupEnd);
  const consumeBy = parseIsoDate(consumeByIso);
  if (end === null) {
    errors.pickupEnd = "Enter a valid pickup end time.";
  } else if (start !== null && end.getTime() <= start.getTime()) {
    errors.pickupEnd = "The pickup window must end after it starts.";
  } else if (consumeBy !== null && end.getTime() >= consumeBy.getTime()) {
    errors.pickupEnd = "The pickup window must end before the consume-by time.";
  }

  const streetLine1 = form.streetLine1.trim();
  if (streetLine1 === "") {
    errors.streetLine1 = "Enter the street address.";
  } else if (streetLine1.length > MAX_STREET_LINE_1) {
    errors.streetLine1 = "Use at most 200 characters.";
  }

  const city = form.city.trim();
  if (city === "") {
    errors.city = "Enter the city.";
  } else if (city.length > MAX_CITY) {
    errors.city = "Use at most 120 characters.";
  }

  return errors;
}

/** What one PATCH sends: only the two fields step 3 owns. */
export type DraftPatch = { foodName: string; portions: number };

export function buildDraftPatch(form: DetailsForm): DraftPatch {
  return { foodName: form.foodName.trim(), portions: Number(form.portions) };
}

/**
 * Address parts of a saved pickup the step never edits: they ride along with
 * every save so a second PUT does not drop them. All-null means "no pickup has
 * been saved yet" (the profile address has none of them either).
 */
export type CarriedAddress = {
  streetLine2: string | null;
  provinceOrState: string | null;
  postalCode: string | null;
  countryCode: string | null;
};

export const EMPTY_CARRIED: CarriedAddress = {
  streetLine2: null,
  provinceOrState: null,
  postalCode: null,
  countryCode: null,
};

/** The PUT body: street and city always, everything else only when it has a value. */
export type PickupBody = {
  address: {
    streetLine1: string;
    streetLine2?: string;
    barangay?: string;
    city: string;
    provinceOrState?: string;
    postalCode?: string;
    countryCode?: string;
    latitude?: number;
    longitude?: number;
  };
  pickupStart: string;
  pickupEnd: string;
};

/** null is an empty or unreadable input: never sent, so the caller shows the generic error. */
function filledOrNull(value: string | null): string | null {
  if (value === null) return null;
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

export function buildPickupBody(
  form: DetailsForm,
  carried: CarriedAddress,
  pin: MapPinPoint | null,
): PickupBody | null {
  const pickupStart = toIsoWithOffset(form.pickupStart);
  const pickupEnd = toIsoWithOffset(form.pickupEnd);
  if (pickupStart === null || pickupEnd === null) return null;

  // The column keeps 6 decimals (numeric(9,6)); round here so what is shown is what is saved.
  const rounded = pin === null ? null : roundPin(pin);
  const streetLine2 = filledOrNull(carried.streetLine2);
  const barangay = filledOrNull(form.barangay);
  const provinceOrState = filledOrNull(carried.provinceOrState);
  const postalCode = filledOrNull(carried.postalCode);
  const countryCode = filledOrNull(carried.countryCode);

  return {
    address: {
      streetLine1: form.streetLine1.trim(),
      ...(streetLine2 !== null ? { streetLine2 } : {}),
      ...(barangay !== null ? { barangay } : {}),
      city: form.city.trim(),
      ...(provinceOrState !== null ? { provinceOrState } : {}),
      ...(postalCode !== null ? { postalCode } : {}),
      ...(countryCode !== null ? { countryCode } : {}),
      ...(rounded !== null ? { latitude: rounded.latitude, longitude: rounded.longitude } : {}),
    },
    pickupStart,
    pickupEnd,
  };
}

/** The draft fields step 3 reads from the drafts list. */
export type DraftDetails = { foodName: string; portions: number };

const draftDetailsEntrySchema = z.looseObject({
  foodName: z.string(),
  portions: z.number(),
});

/** Loose on purpose: the list carries dates and codes this step never reads. */
const draftsEnvelopeSchema = z.looseObject({ drafts: z.array(z.unknown()) });
const entryIdSchema = z.looseObject({ id: z.string() });

/**
 * The name and portions of `id` in the GET /api/donor/drafts body. A body that
 * is not the list, no matching entry, or a matching entry that is malformed is
 * null: all three end the same way (the step cannot load).
 */
export function parseDraftDetails(body: unknown, id: string): DraftDetails | null {
  const envelope = draftsEnvelopeSchema.safeParse(body);
  if (!envelope.success) return null;
  for (const entry of envelope.data.drafts) {
    // One entry at a time, so an unrelated bad entry cannot hide the wanted one.
    const withId = entryIdSchema.safeParse(entry);
    if (!withId.success || withId.data.id !== id) continue;
    const parsed = draftDetailsEntrySchema.safeParse(entry);
    return parsed.success ? { foodName: parsed.data.foodName, portions: parsed.data.portions } : null;
  }
  return null;
}

/** The pickup address as the GET returns it: database nulls, plain numbers for the pin. */
const pickupAddressSchema = z.looseObject({
  streetLine1: z.string(),
  streetLine2: z.string().nullable(),
  barangay: z.string().nullable(),
  city: z.string(),
  provinceOrState: z.string().nullable(),
  postalCode: z.string().nullable(),
  countryCode: z.string(),
  latitude: z.number().nullable(),
  longitude: z.number().nullable(),
});

const pickupViewSchema = z.looseObject({
  address: pickupAddressSchema,
  pickupStart: z.string(),
  pickupEnd: z.string(),
});

export type PickupDetails = z.infer<typeof pickupViewSchema>;

const pickupLoadSchema = z.looseObject({ pickup: pickupViewSchema.nullable() });

/**
 * null (the "no pickup" answer) and "this body is not that response" must stay
 * apart: a malformed body is a failed load, not an empty pickup.
 */
export type PickupLoad = { ok: true; pickup: PickupDetails | null } | { ok: false };

export function parsePickupLoad(body: unknown): PickupLoad {
  const parsed = pickupLoadSchema.safeParse(body);
  return parsed.success ? { ok: true, pickup: parsed.data.pickup } : { ok: false };
}

/** Only the address parts the profile response really sends; the rest rides along unexamined. */
const profileAddressSchema = z.looseObject({
  streetLine1: z.string(),
  streetLine2: z.string().nullable(),
  barangay: z.string().nullable(),
  city: z.string(),
  latitude: z.number().nullable(),
  longitude: z.number().nullable(),
});

const profileLoadSchema = z.looseObject({
  profile: z.looseObject({ address: profileAddressSchema }),
});

export type ProfileAddress = z.infer<typeof profileAddressSchema>;

/** The profile's pickup-prefill address, or null when the body is not that response. */
export function parseProfileAddress(body: unknown): ProfileAddress | null {
  const parsed = profileLoadSchema.safeParse(body);
  return parsed.success ? parsed.data.profile.address : null;
}

const saveResponseSchema = z.strictObject({ donationId: z.string().min(1) });

export type DetailsSaveResponse = { donationId: string };

/** The PUT 200 body, or null when it is not that response (the step shows the generic error). */
export function parseSaveResponse(body: unknown): DetailsSaveResponse | null {
  const parsed = saveResponseSchema.safeParse(body);
  return parsed.success ? parsed.data : null;
}

/** Everything one successful load hands to the step at once. */
export type DetailsLoad = {
  form: DetailsForm;
  pin: MapPinPoint | null;
  carried: CarriedAddress;
};

/**
 * The saved pickup wins: its address, its window and its pin, and the address
 * parts it carries. Without one the profile address prefills the fields (and
 * its pin, and its street line 2, which the form never shows), while the window
 * stays empty because no pickup exists yet. The
 * placeholder from step 1 shows as an empty name and empty portions, so the
 * donor never edits the words "Untitled donation".
 */
export function deriveInitialDetails(input: {
  draft: DraftDetails;
  pickup: PickupDetails | null;
  profile: ProfileAddress | null;
}): DetailsLoad {
  // The pickup view nests its address; the profile response is already flat.
  const address = input.pickup === null ? input.profile : input.pickup.address;
  const placeholder = input.draft.foodName === PLACEHOLDER_FOOD_NAME;
  const pickup = input.pickup;

  return {
    form: {
      foodName: placeholder ? "" : input.draft.foodName,
      portions: placeholder ? "" : String(input.draft.portions),
      pickupStart: pickup === null ? "" : fromIsoToLocalInput(pickup.pickupStart),
      pickupEnd: pickup === null ? "" : fromIsoToLocalInput(pickup.pickupEnd),
      streetLine1: address?.streetLine1 ?? "",
      barangay: address?.barangay ?? "",
      city: address?.city ?? "",
    },
    pin:
      address !== null && address.latitude !== null && address.longitude !== null
        ? { latitude: address.latitude, longitude: address.longitude }
        : null,
    carried:
      pickup === null
        ? { ...EMPTY_CARRIED, streetLine2: input.profile?.streetLine2 ?? null }
        : {
            streetLine2: pickup.address.streetLine2,
            provinceOrState: pickup.address.provinceOrState,
            postalCode: pickup.address.postalCode,
            countryCode: pickup.address.countryCode,
          },
  };
}

/**
 * The refusals only the draft and pickup routes return; every other code
 * shares the photo step's wording. The server's message text is never rendered.
 */
const DETAILS_ERROR_MESSAGES: Record<string, string> = {
  PICKUP_START_NOT_IN_FUTURE: "The pickup window must start in the future.",
  CONSUME_BY_NOT_AFTER_PICKUP_END: "The pickup window must end before the consume-by time.",
  NOT_EDITABLE: "That draft can no longer be changed.",
  NOT_FOUND: "The draft was not found.",
};

export function messageForDetailsError(code: string | undefined): string {
  if (code !== undefined && Object.hasOwn(DETAILS_ERROR_MESSAGES, code)) {
    return DETAILS_ERROR_MESSAGES[code];
  }
  return messageForError(code);
}

/** One line of the rules list under the form. */
export type DetailsRule = { text: string; met: boolean };

/** The two checklist times this step reads, as the GET sends them. */
export type ChecklistTimes = { consumeByAt: string | null; preparedAt: string | null };

/**
 * "2026-01-03T18:00" as "6:00 PM". Read as text, never through a Date, so the
 * same value shows the same clock on every machine.
 */
function formatClock(localValue: string): string | null {
  const match = /^(\d{2}):(\d{2})$/.exec(localValue.slice(11, 16));
  if (match === null) return null;
  const hour = Number(match[1]);
  if (hour > 23) return null;
  const suffix = hour < 12 ? "AM" : "PM";
  const twelve = hour % 12 === 0 ? 12 : hour % 12;
  return `${twelve}:${match[2]} ${suffix}`;
}

/**
 * The two rule lines. The first is computed from the form alone (a start in
 * the past is refused by validateDetails and by the server, not by this line,
 * which takes no clock); the second is unmet only when the checklist really
 * shows a consume-by that is not later than the prepared time.
 */
export function rulesFor(form: DetailsForm, checklistTimes: ChecklistTimes): DetailsRule[] {
  const consumeBy = parseIsoDate(checklistTimes.consumeByAt);
  const prepared = parseIsoDate(checklistTimes.preparedAt);
  const start = parseLocalDate(form.pickupStart);
  const end = parseLocalDate(form.pickupEnd);

  const firstMet =
    start !== null &&
    end !== null &&
    end.getTime() > start.getTime() &&
    (consumeBy === null || end.getTime() < consumeBy.getTime());

  const consumeByLocal =
    checklistTimes.consumeByAt === null ? "" : fromIsoToLocalInput(checklistTimes.consumeByAt);
  const clock = consumeByLocal === "" ? null : formatClock(consumeByLocal);

  return [
    {
      text:
        clock === null
          ? "Pickup ends after it starts and before the consume-by time."
          : `Pickup ends after it starts and before ${clock} consume-by.`,
      met: firstMet,
    },
    {
      text: "Consume-by is later than prepared time.",
      met: !(consumeBy !== null && prepared !== null && consumeBy.getTime() <= prepared.getTime()),
    },
  ];
}
