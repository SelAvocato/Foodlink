import { describe, expect, it } from "vitest";
import { contactNumber, email, loginSchema, password } from "./auth";

describe("email", () => {
    it("trims and lowercases", () => {
        expect(email.parse("  Maria@Example.PH ")).toBe("maria@example.ph");
    });
    it("rejects a value that is not an email", () => {
        expect(email.safeParse("not-an-email").success).toBe(false);
    });
    it("rejects an email longer than 254 characters", () => {
        expect(email.safeParse(`${"a".repeat(250)}@x.ph`).success).toBe(false);
    });
});

describe("password", () => {
    it("accepts a password that meets every rule", () => {
        expect(password.safeParse("Abcdef1!").success).toBe(true);
    });
    it("rejects a password without an uppercase letter", () => {
        expect(password.safeParse("abcdef1!").success).toBe(false);
    });
    it("rejects a password without a lowercase letter", () => {
        expect(password.safeParse("ABCDEF1!").success).toBe(false);
    });
    it("rejects a password without a number", () => {
        expect(password.safeParse("Abcdefg!").success).toBe(false);
    });
    it("rejects a password without a special character", () => {
        expect(password.safeParse("Abcdefg1").success).toBe(false);
    });
    it("does not count a space as a special character", () => {
        expect(password.safeParse("Abcdef1 ").success).toBe(false);
    });
    it("rejects a password shorter than 8 characters", () => {
        expect(password.safeParse("Abcde1!").success).toBe(false);
    });
    it("rejects a password longer than 128 characters", () => {
        expect(password.safeParse(`Abc1!${"x".repeat(124)}`).success).toBe(false);
    });
});

describe("contactNumber", () => {
    it("removes spaces", () => {
        expect(contactNumber.parse("0917 123 4567")).toBe("09171234567");
    });
    it("removes dashes and keeps the plus sign", () => {
        expect(contactNumber.parse("+63 917-123-4567")).toBe("+639171234567");
    });
    it("rejects a number that is too short", () => {
        expect(contactNumber.safeParse("12345").success).toBe(false);
    });
    it("rejects letters and numbers with more than 15 digits", () => {
        expect(contactNumber.safeParse("abc").success).toBe(false);
        expect(contactNumber.safeParse("1234567890123456").success).toBe(false);
    });
});

describe("loginSchema", () => {
    it("accepts valid credentials and normalizes the email", () => {
        expect(loginSchema.parse({ email: " A@B.ph ", password: "Abcdef1!" })).toEqual({
            email: "a@b.ph",
            password: "Abcdef1!",
        });
    });
    it("rejects unknown fields such as a role", () => {
        expect(loginSchema.safeParse({ email: "a@b.ph", password: "Abcdef1!", role: "ADMIN" }).success).toBe(false);
    });
    it("rejects a missing password", () => {
        expect(loginSchema.safeParse({ email: "a@b.ph" }).success).toBe(false);
    });
    it("accepts any non-empty password up to 128 characters", () => {
        expect(loginSchema.safeParse({ email: "a@b.ph", password: "x" }).success).toBe(true);
        expect(loginSchema.safeParse({ email: "a@b.ph", password: "" }).success).toBe(false);
        expect(loginSchema.safeParse({ email: "a@b.ph", password: "x".repeat(128) }).success).toBe(true);
        expect(loginSchema.safeParse({ email: "a@b.ph", password: "x".repeat(129) }).success).toBe(false);
    });
});