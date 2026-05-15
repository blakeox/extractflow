import { expect, test } from "@playwright/test";

import { mockExtractionApi } from "./helpers/mock-api";

test("shows the constrained no-schema workflow when no templates exist", async ({
  page,
}) => {
  await mockExtractionApi(page, { templates: [] });
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

  await expect(
    page.getByRole("heading", { name: "New extraction" }),
  ).toBeVisible();
  await expect(page.getByText("No schemas yet")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Open schema builder" }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Open help" })).toBeVisible();
  await expect(page.getByRole("combobox", { name: "Schema" })).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Change version" }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Run extraction" }),
  ).toHaveCount(0);
});
