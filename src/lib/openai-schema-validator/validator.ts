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

function isStringArray(value: unknown): value is string[] {
  return (
    Array.isArray(value) &&
    value.every((item): item is string => typeof item === "string")
  );
}

function createDiagnostic(
  severity: DiagnosticSeverity,
  code: string,
  path: string,
  message: string,
  suggestion?: string,
): SchemaDiagnostic {
  return {
    code,
    severity,
    path,
    message,
    suggestion,
    documentationUrl: OPENAI_SCHEMA_DOCS_URL,
  };
}

function appendPath(path: string, segment: string): string {
  return /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(segment)
    ? `${path}.${segment}`
    : `${path}[${JSON.stringify(segment)}]`;
}

function appendIndex(path: string, index: number): string {
  return `${path}[${index}]`;
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
    if (isObject(jsonSchema) && "schema" in jsonSchema) {
      return {
        schema: jsonSchema.schema,
        sourcePath: "$.response_format.json_schema.schema",
      };
    }
  }

  const text = input.text;
  if (isObject(text)) {
    const format = text.format;
    if (isObject(format) && "schema" in format) {
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

      if ("parameters" in tool.function) {
        return {
          schema: tool.function.parameters,
          sourcePath: `$.tools[${index}].function.parameters`,
        };
      }
    }
  }

  if (input.type !== "object" && "schema" in input) {
    return { schema: input.schema, sourcePath: "$.schema" };
  }

  if (input.type !== "object" && "parameters" in input) {
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
        createDiagnostic(
          "error",
          "unsupported_keyword",
          appendPath(path, keyword),
          `"${keyword}" is not supported by OpenAI Structured Outputs.`,
          `Remove "${keyword}" or express the constraint with the supported JSON Schema subset.`,
        ),
      );
    }
  }

  for (const keyword of Object.keys(node)) {
    if (FINE_TUNED_LIMITED_KEYWORDS.has(keyword)) {
      state.warnings.push(
        createDiagnostic(
          "warning",
          "fine_tuned_model_keyword",
          appendPath(path, keyword),
          `"${keyword}" is not supported for fine-tuned models.`,
          "Remove this constraint when targeting a fine-tuned model.",
        ),
      );
    } else if (!KNOWN_SCHEMA_KEYWORDS.has(keyword)) {
      state.warnings.push(
        createDiagnostic(
          "warning",
          "unknown_keyword",
          appendPath(path, keyword),
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
      createDiagnostic(
        "error",
        "unsupported_format",
        appendPath(path, "format"),
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
        createDiagnostic(
          "error",
          "unsupported_type",
          appendPath(path, "type"),
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
        createDiagnostic(
          "error",
          "additional_properties_must_be_false",
          appendPath(path, "additionalProperties"),
          'Every object schema must set "additionalProperties" to false.',
          'Set "additionalProperties": false on this object.',
        ),
      );
      node.additionalProperties = false;
      state.changed = true;
    }

    const propertyNames = properties ? Object.keys(properties) : [];

    if (properties) {
      state.stats.propertyCount += propertyNames.length;
      state.stats.totalStringLength += propertyNames.reduce(
        (total, propertyName) => total + propertyName.length,
        0,
      );
    }

    const requiredValue = node.required;
    const requiredIsStringArray = isStringArray(requiredValue);
    const declaredRequired: string[] = requiredIsStringArray
      ? requiredValue
      : [];
    const fixedRequired = declaredRequired.filter((propertyName) =>
      propertyNames.includes(propertyName),
    );
    let requiredChanged = false;

    if ("required" in node && !requiredIsStringArray) {
      state.errors.push(
        createDiagnostic(
          "error",
          "required_must_be_string_array",
          appendPath(path, "required"),
          '"required" must be an array of property-name strings.',
          'Replace "required" with an array containing declared property names.',
        ),
      );
      requiredChanged = true;
    }

    for (const propertyName of declaredRequired) {
      if (!propertyNames.includes(propertyName)) {
        state.errors.push(
          createDiagnostic(
            "error",
            "required_property_not_declared",
            appendPath(path, "required"),
            `"${propertyName}" is listed in "required" but is not declared in "properties".`,
            `Remove "${propertyName}" from "required" or declare the property.`,
          ),
        );
        requiredChanged = true;
      }
    }

    for (const propertyName of propertyNames) {
      if (!fixedRequired.includes(propertyName)) {
        state.errors.push(
          createDiagnostic(
            "error",
            "property_must_be_required",
            appendPath(path, "required"),
            `"${propertyName}" is declared in "properties" but missing from "required".`,
            `Add "${propertyName}" to "required".`,
          ),
        );
        fixedRequired.push(propertyName);
        requiredChanged = true;
      }
    }

    if (requiredChanged) {
      node.required = fixedRequired;
      state.changed = true;
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
        createDiagnostic(
          "error",
          "enum_string_values_too_long",
          appendPath(path, "enum"),
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
        appendPath(appendPath(path, "properties"), propertyName),
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
        appendPath(appendPath(path, definitionsKey), definitionName),
        objectDepth,
        state,
      );
    }
  }

  if (isObject(node.items)) {
    visitSchema(node.items, appendPath(path, "items"), objectDepth, state);
  }

  if (Array.isArray(node.anyOf)) {
    node.anyOf.forEach((variant, index) => {
      visitSchema(
        variant,
        appendIndex(appendPath(path, "anyOf"), index),
        objectDepth,
        state,
      );
    });
  }
}

function resolveLocalReference(root: unknown, reference: string): unknown {
  if (reference === "#") {
    return root;
  }

  if (!reference.startsWith("#/")) {
    return undefined;
  }

  let current = root;

  for (const rawSegment of reference.slice(2).split("/")) {
    let segment: string;

    try {
      segment = decodeURIComponent(rawSegment)
        .replaceAll("~1", "/")
        .replaceAll("~0", "~");
    } catch {
      return undefined;
    }

    if (Array.isArray(current)) {
      if (!/^(0|[1-9]\d*)$/.test(segment)) {
        return undefined;
      }

      current = current[Number(segment)];
      continue;
    }

    if (!isObject(current) || !(segment in current)) {
      return undefined;
    }

    current = current[segment];
  }

  return current;
}

function computeMaxObjectDepth(root: unknown): number {
  let maxDepth = 0;

  function visitDepth(
    node: unknown,
    depth: number,
    activeNodes: Set<JsonObject>,
  ): void {
    if (!isObject(node) || activeNodes.has(node)) {
      return;
    }

    const nextActiveNodes = new Set(activeNodes);
    nextActiveNodes.add(node);

    const properties = isObject(node.properties) ? node.properties : null;
    const isObjectSchema = node.type === "object" || properties !== null;
    const childDepth = isObjectSchema ? depth + 1 : depth;

    if (isObjectSchema) {
      maxDepth = Math.max(maxDepth, childDepth);
    }

    if (typeof node.$ref === "string") {
      visitDepth(
        resolveLocalReference(root, node.$ref),
        depth,
        nextActiveNodes,
      );
    }

    if (properties) {
      for (const propertySchema of Object.values(properties)) {
        visitDepth(propertySchema, childDepth, nextActiveNodes);
      }
    }

    if (isObject(node.items)) {
      visitDepth(node.items, childDepth, nextActiveNodes);
    }

    if (Array.isArray(node.anyOf)) {
      for (const variant of node.anyOf) {
        visitDepth(variant, depth, nextActiveNodes);
      }
    }
  }

  visitDepth(root, 0, new Set());

  const visitedForDefinitions = new Set<JsonObject>();

  function visitDefinitions(node: unknown): void {
    if (!isObject(node) || visitedForDefinitions.has(node)) {
      return;
    }

    visitedForDefinitions.add(node);

    const properties = isObject(node.properties) ? node.properties : null;
    if (properties) {
      for (const propertySchema of Object.values(properties)) {
        visitDefinitions(propertySchema);
      }
    }

    if (isObject(node.items)) {
      visitDefinitions(node.items);
    }

    if (Array.isArray(node.anyOf)) {
      for (const variant of node.anyOf) {
        visitDefinitions(variant);
      }
    }

    for (const definitionsKey of ["$defs", "definitions"] as const) {
      const definitions = node[definitionsKey];
      if (!isObject(definitions)) {
        continue;
      }

      for (const definitionSchema of Object.values(definitions)) {
        visitDepth(definitionSchema, 0, new Set());
        visitDefinitions(definitionSchema);
      }
    }
  }

  visitDefinitions(root);
  return maxDepth;
}

function enforceGlobalLimits(
  state: TraversalState,
  sourcePath: string,
): void {
  if (state.stats.propertyCount > 5_000) {
    state.errors.push(
      createDiagnostic(
        "error",
        "too_many_properties",
        sourcePath,
        `The schema declares ${state.stats.propertyCount.toLocaleString("en-US")} object properties; OpenAI allows at most 5,000.`,
        "Split the task into smaller schemas or remove unused properties.",
      ),
    );
  }

  if (state.stats.maxObjectDepth > 10) {
    state.errors.push(
      createDiagnostic(
        "error",
        "object_nesting_too_deep",
        sourcePath,
        `The schema reaches ${state.stats.maxObjectDepth} object levels; OpenAI allows at most 10.`,
        "Flatten nested objects or split the task into smaller schemas.",
      ),
    );
  }

  if (state.stats.totalStringLength > 120_000) {
    state.errors.push(
      createDiagnostic(
        "error",
        "schema_text_too_long",
        sourcePath,
        `Counted schema strings total ${state.stats.totalStringLength.toLocaleString("en-US")} characters; OpenAI allows at most 120,000.`,
        "Shorten property and definition names, enum values, or const values.",
      ),
    );
  }

  if (state.stats.enumValueCount > 1_000) {
    state.errors.push(
      createDiagnostic(
        "error",
        "too_many_enum_values",
        sourcePath,
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
        stats: { ...EMPTY_STATS },
      };
    }
  }

  const extracted = extractSchema(schema);
  const objectSchema = isObject(extracted.schema) ? extracted.schema : {};
  const errors: SchemaDiagnostic[] = [];
  const warnings: SchemaDiagnostic[] = [];

  if (objectSchema.type !== "object") {
    errors.push(
      createDiagnostic(
        "error",
        "root_must_be_object",
        appendPath(extracted.sourcePath, "type"),
        'The root schema must set "type" to "object".',
        'Wrap the schema in an object and set "type": "object".',
      ),
    );
  }

  if ("anyOf" in objectSchema) {
    errors.push(
      createDiagnostic(
        "error",
        "root_any_of",
        appendPath(extracted.sourcePath, "anyOf"),
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
  traversalState.stats.maxObjectDepth = computeMaxObjectDepth(fixedSchema);
  enforceGlobalLimits(traversalState, extracted.sourcePath);

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
