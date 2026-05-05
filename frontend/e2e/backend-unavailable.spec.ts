import { expect, test } from "@playwright/test";

import { mockExtractionApi } from "./helpers/mock-api";

test("keeps the web workspace visible when the backend health check fails", async ({
  page,
}) => {
  await mockExtractionApi(page, { apiAvailable: false });
  await page.goto("/");

  await expect(
    page.getByText(
      "Backend unavailable. The extraction workspace is open, but the local API is not reachable",
    ),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "New extraction" }),
  ).toBeVisible();
  await expect(page.getByText("Upload PDF or source file")).toBeVisible();
  await expect(page.getByText("No schemas yet")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Open schema builder" }),
  ).toBeVisible();
  await expect(page.getByRole("combobox", { name: "Schema" })).toHaveCount(0);
  await expect(
    page.getByRole("combobox", { name: "Advanced: version" }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Run extraction" }),
  ).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Start stack" })).toHaveCount(
    0,
  );
  await expect(page.getByRole("button", { name: "Refresh" })).toHaveCount(0);
});
