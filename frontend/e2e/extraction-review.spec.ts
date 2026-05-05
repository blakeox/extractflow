import { expect, test } from "@playwright/test";

import { mockExtractionApi } from "./helpers/mock-api";

test("uploads a document, runs extraction, and saves a review decision", async ({
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

  await expect(page.getByText("Uploaded sample-contract.txt.")).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "New extraction" }),
  ).toBeVisible();

  await page.getByRole("combobox", { name: "Schema" }).selectOption("1");
  await page
    .getByRole("combobox", { name: "Advanced: version" })
    .selectOption("101");
  await expect(
    page.getByRole("button", { name: "Run extraction" }),
  ).toBeEnabled();
  await page.getByRole("button", { name: "Run extraction" }).click();

  await expect(
    page.getByText("Extraction job queued in the active workspace."),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "1 fields need review" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: /sample-contract\.txt.*need review/i }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Save changes" }),
  ).toBeVisible();
  await expect(page.getByLabel("Vendor Name review value")).toHaveValue(
    "Acme Company",
  );
  await expect(page.getByRole("button", { name: "Export JSON" })).toBeVisible();

  await page.getByLabel("Vendor Name review value").fill("Acme Incorporated");
  await page.getByRole("button", { name: "Save changes" }).click();

  await expect(
    page.getByText("Review edits saved and formulas recalculated."),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Extraction complete" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", {
      name: /sample-contract\.txt.*Ready to export/i,
    }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Save changes" })).toHaveCount(
    0,
  );
  await expect(page.getByLabel("Vendor Name review value")).toHaveCount(0);
  await expect(page.getByText("No manual review required")).toBeVisible();
  await expect(page.getByRole("button", { name: "Export CSV" })).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Export Excel" }),
  ).toBeVisible();
  await expect(page.getByText("Acme Incorporated")).toBeVisible();
});
