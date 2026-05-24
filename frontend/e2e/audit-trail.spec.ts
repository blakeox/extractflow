import { expect, test } from "@playwright/test";

import { mockExtractionApi } from "./helpers/mock-api";

test("audit page renders live events and deep links to a job", async ({
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
      buffer: Buffer.from("Vendor Name: Acme Company", "utf-8"),
    });
  await page.getByRole("combobox", { name: "Schema" }).selectOption("1");
  await page.getByRole("button", { name: "Run extraction" }).click();
  await page.getByRole("button", { name: "Save review" }).click();
  await page.getByRole("button", { name: "Export JSON" }).click();

  await page.getByRole("button", { name: "Audit" }).click();
  await expect(page.getByText("review · saved")).toBeVisible();
  await expect(page.getByText("export · created")).toBeVisible();

  await page.getByRole("button", { name: "result" }).first().click();
  await expect(page.getByText("Parsed document")).toBeVisible();
  await expect(page.getByRole("button", { name: "Save review" })).toBeVisible();
});
