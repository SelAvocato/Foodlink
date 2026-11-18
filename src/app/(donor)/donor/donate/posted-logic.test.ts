import { describe, expect, it } from "vitest";
import {
  donationShortCode,
  imageFileName,
  labelCode,
  parseQrResponse,
  pickupText,
  portionsText,
  qrPayload,
} from "./posted-logic";

const ID = "9fc03951-aaaa-4bbb-8ccc-123456789abc";
const TOKEN = "A".repeat(43);

describe("short code", () => {
  it("uses the first 8 characters, uppercased", () => {
    expect(donationShortCode(ID)).toBe("9FC03951");
    expect(labelCode(ID)).toBe("#9FC03951");
  });
  it("does not fail on a short id", () => {
    expect(donationShortCode("ab")).toBe("AB");
  });
});

describe("imageFileName", () => {
  it("names the file from the short code only", () => {
    expect(imageFileName(ID)).toBe("foodlink-9FC03951.png");
  });
});

describe("qrPayload", () => {
  it("puts the token in the fragment", () => {
    expect(qrPayload("https://example.com", TOKEN)).toBe(
      `https://example.com/volunteer/scan#${TOKEN}`,
    );
  });
  it("drops a trailing slash on the origin", () => {
    expect(qrPayload("https://example.com/", TOKEN)).toBe(
      `https://example.com/volunteer/scan#${TOKEN}`,
    );
  });
});

describe("parseQrResponse", () => {
  it("returns the token for a matching 200 body", () => {
    expect(parseQrResponse({ donationId: ID, status: "POSTED", qrToken: TOKEN }, ID)).toBe(TOKEN);
  });
  it("refuses a body for another donation", () => {
    expect(parseQrResponse({ donationId: "other", qrToken: TOKEN }, ID)).toBeNull();
  });
  it("refuses a malformed token", () => {
    expect(parseQrResponse({ donationId: ID, qrToken: "short" }, ID)).toBeNull();
    expect(parseQrResponse({ donationId: ID, qrToken: `${"A".repeat(42)}!` }, ID)).toBeNull();
  });
  it("refuses a missing token and non-object bodies", () => {
    expect(parseQrResponse({ donationId: ID }, ID)).toBeNull();
    expect(parseQrResponse(null, ID)).toBeNull();
    expect(parseQrResponse("text", ID)).toBeNull();
  });
});

describe("portionsText", () => {
  it("is plural except for one", () => {
    expect(portionsText(24)).toBe("24 portions");
    expect(portionsText(1)).toBe("1 portion");
  });
});

describe("pickupText", () => {
  it("uses the first line, the pickup window", () => {
    expect(pickupText(["4 Nov 2026 · 7:00–9:00 AM", "18 Mabini Street"])).toBe(
      "Pickup: 4 Nov 2026 · 7:00–9:00 AM",
    );
  });
  it("is empty without lines", () => {
    expect(pickupText([])).toBe("");
  });
});
