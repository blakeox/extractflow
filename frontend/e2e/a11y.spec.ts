import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Locator, type Page } from "@playwright/test";

import { mockExtractionApi } from "./helpers/mock-api";

const SERIOUS_IMPACTS = new Set(["serious", "critical"]);

function formatViolations(
  violations: Array<{
    id: string;
    impact?: string | null;
    description: string;
    nodes: Array<{ target: string[]; failureSummary?: string | null }>;
  }>,
) {
  return violations
    .map((violation) => {
      const nodes = violation.nodes
        .map((node) => {
          const target = node.target.join(", ");
          const summary = node.failureSummary?.trim() ?? "No failure summary.";
          return `  - ${target}: ${summary}`;
        })
        .join("\n");

      return `${violation.id} (${violation.impact ?? "unknown"}) - ${violation.description}\n${nodes}`;
    })
    .join("\n\n");
}

async function expectNoSeriousViolations(page: Page, stateName: string) {
  const results = await new AxeBuilder({ page }).analyze();
  const seriousViolations = results.violations.filter((violation) =>
    SERIOUS_IMPACTS.has(violation.impact ?? ""),
  );

  expect(
    seriousViolations,
    `${stateName} has serious accessibility violations:\n${formatViolations(seriousViolations)}`,
  ).toEqual([]);
}

async function uploadSampleDocument(page: Page) {
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
}

async function runExtractionToReview(page: Page) {
  await uploadSampleDocument(page);
  await page.getByRole("combobox", { name: "Schema" }).selectOption("1");
  await page.getByRole("button", { name: "Run extraction" }).click();
  await expect(
    page.getByRole("heading", { name: "1 fields need review" }),
  ).toBeVisible();
}

async function tabTo(page: Page, target: Locator, maxTabs = 20) {
  await page.locator("body").click({ position: { x: 1, y: 1 } });

  for (let index = 0; index < maxTabs; index += 1) {
    await page.keyboard.press("Tab");
    const isFocused = await target.evaluate(
      (element) => element === document.activeElement,
    );
    if (isFocused) {
      return;
    }
  }

  throw new Error(
    `Could not reach ${await target.innerText()} via keyboard tabbing.`,
  );
}

test("@a11y new extraction shell has no serious accessibility violations", async ({
  page,
}) => {
  await mockExtractionApi(page);
  await page.goto("/");

  await expect(
    page.getByRole("heading", { name: "New extraction" }),
  ).toBeVisible();

  await expectNoSeriousViolations(page, "New extraction shell");
});

test("@a11y no-schema guidance has no serious accessibility violations", async ({
  page,
}) => {
  await mockExtractionApi(page, { templates: [] });
  await page.goto("/");

  await uploadSampleDocument(page);
  await expect(page.getByText("No schemas yet")).toBeVisible();

  await expectNoSeriousViolations(page, "No-schema guidance");
});

test("@a11y extraction review and completion states have no serious accessibility violations", async ({
  page,
}) => {
  await mockExtractionApi(page);
  await page.goto("/");

  await runExtractionToReview(page);
  await expectNoSeriousViolations(page, "Extraction review");

  await page.getByRole("button", { name: "Save review" }).click();
  await expect(
    page.getByRole("heading", { name: "Extraction complete" }),
  ).toBeVisible();

  await expectNoSeriousViolations(page, "Extraction complete");
});

test("@a11y no-schema guidance is keyboard reachable", async ({ page }) => {
  await mockExtractionApi(page, { templates: [] });
  await page.goto("/");

  await uploadSampleDocument(page);

  const openSchemaBuilder = page.getByRole("button", {
    name: "Open schema builder",
  });
  await tabTo(page, openSchemaBuilder);
  await expect(openSchemaBuilder).toBeFocused();

  await page.keyboard.press("Enter");
  await expect(
    page.getByRole("heading", {
      name: "Define what the model should look for before the document run starts.",
    }),
  ).toBeVisible();
});

test("@a11y extraction review can be completed by keyboard", async ({
  page,
}) => {
  await mockExtractionApi(page);
  await page.goto("/");

  await runExtractionToReview(page);

  const saveReview = page.getByRole("button", { name: "Save review" });
  await tabTo(page, saveReview);
  await expect(saveReview).toBeFocused();

  await page.keyboard.press("Enter");
  await expect(
    page.getByRole("heading", { name: "Extraction complete" }),
  ).toBeVisible();
});
