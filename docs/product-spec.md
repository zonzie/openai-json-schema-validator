# OpenAI JSON Schema Validator — Product Specification

Status: implementation-ready
Rule source checked: 2026-08-03
Canonical source: https://developers.openai.com/api/docs/guides/structured-outputs#supported-schemas
Function tool shape source: https://developers.openai.com/api/docs/guides/function-calling#defining-functions

## Product promise

Paste a JSON Schema or an OpenAI request wrapper and receive deterministic,
path-specific diagnostics plus a reviewable strict-mode patch for the documented
OpenAI Structured Outputs subset.

The product is a preflight validator. It does not call the OpenAI API and does
not claim to reproduce undocumented server behavior.

## Primary user

A developer who has received an `invalid schema for response_format` error, or
who wants to verify a schema before sending an OpenAI API request.

## Public seams

1. `validateOpenAISchema(input)` accepts a JSON string or parsed value and
   returns a versioned validation result.
2. The browser workflow lets a user paste, validate, inspect diagnostics,
   review proposed patch operations, apply them, and copy the patched schema.

Tests observe only these seams.

## Supported inputs

- A bare JSON Schema.
- A Structured Outputs descriptor with a `schema` property.
- A Chat Completions `response_format.json_schema.schema` wrapper.
- A Responses API `text.format.schema` wrapper.
- A function definition with `parameters`.
- A Chat Completions request containing `tools[].function.parameters`.
- A Responses API request containing a flat function tool at
  `tools[].parameters`.

The validator extracts recognized schemas and reports where they were found.
For a `tools` request, it validates every recognized function schema and uses
`$.tools` as the aggregate result path while keeping every diagnostic path
specific. Returned statistics include the schema count and combined scan
totals; hard limits are evaluated independently at each schema path.
`type: "json_schema"` and `type: "function"` are recognized
wrapper discriminators; any other top-level `type`, a `$`-prefixed schema
marker, or another structural schema keyword takes precedence as a bare schema
so an unknown annotation cannot be mistaken for a request wrapper.

## MVP rules

Errors:

- Input must be valid JSON.
- The root schema must be an object with `type: "object"`.
- Root-level `anyOf` is not allowed.
- When present, `properties` must be an object whose values are schemas.
- `patternProperties`, `$defs`, and `definitions` must be objects whose values
  are schemas.
- `items` must be a single schema object.
- `anyOf` must be a non-empty array whose entries are schema objects.
- `enum` must be an array.
- Values in `type` and `required` arrays must be unique.
- Numeric constraints must contain finite numbers, and `multipleOf` must be
  greater than zero.
- `minItems`, `maxItems`, `minLength`, and `maxLength` must be non-negative
  integers.
- `pattern` must be a string.
- `$ref` must be a string, and local references must resolve to schema objects.
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
- External references are not resolved locally and produce a warning.
- Empty or duplicate enums and regular expressions that cannot be compiled by
  the browser runtime produce review warnings.

Reviewable strict-mode patches:

- Add missing `required` entries only when `required` is absent or a valid,
  unique string array and contains no undeclared names.
- Set `additionalProperties` to `false` on object schemas.
- Preserve the complete recognized request wrapper around the repaired schema.
- Return each proposed `add` or `replace` operation with its path and value.

The patch does not delete `required` names or rewrite malformed `required`
arrays, root types, composition, limits, references, enums, or unknown
keywords. It does not guess between the two sides of a likely property-name
typo. A patched candidate is exposed only after a second validation pass
confirms that it has no remaining errors.

Diagnostic budgets:

- Return at most 100 errors and 50 warnings.
- Limit diagnostic paths to 512 characters and messages or suggestions to
  1,024 characters.
- Report the number of additional diagnostics omitted after those limits.
- Retain global-limit and reference-budget errors when the diagnostic list is
  full by omitting a lower-priority structural finding.
- Continue computing aggregate schema statistics after the diagnostic limit is
  reached.
- Stop reference-depth analysis after 50,000 graph operations and return a
  `reference_analysis_budget_exceeded` error instead of continuing an
  adversarial cyclic expansion.

## Public API policy

The production site does not expose a validation HTTP endpoint. A request to
the former `/api/validate` path must return HTTP 404. The browser imports the
pure rule engine directly, so removing the endpoint does not change the primary
workflow.

An HTTP API may be reconsidered only after real demand is demonstrated. Before
it is made public, its product contract must include authentication, durable
rate limiting, quotas, abuse monitoring, and explicit privacy documentation.

## Interface direction

The page should feel like a precise engineering instrument:

- warm paper background and dark graphite workbench;
- signal orange for actions, red only for errors, green only for valid state;
- a compact masthead, a two-column editor/diagnostics workbench, and visible
  rule-source/version information;
- distinctive editorial display typography paired with a code-focused
  monospace face;
- no generic AI gradients, chat metaphors, or decorative dashboard cards.
- Edits immediately replace prior diagnostics with an out-of-date state; the
  interface never displays old statistics or a prior green result as current.
- Browser input is capped at 1,000,000 UTF-8 bytes before validation.
- Vercel Web Analytics may record anonymous, cookie-free page views. Custom
  events are allowlisted to validation outcome, patch application, and patched
  JSON copy actions; schema contents, pasted values, and paths are never event
  properties.

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
  included in a reviewable patch.
- Nested object paths are precise.
- Limits and unsupported composition rules are enforced.
- Malformed supported-keyword values and broken local references are rejected.
- Resolved local reference targets receive the same structural validation as
  directly nested schemas.
- Shared `$ref` graphs do not cause repeated exponential traversal.
- Browser input, diagnostic, and reference-analysis budgets are enforced.
- All supported wrappers resolve to the same schema result, and all recognized
  schemas in a tools array are validated.
- Patches preserve supported wrappers and are offered only when the repaired
  result passes every error rule.
- Undeclared names, malformed arrays, and ambiguous `properties`/`required`
  mismatches are diagnosed without destructive rewriting.
- The production site returns HTTP 404 for the removed validation endpoint and
  does not advertise a public API.
- The primary browser workflow passes at desktop and narrow mobile widths.
- Edited and oversized browser input cannot retain a stale passing result.
- Typecheck, lint, unit tests, production build, and Playwright smoke test pass.
