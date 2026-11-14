import { ALLOWED_IMAGE_TYPES } from "@/contracts/image";
import { volunteerRegistrationSchema } from "@/contracts/registration";

/**
 * Mirrors MAX_PROOF_BYTES in the volunteer signup route, which is not exported.
 * The route caps signup proofs at 4 MB because Vercel rejects bodies over 4.5 MB.
 */
export const MAX_SIGNUP_PROOF_BYTES = 4 * 1024 * 1024;

export const PROOF_MESSAGE = "Proof must be a JPEG, PNG, or WebP image up to 4 MB.";

/** The keys the form can show an error under, plus "form" for anything it cannot place. */
export type RegistrationFieldKey =
  | "fullName"
  | "contactNumber"
  | "email"
  | "streetLine1"
  | "barangay"
  | "city"
  | "availability"
  | "password"
  | "consent"
  | "proof"
  | "form";

export type RegistrationFormErrors = Partial<Record<RegistrationFieldKey, string>>;

export interface VolunteerRegistrationPayload {
  fullName: string;
  contactNumber: string;
  email: string;
  /** Only the three inputs the form has; the province, postal code, country and pin are left to the schema defaults. */
  address: { streetLine1: string; barangay: string | undefined; city: string };
  availability: string | undefined;
  password: string;
  consent: true;
}

export type VolunteerFormValidation =
  | { ok: true; payload: VolunteerRegistrationPayload; proof: File }
  | { ok: false; errors: RegistrationFormErrors };

export type RegistrationResponseOutcome =
  | { kind: "success" }
  | { kind: "email_taken" }
  | { kind: "invalid"; errors: RegistrationFormErrors }
  | { kind: "failed" };

const ALLOWED_PROOF_TYPES = new Set<string>(ALLOWED_IMAGE_TYPES);

/** A missing field behaves like an empty one, so the schema's own message shows instead of a type error. */
function readText(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === "string" ? value : "";
}

/** The proof is checked here as well as on the server, so a bad file never leaves the browser. */
function readProof(formData: FormData): File | undefined {
  const value = formData.get("proof");
  if (!(value instanceof File)) return undefined;
  if (value.size === 0 || value.size > MAX_SIGNUP_PROOF_BYTES) return undefined;
  if (!ALLOWED_PROOF_TYPES.has(value.type)) return undefined;
  return value;
}

/** Turns a schema issue path into the field that shows it; anything the form cannot place goes to "form". */
function mapFieldKey(path: readonly PropertyKey[]): RegistrationFieldKey {
  const [head, second] = path;
  if (head === "address") {
    if (second === "streetLine1" || second === "barangay" || second === "city") return second;
    return "form";
  }
  switch (head) {
    case "fullName":
    case "contactNumber":
    case "email":
    case "availability":
    case "password":
    case "consent":
      return head;
    default:
      return "form";
  }
}

/**
 * Client-side validation with the same schema the route uses. Inputs stay uncontrolled:
 * the values are read here and never kept in React state.
 */
export function validateVolunteerForm(formData: FormData): VolunteerFormValidation {
  const parsed = volunteerRegistrationSchema.safeParse({
    fullName: readText(formData, "fullName"),
    contactNumber: readText(formData, "contactNumber"),
    email: readText(formData, "email"),
    address: {
      streetLine1: readText(formData, "streetLine1"),
      barangay: readText(formData, "barangay"),
      city: readText(formData, "city"),
    },
    availability: readText(formData, "availability"),
    password: readText(formData, "password"),
    consent: formData.get("consent") === "true",
  });

  const errors: RegistrationFormErrors = {};
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      const key = mapFieldKey(issue.path);
      // Only the first message per field, so a field never shows a list.
      if (errors[key] === undefined) errors[key] = issue.message;
    }
  }

  const proof = readProof(formData);
  if (proof === undefined) errors.proof = PROOF_MESSAGE;

  if (!parsed.success || proof === undefined) return { ok: false, errors };

  return {
    ok: true,
    proof,
    payload: {
      fullName: parsed.data.fullName,
      contactNumber: parsed.data.contactNumber,
      email: parsed.data.email,
      address: {
        streetLine1: parsed.data.address.streetLine1,
        barangay: parsed.data.address.barangay,
        city: parsed.data.address.city,
      },
      availability: parsed.data.availability,
      password: parsed.data.password,
      consent: parsed.data.consent,
    },
  };
}

/** The multipart body the signup route reads. No other keys, and no Content-Type header at the call site. */
export function buildRegistrationFormData(
  payload: VolunteerRegistrationPayload,
  proof: File,
): FormData {
  const formData = new FormData();
  formData.append("fullName", payload.fullName);
  formData.append("contactNumber", payload.contactNumber);
  formData.append("email", payload.email);
  formData.append("address", JSON.stringify(payload.address));
  if (typeof payload.availability === "string" && payload.availability !== "") {
    formData.append("availability", payload.availability);
  }
  formData.append("password", payload.password);
  formData.append("consent", "true");
  formData.append("proof", proof);
  return formData;
}

function readMessage(body: unknown): string | undefined {
  if (typeof body !== "object" || body === null) return undefined;
  const message = (body as { message?: unknown }).message;
  return typeof message === "string" ? message : undefined;
}

function readFieldErrors(body: unknown): Record<string, string[]> {
  if (typeof body !== "object" || body === null) return {};
  const details = (body as { details?: unknown }).details;
  if (typeof details !== "object" || details === null) return {};
  const fieldErrors = (details as { fieldErrors?: unknown }).fieldErrors;
  if (typeof fieldErrors !== "object" || fieldErrors === null) return {};

  const out: Record<string, string[]> = {};
  for (const [key, value] of Object.entries(fieldErrors)) {
    if (!Array.isArray(value)) continue;
    const list: unknown[] = value;
    const messages = list.filter((item): item is string => typeof item === "string" && item.trim() !== "");
    if (messages.length > 0) out[key] = messages;
  }
  return out;
}

/** The flat errors that belong to no field (z.flattenError formErrors), kept only when they are readable. */
function readFormErrors(body: unknown): string[] {
  if (typeof body !== "object" || body === null) return [];
  const details = (body as { details?: unknown }).details;
  if (typeof details !== "object" || details === null) return [];
  const formErrors = (details as { formErrors?: unknown }).formErrors;
  if (!Array.isArray(formErrors)) return [];

  const list: unknown[] = formErrors;
  return list.filter((item): item is string => typeof item === "string" && item.trim() !== "");
}

/** Server field names the form can show; the address and anything else is shown above the form. */
function mapServerKey(key: string): RegistrationFieldKey {
  switch (key) {
    case "fullName":
    case "contactNumber":
    case "email":
    case "availability":
    case "password":
    case "consent":
      return key;
    default:
      return "form";
  }
}

/**
 * Reads the route's answer. Server messages reach the page only through these fixed
 * mappings, so no server text is rendered as is.
 */
export function interpretRegistrationResponse(
  status: number,
  body: unknown,
): RegistrationResponseOutcome {
  if (status === 201) return { kind: "success" };
  if (status === 409) return { kind: "email_taken" };
  if (status !== 400) return { kind: "failed" };

  const errors: RegistrationFormErrors = {};
  const message = readMessage(body);
  // The route answers a refused proof with its proof message and no field details.
  if (message !== undefined && message.toLowerCase().includes("proof")) {
    errors.proof = PROOF_MESSAGE;
  }

  // Form-level errors go first so they win the shared "form" line over an unplaced field error.
  const formErrors = readFormErrors(body);
  if (formErrors.length > 0) errors.form = formErrors.join(" ");

  for (const [key, messages] of Object.entries(readFieldErrors(body))) {
    const first = messages[0];
    if (first === undefined) continue;
    const target = mapServerKey(key);
    if (errors[target] === undefined) errors[target] = first;
  }

  // A 400 the form cannot place in any field would otherwise show nothing at all.
  if (Object.keys(errors).length === 0) return { kind: "failed" };

  return { kind: "invalid", errors };
}
