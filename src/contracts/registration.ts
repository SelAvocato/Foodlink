import { z } from "zod";
import { contactNumber, email, password } from "./auth";
import { DonorType } from "./enums";

/** Stored in user_consents.consent_type and policy_version. Bump the version when the privacy notice text changes. */
export const PRIVACY_CONSENT_TYPE = "PRIVACY_POLICY";
export const PRIVACY_POLICY_VERSION = "1.0";

const fullName = z.string().trim().min(2, "Enter your full name").max(160, "Name is too long");
const businessName = z.string().trim().min(2, "Enter the business name").max(180, "Business name is too long");
const consent = z.literal(true, { error: "You must accept the Data Privacy Act consent" });

/** Form inputs send "" for an empty optional field. Turn it into undefined so the database gets NULL. */
const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max, `Use at most ${max} characters`)
    .transform((value) => (value === "" ? undefined : value))
    .optional();

const latitude = z.number().min(-90, "Invalid map pin").max(90, "Invalid map pin");
const longitude = z.number().min(-180, "Invalid map pin").max(180, "Invalid map pin");

/** Mirrors the addresses table in db/baseline/001_schema.sql. */
const addressFields = {
  streetLine1: z.string().trim().min(1, "Enter the street address").max(200, "Street address is too long"),
  streetLine2: optionalText(200),
  barangay: optionalText(120),
  city: z.string().trim().min(1, "Enter the city").max(120, "City is too long"),
  provinceOrState: optionalText(120),
  postalCode: optionalText(20),
  countryCode: z
    .string()
    .trim()
    .toUpperCase()
    .pipe(z.string().regex(/^[A-Z]{2}$/, "Use a 2-letter country code"))
    .default("PH"),
};

/** Map pin optional, but latitude and longitude come together (the database requires both or neither). */
export const addressSchema = z
  .strictObject({ ...addressFields, latitude: latitude.optional(), longitude: longitude.optional() })
  .refine((a) => (a.latitude === undefined) === (a.longitude === undefined), {
    message: "Send both latitude and longitude, or neither",
    path: ["latitude"],
  });

/** Donors must place a map pin. */
export const addressWithPinSchema = z.strictObject({ ...addressFields, latitude, longitude });

/** Fields every Donor sends. The proof image is uploaded separately and checked with src/contracts/image.ts. */
const donorBase = {
  fullName,
  contactNumber,
  email,
  address: addressWithPinSchema,
  password,
  consent,
};

/**
 * Establishments need a business name. Individuals must not send one, so the strict object rejects it.
 * The consent time and the account status are set by the server, never read from the body.
 */
export const donorRegistrationSchema = z.discriminatedUnion("donorType", [
  z.strictObject({ donorType: z.literal(DonorType.ESTABLISHMENT), businessName, ...donorBase }),
  z.strictObject({ donorType: z.literal(DonorType.INDIVIDUAL), ...donorBase }),
]);
export type DonorRegistrationInput = z.infer<typeof donorRegistrationSchema>;