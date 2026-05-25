import { expect, test } from "@playwright/test";

import { mockExtractionApi } from "./helpers/mock-api";

test("workspace honors ?status=failed and filters the job list", async ({
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
      buffer: Buffer.from("Vendor Name: Acme Company", "utf-8"),
    });
  await page.getByRole("combobox", { name: "Schema" }).selectOption("1");
  await page.getByRole("button", { name: "Run extraction" }).click();
  await expect(
    page.getByRole("button", { name: /sample-contract\.txt.*Failed/i }),
  ).toBeVisible();

  await page.goto("/?status=failed");

  await expect(page.getByRole("button", { name: "Failed" })).toBeVisible();
  await expect(
    page.getByRole("button", { name: /sample-contract\.txt.*Failed/i }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: /sample-contract\.txt.*need review/i }),
  ).toHaveCount(0);
});
