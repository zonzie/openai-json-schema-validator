import { expect, test } from "@playwright/test";

test("user can diagnose and apply a reviewed strict-mode patch", async ({ page }) => {
  await page.goto("/");

  await expect(page).toHaveTitle(
    "OpenAI JSON Schema Validator for Structured Outputs",
  );
  await expect(
    page.getByRole("heading", { name: "OpenAI JSON Schema Validator" }),
  ).toBeVisible();
  await expect(page.getByText("5 errors", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: "Apply reviewed patch" }).click();

  await expect(
    page.getByText("Valid with warnings", { exact: true }),
  ).toBeVisible();

  const editorValue = await page
    .getByRole("textbox", { name: "JSON Schema input" })
    .inputValue();
  expect(editorValue).toContain('"required": [');
  expect(editorValue.match(/"additionalProperties": false/g)?.length).toBe(2);
});

test("editing the schema invalidates an older suggested fix", async ({
  page,
}) => {
  await page.goto("/");

  const editor = page.getByRole("textbox", { name: "JSON Schema input" });
  const applyFixes = page.getByRole("button", { name: "Apply reviewed patch" });
  const replacement = JSON.stringify(
    {
      type: "object",
      properties: {
        user_marker: { type: "string" },
      },
      required: ["user_marker"],
      additionalProperties: false,
    },
    null,
    2,
  );

  await expect(applyFixes).toBeVisible();
  await editor.fill(replacement);
  await expect(applyFixes).toBeHidden();
  await expect(page.getByText("Results are out of date")).toBeVisible();
  await expect(page.getByText("5 errors", { exact: true })).toBeHidden();

  await page.getByRole("button", { name: "Validate schema" }).click();

  await expect(
    page.getByText("Documented rules pass", { exact: true }),
  ).toBeVisible();
  await expect(editor).toHaveValue(replacement);
});

test("reviewed patches preserve the complete OpenAI request wrapper", async ({
  page,
}) => {
  const wrapper = {
    model: "gpt-5.6",
    input: "Return an answer.",
    text: {
      format: {
        type: "json_schema",
        name: "answer",
        strict: true,
        schema: {
          type: "object",
          properties: {
            answer: { type: "string" },
          },
          required: [],
          additionalProperties: false,
        },
      },
    },
  };

  await page.goto("/");

  const editor = page.getByRole("textbox", { name: "JSON Schema input" });
  await editor.fill(JSON.stringify(wrapper, null, 2));
  await page.getByRole("button", { name: "Validate schema" }).click();

  await expect(page.getByText("1 error", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Apply reviewed patch" }).click();

  await expect(
    page.getByText("Documented rules pass", { exact: true }),
  ).toBeVisible();
  expect(JSON.parse(await editor.inputValue())).toEqual({
    ...wrapper,
    text: {
      format: {
        ...wrapper.text.format,
        schema: {
          ...wrapper.text.format.schema,
          required: ["answer"],
        },
      },
    },
  });
});

test("shows reviewable patch operations and rule evidence", async ({ page }) => {
  await page.goto("/");

  await expect(
    page.getByRole("heading", { name: "Strict-mode patch available" }),
  ).toBeVisible();
  await expect(
    page
      .getByLabel("Proposed patch")
      .getByText("$.properties.citation.additionalProperties", {
        exact: true,
      }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Official rule" }).first(),
  ).toHaveAttribute("href", /developers\.openai\.com/);
});

test("blocks oversized browser input before validation", async ({
  page,
}, testInfo) => {
  test.setTimeout(60_000);
  test.skip(testInfo.project.name !== "chromium");
  await page.goto("/");

  const editor = page.getByRole("textbox", { name: "JSON Schema input" });
  await editor.fill("x".repeat(1_000_001));
  await expect(page.getByText("Edited · run check")).toBeVisible();
  await page.getByRole("button", { name: "Validate schema" }).click();

  await expect(page.getByText("Input is too large")).toBeVisible();
  await expect(page.getByText("Documented rules pass")).toBeHidden();
});

test("keeps the validator close to the first mobile viewport", async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== "mobile-chromium");
  await page.goto("/");

  const workbench = page.getByRole("heading", { name: "Schema workbench" });
  const box = await workbench.boundingBox();
  expect(box?.y).toBeLessThan(900);
});

test("publishes crawlable canonical, structured data, robots, and sitemap", async ({
  page,
  request,
}, testInfo) => {
  test.skip(testInfo.project.name !== "chromium");
  await page.goto("/");

  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute(
    "href",
    "https://openai-json-schema-validator.vercel.app",
  );
  const structuredData = await page
    .locator('script[type="application/ld+json"]')
    .evaluateAll((scripts) =>
      scripts.flatMap((script) => JSON.parse(script.textContent ?? "[]")),
    );
  expect(structuredData.map((entry) => entry["@type"])).toEqual([
    "SoftwareApplication",
    "FAQPage",
  ]);

  const robots = await request.get("/robots.txt");
  expect(robots.ok()).toBe(true);
  await expect(robots.text()).resolves.toContain(
    "Sitemap: https://openai-json-schema-validator.vercel.app/sitemap.xml",
  );

  const sitemap = await request.get("/sitemap.xml");
  expect(sitemap.ok()).toBe(true);
  await expect(sitemap.text()).resolves.toContain(
    "<loc>https://openai-json-schema-validator.vercel.app</loc>",
  );
});
