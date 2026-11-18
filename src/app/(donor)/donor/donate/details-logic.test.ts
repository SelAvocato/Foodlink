import { describe, expect, it } from "vitest";
import { toIsoWithOffset } from "./checklist-logic";
import {
  buildDraftPatch,
  buildPickupBody,
  deriveInitialDetails,
  EMPTY_CARRIED,
  initialDetailsForm,
  messageForDetailsError,
  parseDraftDetails,
  parseProfileAddress,
  parsePickupLoad,
  parseSaveResponse,
  rulesFor,
  validateDetails,
  type CarriedAddress,
  type DetailsForm,
  type PickupDetails,
  type ProfileAddress,
} from "./details-logic";
import { GENERIC_ERROR, PLACEHOLDER_FOOD_NAME } from "./photo-step-logic";

const DONATION_ID = "9fc03951-1111-4111-8111-111111111111";
const OTHER_ID = "8ab1e2a0-2222-4222-9222-222222222222";

/** A fixed clock as a local time: every date below is built the same local way. */
const NOW = new Date(2026, 5, 15, 12, 0);

function detailsForm(overrides: Partial<DetailsForm> = {}): DetailsForm {
  return { ...initialDetailsForm(), ...overrides };
}

/** The baseline that passes every rule; each test overrides only what it probes. */
function validForm(overrides: Partial<DetailsForm> = {}): DetailsForm {
  return detailsForm({
    foodName: "Chicken adobo",
    portions: "25",
    pickupStart: "2026-06-15T13:00",
    pickupEnd: "2026-06-15T15:00",
    streetLine1: "123 Sampaguita St",
    city: "Quezon City",
    ...overrides,
  });
}

/** An ISO value built from a local wall time; fails the test when there is none. */
function isoOf(local: string): string {
  const value = toIsoWithOffset(local);
  if (value === null) throw new Error(`expected ${local} to convert to an ISO value`);
  return value;
}

describe("validateDetails food name", () => {
  it("accepts a name of 1 to 160 characters", () => {
    expect(validateDetails(validForm(), null, NOW)).toEqual({});
    expect(validateDetails(validForm({ foodName: "x" }), null, NOW)).toEqual({});
    expect(validateDetails(validForm({ foodName: "x".repeat(160) }), null, NOW)).toEqual({});
  });

  it("refuses an empty or whitespace-only name", () => {
    expect(validateDetails(validForm({ foodName: "" }), null, NOW).foodName).toBe(
      "Enter the food name.",
    );
    expect(validateDetails(validForm({ foodName: "   " }), null, NOW).foodName).toBe(
      "Enter the food name.",
    );
  });

  it("refuses a name longer than 160 characters", () => {
    expect(validateDetails(validForm({ foodName: "x".repeat(161) }), null, NOW).foodName).toBe(
      "Use at most 160 characters.",
    );
  });
});

describe("validateDetails portions", () => {
  const refused: [string, string][] = [
    ["", "Enter the number of portions."],
    ["   ", "Enter the number of portions."],
    ["abc", "Portions must be a whole number."],
    ["1.5", "Portions must be a whole number."],
    ["0", "Enter at least 1 portion."],
    ["-1", "Enter at least 1 portion."],
    ["100001", "Use at most 100000 portions."],
  ];

  it.each(refused)("refuses the portions value %j", (value, message) => {
    expect(validateDetails(validForm({ portions: value }), null, NOW).portions).toBe(message);
  });

  it("accepts the bounds 1 and 100000", () => {
    expect(validateDetails(validForm({ portions: "1" }), null, NOW).portions).toBeUndefined();
    expect(validateDetails(validForm({ portions: "100000" }), null, NOW).portions).toBeUndefined();
  });
});

describe("validateDetails pickup window", () => {
  it("refuses an empty or unreadable start and end", () => {
    expect(validateDetails(validForm({ pickupStart: "" }), null, NOW).pickupStart).toBe(
      "Enter a valid pickup start time.",
    );
    expect(validateDetails(validForm({ pickupStart: "yesterday" }), null, NOW).pickupStart).toBe(
      "Enter a valid pickup start time.",
    );
    expect(validateDetails(validForm({ pickupEnd: "" }), null, NOW).pickupEnd).toBe(
      "Enter a valid pickup end time.",
    );
    expect(validateDetails(validForm({ pickupEnd: "tomorrow" }), null, NOW).pickupEnd).toBe(
      "Enter a valid pickup end time.",
    );
  });

  it("refuses a start that is not after the clock", () => {
    expect(validateDetails(validForm({ pickupStart: "2026-06-15T11:00" }), null, NOW).pickupStart).toBe(
      "The pickup window must start in the future.",
    );
    // Exactly now is refused: the server wants the start strictly after the clock.
    expect(validateDetails(validForm({ pickupStart: "2026-06-15T12:00" }), null, NOW).pickupStart).toBe(
      "The pickup window must start in the future.",
    );
  });

  it("accepts a start after the clock", () => {
    expect(
      validateDetails(validForm({ pickupStart: "2026-06-15T12:01" }), null, NOW).pickupStart,
    ).toBeUndefined();
  });

  it("refuses an end that is not after the start", () => {
    expect(validateDetails(validForm({ pickupEnd: "2026-06-15T13:00" }), null, NOW).pickupEnd).toBe(
      "The pickup window must end after it starts.",
    );
    expect(validateDetails(validForm({ pickupEnd: "2026-06-15T12:00" }), null, NOW).pickupEnd).toBe(
      "The pickup window must end after it starts.",
    );
  });

  it("refuses an end that is not before the consume-by time", () => {
    const consumeBy = isoOf("2026-06-15T14:00");
    expect(validateDetails(validForm(), consumeBy, NOW).pickupEnd).toBe(
      "The pickup window must end before the consume-by time.",
    );
    expect(
      validateDetails(validForm({ pickupEnd: "2026-06-15T14:00" }), consumeBy, NOW).pickupEnd,
    ).toBe("The pickup window must end before the consume-by time.");
  });

  it("skips the consume-by rule when the checklist has none", () => {
    expect(validateDetails(validForm({ pickupEnd: "2026-06-15T20:00" }), null, NOW)).toEqual({});
  });

  it("reports only the first problem of each field", () => {
    const errors = validateDetails(validForm({ pickupStart: "", pickupEnd: "" }), null, NOW);
    expect(errors.pickupStart).toBe("Enter a valid pickup start time.");
    expect(errors.pickupEnd).toBe("Enter a valid pickup end time.");
    expect(errors.foodName).toBeUndefined();
    expect(errors.portions).toBeUndefined();
  });
});

describe("validateDetails address", () => {
  it("refuses an empty or whitespace-only street and city", () => {
    expect(validateDetails(validForm({ streetLine1: "" }), null, NOW).streetLine1).toBe(
      "Enter the street address.",
    );
    expect(validateDetails(validForm({ streetLine1: "   " }), null, NOW).streetLine1).toBe(
      "Enter the street address.",
    );
    expect(validateDetails(validForm({ city: "" }), null, NOW).city).toBe("Enter the city.");
    expect(validateDetails(validForm({ city: "   " }), null, NOW).city).toBe("Enter the city.");
  });

  it("refuses a street longer than 200 characters", () => {
    expect(validateDetails(validForm({ streetLine1: "x".repeat(201) }), null, NOW).streetLine1).toBe(
      "Use at most 200 characters.",
    );
  });

  it("refuses a city longer than 120 characters", () => {
    expect(validateDetails(validForm({ city: "x".repeat(121) }), null, NOW).city).toBe(
      "Use at most 120 characters.",
    );
  });

  it("accepts both bounds, counting the trimmed value", () => {
    expect(validateDetails(validForm({ streetLine1: "x" }), null, NOW).streetLine1).toBeUndefined();
    expect(
      validateDetails(validForm({ streetLine1: "x".repeat(200) }), null, NOW).streetLine1,
    ).toBeUndefined();
    expect(
      validateDetails(validForm({ streetLine1: `  ${"x".repeat(200)}  ` }), null, NOW).streetLine1,
    ).toBeUndefined();
    expect(validateDetails(validForm({ city: "x" }), null, NOW).city).toBeUndefined();
    expect(validateDetails(validForm({ city: "x".repeat(120) }), null, NOW).city).toBeUndefined();
    expect(validateDetails(validForm({ city: `  ${"x".repeat(120)}  ` }), null, NOW).city).toBeUndefined();
  });
});

describe("buildDraftPatch", () => {
  it("trims the name and sends portions as a number", () => {
    expect(buildDraftPatch(detailsForm({ foodName: "  Pancake mix  ", portions: "12" }))).toEqual({
      foodName: "Pancake mix",
      portions: 12,
    });
  });
});

describe("buildPickupBody address", () => {
  const carried: CarriedAddress = {
    streetLine2: "Unit 4B",
    provinceOrState: "Metro Manila",
    postalCode: "1101",
    countryCode: "PH",
  };

  it("keeps the carried fields and trims the editable ones", () => {
    const body = buildPickupBody(
      validForm({ barangay: "  Poblacion  " }),
      carried,
      null,
    );
    if (body === null) throw new Error("expected a pickup body");
    expect(body.address).toEqual({
      streetLine1: "123 Sampaguita St",
      streetLine2: "Unit 4B",
      barangay: "Poblacion",
      city: "Quezon City",
      provinceOrState: "Metro Manila",
      postalCode: "1101",
      countryCode: "PH",
    });
    expect(body.address).not.toHaveProperty("latitude");
    expect(body.address).not.toHaveProperty("longitude");
  });

  it("omits empty optional fields and every null carried field", () => {
    const body = buildPickupBody(
      validForm({ barangay: "   " }),
      { streetLine2: null, provinceOrState: "", postalCode: null, countryCode: null },
      null,
    );
    if (body === null) throw new Error("expected a pickup body");
    expect(body.address).toEqual({ streetLine1: "123 Sampaguita St", city: "Quezon City" });
  });

  it("sends the pin rounded to 6 decimals, both coordinates together", () => {
    const body = buildPickupBody(validForm(), EMPTY_CARRIED, {
      latitude: 14.1234567,
      longitude: 121.1234564,
    });
    if (body === null) throw new Error("expected a pickup body");
    expect(body.address.latitude).toBe(14.123457);
    expect(body.address.longitude).toBe(121.123456);
  });

  it("omits the pin entirely when it is not set", () => {
    const body = buildPickupBody(validForm(), EMPTY_CARRIED, null);
    if (body === null) throw new Error("expected a pickup body");
    expect(body.address).not.toHaveProperty("latitude");
    expect(body.address).not.toHaveProperty("longitude");
  });

  it("sends the window as the same instant as the local inputs", () => {
    const body = buildPickupBody(validForm(), EMPTY_CARRIED, null);
    if (body === null) throw new Error("expected a pickup body");
    expect(new Date(body.pickupStart).getTime()).toBe(new Date("2026-06-15T13:00").getTime());
    expect(new Date(body.pickupEnd).getTime()).toBe(new Date("2026-06-15T15:00").getTime());
  });

  it("returns null when a date does not convert", () => {
    expect(buildPickupBody(validForm({ pickupStart: "" }), EMPTY_CARRIED, null)).toBeNull();
    expect(buildPickupBody(validForm({ pickupEnd: "not a date" }), EMPTY_CARRIED, null)).toBeNull();
  });
});

describe("deriveInitialDetails", () => {
  const savedPickup: PickupDetails = {
    address: {
      streetLine1: "Pickup Street 1",
      streetLine2: "Unit 9",
      barangay: "Bagong Silang",
      city: "Pasig",
      provinceOrState: "Metro Manila",
      postalCode: "1600",
      countryCode: "PH",
      latitude: 14.55,
      longitude: 121.05,
    },
    pickupStart: new Date(2026, 5, 15, 13, 0).toISOString(),
    pickupEnd: new Date(2026, 5, 15, 15, 0).toISOString(),
  };

  const profileAddress: ProfileAddress = {
    streetLine1: "Profile Street 1",
    streetLine2: null,
    barangay: "Profile Barangay",
    city: "Profile City",
    latitude: 14.1,
    longitude: 121.9,
  };

  it("lets a saved pickup win over the profile address", () => {
    const initial = deriveInitialDetails({
      draft: { foodName: "Chicken adobo", portions: 25 },
      pickup: savedPickup,
      profile: profileAddress,
    });
    expect(initial.form).toEqual({
      foodName: "Chicken adobo",
      portions: "25",
      pickupStart: "2026-06-15T13:00",
      pickupEnd: "2026-06-15T15:00",
      streetLine1: "Pickup Street 1",
      barangay: "Bagong Silang",
      city: "Pasig",
    });
    expect(initial.pin).toEqual({ latitude: 14.55, longitude: 121.05 });
    expect(initial.carried).toEqual({
      streetLine2: "Unit 9",
      provinceOrState: "Metro Manila",
      postalCode: "1600",
      countryCode: "PH",
    });
  });

  it("falls back to the profile address when no pickup is saved", () => {
    const initial = deriveInitialDetails({
      draft: { foodName: "Chicken adobo", portions: 4 },
      pickup: null,
      profile: profileAddress,
    });
    expect(initial.form).toEqual({
      foodName: "Chicken adobo",
      portions: "4",
      pickupStart: "",
      pickupEnd: "",
      streetLine1: "Profile Street 1",
      barangay: "Profile Barangay",
      city: "Profile City",
    });
    expect(initial.pin).toEqual({ latitude: 14.1, longitude: 121.9 });
    expect(initial.carried).toEqual(EMPTY_CARRIED);
  });

  it("carries the profile street line 2 when no pickup is saved", () => {
    const initial = deriveInitialDetails({
      draft: { foodName: "Chicken adobo", portions: 4 },
      pickup: null,
      profile: { ...profileAddress, streetLine2: "Unit 12, Profile Tower" },
    });
    expect(initial.carried).toEqual({
      ...EMPTY_CARRIED,
      streetLine2: "Unit 12, Profile Tower",
    });
  });

  it("carries no street line 2 when there is no profile either", () => {
    const initial = deriveInitialDetails({
      draft: { foodName: "Chicken adobo", portions: 4 },
      pickup: null,
      profile: null,
    });
    expect(initial.carried).toEqual(EMPTY_CARRIED);
  });

  it("shows the placeholder name and its portions as empty", () => {
    const initial = deriveInitialDetails({
      draft: { foodName: PLACEHOLDER_FOOD_NAME, portions: 1 },
      pickup: null,
      profile: profileAddress,
    });
    expect(initial.form.foodName).toBe("");
    expect(initial.form.portions).toBe("");
  });

  it("keeps the pin unset when the saved address has neither coordinate", () => {
    const initial = deriveInitialDetails({
      draft: { foodName: "Chicken adobo", portions: 2 },
      pickup: { ...savedPickup, address: { ...savedPickup.address, latitude: null, longitude: null } },
      profile: profileAddress,
    });
    expect(initial.pin).toBeNull();
  });
});

describe("messageForDetailsError", () => {
  const own: [string, string][] = [
    ["PICKUP_START_NOT_IN_FUTURE", "The pickup window must start in the future."],
    ["CONSUME_BY_NOT_AFTER_PICKUP_END", "The pickup window must end before the consume-by time."],
    ["NOT_EDITABLE", "That draft can no longer be changed."],
    ["NOT_FOUND", "The draft was not found."],
  ];

  it.each(own)("maps the error code %s to its own message", (code, message) => {
    expect(messageForDetailsError(code)).toBe(message);
  });

  it("delegates every other code to the photo step's wording", () => {
    expect(messageForDetailsError("UNAUTHENTICATED")).toBe("You are not signed in.");
    expect(messageForDetailsError("SOMETHING_NEW")).toBe(GENERIC_ERROR);
    expect(messageForDetailsError(undefined)).toBe(GENERIC_ERROR);
  });
});

describe("parseSaveResponse", () => {
  it("reads the saved draft id", () => {
    expect(parseSaveResponse({ donationId: DONATION_ID })).toEqual({ donationId: DONATION_ID });
  });

  const malformed: unknown[] = [
    null,
    undefined,
    "saved",
    {},
    { id: DONATION_ID },
    { donationId: "" },
    { donationId: 5 },
    // Strict: an extra field is a shape drift, not something to render.
    { donationId: DONATION_ID, complete: true },
  ];

  it.each(malformed)("refuses the body %j", (body) => {
    expect(parseSaveResponse(body)).toBeNull();
  });
});

describe("parseDraftDetails", () => {
  const entry = {
    id: DONATION_ID,
    foodName: "Chicken adobo",
    description: null,
    portions: 25,
    status: "SCREENED",
    foodCategoryCode: "COOKED_MEALS",
    allergenCodes: ["PEANUTS"],
    dietaryTagCodes: [],
    createdAt: "2026-11-05T00:00:00.000Z",
    updatedAt: "2026-11-06T00:00:00.000Z",
  };

  it("reads the name and portions of the wanted draft", () => {
    const body = { drafts: [{ ...entry, id: OTHER_ID }, entry] };
    expect(parseDraftDetails(body, DONATION_ID)).toEqual({
      foodName: "Chicken adobo",
      portions: 25,
    });
  });

  it("tolerates fields it does not read", () => {
    expect(parseDraftDetails({ ...entry, addedLater: true, drafts: [entry] }, DONATION_ID)).toEqual(
      { foodName: "Chicken adobo", portions: 25 },
    );
  });

  const unusable: unknown[] = [
    null,
    undefined,
    {},
    { drafts: "none" },
    { drafts: [{ ...entry, id: OTHER_ID }] },
    { drafts: [{ id: DONATION_ID, foodName: 5, portions: 25 }] },
    { drafts: [{ id: DONATION_ID, foodName: "Bread" }] },
  ];

  it.each(unusable)("refuses the body %j", (body) => {
    expect(parseDraftDetails(body, DONATION_ID)).toBeNull();
  });
});

describe("parsePickupLoad", () => {
  const savedPickup: PickupDetails = {
    address: {
      streetLine1: "Pickup Street 1",
      streetLine2: null,
      barangay: null,
      city: "Pasig",
      provinceOrState: null,
      postalCode: null,
      countryCode: "PH",
      latitude: null,
      longitude: null,
    },
    pickupStart: "2026-06-15T05:00:00.000Z",
    pickupEnd: "2026-06-15T07:00:00.000Z",
  };

  it("reads a saved pickup", () => {
    expect(parsePickupLoad({ pickup: savedPickup })).toEqual({ ok: true, pickup: savedPickup });
  });

  it("reads a missing pickup as an empty answer, not a failure", () => {
    expect(parsePickupLoad({ pickup: null })).toEqual({ ok: true, pickup: null });
  });

  it("tolerates fields it does not know", () => {
    const pickup = { ...savedPickup, addedLater: 1 };
    expect(parsePickupLoad({ pickup, alsoNew: true })).toEqual({ ok: true, pickup });
  });

  const malformed: unknown[] = [
    null,
    undefined,
    {},
    { pickups: [savedPickup] },
    { pickup: { address: savedPickup.address } },
    { pickup: { ...savedPickup, pickupStart: 5 } },
    { pickup: { ...savedPickup, address: { ...savedPickup.address, latitude: "14.55" } } },
  ];

  it.each(malformed)("refuses the body %j", (body) => {
    expect(parsePickupLoad(body)).toEqual({ ok: false });
  });
});

describe("parseProfileAddress", () => {
  const profileAddress: ProfileAddress = {
    streetLine1: "Profile Street 1",
    streetLine2: null,
    barangay: "Profile Barangay",
    city: "Profile City",
    latitude: 14.1,
    longitude: 121.9,
  };

  const body = {
    profile: {
      fullName: "Test Donor",
      businessName: null,
      donorType: "ESTABLISHMENT",
      email: "donor@example.com",
      status: "ACTIVE",
      contactNumber: "+639000000000",
      address: profileAddress,
      proof: null,
    },
  };

  it("reads the address and ignores the rest of the profile", () => {
    expect(parseProfileAddress(body)).toEqual(profileAddress);
  });

  it("tolerates fields it does not know", () => {
    expect(
      parseProfileAddress({ ...body, addedLater: 1, profile: { ...body.profile, addedLater: 2 } }),
    ).toEqual(profileAddress);
  });

  const malformed: unknown[] = [
    null,
    undefined,
    {},
    { profile: null },
    { profile: {} },
    { profile: { ...body.profile, address: { ...profileAddress, city: 5 } } },
  ];

  it.each(malformed)("refuses the body %j", (value) => {
    expect(parseProfileAddress(value)).toBeNull();
  });
});

describe("profile street line 2 through the first save", () => {
  it("keeps the unit from the profile response in the pickup PUT body", () => {
    const profileBody = {
      profile: {
        fullName: "Test Donor",
        businessName: null,
        donorType: "ESTABLISHMENT",
        email: "donor@example.com",
        status: "ACTIVE",
        contactNumber: "+639000000000",
        address: {
          streetLine1: "Profile Street 1",
          streetLine2: "Unit 12, Profile Tower",
          barangay: "Profile Barangay",
          city: "Profile City",
          latitude: 14.1,
          longitude: 121.9,
        },
        proof: null,
      },
    };

    const profile = parseProfileAddress(profileBody);
    expect(profile).not.toBeNull();
    if (profile === null) return;

    const initial = deriveInitialDetails({
      draft: { foodName: "Chicken adobo", portions: 25 },
      pickup: null,
      profile,
    });

    // A first load has no window yet; the donor fills it before the first save.
    const body = buildPickupBody(
      { ...initial.form, pickupStart: "2026-06-15T13:00", pickupEnd: "2026-06-15T15:00" },
      initial.carried,
      initial.pin,
    );

    expect(body?.address).toMatchObject({
      streetLine1: "Profile Street 1",
      streetLine2: "Unit 12, Profile Tower",
      barangay: "Profile Barangay",
      city: "Profile City",
      latitude: 14.1,
      longitude: 121.9,
    });
  });
});

describe("rulesFor", () => {
  const consumeBy = new Date(2026, 0, 3, 18, 0).toISOString();

  it("names the consume-by clock in the first rule and marks a good window met", () => {
    const rules = rulesFor(
      detailsForm({ pickupStart: "2026-01-03T13:00", pickupEnd: "2026-01-03T15:00" }),
      { consumeByAt: consumeBy, preparedAt: null },
    );
    expect(rules[0]).toEqual({
      text: "Pickup ends after it starts and before 6:00 PM consume-by.",
      met: true,
    });
  });

  it("falls back to wording without a clock when consume-by is unknown", () => {
    const rules = rulesFor(validForm(), { consumeByAt: null, preparedAt: null });
    expect(rules[0].text).toBe(
      "Pickup ends after it starts and before the consume-by time.",
    );
    expect(rules[0].met).toBe(true);
  });

  it("marks the first rule unmet while the window is missing", () => {
    const rules = rulesFor(detailsForm(), { consumeByAt: consumeBy, preparedAt: null });
    expect(rules[0].met).toBe(false);
  });

  it("marks the first rule unmet when the window is backwards", () => {
    const rules = rulesFor(
      detailsForm({ pickupStart: "2026-01-03T15:00", pickupEnd: "2026-01-03T13:00" }),
      { consumeByAt: consumeBy, preparedAt: null },
    );
    expect(rules[0].met).toBe(false);
  });

  it("marks the first rule unmet when the window reaches the consume-by time", () => {
    const atConsumeBy = rulesFor(
      detailsForm({ pickupStart: "2026-01-03T17:00", pickupEnd: "2026-01-03T18:00" }),
      { consumeByAt: consumeBy, preparedAt: null },
    );
    expect(atConsumeBy[0].met).toBe(false);

    const pastConsumeBy = rulesFor(
      detailsForm({ pickupStart: "2026-01-03T17:00", pickupEnd: "2026-01-03T19:00" }),
      { consumeByAt: consumeBy, preparedAt: null },
    );
    expect(pastConsumeBy[0].met).toBe(false);
  });

  const clocks: [number, number, string][] = [
    [0, 5, "12:05 AM"],
    [9, 30, "9:30 AM"],
    [12, 0, "12:00 PM"],
  ];

  it.each(clocks)("formats the consume-by clock %i:%i as %s", (hour, minute, expected) => {
    const rules = rulesFor(validForm(), {
      consumeByAt: new Date(2026, 0, 3, hour, minute).toISOString(),
      preparedAt: null,
    });
    expect(rules[0].text).toBe(
      `Pickup ends after it starts and before ${expected} consume-by.`,
    );
  });

  it("marks the second rule met when the checklist shows no pair of times", () => {
    expect(rulesFor(validForm(), { consumeByAt: null, preparedAt: null })[1]).toEqual({
      text: "Consume-by is later than prepared time.",
      met: true,
    });
    expect(rulesFor(validForm(), { consumeByAt: consumeBy, preparedAt: null })[1].met).toBe(true);
    expect(rulesFor(validForm(), { consumeByAt: null, preparedAt: consumeBy })[1].met).toBe(true);
  });

  it("marks the second rule met when consume-by is later than prepared", () => {
    const rules = rulesFor(validForm(), {
      consumeByAt: consumeBy,
      preparedAt: new Date(2026, 0, 3, 8, 0).toISOString(),
    });
    expect(rules[1].met).toBe(true);
  });

  it("marks the second rule unmet when consume-by is not later than prepared", () => {
    const preparedLater = rulesFor(validForm(), {
      consumeByAt: consumeBy,
      preparedAt: new Date(2026, 0, 3, 20, 0).toISOString(),
    });
    expect(preparedLater[1].met).toBe(false);

    const sameTime = rulesFor(validForm(), { consumeByAt: consumeBy, preparedAt: consumeBy });
    expect(sameTime[1].met).toBe(false);
  });
});
