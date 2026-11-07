import type { AccountStatus, Role } from "./enums";

export type AuthenticatedActor = {
  id: string;
  email: string;
  name: string;
  role: Role;
  status: AccountStatus;
};

export type RequireRoleOptions = {
  headers?: Headers;
};

/**
 * Runtime implementation belongs in the server layer. This contract requires
 * the implementation to verify the session and re-check account status.
 */
export type RequireRole = (
  allowedRoles: readonly Role[],
  options?: RequireRoleOptions,
) => Promise<AuthenticatedActor>;
