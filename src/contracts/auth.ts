import { z } from "zod";

// Shared auth rules. They match the System PDF (password rule, strict objects)
// and the CHECK constraints in db/baseline/001_schema.sql (email and phone format).

/** Trimmed and lowercased, because the database stores emails in lowercase only. */
export const email = z
  .string()
  .trim()
  .toLowerCase()
  .pipe(z.email("Enter a valid email address").max(254, "Email is too long"));

/** 1 uppercase, 1 lowercase, 1 number, 1 special character (not a space), 8 to 128 characters. */
export const password = z
  .string()
  .min(8, "Use at least 8 characters")
  .max(128, "Use at most 128 characters")
  .regex(/[A-Z]/, "Add an uppercase letter")
  .regex(/[a-z]/, "Add a lowercase letter")
  .regex(/[0-9]/, "Add a number")
  .regex(/[^A-Za-z0-9\s]/, "Add a special character");

/** Spaces, dashes, dots and brackets are removed. The database accepts only +, then 7 to 15 digits. */
export const contactNumber = z
  .string()
  .trim()
  .transform((value) => value.replace(/[\s().-]/g, ""))
  .pipe(z.string().regex(/^\+?[0-9]{7,15}$/, "Enter a valid contact number"));
  
/** Unknown fields are rejected. The role is never read from the request body.
 *  Password complexity is checked at registration and reset, not at login. */
export const loginSchema = z.strictObject({
  email,
  password: z.string().min(1, "Enter your password").max(128, "Use at most 128 characters"),
});
export type LoginInput = z.infer<typeof loginSchema>;