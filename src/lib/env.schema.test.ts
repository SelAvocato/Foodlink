import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { clientSchema, envKeys, serverSchema } from "@/lib/env.schema";

function exampleKeys(): string[] {
    const text = readFileSync(resolve(process.cwd(), ".env.example"), "utf8");
    return text
        .split("\n")
        .map((line) => line.match(/^([A-Z][A-Z0-9_]*)=/)?.[1])
        .filter((key): key is string => Boolean(key));
}

const valid = {
    DATABASE_URL: "postgresql://user:pass@localhost:5432/foodlink",
    DIRECT_URL: "postgresql://user:pass@localhost:5432/foodlink",
    AUTH_SECRET: "a".repeat(32),
    NEXT_PUBLIC_APP_URL: "http://localhost:3000",
};

describe("env", () => {
    it("keeps .env.example and the schema in sync", () => {
        expect([...exampleKeys()].sort()).toEqual([...envKeys].sort());
    });

    it("accepts a valid configuration", () => {
        expect(serverSchema.safeParse(valid).success).toBe(true);
        expect(clientSchema.safeParse(valid).success).toBe(true);
    });

    it("rejects a short AUTH_SECRET and a malformed URL", () => {
        expect(serverSchema.safeParse({ ...valid, AUTH_SECRET: "short" }).success).toBe(false);
        expect(serverSchema.safeParse({ ...valid, DATABASE_URL: "not a url" }).success).toBe(false);
        expect(serverSchema.safeParse({ ...valid, DATABASE_URL: "http://example.com" }).success).toBe(false);
        expect(clientSchema.safeParse({ NEXT_PUBLIC_APP_URL: "mailto:user@example.com" }).success).toBe(false);
        expect(serverSchema.safeParse({ ...valid, DATABASE_URL: "postgresql:localhost/mydb" }).success).toBe(false);
        expect(clientSchema.safeParse({ NEXT_PUBLIC_APP_URL: "http:localhost:3000" }).success).toBe(false);
    });

    it("only exposes NEXT_PUBLIC_ keys to the client", () => {
        for (const key of Object.keys(clientSchema.shape)) {
            expect(key.startsWith("NEXT_PUBLIC_")).toBe(true);
        }
    });
});