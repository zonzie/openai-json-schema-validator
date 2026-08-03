import { describe, expect, it } from "vitest";

import { validateOpenAISchema } from "./validator";

describe("validateOpenAISchema", () => {
  it("accepts a valid bare Structured Outputs schema", () => {
    const result = validateOpenAISchema({
      type: "object",
      properties: {
        name: { type: "string" },
      },
      required: ["name"],
      additionalProperties: false,
    });

    expect(result).toMatchObject({
      ruleVersion: "2026-08-03",
      sourcePath: "$",
      valid: true,
      errors: [],
      warnings: [],
      fixedSchema: null,
      stats: {
        schemaCount: 1,
        propertyCount: 1,
        maxObjectDepth: 1,
        totalStringLength: 4,
        enumValueCount: 0,
      },
    });
  });

  it("returns a diagnostic for malformed JSON instead of throwing", () => {
    const result = validateOpenAISchema('{"type":"object"');

    expect(result.valid).toBe(false);
    expect(result.errors).toEqual([
      expect.objectContaining({
        code: "invalid_json",
        path: "$",
        severity: "error",
      }),
    ]);
    expect(result.fixedSchema).toBeNull();
  });

  it("returns fresh stats for each malformed input result", () => {
    const first = validateOpenAISchema("{");
    first.stats.propertyCount = 99;

    const second = validateOpenAISchema("{");

    expect(second.stats.propertyCount).toBe(0);
  });

  it("ignores schema keywords inherited from the object prototype", () => {
    let result: ReturnType<typeof validateOpenAISchema>;

    Object.defineProperty(Object.prototype, "allOf", {
      configurable: true,
      value: [],
    });

    try {
      result = validateOpenAISchema(
        JSON.stringify({
          type: "object",
          properties: {},
          required: [],
          additionalProperties: false,
        }),
      );
    } finally {
      delete (Object.prototype as Record<string, unknown>).allOf;
    }

    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it("rejects a root schema that is not an object", () => {
    const result = validateOpenAISchema({
      type: "array",
      items: { type: "string" },
    });

    expect(result.valid).toBe(false);
    expect(result.errors).toContainEqual(
      expect.objectContaining({
        code: "root_must_be_object",
        path: "$.type",
      }),
    );
  });

  it("rejects anyOf at the root", () => {
    const result = validateOpenAISchema({
      type: "object",
      anyOf: [
        {
          type: "object",
          properties: {},
          required: [],
          additionalProperties: false,
        },
      ],
      properties: {},
      required: [],
      additionalProperties: false,
    });

    expect(result.errors).toContainEqual(
      expect.objectContaining({
        code: "root_any_of",
        path: "$.anyOf",
      }),
    );
  });

  it("finds and patches missing strict object requirements", () => {
    const input = {
      type: "object",
      properties: {
        profile: {
          type: "object",
          properties: {
            name: { type: "string" },
            age: { type: "integer" },
          },
          required: ["name"],
        },
      },
      required: ["profile"],
      additionalProperties: false,
    };

    const result = validateOpenAISchema(input);

    expect(result.valid).toBe(false);
    expect(result.errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "additional_properties_must_be_false",
          path: "$.properties.profile.additionalProperties",
        }),
        expect.objectContaining({
          code: "property_must_be_required",
          path: "$.properties.profile.required",
          message: expect.stringContaining('"age"'),
        }),
      ]),
    );
    expect(result.fixedSchema).toEqual({
      type: "object",
      properties: {
        profile: {
          type: "object",
          properties: {
            name: { type: "string" },
            age: { type: "integer" },
          },
          required: ["name", "age"],
          additionalProperties: false,
        },
      },
      required: ["profile"],
      additionalProperties: false,
    });
    expect(result.patches).toEqual(
      expect.arrayContaining([
        {
          operation: "add",
          path: "$.properties.profile.additionalProperties",
          value: false,
        },
        {
          operation: "replace",
          path: "$.properties.profile.required",
          value: ["name", "age"],
        },
      ]),
    );

    expect(validateOpenAISchema(result.fixedSchema).valid).toBe(true);
  });

  it("enforces strict object rules for nullable object schemas", () => {
    const result = validateOpenAISchema({
      type: "object",
      properties: {
        payload: {
          type: ["object", "null"],
          additionalProperties: true,
        },
      },
      required: ["payload"],
      additionalProperties: false,
    });

    expect(result.stats.maxObjectDepth).toBe(2);
    expect(result.errors).toContainEqual(
      expect.objectContaining({
        code: "additional_properties_must_be_false",
        path: "$.properties.payload.additionalProperties",
      }),
    );
    expect(result.fixedSchema).toEqual({
      type: "object",
      properties: {
        payload: {
          type: ["object", "null"],
          additionalProperties: false,
        },
      },
      required: ["payload"],
      additionalProperties: false,
    });
    expect(validateOpenAISchema(result.fixedSchema).valid).toBe(true);
  });

  it("does not remove required names that have no declared property", () => {
    const result = validateOpenAISchema({
      type: "object",
      required: ["ghost"],
      additionalProperties: false,
    });

    expect(result.errors).toContainEqual(
      expect.objectContaining({
        code: "required_property_not_declared",
        path: "$.required",
      }),
    );
    expect(result.fixedSchema).toBeNull();
    expect(result.patches).toEqual([]);
  });

  it("does not guess how to fix a likely property-name typo", () => {
    const input = {
      type: "object",
      properties: {
        emial: { type: "string" },
      },
      required: ["email"],
      additionalProperties: false,
    };

    const result = validateOpenAISchema(input);

    expect(result.errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "required_property_not_declared",
          message: expect.stringContaining('"email"'),
        }),
        expect.objectContaining({
          code: "property_must_be_required",
          message: expect.stringContaining('"emial"'),
        }),
      ]),
    );
    expect(result.fixedSchema).toBeNull();
    expect(input.required).toEqual(["email"]);
  });

  it("does not rewrite required names when properties is malformed", () => {
    const input = {
      type: "object",
      properties: "not-an-object",
      required: ["name"],
      additionalProperties: false,
    };

    const result = validateOpenAISchema(input);

    expect(result.errors).toContainEqual(
      expect.objectContaining({
        code: "properties_must_be_object",
        path: "$.properties",
      }),
    );
    expect(result.errors).not.toContainEqual(
      expect.objectContaining({
        code: "required_property_not_declared",
      }),
    );
    expect(result.fixedSchema).toBeNull();
    expect(input.required).toEqual(["name"]);
  });

  it("rejects property entries that are not schema objects", () => {
    const result = validateOpenAISchema({
      type: "object",
      properties: {
        bad: 42,
      },
      required: ["bad"],
      additionalProperties: false,
    });

    expect(result.valid).toBe(false);
    expect(result.errors).toContainEqual(
      expect.objectContaining({
        code: "schema_must_be_object",
        path: "$.properties.bad",
      }),
    );
    expect(result.fixedSchema).toBeNull();
  });

  it.each([42, []])(
    "rejects a non-schema items value: %j",
    (items) => {
      const result = validateOpenAISchema({
        type: "object",
        properties: {
          values: {
            type: "array",
            items,
          },
        },
        required: ["values"],
        additionalProperties: false,
      });

      expect(result.valid).toBe(false);
      expect(result.errors).toContainEqual(
        expect.objectContaining({
          code: "items_must_be_schema",
          path: "$.properties.values.items",
        }),
      );
    },
  );

  it.each([{}, []])(
    "rejects an anyOf value that is not a non-empty schema array",
    (anyOf) => {
      const result = validateOpenAISchema({
        type: "object",
        properties: {
          value: { anyOf },
        },
        required: ["value"],
        additionalProperties: false,
      });

      expect(result.valid).toBe(false);
      expect(result.errors).toContainEqual(
        expect.objectContaining({
          code: "any_of_must_be_non_empty_array",
          path: "$.properties.value.anyOf",
        }),
      );
    },
  );

  it.each([
    ["patternProperties", [], "$.patternProperties"],
    ["$defs", [], "$.$defs"],
    ["definitions", null, "$.definitions"],
  ] as const)(
    "rejects a malformed %s schema map",
    (keyword, value, expectedPath) => {
      const result = validateOpenAISchema({
        type: "object",
        properties: {},
        required: [],
        additionalProperties: false,
        [keyword]: value,
      });

      expect(result.valid).toBe(false);
      expect(result.errors).toContainEqual(
        expect.objectContaining({
          code: "schema_map_must_be_object",
          path: expectedPath,
        }),
      );
    },
  );

  it("rejects an enum value that is not an array", () => {
    const result = validateOpenAISchema({
      type: "object",
      properties: {
        color: {
          type: "string",
          enum: "red",
        },
      },
      required: ["color"],
      additionalProperties: false,
    });

    expect(result.valid).toBe(false);
    expect(result.errors).toContainEqual(
      expect.objectContaining({
        code: "enum_must_be_array",
        path: "$.properties.color.enum",
      }),
    );
  });

  it.each([
    [
      { $ref: 7 },
      "ref_must_be_string",
    ],
    [
      { $ref: "#/$defs/missing" },
      "unresolved_local_ref",
    ],
  ] as const)("rejects an invalid local reference", (propertySchema, code) => {
    const result = validateOpenAISchema({
      type: "object",
      properties: {
        value: propertySchema,
      },
      required: ["value"],
      additionalProperties: false,
      $defs: {},
    });

    expect(result.valid).toBe(false);
    expect(result.errors).toContainEqual(
      expect.objectContaining({
        code,
        path: "$.properties.value.$ref",
      }),
    );
  });

  it("validates local reference targets outside schema containers", () => {
    const result = validateOpenAISchema({
      type: "object",
      properties: {
        value: { $ref: "#/x" },
      },
      required: ["value"],
      additionalProperties: false,
      x: {
        items: 42,
      },
    });

    expect(result.valid).toBe(false);
    expect(result.errors).toContainEqual(
      expect.objectContaining({
        code: "items_must_be_schema",
        path: "$.x.items",
      }),
    );
  });

  it("patches referenced object schemas without mutating input", () => {
    const input = {
      type: "object",
      properties: {
        value: { $ref: "#/x" },
      },
      required: ["value"],
      additionalProperties: false,
      x: {
        type: "object",
        properties: {
          name: { type: "string" },
        },
        required: [],
      },
    };

    const result = validateOpenAISchema(input);

    expect(result.fixedSchema).toEqual({
      type: "object",
      properties: {
        value: { $ref: "#/x" },
      },
      required: ["value"],
      additionalProperties: false,
      x: {
        type: "object",
        properties: {
          name: { type: "string" },
        },
        required: ["name"],
        additionalProperties: false,
      },
    });
    expect(input.x).toEqual({
      type: "object",
      properties: {
        name: { type: "string" },
      },
      required: [],
    });
    expect(validateOpenAISchema(result.fixedSchema).valid).toBe(true);
  });

  it("escapes user-defined names in diagnostic JSON paths", () => {
    const result = validateOpenAISchema({
      type: "object",
      properties: {
        "profile.name": {
          type: "object",
          properties: {},
          required: [],
        },
      },
      required: ["profile.name"],
      additionalProperties: false,
    });

    expect(result.errors).toContainEqual(
      expect.objectContaining({
        code: "additional_properties_must_be_false",
        path: '$.properties["profile.name"].additionalProperties',
      }),
    );
  });

  it("rejects unsupported composition keywords without rewriting them", () => {
    const input = {
      type: "object",
      properties: {},
      required: [],
      additionalProperties: false,
      allOf: [],
    };

    const result = validateOpenAISchema(input);

    expect(result.errors).toContainEqual(
      expect.objectContaining({
        code: "unsupported_keyword",
        path: "$.allOf",
        message: expect.stringContaining('"allOf"'),
      }),
    );
    expect(result.fixedSchema).toBeNull();
  });

  it("enforces the 5,000-property schema limit", () => {
    const propertyNames = Array.from(
      { length: 5_001 },
      (_, index) => `field_${index}`,
    );
    const properties = Object.fromEntries(
      propertyNames.map((propertyName) => [
        propertyName,
        { type: "string" },
      ]),
    );

    const result = validateOpenAISchema({
      type: "object",
      properties,
      required: propertyNames,
      additionalProperties: false,
    });

    expect(result.stats.propertyCount).toBe(5_001);
    expect(result.errors).toContainEqual(
      expect.objectContaining({
        code: "too_many_properties",
        path: "$",
      }),
    );
  });

  it("enforces the 10-level object nesting limit", () => {
    let schema: Record<string, unknown> = {
      type: "object",
      properties: {},
      required: [],
      additionalProperties: false,
    };

    for (let level = 0; level < 10; level += 1) {
      schema = {
        type: "object",
        properties: { child: schema },
        required: ["child"],
        additionalProperties: false,
      };
    }

    const result = validateOpenAISchema(schema);

    expect(result.stats.maxObjectDepth).toBe(11);
    expect(result.errors).toContainEqual(
      expect.objectContaining({
        code: "object_nesting_too_deep",
        path: "$",
      }),
    );
  });

  it("returns a depth diagnostic for deeply nested JSON without overflowing the stack", () => {
    let schema = '{"type":"string"}';

    for (let level = 0; level < 5_000; level += 1) {
      schema = `{"type":"object","properties":{"child":${schema}},"required":["child"],"additionalProperties":false}`;
    }

    const result = validateOpenAISchema(schema);

    expect(result.stats.maxObjectDepth).toBe(5_000);
    expect(result.errors).toContainEqual(
      expect.objectContaining({
        code: "object_nesting_too_deep",
        path: "$",
      }),
    );
  });

  it("bounds diagnostics and paths for deeply invalid schemas", () => {
    let schema: Record<string, unknown> = {
      type: "object",
      properties: {},
      required: [],
    };

    for (let level = 0; level < 300; level += 1) {
      schema = {
        type: "object",
        properties: { child: schema },
        required: [],
      };
    }

    const result = validateOpenAISchema(schema);

    expect(result.errors).toHaveLength(100);
    expect(result.omittedDiagnosticCount).toBeGreaterThan(0);
    expect(
      Math.max(...result.errors.map((diagnostic) => diagnostic.path.length)),
    ).toBeLessThanOrEqual(512);
  });

  it("bounds warnings without making an otherwise valid schema invalid", () => {
    const unknownKeywords = Object.fromEntries(
      Array.from({ length: 60 }, (_, index) => [`unknown_${index}`, true]),
    );

    const result = validateOpenAISchema({
      type: "object",
      properties: {},
      required: [],
      additionalProperties: false,
      ...unknownKeywords,
    });

    expect(result.valid).toBe(true);
    expect(result.warnings).toHaveLength(50);
    expect(result.omittedDiagnosticCount).toBe(10);
  });

  it("enforces the 120,000-character schema string limit", () => {
    const longPropertyName = "x".repeat(120_001);
    const result = validateOpenAISchema({
      type: "object",
      properties: {
        [longPropertyName]: { type: "string" },
      },
      required: [longPropertyName],
      additionalProperties: false,
    });

    expect(result.stats.totalStringLength).toBe(120_001);
    expect(result.errors).toContainEqual(
      expect.objectContaining({
        code: "schema_text_too_long",
        path: "$",
      }),
    );
  });

  it("enforces the 1,000-value combined enum limit", () => {
    const result = validateOpenAISchema({
      type: "object",
      properties: {
        code: {
          type: "integer",
          enum: Array.from({ length: 1_001 }, (_, index) => index),
        },
      },
      required: ["code"],
      additionalProperties: false,
    });

    expect(result.stats.enumValueCount).toBe(1_001);
    expect(result.errors).toContainEqual(
      expect.objectContaining({
        code: "too_many_enum_values",
        path: "$",
      }),
    );
  });

  it("enforces the long string-enum limit above 250 values", () => {
    const result = validateOpenAISchema({
      type: "object",
      properties: {
        status: {
          type: "string",
          enum: Array.from(
            { length: 251 },
            (_, index) => `${index}-${"x".repeat(60)}`,
          ),
        },
      },
      required: ["status"],
      additionalProperties: false,
    });

    expect(result.errors).toContainEqual(
      expect.objectContaining({
        code: "enum_string_values_too_long",
        path: "$.properties.status.enum",
      }),
    );
  });

  it("extracts schemas from supported OpenAI request wrappers", () => {
    const schema = {
      type: "object",
      properties: { answer: { type: "string" } },
      required: ["answer"],
      additionalProperties: false,
    };
    const cases = [
      {
        input: { name: "answer", strict: true, schema },
        sourcePath: "$.schema",
      },
      {
        input: {
          response_format: {
            type: "json_schema",
            json_schema: { name: "answer", strict: true, schema },
          },
        },
        sourcePath: "$.response_format.json_schema.schema",
      },
      {
        input: {
          text: {
            format: { type: "json_schema", name: "answer", strict: true, schema },
          },
        },
        sourcePath: "$.text.format.schema",
      },
      {
        input: { name: "answer", strict: true, parameters: schema },
        sourcePath: "$.parameters",
      },
      {
        input: {
          tools: [
            {
              type: "function",
              function: { name: "answer", strict: true, parameters: schema },
            },
          ],
        },
        sourcePath: "$.tools[0].function.parameters",
      },
      {
        input: {
          model: "gpt-5.6",
          tools: [
            {
              type: "function",
              name: "answer",
              strict: true,
              parameters: schema,
            },
          ],
        },
        sourcePath: "$.tools[0].parameters",
      },
    ];

    for (const testCase of cases) {
      const result = validateOpenAISchema(testCase.input);
      expect(result.valid, testCase.sourcePath).toBe(true);
      expect(result.sourcePath).toBe(testCase.sourcePath);
    }
  });

  it("validates every recognized function schema in a tools request", () => {
    const result = validateOpenAISchema({
      model: "gpt-5.6",
      tools: [
        {
          type: "function",
          function: {
            name: "first",
            parameters: {
              type: "object",
              properties: { query: { type: "string" } },
              required: ["query"],
              additionalProperties: false,
            },
          },
        },
        {
          type: "function",
          name: "second",
          parameters: {
            type: "object",
            properties: { limit: { type: "integer" } },
            required: [],
          },
        },
      ],
    });

    expect(result.sourcePath).toBe("$.tools");
    expect(result.valid).toBe(false);
    expect(result.stats.propertyCount).toBe(2);
    expect(result.stats.schemaCount).toBe(2);
    expect(result.errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "additional_properties_must_be_false",
          path: "$.tools[1].parameters.additionalProperties",
        }),
        expect.objectContaining({
          code: "property_must_be_required",
          path: "$.tools[1].parameters.required",
        }),
      ]),
    );
    expect(result.fixedSchema).toEqual({
      model: "gpt-5.6",
      tools: [
        {
          type: "function",
          function: {
            name: "first",
            parameters: {
              type: "object",
              properties: { query: { type: "string" } },
              required: ["query"],
              additionalProperties: false,
            },
          },
        },
        {
          type: "function",
          name: "second",
          parameters: {
            type: "object",
            properties: { limit: { type: "integer" } },
            required: ["limit"],
            additionalProperties: false,
          },
        },
      ],
    });
    expect(result.patches).toEqual([
      {
        operation: "add",
        path: "$.tools[1].parameters.additionalProperties",
        value: false,
      },
      {
        operation: "replace",
        path: "$.tools[1].parameters.required",
        value: ["limit"],
      },
    ]);
  });

  it.each([
    ["minimum", "0", "numeric_keyword_must_be_number"],
    ["maximum", null, "numeric_keyword_must_be_number"],
    ["multipleOf", 0, "multiple_of_must_be_positive"],
    ["minLength", -1, "size_keyword_must_be_non_negative_integer"],
    ["maxLength", 1.5, "size_keyword_must_be_non_negative_integer"],
    ["minItems", -1, "size_keyword_must_be_non_negative_integer"],
    ["maxItems", 2.5, "size_keyword_must_be_non_negative_integer"],
    ["pattern", 42, "pattern_must_be_string"],
  ] as const)(
    "rejects a malformed %s keyword value",
    (keyword, value, code) => {
      const result = validateOpenAISchema({
        type: "object",
        properties: {
          value: { type: "string", [keyword]: value },
        },
        required: ["value"],
        additionalProperties: false,
      });

      expect(result.valid).toBe(false);
      expect(result.errors).toContainEqual(
        expect.objectContaining({
          code,
          path: `$.properties.value.${keyword}`,
        }),
      );
    },
  );

  it("rejects duplicate values in type and required arrays", () => {
    const result = validateOpenAISchema({
      type: "object",
      properties: {
        value: { type: ["string", "string"] },
      },
      required: ["value", "value"],
      additionalProperties: false,
    });

    expect(result.errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "type_values_must_be_unique",
          path: "$.properties.value.type",
        }),
        expect.objectContaining({
          code: "required_values_must_be_unique",
          path: "$.required",
        }),
      ]),
    );
  });

  it("warns about constraints whose compatibility cannot be confirmed locally", () => {
    const result = validateOpenAISchema({
      type: "object",
      properties: {
        empty: { type: "string", enum: [] },
        repeated: { type: "string", enum: ["x", "x"] },
        pattern: { type: "string", pattern: "[" },
        remote: { $ref: "https://example.com/schema.json" },
      },
      required: ["empty", "repeated", "pattern", "remote"],
      additionalProperties: false,
    });

    expect(result.warnings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "empty_enum" }),
        expect.objectContaining({ code: "duplicate_enum_value" }),
        expect.objectContaining({ code: "invalid_pattern_syntax" }),
        expect.objectContaining({ code: "external_ref_not_resolved" }),
      ]),
    );
  });

  it("does not mistake a bare schema tools annotation for a request wrapper", () => {
    const result = validateOpenAISchema({
      type: "object",
      properties: {
        outer: { type: "string" },
      },
      required: ["outer"],
      additionalProperties: false,
      tools: [
        {
          type: "function",
          parameters: {
            type: "object",
            properties: {
              inner: { type: "string" },
            },
            required: [],
            additionalProperties: false,
          },
        },
      ],
    });

    expect(result.sourcePath).toBe("$");
    expect(result.valid).toBe(true);
    expect(result.warnings).toContainEqual(
      expect.objectContaining({
        code: "unknown_keyword",
        path: "$.tools",
      }),
    );
    expect(result.fixedSchema).toBeNull();
  });

  it("does not let a wrapper-like annotation hide a bare root error", () => {
    const result = validateOpenAISchema({
      type: "string",
      tools: [
        {
          type: "function",
          parameters: {
            type: "object",
            properties: {},
            required: [],
            additionalProperties: false,
          },
        },
      ],
    });

    expect(result.sourcePath).toBe("$");
    expect(result.valid).toBe(false);
    expect(result.errors).toContainEqual(
      expect.objectContaining({
        code: "root_must_be_object",
        path: "$.type",
      }),
    );
    expect(result.fixedSchema).toBeNull();
  });

  it("recognizes a JSON Schema dialect marker before wrapper-like annotations", () => {
    const result = validateOpenAISchema({
      $schema: "https://json-schema.org/draft/2020-12/schema",
      title: "Bare schema",
      tools: [
        {
          type: "function",
          parameters: {
            type: "object",
            properties: {},
            required: [],
            additionalProperties: false,
          },
        },
      ],
    });

    expect(result.sourcePath).toBe("$");
    expect(result.valid).toBe(false);
    expect(result.errors).toContainEqual(
      expect.objectContaining({
        code: "root_must_be_object",
        path: "$.type",
      }),
    );
    expect(result.warnings).toContainEqual(
      expect.objectContaining({
        code: "unknown_keyword",
        path: "$.$schema",
      }),
    );
  });

  it("preserves a Responses text-format wrapper when applying a patch", () => {
    const input = {
      model: "gpt-5.6",
      input: "Return a short answer.",
      text: {
        format: {
          type: "json_schema",
          name: "answer",
          strict: true,
          schema: {
            type: "object",
            properties: { answer: { type: "string" } },
            required: [],
            additionalProperties: false,
          },
        },
      },
    };

    const result = validateOpenAISchema(input);

    expect(result.sourcePath).toBe("$.text.format.schema");
    expect(result.fixedSchema).toEqual({
      model: "gpt-5.6",
      input: "Return a short answer.",
      text: {
        format: {
          type: "json_schema",
          name: "answer",
          strict: true,
          schema: {
            type: "object",
            properties: { answer: { type: "string" } },
            required: ["answer"],
            additionalProperties: false,
          },
        },
      },
    });
    expect(input.text.format.schema.required).toEqual([]);
  });

  it("preserves a wrapper source path when its schema value is malformed", () => {
    const result = validateOpenAISchema({
      text: {
        format: {
          type: "json_schema",
          name: "answer",
          schema: "not-an-object",
        },
      },
    });

    expect(result.sourcePath).toBe("$.text.format.schema");
    expect(result.errors).toContainEqual(
      expect.objectContaining({
        code: "root_must_be_object",
        path: "$.text.format.schema.type",
      }),
    );
  });

  it("warns about fine-tuned and unknown keywords without declaring the schema invalid", () => {
    const result = validateOpenAISchema({
      type: "object",
      properties: {
        code: {
          type: "string",
          pattern: "^[A-Z]+$",
          oneOf: [],
        },
      },
      required: ["code"],
      additionalProperties: false,
    });

    expect(result.valid).toBe(true);
    expect(result.warnings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "fine_tuned_model_keyword",
          path: "$.properties.code.pattern",
        }),
        expect.objectContaining({
          code: "unknown_keyword",
          path: "$.properties.code.oneOf",
        }),
      ]),
    );
  });

  it("validates and counts schemas nested under patternProperties", () => {
    const result = validateOpenAISchema({
      type: "object",
      properties: {},
      patternProperties: {
        "^item_": {
          type: "object",
          properties: {
            value: { type: "string" },
          },
          required: [],
        },
      },
      required: [],
      additionalProperties: false,
    });

    expect(result.stats).toMatchObject({
      propertyCount: 1,
      maxObjectDepth: 2,
    });
    expect(result.errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "additional_properties_must_be_false",
          path: '$.patternProperties["^item_"].additionalProperties',
        }),
        expect.objectContaining({
          code: "property_must_be_required",
          path: '$.patternProperties["^item_"].required',
        }),
      ]),
    );
    expect(result.fixedSchema).not.toBeNull();
    expect(validateOpenAISchema(result.fixedSchema).valid).toBe(true);
  });

  it("rejects string formats outside the documented supported list", () => {
    const result = validateOpenAISchema({
      type: "object",
      properties: {
        website: {
          type: "string",
          format: "uri",
        },
      },
      required: ["website"],
      additionalProperties: false,
    });

    expect(result.errors).toContainEqual(
      expect.objectContaining({
        code: "unsupported_format",
        path: "$.properties.website.format",
      }),
    );
    expect(result.fixedSchema).toBeNull();
  });

  it("does not offer a partially fixed schema that still has hard errors", () => {
    const result = validateOpenAISchema({
      type: "object",
      properties: {
        website: {
          type: "string",
          format: "uri",
        },
      },
      required: ["website"],
    });

    expect(result.errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "additional_properties_must_be_false",
          path: "$.additionalProperties",
        }),
        expect.objectContaining({
          code: "unsupported_format",
          path: "$.properties.website.format",
        }),
      ]),
    );
    expect(result.fixedSchema).toBeNull();
  });

  it("rejects schema types outside the supported type set", () => {
    const result = validateOpenAISchema({
      type: "object",
      properties: {
        publishedAt: {
          type: "datetime",
        },
      },
      required: ["publishedAt"],
      additionalProperties: false,
    });

    expect(result.errors).toContainEqual(
      expect.objectContaining({
        code: "unsupported_type",
        path: "$.properties.publishedAt.type",
      }),
    );
  });

  it("returns a type diagnostic for non-JSON values without throwing", () => {
    const result = validateOpenAISchema({
      type: "object",
      properties: {
        value: { type: ["string", Symbol("invalid")] },
      },
      required: ["value"],
      additionalProperties: false,
    });

    expect(result.valid).toBe(false);
    expect(result.errors).toContainEqual(
      expect.objectContaining({
        code: "unsupported_type",
        path: "$.properties.value.type",
      }),
    );
  });

  it("counts object depth through local definition references", () => {
    const definitions: Record<string, unknown> = {};

    for (let level = 10; level >= 1; level -= 1) {
      definitions[`level${level}`] = {
        type: "object",
        properties:
          level === 10
            ? {}
            : {
                next: {
                  $ref: `#/$defs/level${level + 1}`,
                },
              },
        required: level === 10 ? [] : ["next"],
        additionalProperties: false,
      };
    }

    const result = validateOpenAISchema({
      type: "object",
      properties: {
        root: { $ref: "#/$defs/level1" },
      },
      required: ["root"],
      additionalProperties: false,
      $defs: definitions,
    });

    expect(result.stats.maxObjectDepth).toBe(11);
    expect(result.errors).toContainEqual(
      expect.objectContaining({
        code: "object_nesting_too_deep",
        path: "$",
      }),
    );
  });

  it("validates a shared-reference DAG within the core operation budget", () => {
    const definitions: Record<string, unknown> = {
      level20: {
        type: "object",
        properties: {},
        required: [],
        additionalProperties: false,
      },
    };

    for (let level = 19; level >= 0; level -= 1) {
      definitions[`level${level}`] = {
        anyOf: [
          { $ref: `#/$defs/level${level + 1}` },
          { $ref: `#/$defs/level${level + 1}` },
        ],
      };
    }

    const startedAt = performance.now();
    const result = validateOpenAISchema({
      type: "object",
      properties: {
        value: { $ref: "#/$defs/level0" },
      },
      required: ["value"],
      additionalProperties: false,
      $defs: definitions,
    });
    const elapsedMilliseconds = performance.now() - startedAt;

    expect(result.valid).toBe(true);
    expect(result.stats.maxObjectDepth).toBe(2);
    expect(elapsedMilliseconds).toBeLessThan(500);
  });

  it("stops cyclic reference expansion at the core operation budget", () => {
    const definitions: Record<string, unknown> = {
      level18: { $ref: "#/$defs/level18" },
    };

    for (let level = 17; level >= 0; level -= 1) {
      definitions[`level${level}`] = {
        anyOf: [
          { $ref: `#/$defs/level${level + 1}` },
          { $ref: `#/$defs/level${level + 1}` },
        ],
      };
    }

    const startedAt = performance.now();
    const result = validateOpenAISchema({
      type: "object",
      properties: {
        value: { $ref: "#/$defs/level0" },
      },
      required: ["value"],
      additionalProperties: false,
      $defs: definitions,
    });
    const elapsedMilliseconds = performance.now() - startedAt;

    expect(result.errors).toContainEqual(
      expect.objectContaining({
        code: "reference_analysis_budget_exceeded",
      }),
    );
    expect(elapsedMilliseconds).toBeLessThan(500);
  });

  it("reports reference budget exhaustion when the error cap is full", () => {
    const definitions: Record<string, unknown> = Object.fromEntries(
      Array.from({ length: 101 }, (_, index) => [
        `invalid${index}`,
        {
          type: "object",
          properties: {},
          required: [],
        },
      ]),
    );
    definitions.level18 = { $ref: "#/$defs/level18" };

    for (let level = 17; level >= 0; level -= 1) {
      definitions[`level${level}`] = {
        anyOf: [
          { $ref: `#/$defs/level${level + 1}` },
          { $ref: `#/$defs/level${level + 1}` },
        ],
      };
    }

    const result = validateOpenAISchema({
      type: "object",
      properties: {
        value: { $ref: "#/$defs/level0" },
      },
      required: ["value"],
      additionalProperties: false,
      $defs: definitions,
    });

    expect(result.errors).toHaveLength(100);
    expect(result.errors).toContainEqual(
      expect.objectContaining({
        code: "reference_analysis_budget_exceeded",
      }),
    );
    expect(result.omittedDiagnosticCount).toBeGreaterThan(0);
  });

  it("preserves finite structural depth across cyclic definitions", () => {
    const result = validateOpenAISchema({
      type: "object",
      properties: {},
      required: [],
      additionalProperties: false,
      $defs: {
        A: {
          type: "object",
          properties: {},
          required: [],
          additionalProperties: false,
          anyOf: [{ $ref: "#/$defs/B" }],
        },
        B: {
          type: "object",
          properties: {
            next: { $ref: "#/$defs/A" },
          },
          required: ["next"],
          additionalProperties: false,
          anyOf: [{ $ref: "#/$defs/B" }],
        },
      },
    });

    expect(result.valid).toBe(true);
    expect(result.stats.maxObjectDepth).toBe(2);
  });

  it("does not reuse cycle-dependent depth results across reference entries", () => {
    const definitions: Record<string, unknown> = {};

    for (let level = 8; level >= 1; level -= 1) {
      definitions[`C${level}`] = {
        type: "object",
        properties:
          level === 8
            ? {}
            : { next: { $ref: `#/$defs/C${level + 1}` } },
        required: level === 8 ? [] : ["next"],
        additionalProperties: false,
      };
    }

    definitions.A = {
      type: "object",
      properties: {
        b: { $ref: "#/$defs/B" },
        c: { $ref: "#/$defs/C1" },
      },
      required: ["b", "c"],
      additionalProperties: false,
    };
    definitions.B = {
      type: "object",
      properties: {
        a: { $ref: "#/$defs/A" },
      },
      required: ["a"],
      additionalProperties: false,
    };

    const result = validateOpenAISchema({
      type: "object",
      properties: {
        p: { $ref: "#/$defs/A" },
        q: { $ref: "#/$defs/B" },
      },
      required: ["p", "q"],
      additionalProperties: false,
      $defs: definitions,
    });

    expect(result.stats.maxObjectDepth).toBe(11);
    expect(result.errors).toContainEqual(
      expect.objectContaining({
        code: "object_nesting_too_deep",
      }),
    );
  });

  it("supports recursive references without treating them as infinite depth", () => {
    const result = validateOpenAISchema({
      type: "object",
      properties: {
        label: { type: "string" },
        children: {
          type: "array",
          items: { $ref: "#" },
        },
      },
      required: ["label", "children"],
      additionalProperties: false,
    });

    expect(result.valid).toBe(true);
    expect(result.stats.maxObjectDepth).toBe(1);
  });

  it("anchors global limit diagnostics to an extracted wrapper path", () => {
    const longPropertyName = "x".repeat(120_001);
    const result = validateOpenAISchema({
      name: "wrapped",
      strict: true,
      schema: {
        type: "object",
        properties: {
          [longPropertyName]: { type: "string" },
        },
        required: [longPropertyName],
        additionalProperties: false,
      },
    });

    expect(result.errors).toContainEqual(
      expect.objectContaining({
        code: "schema_text_too_long",
        path: "$.schema",
      }),
    );
  });
});
