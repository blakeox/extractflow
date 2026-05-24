import { expect, test } from "@playwright/test";

import { mockExtractionApi } from "./helpers/mock-api";

test("export policy blocks export until review is cleared", async ({
  page,
}) => {
  await mockExtractionApi(page, {
    exportPolicy: { require_review_cleared: true },
  });
  await page.goto("/");

  await page
    .locator('input[type="file"]')
    .first()
    .setInputFiles({
      name: "sample-contract.txt",
      mimeType: "text/plain",
      buffer: Buffer.from("Vendor Name: Acme Company", "utf-8"),
    });
  await page.getByRole("combobox", { name: "Schema" }).selectOption("1");
  await page.getByRole("button", { name: "Run extraction" }).click();
  await expect(page.getByText("Parsed document")).toBeVisible();

  await expect(
    page.getByText("Export blocked until review is cleared."),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Export JSON" }),
  ).toBeDisabled();

  await page.getByRole("button", { name: "Save review" }).click();
  await expect(
    page.getByText("Review saved and formulas recalculated."),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Export JSON" })).toBeEnabled();
});
