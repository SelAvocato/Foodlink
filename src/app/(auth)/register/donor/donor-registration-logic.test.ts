import { describe, expect, it } from "vitest";
import {
  MAP_PIN_MESSAGE,
  buildRegistrationFormData,
  interpretDonorRegistrationResponse,
  validateDonorForm,
  type DonorMapPin,
  type DonorRegistrationPayload,
} from "./donor-registration-logic";
import { MAX_SIGNUP_PROOF_BYTES, PROOF_MESSAGE } from "../volunteer/registration-form-logic";

/** Obviously fake coordinates: the map step is not built, so no real pin exists in these tests. */
const PIN: DonorMapPin = { latitude: 1.2345, longitude: 6.7891 };

function pngFile(): File {
  return new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])], "permit.png", {
    type: "image/png",
  });
}

/** A field set to null is left out, which is what a missing input sends. */
function validFormData(patch: Record<string, string | File | null> = {}): FormData {
  const values: Record<string, string | File | null> = {
    donorType: "ESTABLISHMENT",
    businessName: "Test Bakery",
    fullName: "Test Donor",
    contactNumber: "0917 123 4567",
    email: "donor@example.com",
    streetLine1: "123 Katipunan Ave",
    barangay: "Barangay Test",
    city: "Quezon City",
    password: "TestDonor1!",
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
  const result = validateDonorForm(validFormData(patch), PIN);
  if (result.ok) throw new Error("expected the form to fail");
  return result.errors;
}

const payload: DonorRegistrationPayload = {
  donorType: "ESTABLISHMENT",
  businessName: "Test Bakery",
  fullName: "Test Donor",
  contactNumber: "09171234567",
  email: "donor@example.com",
  address: {
    streetLine1: "123 Katipunan Ave",
    barangay: "Barangay Test",
    city: "Quezon City",
    latitude: PIN.latitude,
    longitude: PIN.longitude,
  },
  password: "TestDonor1!",
  consent: true,
};

describe("validateDonorForm", () => {
  it("passes a fully valid establishment form", () => {
    const result = validateDonorForm(validFormData(), PIN);

    expect(result.ok).toBe(true);
  });

  it("refuses an establishment without a business name", () => {
    expect(errorsFor({ businessName: null }).businessName).toBe("Enter the business name");
  });

  it("accepts an individual with an empty business name and never sends it", () => {
    const result = validateDonorForm(
      validFormData({ donorType: "INDIVIDUAL", businessName: "" }),
      PIN,
    );
    if (!result.ok) throw new Error("expected the form to pass");

    expect(result.payload).not.toHaveProperty("businessName");
    expect(buildRegistrationFormData(result.payload, result.proof).has("businessName")).toBe(false);
  });

  it("puts the business name in the FormData for an establishment", () => {
    const result = validateDonorForm(validFormData({ businessName: "Test Bakery" }), PIN);
    if (!result.ok) throw new Error("expected the form to pass");

    const formData = buildRegistrationFormData(result.payload, result.proof);
    expect(formData.get("businessName")).toBe("Test Bakery");
  });

  it("refuses a missing map pin without a payload", () => {
    const result = validateDonorForm(validFormData(), null);

    expect(result.ok).toBe(false);
    expect(result).not.toHaveProperty("payload");
    if (result.ok) return;
    expect(result.errors.mapPin).toBe(MAP_PIN_MESSAGE);
  });

  it("accepts a map pin and keeps its coordinates in the payload", () => {
    const result = validateDonorForm(validFormData(), PIN);
    if (!result.ok) throw new Error("expected the form to pass");

    expect(result.payload.address.latitude).toBe(PIN.latitude);
    expect(result.payload.address.longitude).toBe(PIN.longitude);
  });

  it("accepts a phone number with spaces", () => {
    const result = validateDonorForm(validFormData({ contactNumber: "0917 123 4567" }), PIN);
    if (!result.ok) throw new Error("expected the form to pass");

    expect(result.payload.contactNumber).toBe("09171234567");
  });

  it("refuses a weak password", () => {
    expect(errorsFor({ password: "short" }).password).toBe("Use at least 8 characters");
  });

  it("refuses an unticked consent", () => {
    expect(errorsFor({ consent: null }).consent).toBe(
      "You must accept the Data Privacy Act consent",
    );
  });

  it("puts a missing street on streetLine1 and a missing city on city", () => {
    const errors = errorsFor({ streetLine1: null, city: null });

    expect(errors.streetLine1).toBe("Enter the street address");
    expect(errors.city).toBe("Enter the city");
  });

  it("accepts a blank barangay and leaves it out of the payload", () => {
    const result = validateDonorForm(validFormData({ barangay: null }), PIN);
    if (!result.ok) throw new Error("expected the form to pass");

    expect(result.payload.address.barangay).toBeUndefined();
  });
});

describe("validateDonorForm proof", () => {
  it("rejects a missing file", () => {
    expect(errorsFor({ proof: null }).proof).toBe(PROOF_MESSAGE);
  });

  it("rejects an empty file", () => {
    const empty = new File([], "permit.png", { type: "image/png" });

    expect(errorsFor({ proof: empty }).proof).toBe(PROOF_MESSAGE);
  });

  it("rejects the wrong file type", () => {
    const text = new File(["hello"], "permit.txt", { type: "text/plain" });

    expect(errorsFor({ proof: text }).proof).toBe(PROOF_MESSAGE);
  });

  it("rejects a file over 4 MB", () => {
    const large = new File([new Uint8Array(MAX_SIGNUP_PROOF_BYTES + 1)], "permit.png", {
      type: "image/png",
    });

    expect(errorsFor({ proof: large }).proof).toBe(PROOF_MESSAGE);
  });

  it("accepts a small PNG", () => {
    const result = validateDonorForm(validFormData({ proof: pngFile() }), PIN);
    if (!result.ok) throw new Error("expected the form to pass");

    expect(result.proof.type).toBe("image/png");
  });
});

describe("buildRegistrationFormData", () => {
  it("sends exactly the expected keys", () => {
    const formData = buildRegistrationFormData(payload, pngFile());

    expect([...formData.keys()]).toEqual([
      "donorType",
      "fullName",
      "businessName",
      "contactNumber",
      "email",
      "address",
      "password",
      "consent",
      "proof",
    ]);
  });

  it("sends the donor type", () => {
    const formData = buildRegistrationFormData(payload, pngFile());

    expect(formData.get("donorType")).toBe("ESTABLISHMENT");
  });

  it("sends the address as JSON with the map pin", () => {
    const formData = buildRegistrationFormData(payload, pngFile());
    const address = formData.get("address");

    expect(typeof address).toBe("string");
    const parsed: unknown = JSON.parse(typeof address === "string" ? address : "null");
    expect(parsed).toEqual({
      streetLine1: "123 Katipunan Ave",
      barangay: "Barangay Test",
      city: "Quezon City",
      latitude: PIN.latitude,
      longitude: PIN.longitude,
    });
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

  it("leaves businessName out for an individual", () => {
    const individual: DonorRegistrationPayload = {
      ...payload,
      donorType: "INDIVIDUAL",
      businessName: undefined,
    };
    const formData = buildRegistrationFormData(individual, pngFile());

    expect(formData.get("donorType")).toBe("INDIVIDUAL");
    expect(formData.has("businessName")).toBe(false);
  });
});

describe("interpretDonorRegistrationResponse", () => {
  it("reads 201 as success", () => {
    expect(
      interpretDonorRegistrationResponse(201, { userId: "u1", status: "PENDING" }),
    ).toEqual({ kind: "success" });
  });

  it("reads 409 as a taken email", () => {
    expect(interpretDonorRegistrationResponse(409, { error: "EMAIL_TAKEN" })).toEqual({
      kind: "email_taken",
    });
  });

  it("maps a top-level field error by name", () => {
    const outcome = interpretDonorRegistrationResponse(400, {
      error: "INVALID_REQUEST",
      message: "Some registration fields are invalid.",
      details: { formErrors: [], fieldErrors: { businessName: ["Enter the business name"] } },
    });

    expect(outcome).toEqual({
      kind: "invalid",
      errors: { businessName: "Enter the business name" },
    });
  });

  it("sends a nested address error to the form line", () => {
    const outcome = interpretDonorRegistrationResponse(400, {
      error: "INVALID_REQUEST",
      message: "Some registration fields are invalid.",
      details: { formErrors: [], fieldErrors: { "address.city": ["Enter the city"] } },
    });

    expect(outcome).toEqual({ kind: "invalid", errors: { form: "Enter the city" } });
  });

  it("shows formErrors that belong to no field", () => {
    const outcome = interpretDonorRegistrationResponse(400, {
      error: "INVALID_REQUEST",
      message: "Some registration fields are invalid.",
      details: { formErrors: ["Unrecognized key: businessName"], fieldErrors: {} },
    });

    expect(outcome).toEqual({
      kind: "invalid",
      errors: { form: "Unrecognized key: businessName" },
    });
  });

  it("reads the proof message as a proof error", () => {
    const outcome = interpretDonorRegistrationResponse(400, {
      error: "INVALID_REQUEST",
      message: PROOF_MESSAGE,
    });

    expect(outcome).toEqual({ kind: "invalid", errors: { proof: PROOF_MESSAGE } });
  });

  it("reads a 400 with no readable body as failed", () => {
    expect(interpretDonorRegistrationResponse(400, null)).toEqual({ kind: "failed" });
  });

  it("reads an unrecognized 400 message with no usable details as failed", () => {
    const outcome = interpretDonorRegistrationResponse(400, {
      error: "INVALID_REQUEST",
      message: "Address must be valid JSON.",
      details: { formErrors: [], fieldErrors: {} },
    });

    expect(outcome).toEqual({ kind: "failed" });
  });

  it("reads any other status as failed", () => {
    expect(interpretDonorRegistrationResponse(500, { error: "INTERNAL_ERROR" })).toEqual({
      kind: "failed",
    });
  });
});
