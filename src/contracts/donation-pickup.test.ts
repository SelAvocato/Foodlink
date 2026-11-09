import { describe, expect, it } from "vitest";
import { z } from "zod";
import { savePickupSchema } from "./donation-pickup";

const address = {
  streetLine1: "123 Katipunan Ave",
  barangay: "Loyola Heights",
  city: "Quezon City",
  latitude: 14.676,
  longitude: 121.0437,
};

const validBody = {
  address,
  pickupStart: "2026-11-10T08:00:00Z",
  pickupEnd: "2026-11-10T10:00:00Z",
};

describe("savePickupSchema", () => {
  it("accepts a valid body and converts both times to Date", () => {
    const result = savePickupSchema.safeParse(validBody);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.pickupStart).toBeInstanceOf(Date);
      expect(result.data.pickupEnd).toBeInstanceOf(Date);
      expect(result.data.pickupStart.toISOString()).toBe("2026-11-10T08:00:00.000Z");
      expect(result.data.address).toEqual({ ...address, countryCode: "PH" });
    }
  });

  it("accepts a datetime with a UTC offset", () => {
    const result = savePickupSchema.safeParse({
      ...validBody,
      pickupStart: "2026-11-10T08:00:00+08:00",
      pickupEnd: "2026-11-10T10:00:00+08:00",
    });

    expect(result.success).toBe(true);
    if (result.success) expect(result.data.pickupStart.toISOString()).toBe("2026-11-10T00:00:00.000Z");
  });

  it("rejects a pin with only one coordinate (from addressSchema)", () => {
    const withoutLatitude: Record<string, unknown> = { ...address };
    delete withoutLatitude.latitude;

    expect(savePickupSchema.safeParse({ ...validBody, address: withoutLatitude }).success).toBe(false);
    expect(
      savePickupSchema.safeParse({ ...validBody, address: { ...address, longitude: undefined } }).success,
    ).toBe(false);
  });

  it("requires the address, the start and the end", () => {
    const noAddress = { pickupStart: validBody.pickupStart, pickupEnd: validBody.pickupEnd };
    const noStart = { address: validBody.address, pickupEnd: validBody.pickupEnd };
    const noEnd = { address: validBody.address, pickupStart: validBody.pickupStart };

    expect(savePickupSchema.safeParse(noAddress).success).toBe(false);
    expect(savePickupSchema.safeParse(noStart).success).toBe(false);
    expect(savePickupSchema.safeParse(noEnd).success).toBe(false);
  });

  it("rejects an end equal to or before the start, on the pickupEnd field", () => {
    for (const pickupEnd of [validBody.pickupStart, "2026-11-10T07:00:00Z"]) {
      const result = savePickupSchema.safeParse({ ...validBody, pickupEnd });

      expect(result.success).toBe(false);
      if (!result.success) {
        const flat = z.flattenError(result.error);
        expect(flat.fieldErrors.pickupEnd?.join(" ")).toContain("end after it starts");
      }
    }
  });

  it("rejects datetimes that are not ISO 8601", () => {
    expect(savePickupSchema.safeParse({ ...validBody, pickupStart: "Nov 10, 2026 8am" }).success).toBe(false);
    expect(savePickupSchema.safeParse({ ...validBody, pickupEnd: "2026-11-10 10:00:00Z" }).success).toBe(false);
  });

  it("rejects datetimes without a UTC offset", () => {
    expect(savePickupSchema.safeParse({ ...validBody, pickupStart: "2026-11-10T08:00:00" }).success).toBe(false);
    expect(savePickupSchema.safeParse({ ...validBody, pickupEnd: "2026-11-10T10:00:00" }).success).toBe(false);
  });

  it("rejects unknown fields such as donorId, donationId or addressId", () => {
    expect(savePickupSchema.safeParse({ ...validBody, donorId: "someone-else" }).success).toBe(false);
    expect(savePickupSchema.safeParse({ ...validBody, donationId: "x" }).success).toBe(false);
    expect(savePickupSchema.safeParse({ ...validBody, addressId: "x" }).success).toBe(false);
  });
});
