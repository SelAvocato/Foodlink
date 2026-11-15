/** Where each signed-in role lands after login. */
export function roleHome(role: string | undefined): string {
  return role === "DONOR" ? "/donor/dashboard" : "/";
}
