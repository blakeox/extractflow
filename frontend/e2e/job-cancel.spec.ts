import { expect, test } from "@playwright/test";

import { mockExtractionApi } from "./helpers/mock-api";

test("operator can cancel a queued extraction job", async ({ page }) => {
  await mockExtractionApi(page, { jobScenarios: ["queued"] });
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

  await expect(page.getByRole("button", { name: "Cancel job" })).toBeVisible();
  await page.getByRole("button", { name: "Cancel job" }).click();
  await expect(page.getByText("Extraction job cancelled.")).toBeVisible();
});
