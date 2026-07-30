# Repository Guide

## Purpose

This repository ships a deterministic browser and HTTP preflight validator for
the documented OpenAI Structured Outputs JSON Schema subset.

## Commands

- `pnpm dev` — run the app locally.
- `pnpm test` — run unit and API tests.
- `pnpm test:e2e` — run the Playwright browser test.
- `pnpm typecheck` — run TypeScript without emitting files.
- `pnpm lint` — run ESLint.
- `pnpm build` — create the production build.

## Conventions

- Treat `docs/product-spec.md` as the originating product specification.
- Keep validation logic pure and deterministic under
  `src/lib/openai-schema-validator/`.
- Tests must exercise public interfaces, not private helpers.
- Every diagnostic needs a stable code, severity, JSON path, plain-language
  message, and documentation URL.
- Auto-fixes must be conservative and covered by a behavior test.
- Do not send or persist user schemas.
- Do not claim parity with undocumented OpenAI server behavior.
- Use `apply_patch` for hand-authored edits.
