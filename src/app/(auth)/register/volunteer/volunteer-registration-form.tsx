"use client";

import Link from "next/link";
import { useState, type FormEvent, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  buildRegistrationFormData,
  interpretRegistrationResponse,
  validateVolunteerForm,
  type RegistrationFieldKey,
  type RegistrationFormErrors,
} from "./registration-form-logic";

const GENERAL_ERROR = "Something went wrong. Please try again.";
const EMAIL_TAKEN = "This email is already registered.";

/** The visual order, so focus goes to the first invalid control and not the first key set. */
const FOCUS_ORDER: readonly RegistrationFieldKey[] = [
  "fullName",
  "availability",
  "email",
  "contactNumber",
  "streetLine1",
  "barangay",
  "city",
  "password",
  "proof",
  "consent",
  "form",
];

function focusFirstInvalid(errors: RegistrationFormErrors) {
  const key = FOCUS_ORDER.find((candidate) => errors[candidate] !== undefined);
  if (key === undefined) return;
  const control = document.getElementById(key);
  if (control instanceof HTMLElement) control.focus();
}

/** The two ARIA attributes a control needs when its error line is shown. */
function ariaFor(id: RegistrationFieldKey, error: string | undefined) {
  if (error === undefined) return {};
  return { "aria-invalid": true, "aria-describedby": `${id}-error` };
}

function Field({
  id,
  label,
  error,
  children,
}: {
  id: string;
  label: string;
  error?: string;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-2">
      <Label htmlFor={id} className="text-(--fl-ink)">
        {label}
      </Label>
      {children}
      {error === undefined ? null : (
        <p id={`${id}-error`} role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}

export function VolunteerRegistrationForm() {
  const [errors, setErrors] = useState<RegistrationFormErrors>({});
  const [sending, setSending] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    // A second click while the request is in flight is ignored; the button is disabled too.
    if (sending) return;

    setErrors({});
    const result = validateVolunteerForm(new FormData(event.currentTarget));
    if (!result.ok) {
      setErrors(result.errors);
      focusFirstInvalid(result.errors);
      return;
    }

    setSending(true);
    try {
      // No Content-Type header: the browser sets the multipart boundary itself.
      const response = await fetch("/api/auth/register/volunteer", {
        method: "POST",
        body: buildRegistrationFormData(result.payload, result.proof),
      });
      const body: unknown = await response.json().catch(() => null);
      const outcome = interpretRegistrationResponse(response.status, body);

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
          Staff will review your ID. You will receive an email decision. Once approved, you can log
          in.
        </p>
        <Link href="/login" className="mt-6 inline-block text-sm text-(--fl-primary) hover:underline">
          Go to login
        </Link>
      </div>
    );
  }

  return (
    <form className="rounded-xl bg-(--fl-card) p-6 sm:p-8" noValidate onSubmit={handleSubmit}>
      <h2 className="text-lg font-semibold">Your information</h2>
      <p className="mt-2 text-sm text-(--fl-muted)">Your ID is used only for application review.</p>

      <div className="mt-8 grid gap-6 sm:grid-cols-2">
        <Field id="fullName" label="Full name" error={errors.fullName}>
          <Input
            id="fullName"
            name="fullName"
            autoComplete="name"
            placeholder="Your full name"
            {...ariaFor("fullName", errors.fullName)}
          />
        </Field>
        <Field id="availability" label="Availability (optional)" error={errors.availability}>
          <Input
            id="availability"
            name="availability"
            placeholder="e.g. Saturdays, 8:00 AM–12:00 PM"
            {...ariaFor("availability", errors.availability)}
          />
        </Field>
        <Field id="email" label="Email" error={errors.email}>
          <Input
            id="email"
            name="email"
            type="email"
            autoComplete="email"
            placeholder="name@example.com"
            {...ariaFor("email", errors.email)}
          />
        </Field>
        <Field id="contactNumber" label="Contact number" error={errors.contactNumber}>
          <Input
            id="contactNumber"
            name="contactNumber"
            type="tel"
            autoComplete="tel"
            placeholder="+63 9XX XXX XXXX"
            {...ariaFor("contactNumber", errors.contactNumber)}
          />
        </Field>
        <Field id="streetLine1" label="Street address" error={errors.streetLine1}>
          <Input
            id="streetLine1"
            name="streetLine1"
            autoComplete="address-line1"
            placeholder="House number and street"
            {...ariaFor("streetLine1", errors.streetLine1)}
          />
        </Field>
        <Field id="barangay" label="Barangay (optional)" error={errors.barangay}>
          <Input
            id="barangay"
            name="barangay"
            placeholder="Barangay"
            {...ariaFor("barangay", errors.barangay)}
          />
        </Field>
        <Field id="city" label="City" error={errors.city}>
          <Input
            id="city"
            name="city"
            autoComplete="address-level2"
            placeholder="City"
            {...ariaFor("city", errors.city)}
          />
        </Field>
        <Field id="password" label="Password" error={errors.password}>
          <Input
            id="password"
            name="password"
            type="password"
            autoComplete="new-password"
            placeholder="Create a strong password"
            {...ariaFor("password", errors.password)}
          />
        </Field>
      </div>
      <p className="mt-3 text-xs text-(--fl-muted)">
        Password: 8+ characters, uppercase, lowercase, number and special character.
      </p>

      <label
        htmlFor="proof"
        className="mt-8 block cursor-pointer rounded-xl border border-dashed border-(--fl-muted)/40 bg-(--fl-canvas) p-6 focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-(--fl-primary)"
      >
        <span className="block text-base font-semibold text-(--fl-primary)">Upload valid ID</span>
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
      {errors.proof === undefined ? null : (
        <p id="proof-error" role="alert" className="text-sm text-destructive">
          {errors.proof}
        </p>
      )}

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
      {errors.consent === undefined ? null : (
        <p id="consent-error" role="alert" className="text-sm text-destructive">
          {errors.consent}
        </p>
      )}

      {errors.form === undefined ? null : (
        <div role="alert" className="rounded-lg bg-(--fl-error) p-4 text-sm text-(--fl-ink)">
          {errors.form}
        </div>
      )}

      <div className="mt-8 flex flex-wrap items-center gap-6">
        <Button type="submit" className="h-12 px-8" disabled={sending}>
          {sending ? "Submitting..." : "Submit application"}
        </Button>
        <Link href="/login" className="text-sm text-(--fl-primary) hover:underline">
          Already approved? Login
        </Link>
      </div>
    </form>
  );
}
