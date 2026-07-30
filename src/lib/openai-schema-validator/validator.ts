export const RULE_VERSION = "2026-07-30" as const;

export const OPENAI_SCHEMA_DOCS_URL =
  "https://developers.openai.com/api/docs/guides/structured-outputs#supported-schemas";

export const MAX_ERROR_DIAGNOSTICS = 100;
export const MAX_WARNING_DIAGNOSTICS = 50;
export const MAX_DIAGNOSTIC_PATH_LENGTH = 512;
export const MAX_DIAGNOSTIC_TEXT_LENGTH = 1_024;
export const MAX_REFERENCE_DEPTH_OPERATIONS = 50_000;

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
  omittedDiagnosticCount: number;
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
    path: truncateDiagnosticValue(path, MAX_DIAGNOSTIC_PATH_LENGTH),
    message: truncateDiagnosticValue(message, MAX_DIAGNOSTIC_TEXT_LENGTH),
    suggestion:
      suggestion === undefined
        ? undefined
        : truncateDiagnosticValue(suggestion, MAX_DIAGNOSTIC_TEXT_LENGTH),
    documentationUrl: OPENAI_SCHEMA_DOCS_URL,
  };
}

function truncateDiagnosticValue(value: string, maxLength: number): string {
  if (value.length <= maxLength) {
    return value;
  }

  const separator = "...";
  const availableLength = maxLength - separator.length;
  const startLength = Math.ceil(availableLength / 2);
  const endLength = Math.floor(availableLength / 2);

  return `${value.slice(0, startLength)}${separator}${value.slice(-endLength)}`;
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

type DiagnosticText = string | (() => string);

type DiagnosticCollector = {
  errors: SchemaDiagnostic[];
  warnings: SchemaDiagnostic[];
  omittedDiagnosticCount: number;
};

function addDiagnostic(
  state: DiagnosticCollector,
  severity: DiagnosticSeverity,
  code: string,
  path: string | SchemaPath,
  message: DiagnosticText,
  suggestion?: DiagnosticText,
): void {
  const diagnostics = severity === "error" ? state.errors : state.warnings;
  const limit =
    severity === "error" ? MAX_ERROR_DIAGNOSTICS : MAX_WARNING_DIAGNOSTICS;

  if (diagnostics.length >= limit) {
    state.omittedDiagnosticCount += 1;
    return;
  }

  diagnostics.push(
    createDiagnostic(
      severity,
      code,
      typeof path === "string" ? path : formatSchemaPath(path),
      typeof message === "function" ? message() : message,
      typeof suggestion === "function" ? suggestion() : suggestion,
    ),
  );
}

function addPriorityError(
  state: DiagnosticCollector,
  code: string,
  path: string | SchemaPath,
  message: DiagnosticText,
  suggestion?: DiagnosticText,
): void {
  if (state.errors.length >= MAX_ERROR_DIAGNOSTICS) {
    state.errors.pop();
    state.omittedDiagnosticCount += 1;
  }

  addDiagnostic(state, "error", code, path, message, suggestion);
  const priorityDiagnostic = state.errors.pop();
  if (priorityDiagnostic) {
    state.errors.unshift(priorityDiagnostic);
  }
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

function hasBareSchemaRootSignals(input: JsonObject): boolean {
  if (hasOwn(input, "type")) {
    const declaredType = getOwn(input, "type");
    return declaredType !== "json_schema" && declaredType !== "function";
  }

  if (Object.keys(input).some((key) => key.startsWith("$"))) {
    return true;
  }

  const isDirectWrapper =
    hasOwn(input, "schema") || hasOwn(input, "parameters");

  for (const keyword of KNOWN_SCHEMA_KEYWORDS) {
    if (
      !(keyword === "description" && isDirectWrapper) &&
      hasOwn(input, keyword)
    ) {
      return true;
    }
  }

  return false;
}

function extractSchema(input: unknown): ExtractedSchema {
  if (!isObject(input)) {
    return { schema: input, sourcePath: "$" };
  }

  if (hasBareSchemaRootSignals(input)) {
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
      if (!isObject(tool)) {
        continue;
      }

      const toolFunction = getOwn(tool, "function");
      if (isObject(toolFunction) && hasOwn(toolFunction, "parameters")) {
        return {
          schema: getOwn(toolFunction, "parameters"),
          sourcePath: `$.tools[${index}].function.parameters`,
        };
      }

      if (
        getOwn(tool, "type") === "function" &&
        hasOwn(tool, "parameters")
      ) {
        return {
          schema: getOwn(tool, "parameters"),
          sourcePath: `$.tools[${index}].parameters`,
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
  omittedDiagnosticCount: number;
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
      addDiagnostic(
        state,
        "error",
        "schema_must_be_object",
        current.path,
        "Each nested schema must be a JSON object.",
        "Replace this value with an object containing supported schema keywords.",
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
        addDiagnostic(
          state,
          "error",
          "unsupported_keyword",
          extendSchemaPath(path, keyword),
          `"${keyword}" is not supported by OpenAI Structured Outputs.`,
          `Remove "${keyword}" or express the constraint with the supported JSON Schema subset.`,
        );
      }
    }

    for (const keyword of Object.keys(node)) {
      if (FINE_TUNED_LIMITED_KEYWORDS.has(keyword)) {
        addDiagnostic(
          state,
          "warning",
          "fine_tuned_model_keyword",
          extendSchemaPath(path, keyword),
          `"${keyword}" is not supported for fine-tuned models.`,
          "Remove this constraint when targeting a fine-tuned model.",
        );
      } else if (!KNOWN_SCHEMA_KEYWORDS.has(keyword)) {
        addDiagnostic(
          state,
          "warning",
          "unknown_keyword",
          extendSchemaPath(path, keyword),
          `"${keyword}" is not listed in OpenAI's documented Structured Outputs subset.`,
          "Verify this keyword against the current OpenAI documentation.",
        );
      }
    }

    const formatValue = getOwn(node, "format");
    if (
      hasOwn(node, "format") &&
      (typeof formatValue !== "string" ||
        !SUPPORTED_STRING_FORMATS.has(formatValue))
    ) {
      addDiagnostic(
        state,
        "error",
        "unsupported_format",
        extendSchemaPath(path, "format"),
        () =>
          `"${String(formatValue)}" is not a documented Structured Outputs string format.`,
        `Use one of: ${Array.from(SUPPORTED_STRING_FORMATS).join(", ")}.`,
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
        addDiagnostic(
          state,
          "error",
          "unsupported_type",
          extendSchemaPath(path, "type"),
          () =>
            `"${Array.isArray(typeValue) ? typeValue.join(", ") : String(typeValue)}" contains a type outside the documented Structured Outputs set.`,
          `Use one or more of: ${Array.from(SUPPORTED_TYPES).join(", ")}.`,
        );
      }
    }

    if (hasOwn(node, "items") && !isObject(getOwn(node, "items"))) {
      addDiagnostic(
        state,
        "error",
        "items_must_be_schema",
        extendSchemaPath(path, "items"),
        '"items" must be a single schema object.',
        'Replace "items" with an object containing supported schema keywords.',
      );
    }

    const anyOfValue = getOwn(node, "anyOf");
    if (
      hasOwn(node, "anyOf") &&
      (!Array.isArray(anyOfValue) || anyOfValue.length === 0)
    ) {
      addDiagnostic(
        state,
        "error",
        "any_of_must_be_non_empty_array",
        extendSchemaPath(path, "anyOf"),
        '"anyOf" must be a non-empty array of schema objects.',
        'Replace "anyOf" with an array containing at least one valid schema.',
      );
    }

    const referenceValue = getOwn(node, "$ref");
    const resolvedReference =
      typeof referenceValue === "string" && referenceValue.startsWith("#")
        ? resolveLocalReferenceWithPath(root, referenceValue)
        : undefined;
    if (hasOwn(node, "$ref")) {
      if (typeof referenceValue !== "string") {
        addDiagnostic(
          state,
          "error",
          "ref_must_be_string",
          extendSchemaPath(path, "$ref"),
          '"$ref" must be a string.',
          'Use a local JSON Pointer such as "#/$defs/item".',
        );
      } else if (
        referenceValue.startsWith("#") &&
        !isObject(resolvedReference?.value)
      ) {
        addDiagnostic(
          state,
          "error",
          "unresolved_local_ref",
          extendSchemaPath(path, "$ref"),
          () =>
            `The local reference "${referenceValue}" does not resolve to a schema object.`,
          "Point this reference at an existing local schema definition.",
        );
      }
    }

    for (const keyword of [
      "patternProperties",
      "$defs",
      "definitions",
    ] as const) {
      if (hasOwn(node, keyword) && !isObject(getOwn(node, keyword))) {
        addDiagnostic(
          state,
          "error",
          "schema_map_must_be_object",
          extendSchemaPath(path, keyword),
          `"${keyword}" must be an object whose values are schemas.`,
          `Replace "${keyword}" with an object keyed by schema name.`,
        );
      }
    }

    const hasPropertiesKeyword = hasOwn(node, "properties");
    const propertiesValue = getOwn(node, "properties");
    const properties = isObject(propertiesValue) ? propertiesValue : null;
    const hasMalformedProperties = hasPropertiesKeyword && properties === null;

    if (hasMalformedProperties) {
      addDiagnostic(
        state,
        "error",
        "properties_must_be_object",
        extendSchemaPath(path, "properties"),
        '"properties" must be an object whose values are schemas.',
        'Replace "properties" with an object keyed by property name.',
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
        addDiagnostic(
          state,
          "error",
          "additional_properties_must_be_false",
          extendSchemaPath(path, "additionalProperties"),
          'Every object schema must set "additionalProperties" to false.',
          'Set "additionalProperties": false on this object.',
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
      const propertyNameSet = new Set(propertyNames);
      const declaredRequiredSet = new Set(declaredRequired);
      const undeclaredRequired = hasMalformedProperties
        ? []
        : declaredRequired.filter(
            (propertyName) => !propertyNameSet.has(propertyName),
          );
      const missingRequired = hasMalformedProperties
        ? []
        : propertyNames.filter(
            (propertyName) => !declaredRequiredSet.has(propertyName),
          );
      const hasAmbiguousRequiredMismatch =
        undeclaredRequired.length > 0 && missingRequired.length > 0;
      const fixedRequired = hasMalformedProperties
        ? [...declaredRequired]
        : hasAmbiguousRequiredMismatch
          ? [...declaredRequired]
          : declaredRequired.filter((propertyName) =>
              propertyNameSet.has(propertyName),
            );
      let requiredChanged = false;

      if (hasOwn(node, "required") && !requiredIsStringArray) {
        addDiagnostic(
          state,
          "error",
          "required_must_be_string_array",
          extendSchemaPath(path, "required"),
          '"required" must be an array of property-name strings.',
          'Replace "required" with an array containing declared property names.',
        );
        requiredChanged = !hasMalformedProperties;
      }

      if (!hasMalformedProperties) {
        for (const propertyName of undeclaredRequired) {
          addDiagnostic(
            state,
            "error",
            "required_property_not_declared",
            extendSchemaPath(path, "required"),
            () =>
              `"${propertyName}" is listed in "required" but is not declared in "properties".`,
            () =>
              `Remove "${propertyName}" from "required" or declare the property.`,
          );
          if (!hasAmbiguousRequiredMismatch) {
            requiredChanged = true;
          }
        }

        for (const propertyName of missingRequired) {
          addDiagnostic(
            state,
            "error",
            "property_must_be_required",
            extendSchemaPath(path, "required"),
            () =>
              `"${propertyName}" is declared in "properties" but missing from "required".`,
            () => `Add "${propertyName}" to "required".`,
          );
          if (!hasAmbiguousRequiredMismatch) {
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
    if (hasOwn(node, "enum") && !Array.isArray(enumValue)) {
      addDiagnostic(
        state,
        "error",
        "enum_must_be_array",
        extendSchemaPath(path, "enum"),
        '"enum" must be an array of allowed values.',
        'Replace "enum" with a JSON array.',
      );
    }

    if (Array.isArray(enumValue)) {
      state.stats.enumValueCount += enumValue.length;
      const enumStringLength = enumValue.reduce(
        (total: number, value: unknown) =>
          total + (typeof value === "string" ? value.length : 0),
        0,
      );
      state.stats.totalStringLength += enumStringLength;

      if (enumValue.length > 250 && enumStringLength > 15_000) {
        addDiagnostic(
          state,
          "error",
          "enum_string_values_too_long",
          extendSchemaPath(path, "enum"),
          () =>
            `This enum has more than 250 values and ${enumStringLength.toLocaleString("en-US")} string characters; OpenAI allows at most 15,000 in this case.`,
          "Shorten or reduce the enum values.",
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

    if (isObject(resolvedReference?.value)) {
      pending.push({
        node: resolvedReference.value,
        path: extendSchemaPath(
          { kind: "root", value: sourcePath },
          ...resolvedReference.pathSegments,
        ),
        objectDepth: current.objectDepth,
      });
    }
  }
}

type ResolvedLocalReference = {
  value: unknown;
  pathSegments: Array<string | number>;
};

function resolveLocalReferenceWithPath(
  root: unknown,
  reference: string,
): ResolvedLocalReference | undefined {
  if (reference === "#") {
    return { value: root, pathSegments: [] };
  }

  if (!reference.startsWith("#/")) {
    return undefined;
  }

  let current = root;
  const pathSegments: Array<string | number> = [];

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

      const index = Number(segment);
      pathSegments.push(index);
      current = current[index];
      continue;
    }

    if (!isObject(current) || !hasOwn(current, segment)) {
      return undefined;
    }

    pathSegments.push(segment);
    current = current[segment];
  }

  return { value: current, pathSegments };
}

type ObjectDepthAnalysis = {
  maxDepth: number;
  operationBudgetExceeded: boolean;
};

function computeMaxObjectDepth(root: unknown): ObjectDepthAnalysis {
  let maxDepth = 0;
  let remainingOperations = MAX_REFERENCE_DEPTH_OPERATIONS;
  let operationBudgetExceeded = false;
  const memoizedHeights = new Map<JsonObject, number>();

  type DepthEdge = {
    node: unknown;
    objectDepthContribution: number;
  };

  type DepthFrame = {
    node: JsonObject;
    edges: DepthEdge[];
    nextEdgeIndex: number;
    maxHeight: number;
    incomingDepthContribution: number;
    canMemoizeHeight: boolean;
  };

  function createDepthFrame(
    node: JsonObject,
    incomingDepthContribution: number,
  ): DepthFrame {
    const properties = getOwn(node, "properties");
    const objectDepth =
      declaresType(node, "object") || isObject(properties) ? 1 : 0;
    const edges: DepthEdge[] = [];

    for (const child of getSchemaChildren(node)) {
      if (child.relation === "definition") {
        continue;
      }

      edges.push({
        node: child.schema,
        objectDepthContribution:
          child.relation === "nested" ? objectDepth : 0,
      });
    }

    const reference = getOwn(node, "$ref");
    if (typeof reference === "string") {
      edges.push({
        node: resolveLocalReferenceWithPath(root, reference)?.value,
        objectDepthContribution: 0,
      });
    }

    return {
      node,
      edges,
      nextEdgeIndex: 0,
      maxHeight: objectDepth,
      incomingDepthContribution,
      canMemoizeHeight: true,
    };
  }

  function consumeOperation(): boolean {
    if (remainingOperations === 0) {
      operationBudgetExceeded = true;
      return false;
    }

    remainingOperations -= 1;
    return true;
  }

  function measureFrom(start: unknown): void {
    const activeNodes = new Set<JsonObject>();
    if (!isObject(start)) {
      return;
    }

    const cachedHeight = memoizedHeights.get(start);
    if (cachedHeight !== undefined) {
      maxDepth = Math.max(maxDepth, cachedHeight);
      return;
    }

    const pending: DepthFrame[] = [createDepthFrame(start, 0)];
    activeNodes.add(start);

    while (pending.length > 0) {
      if (!consumeOperation()) {
        return;
      }

      const frame = pending.at(-1);
      if (!frame) {
        continue;
      }

      const edge = frame.edges[frame.nextEdgeIndex];
      if (edge) {
        frame.nextEdgeIndex += 1;

        if (!isObject(edge.node)) {
          frame.maxHeight = Math.max(
            frame.maxHeight,
            edge.objectDepthContribution,
          );
          continue;
        }

        if (activeNodes.has(edge.node)) {
          frame.maxHeight = Math.max(
            frame.maxHeight,
            edge.objectDepthContribution,
          );
          frame.canMemoizeHeight = false;
          continue;
        }

        const childHeight = memoizedHeights.get(edge.node);
        if (childHeight !== undefined) {
          frame.maxHeight = Math.max(
            frame.maxHeight,
            edge.objectDepthContribution + childHeight,
          );
          continue;
        }

        activeNodes.add(edge.node);
        pending.push(
          createDepthFrame(edge.node, edge.objectDepthContribution),
        );
        continue;
      }

      pending.pop();
      activeNodes.delete(frame.node);
      if (frame.canMemoizeHeight) {
        memoizedHeights.set(frame.node, frame.maxHeight);
      }

      const parent = pending.at(-1);
      if (parent) {
        parent.maxHeight = Math.max(
          parent.maxHeight,
          frame.incomingDepthContribution + frame.maxHeight,
        );
        if (!frame.canMemoizeHeight) {
          parent.canMemoizeHeight = false;
        }
      } else {
        maxDepth = Math.max(maxDepth, frame.maxHeight);
      }
    }
  }

  const definitionRoots: unknown[] = [];
  const visitedForDefinitions = new Set<JsonObject>();
  const pendingDefinitions: unknown[] = [root];

  while (pendingDefinitions.length > 0) {
    if (!consumeOperation()) {
      break;
    }

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

  if (!operationBudgetExceeded) {
    measureFrom(root);
  }
  for (const definitionRoot of definitionRoots) {
    if (operationBudgetExceeded) {
      break;
    }

    measureFrom(definitionRoot);
  }

  return { maxDepth, operationBudgetExceeded };
}

function enforceGlobalLimits(
  state: TraversalState,
  sourcePath: string,
): void {
  if (state.stats.propertyCount > 5_000) {
    addPriorityError(
      state,
      "too_many_properties",
      sourcePath,
      () =>
        `The schema declares ${state.stats.propertyCount.toLocaleString("en-US")} object properties; OpenAI allows at most 5,000.`,
      "Split the task into smaller schemas or remove unused properties.",
    );
  }

  if (state.stats.maxObjectDepth > 10) {
    addPriorityError(
      state,
      "object_nesting_too_deep",
      sourcePath,
      () =>
        `The schema reaches ${state.stats.maxObjectDepth} object levels; OpenAI allows at most 10.`,
      "Flatten nested objects or split the task into smaller schemas.",
    );
  }

  if (state.stats.totalStringLength > 120_000) {
    addPriorityError(
      state,
      "schema_text_too_long",
      sourcePath,
      () =>
        `Counted schema strings total ${state.stats.totalStringLength.toLocaleString("en-US")} characters; OpenAI allows at most 120,000.`,
      "Shorten property and definition names, enum values, or const values.",
    );
  }

  if (state.stats.enumValueCount > 1_000) {
    addPriorityError(
      state,
      "too_many_enum_values",
      sourcePath,
      () =>
        `The schema declares ${state.stats.enumValueCount.toLocaleString("en-US")} enum values; OpenAI allows at most 1,000 across the schema.`,
      "Reduce enum values or split the task into smaller schemas.",
    );
  }
}

export function validateOpenAISchema(input: unknown): ValidationResult {
  return validateOpenAISchemaInternal(input, true);
}

function validateOpenAISchemaInternal(
  input: unknown,
  includeFixedSchema: boolean,
): ValidationResult {
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
        omittedDiagnosticCount: 0,
        fixedSchema: null,
        stats: { ...EMPTY_STATS },
      };
    }
  }

  const fixedInput = cloneJson(schema);
  const extracted = extractSchema(fixedInput);
  const objectSchema = isObject(extracted.schema) ? extracted.schema : {};
  const errors: SchemaDiagnostic[] = [];
  const warnings: SchemaDiagnostic[] = [];
  const traversalState: TraversalState = {
    errors,
    warnings,
    omittedDiagnosticCount: 0,
    stats: { ...EMPTY_STATS },
    changed: false,
  };

  if (getOwn(objectSchema, "type") !== "object") {
    addDiagnostic(
      traversalState,
      "error",
      "root_must_be_object",
      appendPath(extracted.sourcePath, "type"),
      'The root schema must set "type" to "object".',
      'Wrap the schema in an object and set "type": "object".',
    );
  }

  if (hasOwn(objectSchema, "anyOf")) {
    addDiagnostic(
      traversalState,
      "error",
      "root_any_of",
      appendPath(extracted.sourcePath, "anyOf"),
      'The root schema cannot use "anyOf".',
      'Move the union into a property and keep the root "type" as "object".',
    );
  }

  visitSchema(objectSchema, extracted.sourcePath, 0, traversalState);
  const objectDepthAnalysis = computeMaxObjectDepth(objectSchema);
  traversalState.stats.maxObjectDepth = Math.max(
    traversalState.stats.maxObjectDepth,
    objectDepthAnalysis.maxDepth,
  );
  if (objectDepthAnalysis.operationBudgetExceeded) {
    addPriorityError(
      traversalState,
      "reference_analysis_budget_exceeded",
      extracted.sourcePath,
      `The reference graph exceeded the ${MAX_REFERENCE_DEPTH_OPERATIONS.toLocaleString("en-US")}-operation depth-analysis budget.`,
      "Reduce repeated cyclic reference branches or split the schema.",
    );
  }
  enforceGlobalLimits(traversalState, extracted.sourcePath);
  let serializableFixedSchema: unknown | null = null;

  if (
    includeFixedSchema &&
    traversalState.changed &&
    canSerializeAsJson(fixedInput) &&
    validateOpenAISchemaInternal(fixedInput, false).valid
  ) {
    serializableFixedSchema = fixedInput;
  }

  return {
    ruleVersion: RULE_VERSION,
    sourcePath: extracted.sourcePath,
    valid: errors.length === 0,
    errors,
    warnings,
    omittedDiagnosticCount: traversalState.omittedDiagnosticCount,
    fixedSchema: serializableFixedSchema,
    stats: traversalState.stats,
  };
}
