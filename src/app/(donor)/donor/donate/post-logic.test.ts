import { describe, expect, it } from "vitest";
import { GENERIC_ERROR } from "./photo-step-logic";
import { canSubmit, parsePostSuccess, postFailure } from "./post-logic";

describe("canSubmit", () => {
  it("needs the confirmation and no post running", () => {
    expect(canSubmit({ confirmed: true, posting: false })).toBe(true);
    expect(canSubmit({ confirmed: false, posting: false })).toBe(false);
    expect(canSubmit({ confirmed: true, posting: true })).toBe(false);
  });
});

describe("postFailure", () => {
  it("maps each post code to its own text", () => {
    for (const code of [
      "NOT_FOUND",
      "NOT_SCREENED",
      "NOT_EDITABLE",
      "PHOTO_REQUIRED",
      "CHECKLIST_INCOMPLETE",
      "PICKUP_REQUIRED",
      "PICKUP_START_NOT_IN_FUTURE",
      "CONSUME_BY_NOT_AFTER_PICKUP_END",
    ]) {
      const failure = postFailure({ error: code, message: "server words" });
      expect(failure.message).not.toBe(GENERIC_ERROR);
      expect(failure.message).not.toContain("server words");
    }
  });

  it("warns that a NOT_EDITABLE donation may already be posted", () => {
    expect(postFailure({ error: "NOT_EDITABLE" }).message).toContain("may already be posted");
  });

  it("lists the missing checklist items for CHECKLIST_INCOMPLETE", () => {
    const failure = postFailure({
      error: "CHECKLIST_INCOMPLETE",
      message: "x",
      details: { missing: ["preparedAt", "not-a-code"] },
    });
    expect(failure.lines.length).toBe(1);
  });

  it("gives no lines when the missing list is absent or malformed", () => {
    expect(postFailure({ error: "CHECKLIST_INCOMPLETE" }).lines).toEqual([]);
    expect(
      postFailure({ error: "CHECKLIST_INCOMPLETE", details: { missing: "x" } }).lines,
    ).toEqual([]);
  });

  it("uses the generic text for an unknown code or no code", () => {
    expect(postFailure({ error: "SOMETHING_NEW" }).message).toBe(GENERIC_ERROR);
    expect(postFailure(null).message).toBe(GENERIC_ERROR);
    expect(postFailure("oops").message).toBe(GENERIC_ERROR);
  });

  it("never uses the server message text", () => {
    expect(postFailure({ error: "SOMETHING_NEW", message: "secret server text" }).message).toBe(
      GENERIC_ERROR,
    );
  });
});

describe("parsePostSuccess", () => {
  it("reads the donation id and expiry", () => {
    expect(
      parsePostSuccess({ donationId: "abc", status: "POSTED", expiresAt: "2026-11-20T09:00:00.000Z" }),
    ).toEqual({ donationId: "abc", expiresAt: "2026-11-20T09:00:00.000Z" });
  });

  it("is null for any other body", () => {
    expect(parsePostSuccess({ donationId: "abc", status: "SCREENED", expiresAt: "x" })).toBeNull();
    expect(parsePostSuccess({ donationId: "abc", status: "POSTED" })).toBeNull();
    expect(parsePostSuccess(null)).toBeNull();
  });
});
