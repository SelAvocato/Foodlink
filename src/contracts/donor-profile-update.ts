import { z } from "zod";
import { contactNumber } from "./auth";
import { addressWithPinSchema } from "./registration";

/**
 * The address fields the Profile screen (Figma p15) edits. Same validators as donor
 * registration, just fewer fields: province_or_state, postal_code and country_code are
 * not part of the screen, so the save copies them from the current row instead of
 * accepting them (sending one is an unknown field and a 400). The map pin stays
 * required, exactly like registration.
 */
const profileAddress = addressWithPinSchema.pick({
  streetLine1: true,
  streetLine2: true,
  barangay: true,
  city: true,
  latitude: true,
  longitude: true,
});

/**
 * Save half of the donor Profile screen: the contact number and the pickup address
 * with its map pin. Name, business name, email, donor type, status and any id are
 * shown as text on the screen and are never accepted here.
 */
export const donorProfileUpdateSchema = z.strictObject({
  contactNumber,
  address: profileAddress,
});

export type DonorProfileUpdateInput = z.infer<typeof donorProfileUpdateSchema>;
