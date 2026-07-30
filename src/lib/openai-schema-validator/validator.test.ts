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
      ruleVersion: "2026-07-30",
      sourcePath: "$",
      valid: true,
      errors: [],
      warnings: [],
      fixedSchema: null,
      stats: {
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

  it("finds and safely fixes missing strict object requirements", () => {
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

  it("removes required names that have no declared property", () => {
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
    expect(result.fixedSchema).toEqual({
      type: "object",
      required: [],
      additionalProperties: false,
    });
    expect(validateOpenAISchema(result.fixedSchema).valid).toBe(true);
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
    ];

    for (const testCase of cases) {
      const result = validateOpenAISchema(testCase.input);
      expect(result.valid, testCase.sourcePath).toBe(true);
      expect(result.sourcePath).toBe(testCase.sourcePath);
    }
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
