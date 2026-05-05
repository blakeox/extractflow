import { expect, test } from "@playwright/test";

import { mockExtractionApi } from "./helpers/mock-api";

test("keeps a trusted result in place when export generation fails", async ({
  page,
}) => {
  await mockExtractionApi(page, { exportScenarios: ["failed"] });
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
  await page
    .getByRole("combobox", { name: "Advanced: version" })
    .selectOption("101");
  await page.getByRole("button", { name: "Run extraction" }).click();

  await page.getByLabel("Vendor Name review value").fill("Acme Incorporated");
  await page.getByRole("button", { name: "Save changes" }).click();

  await expect(
    page.getByRole("heading", { name: "Extraction complete" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", {
      name: /sample-contract\.txt.*Ready to export/i,
    }),
  ).toBeVisible();
  await expect(page.getByText("No exports yet")).toBeVisible();

  await page.getByRole("button", { name: "Export JSON" }).click();

  await expect(
    page.getByText("Export generation failed at the backend."),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Extraction complete" }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Export JSON" })).toBeVisible();
  await expect(page.getByText("No exports yet")).toBeVisible();
  await expect(page.getByText("Acme Incorporated")).toBeVisible();
});
