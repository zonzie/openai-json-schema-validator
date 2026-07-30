# OpenAI JSON Schema Validator

A deterministic browser tool and HTTP API for checking JSON Schemas against
the documented OpenAI Structured Outputs subset.

The validator catches OpenAI-specific strict-mode requirements that a generic
JSON Schema validator can miss, then offers conservative repairs for the rules
that can be changed safely.

> Independent developer tool. Not affiliated with or endorsed by OpenAI.

## What it checks

- root schema is an object and does not use root-level `anyOf`
- every object sets `additionalProperties: false`
- every declared property appears in `required`
- every required name exists in `properties`
- unsupported composition keywords
- documented type and string-format values
- 5,000-property and 10-object-level limits
- 120,000-character schema string budget
- 1,000 combined enum values
- long string-enum limit above 250 values
- model-dependent and unknown keywords as warnings

The current rule snapshot is dated `2026-07-30` and links every diagnostic to
the [official Structured Outputs documentation][openai-docs].

## Input formats

The public validator accepts:

- a bare JSON Schema
- a descriptor with `schema`
- `response_format.json_schema.schema`
- `text.format.schema`
- a function definition with `parameters`
- `tools[].function.parameters`

## Local development

Requirements:

- Node.js 22+
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
workbench. The server does not persist input. The web interface itself imports
the pure validator and runs locally in the browser.

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
full paste → diagnose → apply safe fixes flow.

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
the final URL.

## Scope and limitations

This is a documented-rule preflight, not a clone of the private OpenAI server
validator. A passing result does not guarantee compatibility with every model,
fine-tune, SDK helper, or future API revision. Test the final request against
the exact model and API surface you plan to use.

## License

MIT

[openai-docs]: https://developers.openai.com/api/docs/guides/structured-outputs#supported-schemas
