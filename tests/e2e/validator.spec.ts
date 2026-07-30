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
