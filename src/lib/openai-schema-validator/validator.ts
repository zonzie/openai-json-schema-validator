export const RULE_VERSION = "2026-07-30" as const;

export const OPENAI_SCHEMA_DOCS_URL =
  "https://developers.openai.com/api/docs/guides/structured-outputs#supported-schemas";

export type DiagnosticSeverity = "error" | "warning";

export type SchemaDiagnostic = {
  code: string;
  severity: DiagnosticSeverity;
  path: string;
  message: string;
  suggestion?: string;
  documentationUrl: string;
};

export type SchemaStats = {
  propertyCount: number;
  maxObjectDepth: number;
  totalStringLength: number;
  enumValueCount: number;
};

export type ValidationResult = {
  ruleVersion: typeof RULE_VERSION;
  sourcePath: string;
  valid: boolean;
  errors: SchemaDiagnostic[];
  warnings: SchemaDiagnostic[];
  fixedSchema: unknown | null;
  stats: SchemaStats;
};

type JsonObject = Record<string, unknown>;

const UNSUPPORTED_COMPOSITION_KEYWORDS = [
  "allOf",
  "not",
  "dependentRequired",
  "dependentSchemas",
  "if",
  "then",
  "else",
] as const;

const KNOWN_SCHEMA_KEYWORDS = new Set([
  "type",
  "properties",
  "required",
  "additionalProperties",
  "items",
  "enum",
  "const",
  "anyOf",
  "$defs",
  "definitions",
  "$ref",
  "description",
  "title",
  "pattern",
  "format",
  "multipleOf",
  "maximum",
  "exclusiveMaximum",
  "minimum",
  "exclusiveMinimum",
  "minItems",
  "maxItems",
  "minLength",
  "maxLength",
  "patternProperties",
  ...UNSUPPORTED_COMPOSITION_KEYWORDS,
]);

const FINE_TUNED_LIMITED_KEYWORDS = new Set([
  "minLength",
  "maxLength",
  "pattern",
  "format",
  "minimum",
  "maximum",
  "multipleOf",
  "patternProperties",
  "minItems",
  "maxItems",
]);

const SUPPORTED_STRING_FORMATS = new Set([
  "date-time",
  "time",
  "date",
  "duration",
  "email",
  "hostname",
  "ipv4",
  "ipv6",
  "uuid",
]);

const SUPPORTED_TYPES = new Set([
  "string",
  "number",
  "boolean",
  "integer",
  "object",
  "array",
  "null",
]);

const EMPTY_STATS: SchemaStats = {
  propertyCount: 0,
  maxObjectDepth: 0,
  totalStringLength: 0,
  enumValueCount: 0,
};

function isObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function makeDiagnostic(
  code: string,
  path: string,
  message: string,
  suggestion?: string,
): SchemaDiagnostic {
  return {
    code,
    severity: "error",
    path,
    message,
    suggestion,
    documentationUrl: OPENAI_SCHEMA_DOCS_URL,
  };
}

function makeWarning(
  code: string,
  path: string,
  message: string,
  suggestion?: string,
): SchemaDiagnostic {
  return {
    code,
    severity: "warning",
    path,
    message,
    suggestion,
    documentationUrl: OPENAI_SCHEMA_DOCS_URL,
  };
}

function cloneJson(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(cloneJson);
  }

  if (isObject(value)) {
    return Object.fromEntries(
      Object.entries(value).map(([key, child]) => [key, cloneJson(child)]),
    );
  }

  return value;
}

type ExtractedSchema = {
  schema: unknown;
  sourcePath: string;
};

function extractSchema(input: unknown): ExtractedSchema {
  if (!isObject(input)) {
    return { schema: input, sourcePath: "$" };
  }

  const responseFormat = input.response_format;
  if (isObject(responseFormat)) {
    const jsonSchema = responseFormat.json_schema;
    if (isObject(jsonSchema) && isObject(jsonSchema.schema)) {
      return {
        schema: jsonSchema.schema,
        sourcePath: "$.response_format.json_schema.schema",
      };
    }
  }

  const text = input.text;
  if (isObject(text)) {
    const format = text.format;
    if (isObject(format) && isObject(format.schema)) {
      return {
        schema: format.schema,
        sourcePath: "$.text.format.schema",
      };
    }
  }

  if (Array.isArray(input.tools)) {
    for (const [index, tool] of input.tools.entries()) {
      if (!isObject(tool) || !isObject(tool.function)) {
        continue;
      }

      if (isObject(tool.function.parameters)) {
        return {
          schema: tool.function.parameters,
          sourcePath: `$.tools[${index}].function.parameters`,
        };
      }
    }
  }

  if (input.type !== "object" && isObject(input.schema)) {
    return { schema: input.schema, sourcePath: "$.schema" };
  }

  if (input.type !== "object" && isObject(input.parameters)) {
    return { schema: input.parameters, sourcePath: "$.parameters" };
  }

  return { schema: input, sourcePath: "$" };
}

type TraversalState = {
  errors: SchemaDiagnostic[];
  warnings: SchemaDiagnostic[];
  stats: SchemaStats;
  changed: boolean;
};

function visitSchema(
  node: unknown,
  path: string,
  objectDepth: number,
  state: TraversalState,
): void {
  if (!isObject(node)) {
    return;
  }

  for (const keyword of UNSUPPORTED_COMPOSITION_KEYWORDS) {
    if (keyword in node) {
      state.errors.push(
        makeDiagnostic(
          "unsupported_keyword",
          `${path}.${keyword}`,
          `"${keyword}" is not supported by OpenAI Structured Outputs.`,
          `Remove "${keyword}" or express the constraint with the supported JSON Schema subset.`,
        ),
      );
    }
  }

  for (const keyword of Object.keys(node)) {
    if (FINE_TUNED_LIMITED_KEYWORDS.has(keyword)) {
      state.warnings.push(
        makeWarning(
          "fine_tuned_model_keyword",
          `${path}.${keyword}`,
          `"${keyword}" is not supported for fine-tuned models.`,
          "Remove this constraint when targeting a fine-tuned model.",
        ),
      );
    } else if (!KNOWN_SCHEMA_KEYWORDS.has(keyword)) {
      state.warnings.push(
        makeWarning(
          "unknown_keyword",
          `${path}.${keyword}`,
          `"${keyword}" is not listed in OpenAI's documented Structured Outputs subset.`,
          "Verify this keyword against the current OpenAI documentation.",
        ),
      );
    }
  }

  if (
    "format" in node &&
    (typeof node.format !== "string" ||
      !SUPPORTED_STRING_FORMATS.has(node.format))
  ) {
    state.errors.push(
      makeDiagnostic(
        "unsupported_format",
        `${path}.format`,
        `"${String(node.format)}" is not a documented Structured Outputs string format.`,
        `Use one of: ${Array.from(SUPPORTED_STRING_FORMATS).join(", ")}.`,
      ),
    );
  }

  if ("type" in node) {
    const declaredTypes = Array.isArray(node.type) ? node.type : [node.type];
    const hasUnsupportedType =
      declaredTypes.length === 0 ||
      declaredTypes.some(
        (typeName) =>
          typeof typeName !== "string" || !SUPPORTED_TYPES.has(typeName),
      );

    if (hasUnsupportedType) {
      state.errors.push(
        makeDiagnostic(
          "unsupported_type",
          `${path}.type`,
          `"${Array.isArray(node.type) ? node.type.join(", ") : String(node.type)}" contains a type outside the documented Structured Outputs set.`,
          `Use one or more of: ${Array.from(SUPPORTED_TYPES).join(", ")}.`,
        ),
      );
    }
  }

  const properties = isObject(node.properties) ? node.properties : null;
  const isObjectSchema = node.type === "object" || properties !== null;
  const nextObjectDepth = isObjectSchema ? objectDepth + 1 : objectDepth;

  if (isObjectSchema) {
    state.stats.maxObjectDepth = Math.max(
      state.stats.maxObjectDepth,
      nextObjectDepth,
    );

    if (node.additionalProperties !== false) {
      state.errors.push(
        makeDiagnostic(
          "additional_properties_must_be_false",
          `${path}.additionalProperties`,
          'Every object schema must set "additionalProperties" to false.',
          'Set "additionalProperties": false on this object.',
        ),
      );
      node.additionalProperties = false;
      state.changed = true;
    }

    if (properties) {
      const propertyNames = Object.keys(properties);
      state.stats.propertyCount += propertyNames.length;
      state.stats.totalStringLength += propertyNames.reduce(
        (total, propertyName) => total + propertyName.length,
        0,
      );

      const declaredRequired = Array.isArray(node.required)
        ? node.required.filter(
            (propertyName): propertyName is string =>
              typeof propertyName === "string",
          )
        : [];
      const fixedRequired = declaredRequired.filter((propertyName) =>
        propertyNames.includes(propertyName),
      );

      for (const propertyName of declaredRequired) {
        if (!propertyNames.includes(propertyName)) {
          state.errors.push(
            makeDiagnostic(
              "required_property_not_declared",
              `${path}.required`,
              `"${propertyName}" is listed in "required" but is not declared in "properties".`,
              `Remove "${propertyName}" from "required" or declare the property.`,
            ),
          );
          state.changed = true;
        }
      }

      for (const propertyName of propertyNames) {
        if (!fixedRequired.includes(propertyName)) {
          state.errors.push(
            makeDiagnostic(
              "property_must_be_required",
              `${path}.required`,
              `"${propertyName}" is declared in "properties" but missing from "required".`,
              `Add "${propertyName}" to "required".`,
            ),
          );
          fixedRequired.push(propertyName);
          state.changed = true;
        }
      }

      if (
        state.changed &&
        (fixedRequired.length > 0 || Array.isArray(node.required))
      ) {
        node.required = fixedRequired;
      }
    }
  }

  if (Array.isArray(node.enum)) {
    state.stats.enumValueCount += node.enum.length;
    const enumStringLength = node.enum.reduce(
      (total: number, value: unknown) =>
        total + (typeof value === "string" ? value.length : 0),
      0,
    );
    state.stats.totalStringLength += enumStringLength;

    if (node.enum.length > 250 && enumStringLength > 15_000) {
      state.errors.push(
        makeDiagnostic(
          "enum_string_values_too_long",
          `${path}.enum`,
          `This enum has more than 250 values and ${enumStringLength.toLocaleString("en-US")} string characters; OpenAI allows at most 15,000 in this case.`,
          "Shorten or reduce the enum values.",
        ),
      );
    }
  }

  if (typeof node.const === "string") {
    state.stats.totalStringLength += node.const.length;
  }

  if (properties) {
    for (const [propertyName, propertySchema] of Object.entries(properties)) {
      visitSchema(
        propertySchema,
        `${path}.properties.${propertyName}`,
        nextObjectDepth,
        state,
      );
    }
  }

  for (const definitionsKey of ["$defs", "definitions"] as const) {
    const definitions = node[definitionsKey];
    if (!isObject(definitions)) {
      continue;
    }

    state.stats.totalStringLength += Object.keys(definitions).reduce(
      (total, definitionName) => total + definitionName.length,
      0,
    );

    for (const [definitionName, definitionSchema] of Object.entries(
      definitions,
    )) {
      visitSchema(
        definitionSchema,
        `${path}.${definitionsKey}.${definitionName}`,
        objectDepth,
        state,
      );
    }
  }

  if (isObject(node.items)) {
    visitSchema(node.items, `${path}.items`, objectDepth, state);
  }

  if (Array.isArray(node.anyOf)) {
    node.anyOf.forEach((variant, index) => {
      visitSchema(variant, `${path}.anyOf[${index}]`, objectDepth, state);
    });
  }
}

function enforceGlobalLimits(state: TraversalState): void {
  if (state.stats.propertyCount > 5_000) {
    state.errors.push(
      makeDiagnostic(
        "too_many_properties",
        "$",
        `The schema declares ${state.stats.propertyCount.toLocaleString("en-US")} object properties; OpenAI allows at most 5,000.`,
        "Split the task into smaller schemas or remove unused properties.",
      ),
    );
  }

  if (state.stats.maxObjectDepth > 10) {
    state.errors.push(
      makeDiagnostic(
        "object_nesting_too_deep",
        "$",
        `The schema reaches ${state.stats.maxObjectDepth} object levels; OpenAI allows at most 10.`,
        "Flatten nested objects or split the task into smaller schemas.",
      ),
    );
  }

  if (state.stats.totalStringLength > 120_000) {
    state.errors.push(
      makeDiagnostic(
        "schema_text_too_long",
        "$",
        `Counted schema strings total ${state.stats.totalStringLength.toLocaleString("en-US")} characters; OpenAI allows at most 120,000.`,
        "Shorten property and definition names, enum values, or const values.",
      ),
    );
  }

  if (state.stats.enumValueCount > 1_000) {
    state.errors.push(
      makeDiagnostic(
        "too_many_enum_values",
        "$",
        `The schema declares ${state.stats.enumValueCount.toLocaleString("en-US")} enum values; OpenAI allows at most 1,000 across the schema.`,
        "Reduce enum values or split the task into smaller schemas.",
      ),
    );
  }
}

export function validateOpenAISchema(input: unknown): ValidationResult {
  let schema = input;

  if (typeof input === "string") {
    try {
      schema = JSON.parse(input) as unknown;
    } catch {
      return {
        ruleVersion: RULE_VERSION,
        sourcePath: "$",
        valid: false,
        errors: [
          {
            code: "invalid_json",
            severity: "error",
            path: "$",
            message: "The input is not valid JSON.",
            suggestion: "Fix the JSON syntax, then validate it again.",
            documentationUrl: OPENAI_SCHEMA_DOCS_URL,
          },
        ],
        warnings: [],
        fixedSchema: null,
        stats: EMPTY_STATS,
      };
    }
  }

  const extracted = extractSchema(schema);
  const objectSchema = isObject(extracted.schema) ? extracted.schema : {};
  const errors: SchemaDiagnostic[] = [];
  const warnings: SchemaDiagnostic[] = [];

  if (objectSchema.type !== "object") {
    errors.push(
      makeDiagnostic(
        "root_must_be_object",
        `${extracted.sourcePath}.type`,
        'The root schema must set "type" to "object".',
        'Wrap the schema in an object and set "type": "object".',
      ),
    );
  }

  if ("anyOf" in objectSchema) {
    errors.push(
      makeDiagnostic(
        "root_any_of",
        `${extracted.sourcePath}.anyOf`,
        'The root schema cannot use "anyOf".',
        'Move the union into a property and keep the root "type" as "object".',
      ),
    );
  }

  const fixedSchema = cloneJson(objectSchema);
  const traversalState: TraversalState = {
    errors,
    warnings,
    stats: { ...EMPTY_STATS },
    changed: false,
  };
  visitSchema(fixedSchema, extracted.sourcePath, 0, traversalState);
  enforceGlobalLimits(traversalState);

  return {
    ruleVersion: RULE_VERSION,
    sourcePath: extracted.sourcePath,
    valid: errors.length === 0,
    errors,
    warnings,
    fixedSchema: traversalState.changed ? fixedSchema : null,
    stats: traversalState.stats,
  };
}
