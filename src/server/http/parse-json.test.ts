import { describe, expect, it } from "vitest";
import { z } from "zod";
import { parseJsonBody } from "./parse-json";

const schema = z.strictObject({
  name: z.string().trim().min(1),
  count: z.number().int().optional(),
});

function jsonRequest(body: string) {
  return new Request("https://foodlink.test/api/example", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body,
  });
}

describe("parseJsonBody", () => {
  it("returns the parsed data for a valid body", async () => {
    const result = await parseJsonBody(jsonRequest(JSON.stringify({ name: "Rice", count: 3 })), schema);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data).toEqual({ name: "Rice", count: 3 });
    }
  });

  it("rejects a body that is not JSON with a 400 response", async () => {
    const result = await parseJsonBody(jsonRequest("not json"), schema);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.response.status).toBe(400);
      expect(await result.response.json()).toEqual({
        error: "INVALID_REQUEST",
        message: "Send a valid JSON request body.",
      });
    }
  });

  it("rejects unknown fields with flattened error details", async () => {
    const result = await parseJsonBody(jsonRequest(JSON.stringify({ name: "Rice", extra: true })), schema, "The example is invalid.");

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.response.status).toBe(400);
      const body = await result.response.json();
      expect(body.error).toBe("INVALID_REQUEST");
      expect(body.message).toBe("The example is invalid.");
      expect(body.details).toBeDefined();
    }
  });

  it("rejects schema failures with a 400 response", async () => {
    const result = await parseJsonBody(jsonRequest(JSON.stringify({ name: "" })), schema);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.response.status).toBe(400);
      const body = await result.response.json();
      expect(body.error).toBe("INVALID_REQUEST");
      expect(body.details).toBeDefined();
    }
  });
});
