import type { StorageCondition } from "./enums";

/**
 * The donor's safety checklist as the assigned volunteer reads it on the pickup
 * inspection screen. Only the safety fields are here: no donor identity, contact
 * details or QR token may ever be added to this shape.
 */
export type VolunteerChecklistResponse = {
  preparedAt: string | null;
  consumeByAt: string | null;
  storageCondition: StorageCondition | null;
  storageTemperatureC: number | null;
  packagingIntact: boolean | null;
  allergensConfirmed: boolean | null;
  notCustomerPlateLeftovers: boolean | null;
  allergens: string[];
};
