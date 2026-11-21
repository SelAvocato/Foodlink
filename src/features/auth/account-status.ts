import type { Tone } from "@/components/shared/tones";

export const ACCOUNT_STATUSES = ["pending", "rejected", "suspended", "invalid"] as const;
export type AccountStatus = (typeof ACCOUNT_STATUSES)[number];

/** Copy is verbatim from PDF p10. */
export const accountStatusCopy: Record<
  AccountStatus,
  { tone: Tone; eyebrow: string; title: string; body: string }
> = {
  pending: {
    tone: "success",
    eyebrow: "Pending review",
    title: "Application submitted",
    body: "Your application was received. You cannot log in until the organization approves it. An email will confirm the decision.",
  },
  rejected: {
    tone: "error",
    eyebrow: "Reason from the organization",
    title: "Application rejected",
    body: "Your proof document could not be verified. Please contact the organization for guidance.",
  },
  suspended: {
    tone: "warning",
    eyebrow: "Access unavailable",
    title: "Account suspended",
    body: "Your account has been suspended by the organization. Contact the organization for further information.",
  },
  invalid: {
    tone: "neutral",
    eyebrow: "Check your credentials",
    title: "Login unsuccessful",
    body: "The email or password is incorrect. Check your details and try again.",
  },
};

export function parseAccountStatus(value: string | string[] | undefined): AccountStatus {
  const v = Array.isArray(value) ? value[0] : value;
  return (ACCOUNT_STATUSES as readonly string[]).includes(v ?? "") ? (v as AccountStatus) : "invalid";
}
