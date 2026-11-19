/** Where each signed-in role lands after login. */
export function roleHome(role: string | undefined): string {
  if (role === "DONOR") return "/donor/dashboard";
  if (role === "ADMIN") return "/staff";
  return "/";
}
