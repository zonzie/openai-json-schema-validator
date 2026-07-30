import { expect, test } from "@playwright/test";

test("user can diagnose and repair a strict-mode schema", async ({ page }) => {
  await page.goto("/");

  await expect(page).toHaveTitle(
    "OpenAI JSON Schema Validator for Structured Outputs",
  );
  await expect(
    page.getByRole("heading", { name: "OpenAI JSON Schema Validator" }),
  ).toBeVisible();
  await expect(page.getByText("5 errors", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: "Apply safe fixes" }).click();

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
  const applyFixes = page.getByRole("button", { name: "Apply safe fixes" });
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

  await page.getByRole("button", { name: "Validate schema" }).click();

  await expect(
    page.getByText("Documented rules pass", { exact: true }),
  ).toBeVisible();
  await expect(editor).toHaveValue(replacement);
});

test("safe fixes preserve the complete OpenAI request wrapper", async ({
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
  await page.getByRole("button", { name: "Apply safe fixes" }).click();

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
