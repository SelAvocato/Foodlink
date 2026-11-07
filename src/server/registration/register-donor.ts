import type { DonorRegistrationInput } from "@/contracts/registration";
import {
  registerAccount,
  type RegisterAccountDeps,
  type RegisterAccountResult,
} from "./register-account";

export { DuplicateEmailError } from "./register-account";
export type { RegistrationStore, RegistrationTx } from "./register-account";

export type RegisterDonorDeps = RegisterAccountDeps;
export type RegisterDonorResult = RegisterAccountResult;

export async function registerDonor(
  deps: RegisterDonorDeps,
  input: DonorRegistrationInput,
  proof: Uint8Array,
): Promise<RegisterDonorResult> {
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
        latitude: address.latitude,
        longitude: address.longitude,
      },
      user: {
        role: "DONOR",
        fullName: input.fullName,
        contactNumber: input.contactNumber,
        donorType: input.donorType,
        businessName: input.donorType === "ESTABLISHMENT" ? input.businessName : null,
      },
      documentTypeCode: input.donorType === "ESTABLISHMENT" ? "BUSINESS_PERMIT" : "VALID_ID",
    },
    proof,
  );
}
