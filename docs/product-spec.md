# OpenAI JSON Schema Validator — Product Specification

Status: implementation-ready
Rule source checked: 2026-07-30
Canonical source: https://developers.openai.com/api/docs/guides/structured-outputs#supported-schemas

## Product promise

Paste a JSON Schema or an OpenAI request wrapper and receive deterministic,
path-specific diagnostics plus a conservative auto-fix for the documented
OpenAI Structured Outputs subset.

The product is a preflight validator. It does not call the OpenAI API and does
not claim to reproduce undocumented server behavior.

## Primary user

A developer who has received an `invalid schema for response_format` error, or
who wants to verify a schema before sending an OpenAI API request.

## Public seams

1. `validateOpenAISchema(input)` accepts a JSON string or parsed value and
   returns a versioned validation result.
2. `POST /api/validate` accepts `{ "schema": string | object }` and returns the
   same validation result as JSON.
3. The browser workflow lets a user paste, validate, inspect diagnostics,
   apply safe fixes, and copy the fixed schema.

Tests observe only these seams.

## Supported inputs

- A bare JSON Schema.
- A Structured Outputs descriptor with a `schema` property.
- A Chat Completions `response_format.json_schema.schema` wrapper.
- A Responses API `text.format.schema` wrapper.
- A function definition with `parameters`.
- A request containing `tools[].function.parameters`.

The validator extracts and validates the first recognized schema and reports
where it was found.

## MVP rules

Errors:

- Input must be valid JSON.
- The root schema must be an object with `type: "object"`.
- Root-level `anyOf` is not allowed.
- When present, `properties` must be an object whose values are schemas.
- Every object must set `additionalProperties: false`.
- Every key in an object's `properties` must appear in its `required` array.
- Every name in `required` must exist in `properties`.
- Unsupported composition keywords are rejected: `allOf`, `not`,
  `dependentRequired`, `dependentSchemas`, `if`, `then`, `else`.
- Declared types must use the documented set: `string`, `number`, `boolean`,
  `integer`, `object`, `array`, or `null`.
- String formats must use the documented set: `date-time`, `time`, `date`,
  `duration`, `email`, `hostname`, `ipv4`, `ipv6`, or `uuid`.
- The schema may contain at most 5,000 object properties.
- Object nesting may not exceed 10 levels.
- The combined length of property names, definition names, enum string values,
  and const string values may not exceed 120,000 characters.
- All enum arrays together may contain at most 1,000 values.
- A single string enum with more than 250 values may contain at most 15,000
  characters.

Warnings:

- Unknown JSON Schema keywords are reported conservatively rather than treated
  as errors.
- Fine-tuned models have narrower support for selected constraints; using one
  produces a warning.

Safe auto-fixes:

- Add missing `required` entries for declared properties.
- Remove unknown names from `required`.
- Set `additionalProperties` to `false` on object schemas.

Auto-fix does not rewrite root types, composition, limits, references, enums,
or unknown keywords.

## API contract

`POST /api/validate`

Request:

```json
{
  "schema": "{\"type\":\"object\",\"properties\":{}}"
}
```

Success: HTTP 200 with a `ValidationResult`.

Malformed request JSON or a missing `schema` field: HTTP 400 with:

```json
{
  "error": {
    "code": "invalid_request",
    "message": "A schema string or object is required."
  }
}
```

The API performs no network calls and persists no input.

## Interface direction

The page should feel like a precise engineering instrument:

- warm paper background and dark graphite workbench;
- signal orange for actions, red only for errors, green only for valid state;
- a compact masthead, a two-column editor/diagnostics workbench, and visible
  rule-source/version information;
- distinctive editorial display typography paired with a code-focused
  monospace face;
- no generic AI gradients, chat metaphors, or decorative dashboard cards.

## SEO requirements

- Canonical route: `/`
- Title: `OpenAI JSON Schema Validator for Structured Outputs`
- H1 includes `OpenAI JSON Schema Validator`.
- Visible copy covers `openai structured output validator`,
  `openai structured output validation error`, and
  `invalid schema for response_format` naturally.
- Include `SoftwareApplication` and `FAQPage` structured data.
- Include a crawlable rule reference and privacy statement.

## Acceptance criteria

- A known-valid schema returns no errors.
- Missing `required` and `additionalProperties: false` are both caught and
  safely fixed.
- Nested object paths are precise.
- Limits and unsupported composition rules are enforced.
- All supported wrappers resolve to the same schema result.
- The API mirrors the core result and rejects bad requests.
- The primary browser workflow passes at desktop and narrow mobile widths.
- Typecheck, lint, unit tests, production build, and Playwright smoke test pass.
