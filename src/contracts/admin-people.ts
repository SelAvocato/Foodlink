import { z } from "zod";
import { AccountStatus, DonorType, Role } from "./enums";

export const adminPeopleRoleSchema = z.enum([Role.DONOR, Role.VOLUNTEER]);
export const adminPeopleStatusSchema = z.enum([AccountStatus.ACTIVE, AccountStatus.SUSPENDED, "ALL"]);
export const adminPeopleTypeSchema = z.enum([DonorType.ESTABLISHMENT, DonorType.INDIVIDUAL, "ALL"]);

export type AdminPeopleRole = z.infer<typeof adminPeopleRoleSchema>;
export type AdminPeopleStatus = "ACTIVE" | "SUSPENDED";
export type AdminPeopleType = z.infer<typeof adminPeopleTypeSchema>;

export const adminPeopleListQuerySchema = z
  .strictObject({
    role: adminPeopleRoleSchema.default(Role.DONOR),
    status: adminPeopleStatusSchema.default("ALL"),
    type: adminPeopleTypeSchema.default("ALL"),
    q: z.string().trim().max(100, "Use at most 100 characters").default(""),
    page: z.coerce
      .number()
      .int("The page must be a whole number")
      .min(1, "Use page 1 or higher")
      .max(10000, "Use page 10000 or lower")
      .default(1),
    pageSize: z.coerce
      .number()
      .int("The page size must be a whole number")
      .min(1, "Use at least 1")
      .max(50, "Use at most 50")
      .default(20),
  })
  .refine((query) => query.role === Role.DONOR || query.type === "ALL", {
    message: "The donor type filter applies only to donors",
    path: ["type"],
  });

export type AdminPeopleListQuery = z.infer<typeof adminPeopleListQuerySchema>;

export const adminPersonStatSchema = z.object({
  label: z.string(),
  value: z.string(),
});

export const adminPersonSchema = z.object({
  id: z.uuid(),
  kind: z.enum([Role.DONOR, Role.VOLUNTEER]),
  label: z.string(),
  title: z.string(),
  email: z.email(),
  phone: z.string(),
  donorType: z.enum([DonorType.ESTABLISHMENT, DonorType.INDIVIDUAL]).nullable(),
  status: z.enum([AccountStatus.ACTIVE, AccountStatus.SUSPENDED]),
  recentActivity: z.string(),
  stats: z.array(adminPersonStatSchema),
  activity: z.array(z.string()),
});

export const adminPeopleListResponseSchema = z.object({
  people: z.array(adminPersonSchema),
  counts: z.object({
    DONOR: z.number().int().nonnegative(),
    VOLUNTEER: z.number().int().nonnegative(),
  }),
  page: z.number().int().positive(),
  pageSize: z.number().int().positive(),
  total: z.number().int().nonnegative(),
});

export type AdminPerson = z.infer<typeof adminPersonSchema>;
export type AdminPersonStat = z.infer<typeof adminPersonStatSchema>;
export type AdminPeopleListResponse = z.infer<typeof adminPeopleListResponseSchema>;
