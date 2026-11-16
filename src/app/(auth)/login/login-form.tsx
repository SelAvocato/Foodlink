"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { getSession, signIn } from "next-auth/react";
import { loginSchema } from "@/contracts/auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { FormField } from "@/components/shared/form-field";

type FieldErrors = { email?: string; password?: string };

function firstIssue(issues: { path: PropertyKey[]; message: string }[], field: "email" | "password") {
  const issue = issues.find((entry) => entry.path[0] === field);
  return issue?.message;
}

export function LoginForm() {
  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError(null);
    setFieldErrors({});

    const form = new FormData(event.currentTarget);
    const parsed = loginSchema.safeParse({
      email: String(form.get("email") ?? ""),
      password: String(form.get("password") ?? ""),
    });
    if (!parsed.success) {
      const issues = parsed.error.issues as { path: PropertyKey[]; message: string }[];
      setFieldErrors({
        email: firstIssue(issues, "email"),
        password: firstIssue(issues, "password"),
      });
      return;
    }

    setSubmitting(true);
    const result = await signIn("credentials", {
      email: parsed.data.email,
      password: parsed.data.password,
      redirect: false,
    });
    if (result?.error) {
      setSubmitting(false);
      setFormError("Invalid username or password");
      return;
    }

    const session = await getSession();
    const destination = session?.user?.role === "DONOR" ? "/donor/dashboard" : "/";
    router.push(destination);
  }

  return (
    <form className="mt-8 flex flex-col gap-5" noValidate onSubmit={onSubmit}>
      <FormField label="Email" error={fieldErrors.email}>
        {(p) => (
          <Input {...p} name="email" type="email" autoComplete="email" placeholder="name@example.com" />
        )}
      </FormField>

      <FormField
        label="Password"
        error={fieldErrors.password}
        labelAction={
          <Link href="/forgot" className="text-primary hover:underline">
            Forgot password?
          </Link>
        }
      >
        {(p) => (
          <Input {...p} name="password" type="password" autoComplete="current-password" placeholder="Enter your password" />
        )}
      </FormField>

      {formError ? (
        <div role="alert" className="rounded-lg bg-error p-4 text-sm text-error-foreground">
          {formError}
        </div>
      ) : null}

      <Button type="submit" className="w-full" disabled={submitting} aria-busy={submitting}>
        {submitting ? "Logging in…" : "Login"}
      </Button>
    </form>
  );
}
