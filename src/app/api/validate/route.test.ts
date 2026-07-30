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

  it("returns a limit diagnostic for deeply nested schema JSON", async () => {
    let schema = '{"type":"string"}';

    for (let level = 0; level < 4_999; level += 1) {
      schema = `{"type":"object","properties":{"child":${schema}},"required":["child"],"additionalProperties":false}`;
    }
    schema = `{"type":"object","properties":{"child":${schema}},"required":["child"]}`;

    const request = new Request("http://localhost/api/validate", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ schema }),
    });

    const response = await POST(request);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.stats.maxObjectDepth).toBe(5_000);
    expect(body.fixedSchema).toBeNull();
    expect(body.errors).toContainEqual(
      expect.objectContaining({
        code: "object_nesting_too_deep",
        path: "$",
      }),
    );
  });

  it("rejects request bodies larger than one million bytes", async () => {
    const request = new Request("http://localhost/api/validate", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ schema: "x".repeat(1_000_001) }),
    });

    const response = await POST(request);

    expect(response.status).toBe(413);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "payload_too_large",
        message: "Request body must not exceed 1,000,000 bytes.",
      },
    });
  });

  it("keeps validation responses within the response byte budget", async () => {
    const request = new Request("http://localhost/api/validate", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        schema: {
          type: "object",
          description: "x".repeat(600_000),
          properties: {},
          required: [],
        },
      }),
    });

    const response = await POST(request);
    const responseText = await response.text();
    const body = JSON.parse(responseText) as {
      fixedSchema: unknown;
      fixedSchemaOmitted: boolean;
    };

    expect(response.status).toBe(200);
    expect(new TextEncoder().encode(responseText).byteLength).toBeLessThanOrEqual(
      512_000,
    );
    expect(body.fixedSchema).toBeNull();
    expect(body.fixedSchemaOmitted).toBe(true);
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

  it("does not accept an inherited schema property", async () => {
    let response: Response;

    Object.defineProperty(Object.prototype, "schema", {
      configurable: true,
      value: {
        type: "object",
        properties: {},
        required: [],
        additionalProperties: false,
      },
    });

    try {
      const request = new Request("http://localhost/api/validate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}",
      });
      response = await POST(request);
    } finally {
      delete (Object.prototype as Record<string, unknown>).schema;
    }

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
