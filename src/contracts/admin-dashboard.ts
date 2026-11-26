import { z } from "zod";

export const adminDashboardQuerySchema = z.strictObject({});

export type AdminDashboardQuery = z.infer<typeof adminDashboardQuerySchema>;

export const adminDashboardCountsSchema = z.strictObject({
  pendingRegistrations: z.number().int().nonnegative(),
  screeningReviews: z.number().int().nonnegative(),
  postedDonations: z.number().int().nonnegative(),
  acceptedAwaitingAssignment: z.number().int().nonnegative(),
});

export type AdminDashboardCounts = z.infer<typeof adminDashboardCountsSchema>;

export const adminDashboardActivityTypeSchema = z.enum([
  "REGISTRATION",
  "SCREENING",
  "DONATION_QUEUE",
  "ASSIGNMENT",
]);

export type AdminDashboardActivityType = z.infer<typeof adminDashboardActivityTypeSchema>;

export const adminDashboardActivityItemSchema = z.strictObject({
  id: z.string().min(1),
  type: adminDashboardActivityTypeSchema,
  title: z.string().min(1),
  detail: z.string().min(1),
  occurredAt: z.string().datetime(),
  href: z.string().startsWith("/admin"),
});

export type AdminDashboardActivityItem = z.infer<typeof adminDashboardActivityItemSchema>;

export const adminDashboardResponseSchema = z.strictObject({
  counts: adminDashboardCountsSchema,
  recentActivity: z.array(adminDashboardActivityItemSchema),
});

export type AdminDashboardResponse = z.infer<typeof adminDashboardResponseSchema>;
