import { expect, test } from "@playwright/test";

import { mockExtractionApi } from "./helpers/mock-api";

test("operator playbook: upload, review, export, audit chain", async ({
  page,
}) => {
  await mockExtractionApi(page);
  await page.goto("/");

  await page
    .locator('input[type="file"]')
    .first()
    .setInputFiles({
      name: "sample-contract.txt",
      mimeType: "text/plain",
      buffer: Buffer.from(
        "Vendor Name: Acme Company\nTotal Amount: $1,200.00",
        "utf-8",
      ),
    });

  await page.getByRole("combobox", { name: "Schema" }).selectOption("1");
  await page.getByRole("button", { name: "Run extraction" }).click();
  await expect(page.getByText("Parsed document")).toBeVisible();
  await expect(
    page.getByText("Highlighting source range for Vendor Name"),
  ).toBeVisible();

  await page.getByRole("button", { name: "Save review" }).click();
  await expect(
    page.getByText("Review saved and formulas recalculated."),
  ).toBeVisible();

  await page.getByRole("button", { name: "Export JSON" }).click();
  await expect(page.getByText(/SHA-256/i)).toBeVisible();

  await page.getByRole("button", { name: "Audit" }).click();
  await expect(page.getByText("review · saved")).toBeVisible();
  await expect(page.getByText("export · created")).toBeVisible();
});
