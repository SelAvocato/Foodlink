export type LoginAccountStatus = "pending" | "rejected" | "suspended";

/**
 * next-auth v4 returns the thrown `authorize` error message as `result.error`
 * (see next-auth/core/routes/callback.js). `authenticateLogin` throws LoginError
 * with these exact messages for non-active accounts.
 */
const ERROR_STATUS: Record<string, LoginAccountStatus> = {
  "Pending account": "pending",
  "Rejected account": "rejected",
  "Suspended account": "suspended",
};

/** Maps a next-auth login error to an account-status page value, or null for other failures. */
export function accountStatusFromError(error: string | null | undefined): LoginAccountStatus | null {
  if (!error) return null;
  return ERROR_STATUS[error] ?? null;
}
