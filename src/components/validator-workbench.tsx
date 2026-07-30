"use client";

import { useMemo, useState } from "react";

import {
  RULE_VERSION,
  type SchemaDiagnostic,
  type ValidationResult,
  validateOpenAISchema,
} from "../lib/openai-schema-validator/validator";
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
    </article>
  );
}

export function ValidatorWorkbench() {
  const [schemaText, setSchemaText] = useState(BROKEN_SAMPLE);
  const [result, setResult] = useState<ValidationResult>(() =>
    validateOpenAISchema(BROKEN_SAMPLE),
  );
  const [isDirty, setIsDirty] = useState(false);
  const [editorScrollTop, setEditorScrollTop] = useState(0);
  const [copyState, setCopyState] = useState<"idle" | "copied" | "failed">(
    "idle",
  );

  const lineNumbers = useMemo(
    () => schemaText.split("\n").map((_, index) => index + 1),
    [schemaText],
  );

  const fixedText =
    isDirty || result.fixedSchema === null
      ? null
      : JSON.stringify(result.fixedSchema, null, 2);
  const diagnostics = [...result.errors, ...result.warnings];

  function runValidation(nextText = schemaText) {
    setResult(validateOpenAISchema(nextText));
    setIsDirty(false);
    setCopyState("idle");
  }

  function loadSample(value: string) {
    setSchemaText(value);
    runValidation(value);
  }

  function applyFixes() {
    if (fixedText === null) {
      return;
    }

    setSchemaText(fixedText);
    setResult(validateOpenAISchema(fixedText));
    setIsDirty(false);
    setCopyState("idle");
  }

  async function copyText(value: string) {
    try {
      await navigator.clipboard.writeText(value);
      setCopyState("copied");
    } catch {
      setCopyState("failed");
    }
  }

  const statusLabel = isDirty
    ? "Edited · run check"
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
          <div className={styles.statsStrip}>
            <div>
              <span>Properties</span>
              <strong>
                {result.stats.propertyCount.toLocaleString("en-US")}
                <small>/5,000</small>
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
                <small>/1,000</small>
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
                  <strong>The schema passes this documented preflight.</strong>
                  <p>
                    It is still worth testing the real request with the exact
                    model and API surface you plan to use.
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
        </div>
      </div>

      {fixedText !== null ? (
        <div className={styles.fixTray}>
          <div className={styles.fixCopy}>
            <p className={styles.eyebrow}>Conservative repair available</p>
            <h3>Fix strict object requirements without rewriting your model.</h3>
            <p>
              Adds missing required keys, removes undeclared required names,
              and locks object schemas with{" "}
              <code>additionalProperties: false</code>.
            </p>
            <div className={styles.fixActions}>
              <button type="button" onClick={applyFixes}>
                Apply safe fixes
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
                    : "Copy fixed JSON"}
              </button>
            </div>
          </div>
          <div className={styles.fixPreview}>
            <div>
              <span>Fixed schema preview</span>
              <span>{fixedText.split("\n").length} lines</span>
            </div>
            <pre>{fixedText}</pre>
          </div>
        </div>
      ) : null}
    </section>
  );
}
