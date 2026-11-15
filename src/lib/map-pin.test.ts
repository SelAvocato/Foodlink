import { describe, expect, it } from "vitest";
import {
  formatPin,
  locationFailureMessage,
  LOCATION_BLOCKED_MESSAGE,
  LOCATION_UNAVAILABLE_MESSAGE,
  LOCATION_UNSUPPORTED_MESSAGE,
  roundPin,
} from "./map-pin";

describe("roundPin", () => {
  it("rounds a value with more than 6 decimals to 6", () => {
    const rounded = roundPin({ latitude: 14.59951234, longitude: 120.98423456 });
    expect(rounded.latitude).toBe(14.599512);
    expect(rounded.longitude).toBe(120.984235);
  });

  it("leaves a value with 6 or fewer decimals unchanged", () => {
    const rounded = roundPin({ latitude: 14.599512, longitude: 121.0 });
    expect(rounded.latitude).toBe(14.599512);
    expect(rounded.longitude).toBe(121.0);
  });

  it("rounds negative values", () => {
    const rounded = roundPin({ latitude: -120.9842349, longitude: -14.5 });
    expect(rounded.latitude).toBe(-120.984235);
    expect(rounded.longitude).toBe(-14.5);
  });

  it("rounds both fields", () => {
    const rounded = roundPin({ latitude: 14.1234567, longitude: 121.7654321 });
    expect(rounded.latitude).toBe(14.123457);
    expect(rounded.longitude).toBe(121.765432);
  });

  it("does not mutate the input object", () => {
    const point = { latitude: 14.59951234, longitude: -120.9842349 };
    roundPin(point);
    expect(point).toEqual({ latitude: 14.59951234, longitude: -120.9842349 });
  });
});

describe("formatPin", () => {
  it("pads both fields to 6 decimals", () => {
    expect(formatPin({ latitude: 14.5, longitude: 120.9842 })).toBe("14.500000, 120.984200");
  });

  it("keeps the sign of negative values", () => {
    expect(formatPin({ latitude: -14.5, longitude: -120.9842 })).toBe("-14.500000, -120.984200");
  });
});

describe("locationFailureMessage", () => {
  it("returns the blocked message for code 1 (PERMISSION_DENIED)", () => {
    expect(locationFailureMessage(1)).toBe(LOCATION_BLOCKED_MESSAGE);
  });

  it("returns the unavailable message for other codes", () => {
    expect(locationFailureMessage(2)).toBe(LOCATION_UNAVAILABLE_MESSAGE);
    expect(locationFailureMessage(3)).toBe(LOCATION_UNAVAILABLE_MESSAGE);
    expect(locationFailureMessage(0)).toBe(LOCATION_UNAVAILABLE_MESSAGE);
    expect(locationFailureMessage(99)).toBe(LOCATION_UNAVAILABLE_MESSAGE);
  });
});

describe("location message constants", () => {
  it("are all non-empty and different from each other", () => {
    const messages = [
      LOCATION_UNSUPPORTED_MESSAGE,
      LOCATION_BLOCKED_MESSAGE,
      LOCATION_UNAVAILABLE_MESSAGE,
    ];
    for (const message of messages) {
      expect(message.trim().length).toBeGreaterThan(0);
    }
    expect(new Set(messages).size).toBe(messages.length);
  });
});
