import { expect, test } from "@playwright/test";

import { mockExtractionApi } from "./helpers/mock-api";

test("workspace opens the job from ?job= on load", async ({ page }) => {
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
  await expect(page.getByText("Parsed document")).toBeVisible();

  await page.goto("/?job=1");

  await expect(page.getByText("Parsed document")).toBeVisible();
  await expect(page.getByRole("button", { name: "Save review" })).toBeVisible();
});

test("workspace opens the job from ?result= on load", async ({ page }) => {
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
  await expect(page.getByText("Parsed document")).toBeVisible();

  await page.goto("/?result=501");

  await expect(page.getByText("Parsed document")).toBeVisible();
  await expect(page.getByRole("button", { name: "Save review" })).toBeVisible();
});
