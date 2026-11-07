import type { VolunteerRegistrationInput } from "@/contracts/registration";
import {
  registerAccount,
  type RegisterAccountDeps,
  type RegisterAccountResult,
} from "./register-account";

export type RegisterVolunteerDeps = RegisterAccountDeps;
export type RegisterVolunteerResult = RegisterAccountResult;

export async function registerVolunteer(
  deps: RegisterVolunteerDeps,
  input: VolunteerRegistrationInput,
  proof: Uint8Array,
): Promise<RegisterVolunteerResult> {
  const { address } = input;
  return registerAccount(
    deps,
    {
      email: input.email,
      password: input.password,
      address: {
        streetLine1: address.streetLine1,
        streetLine2: address.streetLine2 ?? null,
        barangay: address.barangay ?? null,
        city: address.city,
        provinceOrState: address.provinceOrState ?? null,
        postalCode: address.postalCode ?? null,
        countryCode: address.countryCode,
        latitude: address.latitude ?? null,
        longitude: address.longitude ?? null,
      },
      user: {
        role: "VOLUNTEER",
        fullName: input.fullName,
        contactNumber: input.contactNumber,
        donorType: null,
        businessName: null,
        availability: input.availability ?? null,
      },
      documentTypeCode: "VALID_ID",
    },
    proof,
  );
}
