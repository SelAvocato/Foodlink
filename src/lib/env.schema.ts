import { z } from "zod";

const postgresUrl = z
    .url({ protocol: /^postgres(ql)?$/ })
    .refine((v) => /^postgres(ql)?:\/\//.test(v), "must start with postgresql:// or postgres://");

const webUrl = z
    .url({ protocol: /^https?$/ })
    .refine((v) => /^https?:\/\//.test(v), "must start with http:// or https://");

/** Server-only variables. Never expose these to the browser. */
export const serverSchema = z.object({
    DATABASE_URL: postgresUrl,
    DIRECT_URL: postgresUrl,
    AUTH_SECRET: z.string().min(32, "must be at least 32 characters"),
});

/** Variables that are safe to expose to the browser. They must start with NEXT_PUBLIC_. */
export const clientSchema = z.object({
    NEXT_PUBLIC_APP_URL: webUrl,
});

export const envKeys = [
    ...Object.keys(serverSchema.shape),
    ...Object.keys(clientSchema.shape),
];