# OpenAI JSON Schema Validator

A deterministic browser tool and HTTP API for checking JSON Schemas against
the documented OpenAI Structured Outputs subset.

The validator catches OpenAI-specific strict-mode requirements that a generic
JSON Schema validator can miss, then shows a reviewable patch for the two
changes it can make without deleting schema intent.

> Independent developer tool. Not affiliated with or endorsed by OpenAI.

## What it checks

- root schema is an object and does not use root-level `anyOf`
- every object sets `additionalProperties: false`
- every declared property appears in `required`
- every required name exists in `properties`
- unsupported composition keywords
- malformed `items`, `anyOf`, schema maps, enums, and local references
- malformed numeric, size, pattern, `type`, and `required` keyword values
- documented type and string-format values
- 5,000-property and 10-object-level limits
- 120,000-character schema string budget
- 1,000 combined enum values
- long string-enum limit above 250 values
- external references, questionable enums, model-dependent keywords, and
  unknown keywords as warnings

The current rule snapshot is dated `2026-08-03` and links every diagnostic to
the [official Structured Outputs documentation][openai-docs].

## Input formats

The public validator accepts:

- a bare JSON Schema
- a descriptor with `schema`
- `response_format.json_schema.schema`
- `text.format.schema`
- a function definition with `parameters`
- every `tools[].function.parameters` schema in a request
- every Responses API function tool with `tools[].parameters`

Top-level `type: "json_schema"` and `type: "function"` remain wrapper
discriminators. Any other top-level `type`, a `$`-prefixed dialect or reference
marker, or a structural schema keyword such as `properties` or `required`
makes the input a bare schema before wrapper matching so unknown annotations
cannot redirect validation into nested data.

## Reviewable patches

Patches run on a clone of the complete accepted input. When the input is an
OpenAI request wrapper, `fixedSchema` preserves that wrapper and changes only
recognized schemas. The result lists every `add` or `replace` operation with
its exact path and proposed value.

A patched result is returned only after the candidate passes every hard
validation rule. The patch may add missing `required` names and set
`additionalProperties: false`; it never removes an undeclared `required` name
or rewrites a malformed `required` array.

## Local development

Requirements:

- Node.js 22.x
- pnpm 11+

```bash
pnpm install
pnpm dev
```

Open `http://localhost:3000`.

## HTTP API

`POST /api/validate`

```bash
curl -X POST http://localhost:3000/api/validate \
  -H "content-type: application/json" \
  -d '{
    "schema": {
      "type": "object",
      "properties": {
        "answer": { "type": "string" }
      },
      "required": ["answer"],
      "additionalProperties": false
    }
  }'
```

The endpoint returns the same versioned `ValidationResult` used by the browser
workbench. Responses use `Cache-Control: no-store`, and the server does not
persist input. The web interface itself imports the pure validator and runs
locally in the browser. Cross-origin browser access is not enabled by default;
use the endpoint from the same origin, a server, CI, or your own proxy.

The HTTP boundary accepts request bodies up to 1,000,000 bytes and keeps
responses at or below 512,000 bytes. Core results retain at most 100 errors and
50 warnings, cap diagnostic paths and text, and report how many additional
findings were omitted. Reference-depth analysis also has a 50,000-operation
budget. When only a large fixed schema would exceed the response budget, the
API omits that field and returns `fixedSchemaOmitted: true`.
If patch values also exceed the budget, the API preserves diagnostics and
returns `patches: []` with `patchesOmitted: true`.

## Verification

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm exec playwright install chromium
pnpm test:e2e
```

Core and API tests exercise public interfaces. The Playwright test verifies the
full paste → diagnose → review patch → apply flow, including stale-result and
browser-size-limit behavior.

## Project structure

```text
src/
  app/
    api/validate/        HTTP API
    page.tsx             crawlable product page
  components/            interactive browser workbench
  lib/
    openai-schema-validator/
                         pure rule engine and behavior tests
docs/
  product-spec.md        product and acceptance specification
```

## Deployment

The app is a standard Next.js project. Set `NEXT_PUBLIC_SITE_URL` to the
production origin so canonical metadata, `robots.txt`, and `sitemap.xml` use
the final URL. Set `NEXT_PUBLIC_GOOGLE_SITE_VERIFICATION` when a Search Console
verification token is available; without the token, no verification tag is
rendered.

Vercel Web Analytics records anonymous, cookie-free page views after it is
enabled for the project. The three custom event helpers accept only fixed event
names and a validation outcome enum; they cannot receive schema contents,
pasted values, diagnostic paths, or API bodies. Custom-event reporting depends
on the Vercel plan, while page-view reporting is available on all plans.

## Scope and limitations

This is a documented-rule preflight, not a clone of the private OpenAI server
validator. A passing result does not guarantee compatibility with every model,
fine-tune, SDK helper, or future API revision. Test the final request against
the exact model and API surface you plan to use.

## License

MIT

[openai-docs]: https://developers.openai.com/api/docs/guides/structured-outputs#supported-schemas
