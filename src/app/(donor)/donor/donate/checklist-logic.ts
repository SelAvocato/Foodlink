import { z } from "zod";
import { StorageCondition } from "@/contracts/enums";
import { SHELF_LIFE_MESSAGE, isConsumeByTooSoon } from "@/lib/min-shelf-life";
import { messageForError } from "./photo-step-logic";

/** One entry of the food-options allergen list the wizard already fetched. */
export type AllergenOption = { code: string; name: string };

/** The two food_categories flags that decide which answers this donation needs. */
export type ChecklistFlags = {
  requiresPreparedTime: boolean;
  requiresStorageInfo: boolean;
};

/** The step's form state, as the inputs show it: local strings, never dates. */
export type ChecklistForm = {
  preparedAt: string;
  consumeByAt: string;
  storageCondition: string;
  storageTemperature: string;
  allergenCodes: string[];
  noneSelected: boolean;
  packagingIntact: boolean;
  notCustomerPlateLeftovers: boolean;
};

/** What one PUT sends: only the fields the category uses, plus the confirmations. */
export type ChecklistBody = {
  preparedAt?: string;
  consumeByAt?: string;
  storageCondition?: StorageCondition;
  storageTemperatureC?: number;
  packagingIntact: boolean;
  allergensConfirmed: boolean;
  notCustomerPlateLeftovers: boolean;
};

/** The contract's own bounds; a value outside them can never be stored. */
const MIN_TEMPERATURE_C = -50;
const MAX_TEMPERATURE_C = 100;

const storageConditionSchema = z.enum(StorageCondition);

/**
 * The datetime-local value (a local wall time with no offset) as the ISO string
 * the contract accepts: the contract requires an offset and toISOString writes
 * "Z". Empty or unparseable is null, so the caller omits the field.
 */
export function toIsoWithOffset(value: string): string | null {
  if (value.trim() === "") return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString();
}

/**
 * A saved ISO datetime as the local datetime-local value in YYYY-MM-DDTHH:mm,
 * read with the local getters so the same instant shows on every machine.
 */
export function fromIsoToLocalInput(value: string | null): string {
  if (value === null) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const pad = (part: number) => String(part).padStart(2, "0");
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
    `T${pad(date.getHours())}:${pad(date.getMinutes())}`
  );
}

/** "" or a value outside the four stored conditions is not sent. */
function parseStorageCondition(value: string): StorageCondition | null {
  if (value.trim() === "") return null;
  const parsed = storageConditionSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

/** Empty, unparseable, infinite or out of range is not sent: the field stays visible. */
function parseTemperature(value: string): number | null {
  if (value.trim() === "") return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return null;
  if (parsed < MIN_TEMPERATURE_C || parsed > MAX_TEMPERATURE_C) return null;
  return parsed;
}

/**
 * The body of one PUT. Dates are converted or dropped, the storage fields only
 * exist when the category asks for them, and the three confirmations are always
 * sent as booleans (false counts as "not answered" on the server).
 */
export function buildChecklistBody(form: ChecklistForm, flags: ChecklistFlags): ChecklistBody {
  const preparedAt = flags.requiresPreparedTime ? toIsoWithOffset(form.preparedAt) : null;
  const consumeByAt = toIsoWithOffset(form.consumeByAt);
  const storageCondition = flags.requiresStorageInfo
    ? parseStorageCondition(form.storageCondition)
    : null;
  const storageTemperatureC = flags.requiresStorageInfo
    ? parseTemperature(form.storageTemperature)
    : null;

  return {
    ...(preparedAt !== null ? { preparedAt } : {}),
    ...(consumeByAt !== null ? { consumeByAt } : {}),
    ...(storageCondition !== null ? { storageCondition } : {}),
    ...(storageTemperatureC !== null ? { storageTemperatureC } : {}),
    packagingIntact: form.packagingIntact,
    allergensConfirmed: form.allergenCodes.length > 0 || form.noneSelected,
    notCustomerPlateLeftovers: form.notCustomerPlateLeftovers,
  };
}

/**
 * The client-side copy of the server's five-month rule for sealed packaged food
 * and beverages: the message to show under consume-by, or null when it passes.
 */
export function shelfLifeMessage(
  form: ChecklistForm,
  categoryCode: string,
  now: Date,
): string | null {
  const consumeBy = toIsoWithOffset(form.consumeByAt);
  if (consumeBy === null) return null;
  return isConsumeByTooSoon(categoryCode, new Date(consumeBy), now) ? SHELF_LIFE_MESSAGE : null;
}

/** Ticking an allergen always unticks None; unticking the last one does not tick it. */
export function toggleAllergen(form: ChecklistForm, code: string): ChecklistForm {
  const already = form.allergenCodes.includes(code);
  return {
    ...form,
    allergenCodes: already
      ? form.allergenCodes.filter((entry) => entry !== code)
      : [...form.allergenCodes, code],
    noneSelected: already ? form.noneSelected : false,
  };
}

/** Ticking None clears every allergen; unticking it leaves the (empty) list alone. */
export function toggleNone(form: ChecklistForm): ChecklistForm {
  if (form.noneSelected) return { ...form, noneSelected: false };
  return { ...form, noneSelected: true, allergenCodes: [] };
}

/** The saved answers as the form shows them; no row is an empty form. */
export function deriveInitialForm(input: {
  checklist: ChecklistView | null;
  allergenCodes: string[];
}): ChecklistForm {
  const { checklist, allergenCodes } = input;
  return {
    preparedAt: fromIsoToLocalInput(checklist?.preparedAt ?? null),
    consumeByAt: fromIsoToLocalInput(checklist?.consumeByAt ?? null),
    storageCondition: checklist?.storageCondition ?? "",
    storageTemperature:
      checklist === null || checklist.storageTemperatureC === null
        ? ""
        : String(checklist.storageTemperatureC),
    allergenCodes: [...allergenCodes],
    // Confirmed with nothing ticked is how the database records "None": the
    // confirmation is true even when there are no allergens at all.
    noneSelected: checklist?.allergensConfirmed === true && allergenCodes.length === 0,
    packagingIntact: checklist?.packagingIntact === true,
    notCustomerPlateLeftovers: checklist?.notCustomerPlateLeftovers === true,
  };
}

const MISSING_MESSAGES: Record<string, string> = {
  consumeByAt: "Add a consume-by time.",
  packagingIntact: "Confirm that the packaging is intact.",
  allergensConfirmed: "Declare the allergens, or tick None.",
  notCustomerPlateLeftovers: "Confirm the food is not plate leftovers.",
  preparedAt: "Add the time prepared.",
  storageCondition: "Choose a storage condition.",
  storageTemperatureC: "Add the storage temperature (between -50 and 100 °C).",
};

/**
 * The server's missing codes as short plain lines. The server only ever emits
 * the codes above; anything else is dropped rather than shown as server text.
 */
export function missingMessages(missing: string[]): string[] {
  const messages: string[] = [];
  for (const code of missing) {
    if (Object.hasOwn(MISSING_MESSAGES, code)) messages.push(MISSING_MESSAGES[code]);
  }
  return messages;
}

/** The refusals only the checklist route returns; every other code shares the photo step's wording. */
const CHECKLIST_ERROR_MESSAGES: Record<string, string> = {
  CONSUME_BY_NOT_AFTER_PREPARED: "The consume-by time must be after the prepared time.",
  CONSUME_BY_NOT_AFTER_PICKUP_END: "The consume-by time must be after the pickup window ends.",
  CONSUME_BY_TOO_SOON: SHELF_LIFE_MESSAGE,
};

/** Messages come from the code only; an unknown code or none at all is the generic one. */
export function messageForChecklistError(code: string | undefined): string {
  if (code !== undefined && Object.hasOwn(CHECKLIST_ERROR_MESSAGES, code)) {
    return CHECKLIST_ERROR_MESSAGES[code];
  }
  return messageForError(code);
}

const saveResponseSchema = z.strictObject({
  donationId: z.string().min(1),
  complete: z.boolean(),
  missing: z.array(z.string()),
});

export type ChecklistSaveResponse = {
  donationId: string;
  complete: boolean;
  missing: string[];
};

/** The PUT 200 body, or null when it is not that response (the step shows the generic error). */
export function parseSaveResponse(body: unknown): ChecklistSaveResponse | null {
  const parsed = saveResponseSchema.safeParse(body);
  return parsed.success ? parsed.data : null;
}

/**
 * The checklist row as GET returns it. Loose so a field added later never breaks
 * the read; the seven fields the form reads must have their real types.
 */
const checklistViewSchema = z.looseObject({
  preparedAt: z.string().nullable(),
  consumeByAt: z.string().nullable(),
  storageCondition: z.enum(StorageCondition).nullable(),
  storageTemperatureC: z.number().nullable(),
  packagingIntact: z.boolean().nullable(),
  allergensConfirmed: z.boolean().nullable(),
  notCustomerPlateLeftovers: z.boolean().nullable(),
});

export type ChecklistView = z.infer<typeof checklistViewSchema>;

/** The documented GET envelope, extra keys tolerated. */
const checklistLoadSchema = z.looseObject({
  checklist: checklistViewSchema.nullable(),
  complete: z.boolean(),
  missing: z.array(z.string()),
});

/**
 * null (the "no row" answer) and "this body is not that response" must stay
 * apart: a malformed body is a failed load, not an empty checklist.
 */
export type ChecklistLoad =
  | { ok: true; checklist: ChecklistView | null }
  | { ok: false };

export function parseChecklistLoad(body: unknown): ChecklistLoad {
  const parsed = checklistLoadSchema.safeParse(body);
  return parsed.success ? { ok: true, checklist: parsed.data.checklist } : { ok: false };
}

/**
 * The wizard has no description field, so the OTHER option drops the server's
 * "specify in description" and just says what it is.
 */
export function allergenLabel(allergen: AllergenOption): string {
  return allergen.code === "OTHER" ? "Other allergen" : allergen.name;
}

const draftEntrySchema = z.looseObject({
  id: z.string(),
  allergenCodes: z.array(z.string()),
});

const draftsEnvelopeSchema = z.looseObject({ drafts: z.array(z.unknown()) });

/**
 * The resumed draft's allergen codes, read from the drafts list the wizard
 * already fetched (resume-logic's lookup keeps no allergens). null when the
 * wanted entry has no usable list: guessing "" would tick None and clear
 * allergens that really exist.
 */
export function allergenCodesFromDraftList(body: unknown, id: string): string[] | null {
  const envelope = draftsEnvelopeSchema.safeParse(body);
  if (!envelope.success) return null;
  for (const entry of envelope.data.drafts) {
    // One entry at a time, so an unrelated bad entry cannot hide the wanted one.
    const parsed = draftEntrySchema.safeParse(entry);
    if (!parsed.success || parsed.data.id !== id) continue;
    return [...parsed.data.allergenCodes];
  }
  return null;
}
