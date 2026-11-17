import { describe, expect, it } from "vitest";
import { QrScanStage } from "./enums";
import { QR_TOKEN_PATTERN, pickupScanBodySchema } from "./volunteer-pickup-scan";

const TOKEN = "A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q7r8S9t0UvW";

function parse(body: unknown) {
  return pickupScanBodySchema.safeParse(body);
}

describe("pickupScanBodySchema", () => {
  it("accepts a 43-character base64url token", () => {
    expect(TOKEN).toHaveLength(43);
    expect(QR_TOKEN_PATTERN.test(TOKEN)).toBe(true);

    const result = parse({ token: TOKEN });

    expect(result.success).toBe(true);
    if (result.success) expect(result.data.token).toBe(TOKEN);
  });

  it("trims whitespace around a scanned token", () => {
    const result = parse({ token: ` \n${TOKEN}\t ` });

    expect(result.success).toBe(true);
    if (result.success) expect(result.data.token).toBe(TOKEN);
  });

  it.each([
    ["a 42-character token", TOKEN.slice(1)],
    ["a 44-character token", `${TOKEN}A`],
    ["padding characters", `${TOKEN.slice(0, 42)}=`],
    ["a standard base64 +", `${TOKEN.slice(0, 42)}+`],
    ["a standard base64 /", `${TOKEN.slice(0, 42)}/`],
    ["an empty token", ""],
    ["a token with an internal space", `${TOKEN.slice(0, 21)} ${TOKEN.slice(22)}`],
    ["a token that is not a string", 12345],
    ["null", null],
  ])("rejects %s", (_label, token) => {
    expect(parse({ token }).success).toBe(false);
  });

  it("rejects unknown fields and a missing token", () => {
    expect(parse({ token: TOKEN, donationId: "x" }).success).toBe(false);
    expect(parse({ token: TOKEN, stage: QrScanStage.PICKUP }).success).toBe(false);
    expect(parse({}).success).toBe(false);
  });
});
