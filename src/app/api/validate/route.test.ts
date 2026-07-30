import { describe, expect, it } from "vitest";

import { POST } from "./route";

describe("POST /api/validate", () => {
  it("returns the core validation result for a schema", async () => {
    const request = new Request("http://localhost/api/validate", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        schema: {
          type: "object",
          properties: {
            answer: { type: "string" },
          },
          required: ["answer"],
          additionalProperties: false,
        },
      }),
    });

    const response = await POST(request);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      ruleVersion: "2026-07-30",
      valid: true,
      errors: [],
    });
  });

  it("rejects requests without a schema", async () => {
    const request = new Request("http://localhost/api/validate", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    });

    const response = await POST(request);

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "invalid_request",
        message: "A schema string or object is required.",
      },
    });
  });

  it("rejects a malformed JSON request body", async () => {
    const request = new Request("http://localhost/api/validate", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: '{"schema":',
    });

    const response = await POST(request);

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "invalid_request",
        message: "A schema string or object is required.",
      },
    });
  });

  it("rejects a null JSON request body", async () => {
    const request = new Request("http://localhost/api/validate", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "null",
    });

    const response = await POST(request);

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "invalid_request",
        message: "A schema string or object is required.",
      },
    });
  });
});
