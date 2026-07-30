import { ValidatorWorkbench } from "@/components/validator-workbench";
import {
  OPENAI_SCHEMA_DOCS_URL,
  RULE_VERSION,
} from "@/lib/openai-schema-validator/validator";

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
      "The interactive workbench runs in your browser and does not upload the schema. The optional HTTP API is a separate server endpoint for callers who explicitly choose to use it.",
  },
  {
    question: "Can it fix invalid schema for response_format errors?",
    answer:
      "It can safely repair common strict-mode problems: missing required entries, undeclared names inside required, and object schemas that do not set additionalProperties to false. Other changes remain manual.",
  },
  {
    question: "Is a passing result guaranteed to work with every OpenAI model?",
    answer:
      "No. This is a preflight against public documentation, not a clone of the OpenAI API validator. Always test the final request with the exact API surface and model you will use.",
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
      "Validate and safely repair JSON Schemas for OpenAI Structured Outputs.",
    offers: {
      "@type": "Offer",
      price: "0",
      priceCurrency: "USD",
    },
    featureList: [
      "OpenAI Structured Outputs preflight",
      "Path-specific diagnostics",
      "Conservative schema auto-fix",
      "Browser-local validation",
      "HTTP validation API",
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
        <a className={styles.brand} href="#" aria-label="Schema Signal home">
          <span className={styles.brandMark} aria-hidden="true">
            {"{✓}"}
          </span>
          <span>
            Schema Signal
            <small>OpenAI preflight</small>
          </span>
        </a>
        <nav aria-label="Primary navigation">
          <a href="#validator">Validator</a>
          <a href="#rules">Rule index</a>
          <a href="#api">API</a>
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
                bare schema or wrapper, get exact paths, and safely repair
                common strict-mode mistakes.
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
                <span>Safe fix</span>
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

        <section id="api" className={styles.apiSection}>
          <div className={styles.apiCopy}>
            <p className={styles.sectionLabel}>Backend interface</p>
            <h2>One rule engine, two ways to use it.</h2>
            <p>
              The page validates locally. CI jobs and internal tools can call
              the same versioned rules through the HTTP endpoint.
            </p>
            <div className={styles.apiFacts}>
              <div>
                <span>Method</span>
                <strong>POST</strong>
              </div>
              <div>
                <span>Endpoint</span>
                <strong>/api/validate</strong>
              </div>
              <div>
                <span>Persistence</span>
                <strong>None</strong>
              </div>
            </div>
          </div>
          <div className={styles.apiCode}>
            <div>
              <span>cURL</span>
              <span>application/json</span>
            </div>
            <pre>
              <code>{`curl -X POST https://your-host/api/validate \\
  -H "content-type: application/json" \\
  -d '{
    "schema": {
      "type": "object",
      "properties": {
        "answer": { "type": "string" }
      },
      "required": ["answer"],
      "additionalProperties": false
    }
  }'`}</code>
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
