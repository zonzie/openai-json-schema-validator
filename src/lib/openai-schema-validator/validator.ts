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

function hasOwn(node: JsonObject, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(node, key);
}

function getOwn(node: JsonObject, key: string): unknown {
  return hasOwn(node, key) ? node[key] : undefined;
}

function declaresType(node: JsonObject, typeName: string): boolean {
  const declaredType = getOwn(node, "type");
  return (
    declaredType === typeName ||
    (Array.isArray(declaredType) && declaredType.includes(typeName))
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

type SchemaPath =
  | { kind: "root"; value: string }
  | {
      kind: "segment";
      parent: SchemaPath;
      value: string | number;
    };

function extendSchemaPath(
  path: SchemaPath,
  ...segments: Array<string | number>
): SchemaPath {
  return segments.reduce<SchemaPath>(
    (parent, value) => ({ kind: "segment", parent, value }),
    path,
  );
}

function formatSchemaPath(path: SchemaPath): string {
  const segments: Array<string | number> = [];
  let current = path;

  while (current.kind === "segment") {
    segments.push(current.value);
    current = current.parent;
  }

  let result = current.value;
  for (const segment of segments.reverse()) {
    result =
      typeof segment === "number"
        ? appendIndex(result, segment)
        : appendPath(result, segment);
  }

  return result;
}

function cloneJson(value: unknown): unknown {
  if (!Array.isArray(value) && !isObject(value)) {
    return value;
  }

  const rootClone: JsonObject | unknown[] = Array.isArray(value)
    ? new Array(value.length)
    : {};
  const clones = new Map<object, JsonObject | unknown[]>([[value, rootClone]]);
  const pending: Array<JsonObject | unknown[]> = [value];

  while (pending.length > 0) {
    const source = pending.pop();
    if (!source) {
      continue;
    }

    const target = clones.get(source);
    if (!target) {
      continue;
    }

    for (const [key, child] of Object.entries(source)) {
      let clonedChild = child;

      if (Array.isArray(child) || isObject(child)) {
        const existingClone = clones.get(child);
        if (existingClone) {
          clonedChild = existingClone;
        } else {
          const childClone: JsonObject | unknown[] = Array.isArray(child)
            ? new Array(child.length)
            : {};
          clones.set(child, childClone);
          pending.push(child);
          clonedChild = childClone;
        }
      }

      Object.defineProperty(target, key, {
        configurable: true,
        enumerable: true,
        value: clonedChild,
        writable: true,
      });
    }
  }

  return rootClone;
}

function canSerializeAsJson(value: unknown): boolean {
  try {
    JSON.stringify(value);
    return true;
  } catch {
    return false;
  }
}

type ExtractedSchema = {
  schema: unknown;
  sourcePath: string;
};

function extractSchema(input: unknown): ExtractedSchema {
  if (!isObject(input)) {
    return { schema: input, sourcePath: "$" };
  }

  const responseFormat = getOwn(input, "response_format");
  if (isObject(responseFormat)) {
    const jsonSchema = getOwn(responseFormat, "json_schema");
    if (isObject(jsonSchema) && hasOwn(jsonSchema, "schema")) {
      return {
        schema: getOwn(jsonSchema, "schema"),
        sourcePath: "$.response_format.json_schema.schema",
      };
    }
  }

  const text = getOwn(input, "text");
  if (isObject(text)) {
    const format = getOwn(text, "format");
    if (isObject(format) && hasOwn(format, "schema")) {
      return {
        schema: getOwn(format, "schema"),
        sourcePath: "$.text.format.schema",
      };
    }
  }

  const tools = getOwn(input, "tools");
  if (Array.isArray(tools)) {
    for (const [index, tool] of tools.entries()) {
      const toolFunction = isObject(tool) ? getOwn(tool, "function") : null;
      if (!isObject(tool) || !isObject(toolFunction)) {
        continue;
      }

      if (hasOwn(toolFunction, "parameters")) {
        return {
          schema: getOwn(toolFunction, "parameters"),
          sourcePath: `$.tools[${index}].function.parameters`,
        };
      }
    }
  }

  if (!declaresType(input, "object") && hasOwn(input, "schema")) {
    return { schema: getOwn(input, "schema"), sourcePath: "$.schema" };
  }

  if (!declaresType(input, "object") && hasOwn(input, "parameters")) {
    return {
      schema: getOwn(input, "parameters"),
      sourcePath: "$.parameters",
    };
  }

  return { schema: input, sourcePath: "$" };
}

type TraversalState = {
  errors: SchemaDiagnostic[];
  warnings: SchemaDiagnostic[];
  stats: SchemaStats;
  changed: boolean;
};

type SchemaChild =
  | {
      schema: unknown;
      relation: "nested" | "definition";
      location: {
        kind: "named";
        container:
          | "properties"
          | "patternProperties"
          | "$defs"
          | "definitions";
        name: string;
      };
    }
  | {
      schema: unknown;
      relation: "nested";
      location: { kind: "single"; key: "items" };
    }
  | {
      schema: unknown;
      relation: "same";
      location: { kind: "indexed"; container: "anyOf"; index: number };
    };

function getSchemaChildren(node: JsonObject): SchemaChild[] {
  const children: SchemaChild[] = [];

  for (const container of ["properties", "patternProperties"] as const) {
    const schemas = getOwn(node, container);
    if (!isObject(schemas)) {
      continue;
    }

    for (const [name, schema] of Object.entries(schemas)) {
      children.push({
        schema,
        relation: "nested",
        location: { kind: "named", container, name },
      });
    }
  }

  for (const container of ["$defs", "definitions"] as const) {
    const schemas = getOwn(node, container);
    if (!isObject(schemas)) {
      continue;
    }

    for (const [name, schema] of Object.entries(schemas)) {
      children.push({
        schema,
        relation: "definition",
        location: { kind: "named", container, name },
      });
    }
  }

  const items = getOwn(node, "items");
  if (isObject(items)) {
    children.push({
      schema: items,
      relation: "nested",
      location: { kind: "single", key: "items" },
    });
  }

  const anyOf = getOwn(node, "anyOf");
  if (Array.isArray(anyOf)) {
    anyOf.forEach((schema, index) => {
      children.push({
        schema,
        relation: "same",
        location: { kind: "indexed", container: "anyOf", index },
      });
    });
  }

  return children;
}

function extendChildPath(path: SchemaPath, child: SchemaChild): SchemaPath {
  if (child.location.kind === "named") {
    return extendSchemaPath(
      path,
      child.location.container,
      child.location.name,
    );
  }

  if (child.location.kind === "indexed") {
    return extendSchemaPath(
      path,
      child.location.container,
      child.location.index,
    );
  }

  return extendSchemaPath(path, child.location.key);
}

function visitSchema(
  root: unknown,
  sourcePath: string,
  objectDepth: number,
  state: TraversalState,
): void {
  type PendingSchema = {
    node: unknown;
    path: SchemaPath;
    objectDepth: number;
  };

  const pending: PendingSchema[] = [
    {
      node: root,
      path: { kind: "root", value: sourcePath },
      objectDepth,
    },
  ];
  const visited = new Set<JsonObject>();

  while (pending.length > 0) {
    const current = pending.pop();
    if (!current) {
      continue;
    }

    if (!isObject(current.node)) {
      state.errors.push(
        createDiagnostic(
          "error",
          "schema_must_be_object",
          formatSchemaPath(current.path),
          "Each nested schema must be a JSON object.",
          "Replace this value with an object containing supported schema keywords.",
        ),
      );
      continue;
    }

    if (visited.has(current.node)) {
      continue;
    }

    const { node, path } = current;
    visited.add(node);

    for (const keyword of UNSUPPORTED_COMPOSITION_KEYWORDS) {
      if (hasOwn(node, keyword)) {
        state.errors.push(
          createDiagnostic(
            "error",
            "unsupported_keyword",
            formatSchemaPath(extendSchemaPath(path, keyword)),
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
            formatSchemaPath(extendSchemaPath(path, keyword)),
            `"${keyword}" is not supported for fine-tuned models.`,
            "Remove this constraint when targeting a fine-tuned model.",
          ),
        );
      } else if (!KNOWN_SCHEMA_KEYWORDS.has(keyword)) {
        state.warnings.push(
          createDiagnostic(
            "warning",
            "unknown_keyword",
            formatSchemaPath(extendSchemaPath(path, keyword)),
            `"${keyword}" is not listed in OpenAI's documented Structured Outputs subset.`,
            "Verify this keyword against the current OpenAI documentation.",
          ),
        );
      }
    }

    const formatValue = getOwn(node, "format");
    if (
      hasOwn(node, "format") &&
      (typeof formatValue !== "string" ||
        !SUPPORTED_STRING_FORMATS.has(formatValue))
    ) {
      state.errors.push(
        createDiagnostic(
          "error",
          "unsupported_format",
          formatSchemaPath(extendSchemaPath(path, "format")),
          `"${String(formatValue)}" is not a documented Structured Outputs string format.`,
          `Use one of: ${Array.from(SUPPORTED_STRING_FORMATS).join(", ")}.`,
        ),
      );
    }

    const typeValue = getOwn(node, "type");
    if (hasOwn(node, "type")) {
      const declaredTypes = Array.isArray(typeValue) ? typeValue : [typeValue];
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
            formatSchemaPath(extendSchemaPath(path, "type")),
            `"${Array.isArray(typeValue) ? typeValue.join(", ") : String(typeValue)}" contains a type outside the documented Structured Outputs set.`,
            `Use one or more of: ${Array.from(SUPPORTED_TYPES).join(", ")}.`,
          ),
        );
      }
    }

    const hasPropertiesKeyword = hasOwn(node, "properties");
    const propertiesValue = getOwn(node, "properties");
    const properties = isObject(propertiesValue) ? propertiesValue : null;
    const hasMalformedProperties = hasPropertiesKeyword && properties === null;

    if (hasMalformedProperties) {
      state.errors.push(
        createDiagnostic(
          "error",
          "properties_must_be_object",
          formatSchemaPath(extendSchemaPath(path, "properties")),
          '"properties" must be an object whose values are schemas.',
          'Replace "properties" with an object keyed by property name.',
        ),
      );
    }

    const isObjectSchema = declaresType(node, "object") || properties !== null;
    const nextObjectDepth = isObjectSchema
      ? current.objectDepth + 1
      : current.objectDepth;

    if (isObjectSchema) {
      state.stats.maxObjectDepth = Math.max(
        state.stats.maxObjectDepth,
        nextObjectDepth,
      );

      if (
        !hasOwn(node, "additionalProperties") ||
        node.additionalProperties !== false
      ) {
        state.errors.push(
          createDiagnostic(
            "error",
            "additional_properties_must_be_false",
            formatSchemaPath(extendSchemaPath(path, "additionalProperties")),
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

      const requiredValue = getOwn(node, "required");
      const requiredIsStringArray = isStringArray(requiredValue);
      const declaredRequired: string[] = requiredIsStringArray
        ? requiredValue
        : [];
      const fixedRequired = hasMalformedProperties
        ? [...declaredRequired]
        : declaredRequired.filter((propertyName) =>
            propertyNames.includes(propertyName),
          );
      let requiredChanged = false;

      if (hasOwn(node, "required") && !requiredIsStringArray) {
        state.errors.push(
          createDiagnostic(
            "error",
            "required_must_be_string_array",
            formatSchemaPath(extendSchemaPath(path, "required")),
            '"required" must be an array of property-name strings.',
            'Replace "required" with an array containing declared property names.',
          ),
        );
        requiredChanged = !hasMalformedProperties;
      }

      if (!hasMalformedProperties) {
        for (const propertyName of declaredRequired) {
          if (!propertyNames.includes(propertyName)) {
            state.errors.push(
              createDiagnostic(
                "error",
                "required_property_not_declared",
                formatSchemaPath(extendSchemaPath(path, "required")),
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
                formatSchemaPath(extendSchemaPath(path, "required")),
                `"${propertyName}" is declared in "properties" but missing from "required".`,
                `Add "${propertyName}" to "required".`,
              ),
            );
            fixedRequired.push(propertyName);
            requiredChanged = true;
          }
        }
      }

      if (requiredChanged) {
        node.required = fixedRequired;
        state.changed = true;
      }
    }

    const enumValue = getOwn(node, "enum");
    if (Array.isArray(enumValue)) {
      state.stats.enumValueCount += enumValue.length;
      const enumStringLength = enumValue.reduce(
        (total: number, value: unknown) =>
          total + (typeof value === "string" ? value.length : 0),
        0,
      );
      state.stats.totalStringLength += enumStringLength;

      if (enumValue.length > 250 && enumStringLength > 15_000) {
        state.errors.push(
          createDiagnostic(
            "error",
            "enum_string_values_too_long",
            formatSchemaPath(extendSchemaPath(path, "enum")),
            `This enum has more than 250 values and ${enumStringLength.toLocaleString("en-US")} string characters; OpenAI allows at most 15,000 in this case.`,
            "Shorten or reduce the enum values.",
          ),
        );
      }
    }

    const constValue = getOwn(node, "const");
    if (typeof constValue === "string") {
      state.stats.totalStringLength += constValue.length;
    }

    const children = getSchemaChildren(node);
    state.stats.totalStringLength += children.reduce(
      (total, child) =>
        child.relation === "definition" &&
        child.location.kind === "named"
          ? total + child.location.name.length
          : total,
      0,
    );

    for (let index = children.length - 1; index >= 0; index -= 1) {
      const child = children[index];
      pending.push({
        node: child.schema,
        path: extendChildPath(path, child),
        objectDepth:
          child.relation === "nested"
            ? nextObjectDepth
            : current.objectDepth,
      });
    }
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

    if (!isObject(current) || !hasOwn(current, segment)) {
      return undefined;
    }

    current = current[segment];
  }

  return current;
}

function computeMaxObjectDepth(root: unknown): number {
  let maxDepth = 0;

  type DepthFrame =
    | { kind: "visit"; node: unknown; depth: number }
    | { kind: "exit"; node: JsonObject };

  function measureFrom(start: unknown): void {
    const activeNodes = new Set<JsonObject>();
    const pending: DepthFrame[] = [{ kind: "visit", node: start, depth: 0 }];

    while (pending.length > 0) {
      const frame = pending.pop();
      if (!frame) {
        continue;
      }

      if (frame.kind === "exit") {
        activeNodes.delete(frame.node);
        continue;
      }

      if (!isObject(frame.node) || activeNodes.has(frame.node)) {
        continue;
      }

      const node = frame.node;
      activeNodes.add(node);
      pending.push({ kind: "exit", node });

      const propertiesValue = getOwn(node, "properties");
      const properties = isObject(propertiesValue) ? propertiesValue : null;
      const isObjectSchema =
        declaresType(node, "object") || properties !== null;
      const childDepth = isObjectSchema ? frame.depth + 1 : frame.depth;

      if (isObjectSchema) {
        maxDepth = Math.max(maxDepth, childDepth);
      }

      const children = getSchemaChildren(node);
      for (let index = children.length - 1; index >= 0; index -= 1) {
        const child = children[index];
        if (child.relation === "definition") {
          continue;
        }

        pending.push({
          kind: "visit",
          node: child.schema,
          depth:
            child.relation === "nested" ? childDepth : frame.depth,
        });
      }

      const reference = getOwn(node, "$ref");
      if (typeof reference === "string") {
        pending.push({
          kind: "visit",
          node: resolveLocalReference(root, reference),
          depth: frame.depth,
        });
      }
    }
  }

  const definitionRoots: unknown[] = [];
  const visitedForDefinitions = new Set<JsonObject>();
  const pendingDefinitions: unknown[] = [root];

  while (pendingDefinitions.length > 0) {
    const current = pendingDefinitions.pop();
    if (
      !isObject(current) ||
      visitedForDefinitions.has(current)
    ) {
      continue;
    }

    visitedForDefinitions.add(current);

    for (const child of getSchemaChildren(current)) {
      pendingDefinitions.push(child.schema);
      if (child.relation === "definition") {
        definitionRoots.push(child.schema);
      }
    }
  }

  measureFrom(root);
  for (const definitionRoot of definitionRoots) {
    measureFrom(definitionRoot);
  }

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

  if (getOwn(objectSchema, "type") !== "object") {
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

  if (hasOwn(objectSchema, "anyOf")) {
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
  const serializableFixedSchema =
    traversalState.changed && canSerializeAsJson(fixedSchema)
      ? fixedSchema
      : null;

  return {
    ruleVersion: RULE_VERSION,
    sourcePath: extracted.sourcePath,
    valid: errors.length === 0,
    errors,
    warnings,
    fixedSchema: serializableFixedSchema,
    stats: traversalState.stats,
  };
}
