import { expect, test } from "@playwright/test";

import { mockExtractionApi } from "./helpers/mock-api";

test("keeps a failed extraction in the workspace and allows rerun recovery", async ({
  page,
}) => {
  await mockExtractionApi(page, { jobScenarios: ["failed", "review"] });
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

  await expect(
    page.getByRole("heading", { name: "Fix and rerun sample-contract.txt" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: /sample-contract\.txt.*Failed/i }),
  ).toBeVisible();
  await expect(page.getByText("Failure detail")).toBeVisible();
  await expect(
    page.getByText(
      "Provider timed out while extracting vendor_name. Check local runtime and rerun.",
    ),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Run extraction" }),
  ).toBeEnabled();
  await expect(page.getByRole("button", { name: "Export JSON" })).toHaveCount(
    0,
  );

  await page.getByRole("button", { name: "Run extraction" }).click();

  await expect(
    page.getByRole("heading", { name: "1 fields need review" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: /sample-contract\.txt.*need review/i }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Save review" })).toBeVisible();
  await expect(page.getByLabel("Vendor Name review value")).toHaveValue(
    "Acme Company",
  );
});
