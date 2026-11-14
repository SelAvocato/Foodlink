import { describe, expect, it } from "vitest";
import {
  MAX_SIGNUP_PROOF_BYTES,
  PROOF_MESSAGE,
  buildRegistrationFormData,
  interpretRegistrationResponse,
  validateVolunteerForm,
  type VolunteerRegistrationPayload,
} from "./registration-form-logic";

function pngFile(): File {
  return new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])], "id.png", {
    type: "image/png",
  });
}

/** A field set to null is left out, which is what a missing input sends. */
function validFormData(patch: Record<string, string | File | null> = {}): FormData {
  const values: Record<string, string | File | null> = {
    fullName: "Test Volunteer",
    contactNumber: "+63 917 123 4567",
    email: "volunteer@example.com",
    streetLine1: "12 Mabini Street",
    barangay: "Barangay San Isidro",
    city: "Quezon City",
    availability: "Saturdays, 8:00 AM–12:00 PM",
    password: "Volunteer1!",
    consent: "true",
    proof: pngFile(),
    ...patch,
  };

  const formData = new FormData();
  for (const [key, value] of Object.entries(values)) {
    if (value !== null) formData.set(key, value);
  }
  return formData;
}

function errorsFor(patch: Record<string, string | File | null>) {
  const result = validateVolunteerForm(validFormData(patch));
  if (result.ok) throw new Error("expected the form to fail");
  return result.errors;
}

const payload: VolunteerRegistrationPayload = {
  fullName: "Test Volunteer",
  contactNumber: "+639171234567",
  email: "volunteer@example.com",
  address: { streetLine1: "12 Mabini Street", barangay: "Barangay San Isidro", city: "Quezon City" },
  availability: "Saturdays",
  password: "Volunteer1!",
  consent: true,
};

describe("validateVolunteerForm", () => {
  it("passes a fully valid form", () => {
    const result = validateVolunteerForm(validFormData());

    expect(result.ok).toBe(true);
  });

  it("returns a payload with only the fields the form has", () => {
    const result = validateVolunteerForm(validFormData());
    if (!result.ok) throw new Error("expected the form to pass");

    expect(result.payload).toEqual({
      fullName: "Test Volunteer",
      contactNumber: "+639171234567",
      email: "volunteer@example.com",
      address: {
        streetLine1: "12 Mabini Street",
        barangay: "Barangay San Isidro",
        city: "Quezon City",
      },
      availability: "Saturdays, 8:00 AM–12:00 PM",
      password: "Volunteer1!",
      consent: true,
    });
    expect(Object.keys(result.payload.address)).toEqual(["streetLine1", "barangay", "city"]);
    expect(result.payload.address).not.toHaveProperty("latitude");
    expect(result.payload.address).not.toHaveProperty("countryCode");
  });

  it("puts a missing full name on fullName", () => {
    expect(errorsFor({ fullName: null }).fullName).toBe("Enter your full name");
  });

  it("puts an invalid email on email", () => {
    expect(errorsFor({ email: "not-an-email" }).email).toBe("Enter a valid email address");
  });

  it("puts a short password on password", () => {
    expect(errorsFor({ password: "short" }).password).toBe("Use at least 8 characters");
  });

  it("puts an unchecked consent on consent", () => {
    expect(errorsFor({ consent: null }).consent).toBe(
      "You must accept the Data Privacy Act consent",
    );
  });

  it("puts a missing street on streetLine1 and a missing city on city", () => {
    const errors = errorsFor({ streetLine1: null, city: null });

    expect(errors.streetLine1).toBe("Enter the street address");
    expect(errors.city).toBe("Enter the city");
  });

  it("keeps a street that is only markup on streetLine1", () => {
    // "<>" is stripped to nothing, so the street counts as empty.
    expect(errorsFor({ streetLine1: "<>" }).streetLine1).toBe("Enter the street address");
  });

  it("accepts a blank barangay and a blank availability", () => {
    const result = validateVolunteerForm(validFormData({ barangay: null, availability: null }));

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.payload.address.barangay).toBeUndefined();
    expect(result.payload.availability).toBeUndefined();
  });

  it("shows only one message per field", () => {
    const errors = errorsFor({ password: "a" });

    expect(typeof errors.password).toBe("string");
    expect(errors.password).toBe("Use at least 8 characters");
  });
});

describe("validateVolunteerForm proof", () => {
  it("rejects a missing file", () => {
    expect(errorsFor({ proof: null }).proof).toBe(PROOF_MESSAGE);
  });

  it("rejects an empty file", () => {
    const empty = new File([], "id.png", { type: "image/png" });

    expect(errorsFor({ proof: empty }).proof).toBe(PROOF_MESSAGE);
  });

  it("rejects a text file", () => {
    const text = new File(["hello"], "id.txt", { type: "text/plain" });

    expect(errorsFor({ proof: text }).proof).toBe(PROOF_MESSAGE);
  });

  it("rejects a file over 4 MB", () => {
    const large = new File([new Uint8Array(MAX_SIGNUP_PROOF_BYTES + 1)], "id.png", {
      type: "image/png",
    });

    expect(errorsFor({ proof: large }).proof).toBe(PROOF_MESSAGE);
  });

  it("accepts a small PNG", () => {
    const result = validateVolunteerForm(validFormData({ proof: pngFile() }));

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.proof.type).toBe("image/png");
  });
});

describe("buildRegistrationFormData", () => {
  it("sends exactly the expected keys", () => {
    const formData = buildRegistrationFormData(payload, pngFile());

    expect([...formData.keys()]).toEqual([
      "fullName",
      "contactNumber",
      "email",
      "address",
      "availability",
      "password",
      "consent",
      "proof",
    ]);
  });

  it("sends the address as JSON that parses back", () => {
    const formData = buildRegistrationFormData(payload, pngFile());
    const address = formData.get("address");

    expect(typeof address).toBe("string");
    const parsed: unknown = JSON.parse(typeof address === "string" ? address : "null");
    expect(parsed).toEqual({
      streetLine1: "12 Mabini Street",
      barangay: "Barangay San Isidro",
      city: "Quezon City",
    });
  });

  it("leaves availability out when it is blank and sends it when it has text", () => {
    const blank = buildRegistrationFormData({ ...payload, availability: undefined }, pngFile());
    const text = buildRegistrationFormData(payload, pngFile());

    expect(blank.has("availability")).toBe(false);
    expect(text.get("availability")).toBe("Saturdays");
  });

  it("sends consent as the string true", () => {
    const formData = buildRegistrationFormData(payload, pngFile());

    expect(formData.get("consent")).toBe("true");
  });

  it("sends the proof file as is", () => {
    const proof = pngFile();
    const formData = buildRegistrationFormData(payload, proof);

    expect(formData.get("proof")).toBe(proof);
  });
});

describe("interpretRegistrationResponse", () => {
  it("reads 201 as success", () => {
    expect(interpretRegistrationResponse(201, { userId: "u1", status: "PENDING" })).toEqual({
      kind: "success",
    });
  });

  it("reads 409 as a taken email", () => {
    expect(interpretRegistrationResponse(409, { error: "EMAIL_TAKEN" })).toEqual({
      kind: "email_taken",
    });
  });

  it("maps a field error for email", () => {
    const outcome = interpretRegistrationResponse(400, {
      error: "INVALID_REQUEST",
      message: "Some registration fields are invalid.",
      details: { formErrors: [], fieldErrors: { email: ["Enter a valid email address"] } },
    });

    expect(outcome).toEqual({
      kind: "invalid",
      errors: { email: "Enter a valid email address" },
    });
  });

  it("shows a nested address error above the form", () => {
    const outcome = interpretRegistrationResponse(400, {
      error: "INVALID_REQUEST",
      message: "Some registration fields are invalid.",
      details: { formErrors: [], fieldErrors: { address: ["Enter the city"] } },
    });

    expect(outcome).toEqual({ kind: "invalid", errors: { form: "Enter the city" } });
  });

  it("reads the proof message as a proof error", () => {
    const outcome = interpretRegistrationResponse(400, {
      error: "INVALID_REQUEST",
      message: PROOF_MESSAGE,
    });

    expect(outcome).toEqual({ kind: "invalid", errors: { proof: PROOF_MESSAGE } });
  });

  it("reads any other status as failed", () => {
    expect(interpretRegistrationResponse(500, { error: "INTERNAL_ERROR" })).toEqual({
      kind: "failed",
    });
  });

  it("reads an unreadable body as failed", () => {
    expect(interpretRegistrationResponse(502, null)).toEqual({ kind: "failed" });
  });

  it("shows a form-level error above the form", () => {
    const outcome = interpretRegistrationResponse(400, {
      error: "INVALID_REQUEST",
      message: "Some registration fields are invalid.",
      details: { formErrors: ["Enter your street address"], fieldErrors: {} },
    });

    expect(outcome).toEqual({ kind: "invalid", errors: { form: "Enter your street address" } });
  });

  it("joins several form-level errors with a space", () => {
    const outcome = interpretRegistrationResponse(400, {
      error: "INVALID_REQUEST",
      message: "Some registration fields are invalid.",
      details: { formErrors: ["Enter your street address", "Enter the city"] },
    });

    expect(outcome).toEqual({
      kind: "invalid",
      errors: { form: "Enter your street address Enter the city" },
    });
  });

  it("reads a 400 with no readable body as failed, not as an empty invalid", () => {
    // The form shows its general message for a failed outcome.
    expect(interpretRegistrationResponse(400, null)).toEqual({ kind: "failed" });
  });

  it("reads a 400 with an unrecognized message and no usable details as failed", () => {
    const outcome = interpretRegistrationResponse(400, {
      error: "INVALID_REQUEST",
      message: "Address must be valid JSON.",
      details: { formErrors: [], fieldErrors: {} },
    });

    expect(outcome).toEqual({ kind: "failed" });
  });

  it("ignores details it cannot read and falls back to failed", () => {
    const outcome = interpretRegistrationResponse(400, {
      error: "INVALID_REQUEST",
      message: "Some registration fields are invalid.",
      details: { formErrors: [""], fieldErrors: { email: [] } },
    });

    expect(outcome).toEqual({ kind: "failed" });
  });
});
