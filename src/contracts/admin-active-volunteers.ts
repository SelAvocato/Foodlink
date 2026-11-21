import { z } from "zod";

/**
 * The active-volunteer list query string (the route parses searchParams, so every
 * value arrives as text). limit defaults to 100; searching is done in the browser,
 * so the query has no search parameter.
 */
export const adminActiveVolunteersQuerySchema = z.strictObject({
  limit: z.coerce
    .number()
    .int("The limit must be a whole number")
    .min(1, "Use at least 1")
    .max(100, "Use at most 100")
    .default(100),
});
export type AdminActiveVolunteersQuery = z.infer<typeof adminActiveVolunteersQuerySchema>;

/**
 * One row of the active-volunteer list. Only these fields leave the server: never
 * the phone, email, address, documents or any other column of users.
 */
export type AdminActiveVolunteerItem = {
  volunteerId: string;
  fullName: string;
  availability: string | null;
};
