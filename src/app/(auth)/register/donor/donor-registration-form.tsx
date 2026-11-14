"use client";

import Link from "next/link";
import { useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { DonorType } from "@/contracts/enums";
import {
  buildRegistrationFormData,
  interpretDonorRegistrationResponse,
  validateDonorForm,
  type DonorMapPin,
  type DonorRegistrationFieldKey,
  type DonorRegistrationFormErrors,
} from "./donor-registration-logic";

const GENERAL_ERROR = "Something went wrong. Please try again.";
const EMAIL_TAKEN = "This email is already registered.";

/** The visual order, so focus goes to the first invalid control and not the first key set. */
const FOCUS_ORDER: readonly DonorRegistrationFieldKey[] = [
  "fullName",
  "businessName",
  "email",
  "contactNumber",
  "streetLine1",
  "barangay",
  "city",
  "mapPin",
  "password",
  "proof",
  "consent",
  "form",
];

function focusFirstInvalid(errors: DonorRegistrationFormErrors) {
  const key = FOCUS_ORDER.find((candidate) => errors[candidate] !== undefined);
  if (key === undefined) return;
  const control = document.getElementById(key);
  if (control instanceof HTMLElement) control.focus();
}

/** The two ARIA attributes a control needs when its error line is shown. */
function ariaFor(id: DonorRegistrationFieldKey, error: string | undefined) {
  if (error === undefined) return {};
  return { "aria-invalid": true, "aria-describedby": `${id}-error` };
}

function FieldError({ id, message }: { id: string; message?: string }) {
  if (message === undefined) return null;
  return (
    <p id={`${id}-error`} role="alert" className="text-sm text-destructive">
      {message}
    </p>
  );
}

export function DonorRegistrationForm() {
  const [errors, setErrors] = useState<DonorRegistrationFormErrors>({});
  const [sending, setSending] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [donorType, setDonorType] = useState<DonorType>("ESTABLISHMENT");
  // The map step is a later task; until it exists no coordinates are ever invented here.
  const pin: DonorMapPin | null = null;

  function chooseDonorType(next: DonorType) {
    setDonorType(next);
    // The business name field is unmounted for individuals, so its old message must not linger.
    setErrors((previous) => ({ ...previous, businessName: undefined }));
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    // A second click while the request is in flight is ignored; the button is disabled too.
    if (sending) return;

    setErrors({});
    const result = validateDonorForm(new FormData(event.currentTarget), pin);
    if (!result.ok) {
      setErrors(result.errors);
      focusFirstInvalid(result.errors);
      return;
    }

    setSending(true);
    try {
      // No Content-Type header: the browser sets the multipart boundary itself.
      const response = await fetch("/api/auth/register/donor", {
        method: "POST",
        body: buildRegistrationFormData(result.payload, result.proof),
      });
      const body: unknown = await response.json().catch(() => null);
      const outcome = interpretDonorRegistrationResponse(response.status, body);

      if (outcome.kind === "success") {
        setSubmitted(true);
      } else if (outcome.kind === "email_taken") {
        setErrors({ email: EMAIL_TAKEN });
      } else if (outcome.kind === "invalid") {
        setErrors(outcome.errors);
      } else {
        setErrors({ form: GENERAL_ERROR });
      }
    } catch {
      setErrors({ form: GENERAL_ERROR });
    } finally {
      setSending(false);
    }
  }

  if (submitted) {
    return (
      <div className="rounded-xl bg-(--fl-card) p-6 sm:p-8">
        <h2 className="text-lg font-semibold">Application submitted</h2>
        <p className="mt-2 text-sm text-(--fl-muted)">
          Staff will review your proof. You will receive an email decision. Once approved, you can log
          in.
        </p>
        <Link href="/login" className="mt-6 inline-block text-sm text-(--fl-primary) hover:underline">
          Go to login
        </Link>
      </div>
    );
  }

  return (
    <form
      className="group/form rounded-xl bg-(--fl-card) p-6 sm:p-8"
      noValidate
      onSubmit={handleSubmit}
    >
      <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
        <span id="donor-type-label" className="text-base font-semibold">
          Donor type
        </span>
        <div
          role="radiogroup"
          aria-labelledby="donor-type-label"
          className="flex flex-wrap items-center gap-x-6 gap-y-2"
        >
          <label className="flex cursor-pointer items-center gap-2 text-base font-semibold text-(--fl-ink)">
            <input
              type="radio"
              name="donorType"
              value="ESTABLISHMENT"
              checked={donorType === "ESTABLISHMENT"}
              onChange={() => chooseDonorType("ESTABLISHMENT")}
              className="size-4 accent-(--fl-primary)"
            />
            Establishment
          </label>
          <label className="flex cursor-pointer items-center gap-2 text-base font-semibold text-(--fl-ink)">
            <input
              type="radio"
              name="donorType"
              value="INDIVIDUAL"
              checked={donorType === "INDIVIDUAL"}
              onChange={() => chooseDonorType("INDIVIDUAL")}
              className="size-4 accent-(--fl-primary)"
            />
            Individual
          </label>
        </div>
      </div>
      <p className="mt-3 text-sm text-(--fl-muted)">
        Donor type is fixed after approval and controls allowed food categories.
      </p>

      <div className="mt-8 grid gap-6 sm:grid-cols-2">
        <div className="flex flex-col gap-2">
          <Label htmlFor="fullName" className="text-(--fl-ink)">
            Full name
          </Label>
          <Input
            id="fullName"
            name="fullName"
            placeholder="Your full name"
            autoComplete="name"
            {...ariaFor("fullName", errors.fullName)}
          />
          <FieldError id="fullName" message={errors.fullName} />
        </div>

        {donorType === "ESTABLISHMENT" ? (
          <div className="flex flex-col gap-2">
            <Label htmlFor="businessName" className="text-(--fl-ink)">
              Business name (establishments only)
            </Label>
            <Input
              id="businessName"
              name="businessName"
              placeholder="Business or establishment name"
              autoComplete="organization"
              {...ariaFor("businessName", errors.businessName)}
            />
            <FieldError id="businessName" message={errors.businessName} />
          </div>
        ) : null}

        <div className="flex flex-col gap-2">
          <Label htmlFor="email" className="text-(--fl-ink)">
            Email
          </Label>
          <Input
            id="email"
            name="email"
            type="email"
            placeholder="name@example.com"
            autoComplete="email"
            {...ariaFor("email", errors.email)}
          />
          <FieldError id="email" message={errors.email} />
        </div>

        <div className="flex flex-col gap-2">
          <Label htmlFor="contactNumber" className="text-(--fl-ink)">
            Contact number
          </Label>
          <Input
            id="contactNumber"
            name="contactNumber"
            type="tel"
            placeholder="+63 9XX XXX XXXX"
            autoComplete="tel"
            {...ariaFor("contactNumber", errors.contactNumber)}
          />
          <FieldError id="contactNumber" message={errors.contactNumber} />
        </div>

        <div className="flex flex-col gap-2">
          <Label htmlFor="streetLine1" className="text-(--fl-ink)">
            Address
          </Label>
          <Input
            id="streetLine1"
            name="streetLine1"
            placeholder="Street"
            autoComplete="address-line1"
            {...ariaFor("streetLine1", errors.streetLine1)}
          />
          <FieldError id="streetLine1" message={errors.streetLine1} />
          <Label htmlFor="barangay" className="sr-only">
            Barangay (optional)
          </Label>
          <Input
            id="barangay"
            name="barangay"
            placeholder="Barangay (optional)"
            {...ariaFor("barangay", errors.barangay)}
          />
          <FieldError id="barangay" message={errors.barangay} />
          <Label htmlFor="city" className="sr-only">
            City
          </Label>
          <Input
            id="city"
            name="city"
            placeholder="City"
            autoComplete="address-level2"
            {...ariaFor("city", errors.city)}
          />
          <FieldError id="city" message={errors.city} />
        </div>

        <div className="flex flex-col gap-2">
          <Label htmlFor="mapPin" className="text-(--fl-ink)">
            Address map pin
          </Label>
          <button
            id="mapPin"
            type="button"
            className="flex h-11 w-full items-center rounded-lg border border-input bg-transparent px-3 text-left text-sm text-(--fl-muted) outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
            {...ariaFor("mapPin", errors.mapPin)}
          >
            Set location on map
          </button>
          <FieldError id="mapPin" message={errors.mapPin} />
        </div>

        <div className="flex flex-col gap-2">
          <Label htmlFor="password" className="text-(--fl-ink)">
            Password
          </Label>
          <Input
            id="password"
            name="password"
            type="password"
            placeholder="Create a strong password"
            autoComplete="new-password"
            {...ariaFor("password", errors.password)}
          />
          <FieldError id="password" message={errors.password} />
          <p className="text-xs text-(--fl-muted)">
            8+ characters, uppercase, lowercase, number and special character.
          </p>
        </div>
      </div>

      <label
        htmlFor="proof"
        className="mt-8 block cursor-pointer rounded-xl border border-dashed border-(--fl-muted)/40 bg-(--fl-canvas) p-6 focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-(--fl-primary)"
      >
        <span className="block text-base font-semibold text-(--fl-primary)">
          Upload business permit / valid ID for individuals
        </span>
        <span className="mt-4 block text-sm text-(--fl-muted)">
          Choose image <span className="px-1">•</span> JPEG, PNG or WebP{" "}
          <span className="px-1">•</span> Up to 4 MB
        </span>
        <input
          id="proof"
          name="proof"
          type="file"
          accept="image/jpeg,image/png,image/webp"
          className="sr-only"
          {...ariaFor("proof", errors.proof)}
        />
      </label>
      <FieldError id="proof" message={errors.proof} />

      <div className="mt-8 flex max-w-xl items-start gap-3">
        <input
          id="consent"
          name="consent"
          type="checkbox"
          value="true"
          className="mt-0.5 size-5 shrink-0 accent-(--fl-primary)"
          {...ariaFor("consent", errors.consent)}
        />
        <Label htmlFor="consent" className="text-sm leading-6 font-normal text-(--fl-ink)">
          I consent to the collection and processing of my information under the Data Privacy Act
          of 2012 (RA 10173).
        </Label>
      </div>
      <FieldError id="consent" message={errors.consent} />

      {errors.form === undefined ? null : (
        <div role="alert" className="rounded-lg bg-(--fl-error) p-4 text-sm text-(--fl-ink)">
          {errors.form}
        </div>
      )}

      <div className="mt-8 flex flex-wrap items-center gap-6">
        <Button type="submit" className="h-12 px-8" disabled={sending}>
          Submit application
        </Button>
        <Link href="/login" className="text-sm text-(--fl-primary) hover:underline">
          Already approved? Login
        </Link>
      </div>
    </form>
  );
}
