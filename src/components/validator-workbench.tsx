"use client";

import { useMemo, useState } from "react";

import {
  RULE_VERSION,
  type SchemaDiagnostic,
  type ValidationResult,
  validateOpenAISchema,
} from "../lib/openai-schema-validator/validator";
import {
  trackPatchedJsonCopied,
  trackPatchApplied,
  trackValidation,
} from "../lib/public-analytics";
import { MAX_INPUT_BYTES } from "../lib/validation-limits";
import styles from "./validator-workbench.module.css";

const BROKEN_SAMPLE = JSON.stringify(
  {
    type: "object",
    properties: {
      summary: {
        type: "string",
        description: "A concise answer.",
      },
      confidence: {
        type: "number",
        minimum: 0,
        maximum: 1,
      },
      citation: {
        type: "object",
        properties: {
          title: { type: "string" },
          url: { type: "string" },
        },
        required: ["url"],
      },
    },
    required: ["summary"],
    additionalProperties: true,
  },
  null,
  2,
);

const VALID_SAMPLE = JSON.stringify(
  {
    type: "object",
    properties: {
      summary: {
        type: "string",
        description: "A concise answer.",
      },
      confidence: {
        type: "number",
        minimum: 0,
        maximum: 1,
      },
    },
    required: ["summary", "confidence"],
    additionalProperties: false,
  },
  null,
  2,
);

const WRAPPER_SAMPLE = JSON.stringify(
  {
    text: {
      format: {
        type: "json_schema",
        name: "research_answer",
        strict: true,
        schema: JSON.parse(VALID_SAMPLE),
      },
    },
  },
  null,
  2,
);

const SAMPLES = [
  { label: "Broken schema", value: BROKEN_SAMPLE },
  { label: "Valid schema", value: VALID_SAMPLE },
  { label: "Responses wrapper", value: WRAPPER_SAMPLE },
] as const;

const MAX_RENDERED_LINE_NUMBERS = 2_000;

function DiagnosticCard({
  diagnostic,
}: {
  diagnostic: SchemaDiagnostic;
}) {
  return (
    <article
      className={`${styles.diagnostic} ${
        diagnostic.severity === "error"
          ? styles.diagnosticError
          : styles.diagnosticWarning
      }`}
    >
      <div className={styles.diagnosticTopline}>
        <span className={styles.diagnosticSeverity}>
          {diagnostic.severity}
        </span>
        <code>{diagnostic.code}</code>
      </div>
      <code className={styles.diagnosticPath}>{diagnostic.path}</code>
      <p>{diagnostic.message}</p>
      {diagnostic.suggestion ? (
        <p className={styles.suggestion}>
          <span>Suggested action</span>
          {diagnostic.suggestion}
        </p>
      ) : null}
      <p className={styles.diagnosticEvidence}>
        <span>Rule evidence</span>
        <a
          href={diagnostic.documentationUrl}
          target="_blank"
          rel="noreferrer"
        >
          Official rule
        </a>
        <small>Rule set {RULE_VERSION}</small>
      </p>
    </article>
  );
}

export function ValidatorWorkbench() {
  const [schemaText, setSchemaText] = useState(BROKEN_SAMPLE);
  const [result, setResult] = useState<ValidationResult>(() =>
    validateOpenAISchema(BROKEN_SAMPLE),
  );
  const [isDirty, setIsDirty] = useState(false);
  const [inputIssue, setInputIssue] = useState<string | null>(null);
  const [editorScrollTop, setEditorScrollTop] = useState(0);
  const [copyState, setCopyState] = useState<"idle" | "copied" | "failed">(
    "idle",
  );

  const lineNumbers = useMemo(
    () =>
      schemaText
        .split("\n", MAX_RENDERED_LINE_NUMBERS)
        .map((_, index) => index + 1),
    [schemaText],
  );

  const fixedText =
    isDirty || inputIssue !== null || result.fixedSchema === null
      ? null
      : JSON.stringify(result.fixedSchema, null, 2);
  const diagnostics = [...result.errors, ...result.warnings];

  function runValidation(nextText = schemaText) {
    if (new TextEncoder().encode(nextText).byteLength > MAX_INPUT_BYTES) {
      setInputIssue(
        "The browser input exceeds the 1,000,000-byte validation limit.",
      );
      setIsDirty(false);
      setCopyState("idle");
      trackValidation("input_too_large");
      return;
    }

    const nextResult = validateOpenAISchema(nextText);
    setResult(nextResult);
    setInputIssue(null);
    setIsDirty(false);
    setCopyState("idle");
    trackValidation(
      nextResult.valid
        ? nextResult.warnings.length > 0
          ? "pass_with_warnings"
          : "pass"
        : "error",
    );
  }

  function loadSample(value: string) {
    setSchemaText(value);
    runValidation(value);
  }

  function applyPatch() {
    if (fixedText === null) {
      return;
    }

    setSchemaText(fixedText);
    setResult(validateOpenAISchema(fixedText));
    setInputIssue(null);
    setIsDirty(false);
    setCopyState("idle");
    trackPatchApplied();
  }

  async function copyText(value: string) {
    try {
      await navigator.clipboard.writeText(value);
      setCopyState("copied");
      trackPatchedJsonCopied();
    } catch {
      setCopyState("failed");
    }
  }

  const statusLabel = isDirty
    ? "Edited · run check"
    : inputIssue
      ? "Input too large"
      : result.valid
        ? result.warnings.length > 0
          ? "Valid with warnings"
          : "Documented rules pass"
        : `${result.errors.length} ${
            result.errors.length === 1 ? "error" : "errors"
          }${result.omittedDiagnosticCount > 0 ? " · more omitted" : ""}`;

  return (
    <section className={styles.workbench} aria-labelledby="workbench-title">
      <div className={styles.workbenchHeader}>
        <div>
          <p className={styles.eyebrow}>
            Local preflight / rule set {RULE_VERSION}
          </p>
          <h2 id="workbench-title">Schema workbench</h2>
        </div>
        <div className={styles.headerSignals}>
          <span className={styles.localSignal}>
            <i aria-hidden="true" />
            Browser-local
          </span>
          <span
            className={`${styles.statusSignal} ${
              isDirty
                ? styles.statusIdle
                : inputIssue
                  ? styles.statusInvalid
                  : result.valid
                    ? styles.statusValid
                    : styles.statusInvalid
            }`}
            aria-live="polite"
          >
            {statusLabel}
          </span>
        </div>
      </div>

      <div className={styles.toolGrid}>
        <div className={styles.editorPanel}>
          <div className={styles.panelToolbar}>
            <div className={styles.sampleGroup} aria-label="Load an example">
              {SAMPLES.map((sample) => (
                <button
                  key={sample.label}
                  type="button"
                  onClick={() => loadSample(sample.value)}
                >
                  {sample.label}
                </button>
              ))}
            </div>
            <button
              className={styles.clearButton}
              type="button"
              onClick={() => {
                setSchemaText("");
                setIsDirty(true);
                setInputIssue(null);
                setCopyState("idle");
              }}
            >
              Clear
            </button>
          </div>

          <div className={styles.editorShell}>
            <div className={styles.lineNumberRail} aria-hidden="true">
              <div
                className={styles.lineNumbers}
                style={{ transform: `translateY(-${editorScrollTop}px)` }}
              >
                {lineNumbers.map((lineNumber) => (
                  <span key={lineNumber}>{lineNumber}</span>
                ))}
              </div>
            </div>
            <textarea
              aria-label="JSON Schema input"
              spellCheck={false}
              value={schemaText}
              onScroll={(event) =>
                setEditorScrollTop(event.currentTarget.scrollTop)
              }
              onChange={(event) => {
                setSchemaText(event.target.value);
                setIsDirty(true);
                setInputIssue(null);
                setCopyState("idle");
              }}
            />
          </div>

          <div className={styles.editorActions}>
            <button
              className={styles.validateButton}
              type="button"
              onClick={() => runValidation()}
            >
              <span aria-hidden="true">↳</span>
              Validate schema
            </button>
            <p>
              Supports bare schemas, Responses, Chat Completions, and function
              wrappers.
            </p>
          </div>
        </div>

        <div className={styles.resultsPanel}>
          {isDirty ? (
            <div className={styles.staleResults} aria-live="polite">
              <span aria-hidden="true">↻</span>
              <div>
                <h3>Results are out of date</h3>
                <p>
                  Run validation again to replace the previous diagnostics and
                  statistics with results for this edit.
                </p>
              </div>
            </div>
          ) : inputIssue ? (
            <div className={styles.staleResults} aria-live="polite">
              <span aria-hidden="true">!</span>
              <div>
                <h3>Input is too large</h3>
                <p>{inputIssue}</p>
              </div>
            </div>
          ) : (
            <>
              <div className={styles.statsStrip}>
                <div>
                  <span>Schemas</span>
                  <strong>{result.stats.schemaCount}</strong>
                </div>
                <div>
                  <span>Properties scanned</span>
                  <strong>
                    {result.stats.propertyCount.toLocaleString("en-US")}
                    <small>
                      {result.stats.schemaCount > 1 ? "combined" : "/5,000"}
                    </small>
                  </strong>
                </div>
                <div>
                  <span>Object depth</span>
                  <strong>
                    {result.stats.maxObjectDepth}
                    <small>/10</small>
                  </strong>
                </div>
                <div>
                  <span>Enum values</span>
                  <strong>
                    {result.stats.enumValueCount.toLocaleString("en-US")}
                    <small>
                      {result.stats.schemaCount > 1 ? "combined" : "/1,000"}
                    </small>
                  </strong>
                </div>
              </div>

              <div className={styles.resultsHeading}>
                <div>
                  <p className={styles.eyebrow}>Diagnostics</p>
                  <h3>
                    {diagnostics.length === 0
                      ? "No documented rule violations"
                      : result.omittedDiagnosticCount > 0
                        ? `${diagnostics.length} shown · ${result.omittedDiagnosticCount} omitted`
                        : `${diagnostics.length} ${
                            diagnostics.length === 1 ? "finding" : "findings"
                          }`}
                  </h3>
                </div>
                <code>{result.sourcePath}</code>
              </div>

              <div className={styles.diagnosticsList}>
                {diagnostics.length === 0 ? (
                  <div className={styles.validMessage}>
                    <span aria-hidden="true">✓</span>
                    <div>
                      <strong>
                        The schema passes this documented preflight.
                      </strong>
                      <p>
                        It is still worth testing the real request with the
                        exact model and API surface you plan to use.
                      </p>
                    </div>
                  </div>
                ) : (
                  diagnostics.map((diagnostic, index) => (
                    <DiagnosticCard
                      key={`${diagnostic.code}-${diagnostic.path}-${index}`}
                      diagnostic={diagnostic}
                    />
                  ))
                )}
              </div>
            </>
          )}
        </div>
      </div>

      {fixedText !== null ? (
        <div className={styles.fixTray}>
          <div className={styles.fixCopy}>
            <p className={styles.eyebrow}>Review before applying</p>
            <h3>Strict-mode patch available</h3>
            <p>
              This patch only adds missing required keys and sets object schemas
              to <code>additionalProperties: false</code>. It never removes an
              undeclared required name.
            </p>
            <ul className={styles.patchList} aria-label="Proposed patch">
              {result.patches.map((patch) => (
                <li key={`${patch.operation}-${patch.path}`}>
                  <span>{patch.operation}</span>
                  <code>{patch.path}</code>
                  <small>{JSON.stringify(patch.value)}</small>
                </li>
              ))}
            </ul>
            <div className={styles.fixActions}>
              <button type="button" onClick={applyPatch}>
                Apply reviewed patch
              </button>
              <button
                className={styles.secondaryButton}
                type="button"
                onClick={() => copyText(fixedText)}
              >
                {copyState === "copied"
                  ? "Copied"
                  : copyState === "failed"
                    ? "Copy failed"
                    : "Copy patched JSON"}
              </button>
            </div>
          </div>
          <div className={styles.fixPreview}>
            <div>
              <span>Patched JSON preview</span>
              <span>{fixedText.split("\n").length} lines</span>
            </div>
            <pre>{fixedText}</pre>
          </div>
        </div>
      ) : null}
    </section>
  );
}
