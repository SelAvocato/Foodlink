import { describe, expect, it } from "vitest";
import { DonationStatus, QrScanStage } from "./enums";
import { dropoffScanBodySchema } from "./volunteer-dropoff";

const TOKEN = "A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q7r8S9t0UvW";

function parse(body: unknown) {
  return dropoffScanBodySchema.safeParse(body);
}

describe("dropoffScanBodySchema", () => {
  it("accepts the same 43-character base64url token as the pickup scan", () => {
    expect(parse({ token: TOKEN }).success).toBe(true);
    expect(parse({ token: `  ${TOKEN}  ` }).success).toBe(true);
  });

  it("refuses a missing, short, long or non-base64url token", () => {
    expect(parse({}).success).toBe(false);
    expect(parse({ token: TOKEN.slice(1) }).success).toBe(false);
    expect(parse({ token: `${TOKEN}A` }).success).toBe(false);
    expect(parse({ token: `${TOKEN.slice(0, 42)}+` }).success).toBe(false);
  });

  it("refuses unknown fields", () => {
    expect(parse({ token: TOKEN, volunteerId: "x" }).success).toBe(false);
  });

  it("pins the response stage and status", () => {
    expect(QrScanStage.DROPOFF).toBe("DROPOFF");
    expect(DonationStatus.DELIVERED).toBe("DELIVERED");
  });
});
