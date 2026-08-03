import Link from "next/link";

import { ValidatorWorkbench } from "@/components/validator-workbench";
import {
  OPENAI_SCHEMA_DOCS_URL,
  RULE_VERSION,
} from "@/lib/openai-schema-validator/validator";
import { SITE_URL } from "@/lib/site";

import styles from "./page.module.css";

const faqs = [
  {
    question: "What does this OpenAI JSON Schema validator check?",
    answer:
      "It checks the documented Structured Outputs subset, including root shape, required fields, additionalProperties, unsupported composition keywords, object depth, property count, enum limits, and schema string limits.",
  },
  {
    question: "Does the validator send my schema to a server?",
    answer:
      "No. The interactive workbench runs entirely in your browser. The production site does not expose a validation API, so pasted schemas are not sent to this site's server.",
  },
  {
    question: "Can it fix invalid schema for response_format errors?",
    answer:
      "It proposes a reviewable patch for missing required entries and object schemas that do not set additionalProperties to false. It never removes undeclared required names; ambiguous changes remain manual.",
  },
  {
    question: "Is a passing result guaranteed to work with every OpenAI model?",
    answer:
      "No. This is a preflight against public documentation, not a clone of the OpenAI API validator. Always test the final request with the exact API surface and model you will use.",
  },
  {
    question: "What usage data is measured?",
    answer:
      "Vercel Web Analytics may record anonymous, cookie-free page views and named actions. Validation events contain only an outcome label; schema contents, pasted values, and diagnostic paths are never included.",
  },
] as const;

const structuredData = [
  {
    "@context": "https://schema.org",
    "@type": "SoftwareApplication",
    name: "OpenAI JSON Schema Validator",
    applicationCategory: "DeveloperApplication",
    operatingSystem: "Any",
    browserRequirements: "Requires JavaScript",
    description:
      "Validate JSON Schemas for OpenAI Structured Outputs and review strict-mode patches.",
    url: SITE_URL,
    softwareVersion: RULE_VERSION,
    isAccessibleForFree: true,
    offers: {
      "@type": "Offer",
      price: "0",
      priceCurrency: "USD",
    },
    featureList: [
      "OpenAI Structured Outputs preflight",
      "Path-specific diagnostics",
      "Reviewable strict-mode patches",
      "Browser-local validation",
      "No schema uploads",
    ],
  },
  {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: faqs.map((faq) => ({
      "@type": "Question",
      name: faq.question,
      acceptedAnswer: {
        "@type": "Answer",
        text: faq.answer,
      },
    })),
  },
];

const ruleCards = [
  {
    index: "01",
    title: "Strict objects",
    copy: "Every object needs additionalProperties: false, including nested objects and definitions.",
  },
  {
    index: "02",
    title: "Required parity",
    copy: "Every declared property must appear in required; unknown required names are flagged.",
  },
  {
    index: "03",
    title: "Root contract",
    copy: "The root must be an object and cannot be an anyOf union.",
  },
  {
    index: "04",
    title: "Supported subset",
    copy: "Unsupported composition keywords are errors; uncertain keywords stay visible as warnings.",
  },
  {
    index: "05",
    title: "Schema scale",
    copy: "Counts the 5,000-property, 10-object-level, and 120,000-character limits.",
  },
  {
    index: "06",
    title: "Enum budgets",
    copy: "Checks the global 1,000-value limit and the long string-enum exception.",
  },
] as const;

export default function Home() {
  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify(structuredData).replace(/</g, "\\u003c"),
        }}
      />

      <header className={styles.siteHeader}>
        <Link
          className={styles.brand}
          href="/"
        >
          <span className={styles.brandMark} aria-hidden="true">
            {"{✓}"}
          </span>
          <span>
            Schema Signal
            <small>OpenAI preflight</small>
          </span>
        </Link>
        <nav aria-label="Primary navigation">
          <a href="#validator">Validator</a>
          <a href="#rules">Rule index</a>
          <a href="#privacy">Privacy</a>
          <a
            href="https://github.com/zonzie/openai-json-schema-validator"
            target="_blank"
            rel="noreferrer"
          >
            GitHub
          </a>
        </nav>
      </header>

      <main>
        <section className={styles.hero}>
          <div className={styles.heroGrid}>
            <div className={styles.heroCopy}>
              <p className={styles.kicker}>
                <span>Documented-rule preflight</span>
                <span>Updated {RULE_VERSION}</span>
              </p>
              <h1>
                OpenAI JSON
                <br />
                Schema Validator
              </h1>
              <p className={styles.heroLead}>
                Use this OpenAI Structured Output validator to investigate an
                OpenAI Structured Output validation error—including “invalid
                schema for response_format”—before sending a request. Paste a
                bare schema or complete tools wrapper, get exact paths, and
                review a narrow patch for common strict-mode mistakes.
              </p>
              <div className={styles.heroActions}>
                <a className={styles.primaryLink} href="#validator">
                  Open the validator
                  <span aria-hidden="true">↓</span>
                </a>
                <a
                  className={styles.textLink}
                  href={OPENAI_SCHEMA_DOCS_URL}
                  target="_blank"
                  rel="noreferrer"
                >
                  Read the source rules ↗
                </a>
              </div>
              <ul className={styles.promiseList} aria-label="Product promises">
                <li>Runs locally in your browser</li>
                <li>Deterministic, versioned rules</li>
                <li>No signup or API key</li>
              </ul>
            </div>

            <div className={styles.heroSpecimen} aria-label="Example diagnostic">
              <div className={styles.specimenTop}>
                <span>Preflight specimen</span>
                <span>ERR / 2</span>
              </div>
              <div className={styles.specimenCode}>
                <span className={styles.codeMuted}>12</span>
                <code>
                  <b>&quot;properties&quot;</b>: {"{"}
                </code>
                <span className={styles.codeMuted}>13</span>
                <code>
                  &nbsp;&nbsp;<b>&quot;answer&quot;</b>: {"{"} &quot;type&quot;:
                  &quot;string&quot; {"}"}
                </code>
                <span className={styles.codeMuted}>14</span>
                <code>{"}"}</code>
              </div>
              <div className={styles.specimenFinding}>
                <span className={styles.findingIndex}>01</span>
                <div>
                  <code>$.required</code>
                  <strong>&quot;answer&quot; must be required</strong>
                  <p>Every property must be listed in required.</p>
                </div>
              </div>
              <div className={styles.specimenFinding}>
                <span className={styles.findingIndex}>02</span>
                <div>
                  <code>$.additionalProperties</code>
                  <strong>Strict object lock is missing</strong>
                  <p>Set additionalProperties to false.</p>
                </div>
              </div>
              <div className={styles.specimenStamp}>
                <span>Review patch</span>
                <strong>available</strong>
              </div>
            </div>
          </div>
        </section>

        <div id="validator" className={styles.validatorAnchor}>
          <ValidatorWorkbench />
        </div>

        <section id="rules" className={styles.rulesSection}>
          <div className={styles.sectionIntro}>
            <p className={styles.sectionLabel}>Rule index / 06 checks</p>
            <h2>
              Not just valid JSON. Checked against OpenAI’s documented subset.
            </h2>
            <p>
              Ordinary validators answer whether a document follows JSON
              Schema. This one focuses on the smaller contract accepted by
              OpenAI Structured Outputs.
            </p>
          </div>
          <div className={styles.ruleGrid}>
            {ruleCards.map((rule) => (
              <article key={rule.index}>
                <span>{rule.index}</span>
                <h3>{rule.title}</h3>
                <p>{rule.copy}</p>
              </article>
            ))}
          </div>
          <p className={styles.sourceNote}>
            Rule behavior is tied to the official documentation snapshot dated{" "}
            {RULE_VERSION}. Unknown behavior is reported conservatively rather
            than presented as API fact.
          </p>
        </section>

        <section id="privacy" className={styles.localSection}>
          <div className={styles.localCopy}>
            <p className={styles.sectionLabel}>Local execution</p>
            <h2>Your schema stays on this device.</h2>
            <p>
              The workbench imports the deterministic rule engine directly into
              your browser. Validation, diagnostics, and reviewed patches are
              computed without uploading the pasted input to this site.
            </p>
            <p className={styles.localPolicy}>
              No public validation API is exposed.
            </p>
            <div className={styles.localFacts}>
              <div>
                <span>Execution</span>
                <strong>Browser local</strong>
              </div>
              <div>
                <span>Schema upload</span>
                <strong>None</strong>
              </div>
              <div>
                <span>Account</span>
                <strong>Not required</strong>
              </div>
              <div>
                <span>Public API</span>
                <strong>Not offered</strong>
              </div>
            </div>
          </div>
          <div className={styles.localFlow}>
            <div>
              <span>Execution path</span>
              <span>Browser only</span>
            </div>
            <pre>
              <code>{`paste schema
    ↓
validateOpenAISchema(input)
    ↓
diagnostics + reviewable patch

network upload     none
server validation  none`}</code>
            </pre>
          </div>
        </section>

        <section className={styles.faqSection}>
          <div className={styles.sectionIntro}>
            <p className={styles.sectionLabel}>Field notes / FAQ</p>
            <h2>Know what a green result means.</h2>
          </div>
          <div className={styles.faqList}>
            {faqs.map((faq, index) => (
              <details key={faq.question} open={index === 0}>
                <summary>
                  <span>{String(index + 1).padStart(2, "0")}</span>
                  {faq.question}
                </summary>
                <p>{faq.answer}</p>
              </details>
            ))}
          </div>
        </section>
      </main>

      <footer className={styles.footer}>
        <div>
          <strong>Schema Signal</strong>
          <p>
            Independent developer tool. Not affiliated with or endorsed by
            OpenAI.
          </p>
        </div>
        <div>
          <a href={OPENAI_SCHEMA_DOCS_URL} target="_blank" rel="noreferrer">
            Official rule source
          </a>
          <a
            href="https://github.com/zonzie/openai-json-schema-validator"
            target="_blank"
            rel="noreferrer"
          >
            Source code
          </a>
        </div>
      </footer>
    </>
  );
}
