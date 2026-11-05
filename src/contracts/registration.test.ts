import { describe, expect, it } from "vitest";
import { addressSchema, donorRegistrationSchema, volunteerRegistrationSchema } from "./registration";

const address = {
  streetLine1: "123 Katipunan Ave",
  barangay: "Loyola Heights",
  city: "Quezon City",
  latitude: 14.676,
  longitude: 121.0437,
};
const base = {
  fullName: "Juan Dela Cruz",
  contactNumber: "0917 123-4567",
  email: " Juan@Example.PH ",
  address,
  password: "Abcdef1!",
  consent: true,
};
const withoutPin: Record<string, unknown> = { ...address };
delete withoutPin.latitude;
delete withoutPin.longitude;
const establishment = { ...base, donorType: "ESTABLISHMENT", businessName: "Juan's Bakery" };
const individual = { ...base, donorType: "INDIVIDUAL" };

describe("donorRegistrationSchema", () => {
  it("accepts an establishment and normalizes email, phone and country", () => {
    const result = donorRegistrationSchema.parse(establishment);
    expect(result.email).toBe("juan@example.ph");
    expect(result.contactNumber).toBe("09171234567");
    expect(result.address.countryCode).toBe("PH");
  });
  it("accepts an individual without a business name", () => {
    expect(donorRegistrationSchema.safeParse(individual).success).toBe(true);
  });
  it("rejects an individual with a business name", () => {
    expect(donorRegistrationSchema.safeParse({ ...individual, businessName: "Juan's Bakery" }).success).toBe(false);
  });
  it("rejects an establishment without a business name", () => {
    const body: Record<string, unknown> = { ...establishment };
    delete body.businessName;
    expect(donorRegistrationSchema.safeParse(body).success).toBe(false);
  });
  it("rejects an unknown donor type", () => {
    expect(donorRegistrationSchema.safeParse({ ...individual, donorType: "RECEIVER" }).success).toBe(false);
  });
  it("requires the privacy consent to be true", () => {
    expect(donorRegistrationSchema.safeParse({ ...individual, consent: false }).success).toBe(false);
    const body: Record<string, unknown> = { ...individual };
    delete body.consent;
    expect(donorRegistrationSchema.safeParse(body).success).toBe(false);
  });
  it("rejects unknown fields such as role or status", () => {
    expect(donorRegistrationSchema.safeParse({ ...individual, role: "ADMIN" }).success).toBe(false);
    expect(donorRegistrationSchema.safeParse({ ...individual, status: "ACTIVE" }).success).toBe(false);
  });
  it("rejects a weak password", () => {
    expect(donorRegistrationSchema.safeParse({ ...individual, password: "abcdefgh" }).success).toBe(false);
  });
  it("requires a map pin for donors", () => {
    expect(donorRegistrationSchema.safeParse({ ...individual, address: withoutPin }).success).toBe(false);
  });
  it("rejects a map pin outside the valid range", () => {
    expect(donorRegistrationSchema.safeParse({ ...individual, address: { ...address, latitude: 91 } }).success).toBe(false);
    expect(donorRegistrationSchema.safeParse({ ...individual, address: { ...address, longitude: -181 } }).success).toBe(false);
  });
  it("accepts names up to the database limits", () => {
    expect(
      donorRegistrationSchema.safeParse({ ...establishment, fullName: "a".repeat(160), businessName: "b".repeat(180) }).success,
    ).toBe(true);
    expect(donorRegistrationSchema.safeParse({ ...individual, fullName: "a".repeat(161) }).success).toBe(false);
  });
});

describe("addressSchema", () => {
  const noPin = withoutPin;
  it("accepts an address without a map pin", () => {
    expect(addressSchema.safeParse(noPin).success).toBe(true);
  });
  it("requires latitude and longitude together", () => {
    expect(addressSchema.safeParse({ ...noPin, latitude: 14.6 }).success).toBe(false);
    expect(addressSchema.safeParse({ ...noPin, longitude: 121 }).success).toBe(false);
  });
  it("requires street and city", () => {
    expect(addressSchema.safeParse({ ...noPin, streetLine1: " " }).success).toBe(false);
    expect(addressSchema.safeParse({ ...noPin, city: "" }).success).toBe(false);
  });
  it("turns empty optional fields into undefined and uppercases the country", () => {
    const result = addressSchema.parse({ ...noPin, streetLine2: "", postalCode: "  ", countryCode: "ph" });
    expect(result.streetLine2).toBeUndefined();
    expect(result.postalCode).toBeUndefined();
    expect(result.countryCode).toBe("PH");
  });
  it("rejects unknown fields and a bad country code", () => {
    expect(addressSchema.safeParse({ ...noPin, id: "x" }).success).toBe(false);
    expect(addressSchema.safeParse({ ...noPin, countryCode: "PHL" }).success).toBe(false);
  });
});

describe("volunteerRegistrationSchema", () => {
  const volunteer = { ...base, address: withoutPin, availability: "Weekends, mornings" };
  it("accepts a volunteer with or without a map pin", () => {
    expect(volunteerRegistrationSchema.safeParse(volunteer).success).toBe(true);
    expect(volunteerRegistrationSchema.safeParse({ ...volunteer, address }).success).toBe(true);
  });
  it("normalizes email and phone and treats empty availability as missing", () => {
    const result = volunteerRegistrationSchema.parse({ ...volunteer, availability: "  " });
    expect(result.email).toBe("juan@example.ph");
    expect(result.contactNumber).toBe("09171234567");
    expect(result.availability).toBeUndefined();
  });
  it("accepts a volunteer with no availability field", () => {
    const body: Record<string, unknown> = { ...volunteer };
    delete body.availability;
    expect(volunteerRegistrationSchema.safeParse(body).success).toBe(true);
  });
  it("requires the address", () => {
    const body: Record<string, unknown> = { ...volunteer };
    delete body.address;
    expect(volunteerRegistrationSchema.safeParse(body).success).toBe(false);
  });
  it("requires the privacy consent to be true", () => {
    expect(volunteerRegistrationSchema.safeParse({ ...volunteer, consent: false }).success).toBe(false);
  });
  it("rejects donor fields and other unknown fields", () => {
    expect(volunteerRegistrationSchema.safeParse({ ...volunteer, donorType: "INDIVIDUAL" }).success).toBe(false);
    expect(volunteerRegistrationSchema.safeParse({ ...volunteer, businessName: "Bakery" }).success).toBe(false);
    expect(volunteerRegistrationSchema.safeParse({ ...volunteer, role: "ADMIN" }).success).toBe(false);
  });
  it("rejects a weak password and an availability note over 500 characters", () => {
    expect(volunteerRegistrationSchema.safeParse({ ...volunteer, password: "abcdefgh" }).success).toBe(false);
    expect(volunteerRegistrationSchema.safeParse({ ...volunteer, availability: "x".repeat(501) }).success).toBe(false);
  });
});