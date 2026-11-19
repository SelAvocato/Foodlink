"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { getSession, signIn } from "next-auth/react";
import { Eye, EyeOff } from "lucide-react";
import { loginSchema } from "@/contracts/auth";
import { roleHome } from "@/lib/role-home";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { FormField } from "@/components/shared/form-field";
import { FeedbackBanner } from "@/components/shared/feedback-banner";

const LOCKOUT_STORAGE_KEY = "fl-login-locked-until";
const LOCKOUT_ERROR_PREFIX = "account_locked:";
const loginLinkClass =
  "inline-flex min-h-11 items-center rounded-lg text-sm font-medium text-primary underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

type FieldErrors = { email?: string; password?: string };

function firstIssue(issues: { path: PropertyKey[]; message: string }[], field: "email" | "password") {
  const issue = issues.find((entry) => entry.path[0] === field);
  return issue?.message;
}

/** Server throws LoginError("account_locked", "account_locked:<iso>") for a locked account. */
function parseLockoutUntil(value: string | null | undefined): Date | null {
  if (!value || !value.startsWith(LOCKOUT_ERROR_PREFIX)) return null;
  const until = new Date(value.slice(LOCKOUT_ERROR_PREFIX.length));
  return Number.isNaN(until.getTime()) || until.getTime() <= Date.now() ? null : until;
}

function readStoredLockout(): Date | null {
  if (typeof window === "undefined") return null;
  return parseLockoutUntil(window.sessionStorage.getItem(LOCKOUT_STORAGE_KEY));
}

function formatCountdown(totalSeconds: number) {
  const mm = Math.floor(totalSeconds / 60);
  const ss = totalSeconds % 60;
  return `${String(mm).padStart(2, "0")}:${String(ss).padStart(2, "0")}`;
}

export function LoginForm({ footer }: { footer?: React.ReactNode }) {
  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [showPassword, setShowPassword] = useState(false);
  const [lockoutUntil, setLockoutUntil] = useState<Date | null>(null);
  const [lockoutExpired, setLockoutExpired] = useState(false);
  const [now, setNow] = useState(() => Date.now());

  // A refresh must not hide an active lockout: restore the deadline from sessionStorage.
  // Deferred to a microtask so the effect does not set state synchronously.
  useEffect(() => {
    const until = readStoredLockout();
    if (!until) return;
    queueMicrotask(() => setLockoutUntil(until));
  }, []);

  useEffect(() => {
    if (!lockoutUntil) return;
    const id = window.setInterval(() => {
      const current = Date.now();
      setNow(current);
      if (current >= lockoutUntil.getTime()) {
        setLockoutUntil(null);
        setLockoutExpired(true);
        window.clearInterval(id);
        window.sessionStorage.removeItem(LOCKOUT_STORAGE_KEY);
      }
    }, 1000);
    return () => window.clearInterval(id);
  }, [lockoutUntil]);

  const remainingSeconds = lockoutUntil
    ? Math.max(0, Math.ceil((lockoutUntil.getTime() - now) / 1000))
    : 0;
  const lockedOut = lockoutUntil !== null && remainingSeconds > 0;

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    // The button is disabled while locked; guard the Enter key too.
    if (lockedOut) return;
    setFormError(null);
    setLockoutExpired(false);
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
      const until = parseLockoutUntil(result.error);
      if (until) {
        setLockoutUntil(until);
        setNow(Date.now());
        window.sessionStorage.setItem(LOCKOUT_STORAGE_KEY, `${LOCKOUT_ERROR_PREFIX}${until.toISOString()}`);
        return;
      }
      setFormError("Invalid username or password");
      return;
    }

    window.sessionStorage.removeItem(LOCKOUT_STORAGE_KEY);
    const session = await getSession();
    router.replace(roleHome(session?.user?.role));
  }

  return (
    <form className="space-y-6" noValidate onSubmit={onSubmit}>
      <FormField label="Email" error={fieldErrors.email}>
        {(p) => (
          <Input {...p} name="email" type="email" autoComplete="email" inputMode="email" placeholder="name@example.com" className="min-h-11" />
        )}
      </FormField>

      <FormField label="Password" error={fieldErrors.password}>
        {(p) => (
          <div className="relative">
            <Input
              {...p}
              name="password"
              type={showPassword ? "text" : "password"}
              autoComplete="current-password"
              placeholder="Enter your password"
              className="min-h-11 pr-12"
            />
            <button
              type="button"
              onClick={() => setShowPassword((visible) => !visible)}
              aria-label={showPassword ? "Hide password" : "Show password"}
              aria-pressed={showPassword}
              className="absolute inset-y-0 right-0 flex min-h-11 min-w-11 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              {showPassword ? <EyeOff className="size-6" aria-hidden /> : <Eye className="size-6" aria-hidden />}
            </button>
          </div>
        )}
      </FormField>

      <div className="flex justify-end">
        <Link
          href="/forgot"
          className="inline-flex min-h-11 items-center rounded-lg text-sm font-medium text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          Forgot password?
        </Link>
      </div>

      {lockedOut ? (
        <FeedbackBanner tone="warning" title="Account temporarily locked">
          Too many failed attempts. Try again in{" "}
          <span className="font-semibold tabular-nums" role="status" aria-live="polite">
            {formatCountdown(remainingSeconds)}
          </span>
          .
        </FeedbackBanner>
      ) : lockoutExpired ? (
        <FeedbackBanner tone="success" title="You can try again now." />
      ) : formError ? (
        <div role="alert" className="rounded-lg bg-error p-4 text-sm text-error-foreground">
          {formError}
        </div>
      ) : null}

      <Button type="submit" className="min-h-11 min-w-[140px]" disabled={submitting || lockedOut} aria-busy={submitting}>
        {submitting ? "Signing in…" : lockedOut ? "Locked" : "Login"}
      </Button>

      {footer ? <div>{footer}</div> : null}
    </form>
  );
}

export { loginLinkClass };
