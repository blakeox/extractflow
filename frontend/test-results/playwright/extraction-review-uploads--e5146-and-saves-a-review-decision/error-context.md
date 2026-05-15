# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: extraction-review.spec.ts >> uploads a document, runs extraction, and saves a review decision
- Location: e2e/extraction-review.spec.ts:5:1

# Error details

```
Error: expect(locator).toBeVisible() failed

Locator: getByText('Acme Company')
Expected: visible
Error: strict mode violation: getByText('Acme Company') resolved to 3 elements:
    1) <p>Acme Company</p> aka getByText('Acme Company').first()
    2) <p>Acme Company</p> aka getByRole('button', { name: 'Vendor Name Acme Company Valid' })
    3) <span>Acme Company</span> aka locator('span').filter({ hasText: 'Acme Company' })

Call log:
  - Expect "toBeVisible" with timeout 5000ms
  - waiting for getByText('Acme Company')

```

# Page snapshot

```yaml
- generic [ref=e3]:
  - complementary [ref=e4]:
    - generic [ref=e5]:
      - generic [ref=e6]: E
      - generic [ref=e7]:
        - heading "ExtractFlow" [level=1] [ref=e8]
        - paragraph [ref=e9]: One workspace from PDF to trusted export.
    - generic [ref=e10]:
      - generic [ref=e11]: Primary
      - navigation "Primary" [ref=e12]:
        - button "Extractions" [ref=e13] [cursor=pointer]:
          - img [ref=e15]
          - generic [ref=e19]: Extractions
        - button "Schemas" [ref=e20] [cursor=pointer]:
          - img [ref=e22]
          - generic [ref=e25]: Schemas
    - generic [ref=e26]:
      - generic [ref=e27]: Setup
      - navigation "Setup" [ref=e28]:
        - button "Settings" [ref=e29] [cursor=pointer]:
          - img [ref=e31]
          - generic [ref=e34]: Settings
    - generic [ref=e35]:
      - generic [ref=e37]:
        - strong [ref=e38]: Local Mode
        - paragraph [ref=e39]: mock (mock-extractor)
        - generic [ref=e40]: No review backlog right now
      - button "Open settings" [ref=e41] [cursor=pointer]
  - generic [ref=e42]:
    - banner [ref=e43]:
      - generic [ref=e44]:
        - strong [ref=e45]: Extractions
        - generic [ref=e46]: Upload a document, run extraction, review only exceptions, and export from one place.
    - main [ref=e47]:
      - status [ref=e48]:
        - generic [ref=e49]: Review saved and formulas recalculated.
        - button "Dismiss" [ref=e50] [cursor=pointer]
      - generic [ref=e52]:
        - complementary [ref=e53]:
          - generic [ref=e55]:
            - heading "Jobs" [level=2] [ref=e56]
            - paragraph [ref=e57]: Switch runs without leaving the workspace.
          - button "New extraction" [ref=e58] [cursor=pointer]
          - generic [ref=e60]:
            - generic [ref=e61]: Completed
            - button "sample-contract.txt May 2, 2026, 8:06 AM Ready to export" [ref=e63] [cursor=pointer]:
              - strong [ref=e64]: sample-contract.txt
              - generic [ref=e65]: May 2, 2026, 8:06 AM
              - emphasis [ref=e66]: Ready to export
        - generic [ref=e68]:
          - generic [ref=e69]:
            - generic [ref=e70]:
              - generic [ref=e71]: Extraction workspace
              - heading "Extraction complete" [level=2] [ref=e72]
              - paragraph [ref=e73]: The output is ready. Export it from the same place where you trusted it.
            - generic [ref=e74]:
              - button "Export JSON" [ref=e75] [cursor=pointer]
              - button "Export CSV" [ref=e76] [cursor=pointer]
              - button "Export Excel" [ref=e77] [cursor=pointer]
          - generic [ref=e78]:
            - generic [ref=e79]:
              - generic [ref=e81]:
                - heading "Source" [level=2] [ref=e82]
                - paragraph [ref=e83]: Keep the document, schema, and evidence together so the next action stays obvious.
              - generic [ref=e84]:
                - generic [ref=e85]:
                  - strong [ref=e86]: sample-contract.txt
                  - paragraph [ref=e87]: Source evidence should justify the field the user is editing.
                - generic [ref=e88]:
                  - strong [ref=e89]: Vendor Name
                  - paragraph [ref=e90]: Acme Company
                  - generic [ref=e91]:
                    - generic [ref=e92]: Page 1
                    - generic [ref=e93]: Page 1
                    - generic [ref=e94]: Chars —
                    - generic [ref=e95]: Confidence 41%
                - generic [ref=e96]:
                  - button "Vendor Name Acme Company Valid" [ref=e97]:
                    - generic [ref=e98]:
                      - strong [ref=e99]: Vendor Name
                      - paragraph [ref=e100]: Acme Company
                    - generic [ref=e101]: Valid
                  - button "Total Amount $1,200.00 Valid" [ref=e102]:
                    - generic [ref=e103]:
                      - strong [ref=e104]: Total Amount
                      - paragraph [ref=e105]: $1,200.00
                    - generic [ref=e106]: Valid
            - generic [ref=e107]:
              - generic [ref=e109]:
                - heading "Trusted result" [level=2] [ref=e110]
                - paragraph [ref=e111]: The extraction finished cleanly. Export directly from the trusted result.
              - generic [ref=e112]:
                - generic [ref=e113]:
                  - generic [ref=e114]: Extracted fields
                  - strong [ref=e115]: "2"
                - generic [ref=e116]:
                  - generic [ref=e117]: Run provider
                  - strong [ref=e118]: mock (mock-extractor)
                - generic [ref=e119]:
                  - generic [ref=e120]: Needs review
                  - strong [ref=e121]: "0"
                - generic [ref=e122]:
                  - generic [ref=e123]: Calculated fields
                  - strong [ref=e124]: "0"
                - generic [ref=e125]:
                  - generic [ref=e126]: Reviewed
                  - strong [ref=e127]: May 2, 2026, 8:07 AM
              - generic [ref=e128]:
                - strong [ref=e129]: No manual review required
                - paragraph [ref=e130]: The result is already ready for export. Do not make the user visit another page just to download it.
              - generic [ref=e131]:
                - generic [ref=e132]:
                  - strong [ref=e133]: Looks good
                  - generic [ref=e134]: 2 fields
                - generic [ref=e135]:
                  - generic [ref=e136]:
                    - generic [ref=e137]: V
                    - generic [ref=e138]:
                      - strong [ref=e139]: Vendor Name
                      - generic [ref=e140]: Acme Company
                    - generic [ref=e142]: Valid
                  - generic [ref=e143]:
                    - generic [ref=e144]: T
                    - generic [ref=e145]:
                      - strong [ref=e146]: Total Amount
                      - generic [ref=e147]: USD 1,200.00
                    - generic [ref=e149]: Valid
              - generic [ref=e150]:
                - generic [ref=e151]:
                  - strong [ref=e152]: Export history
                  - generic [ref=e153]: "0"
                - generic [ref=e154]:
                  - strong [ref=e155]: No exports yet
                  - paragraph [ref=e156]: Exports should be available from this result, not hidden behind another destination.
```

# Test source

```ts
  1  | import { expect, test } from "@playwright/test";
  2  | 
  3  | import { mockExtractionApi } from "./helpers/mock-api";
  4  | 
  5  | test("uploads a document, runs extraction, and saves a review decision", async ({
  6  |   page,
  7  | }) => {
  8  |   await mockExtractionApi(page);
  9  |   await page.goto("/");
  10 | 
  11 |   await page
  12 |     .locator('input[type="file"]')
  13 |     .first()
  14 |     .setInputFiles({
  15 |       name: "sample-contract.txt",
  16 |       mimeType: "text/plain",
  17 |       buffer: Buffer.from(
  18 |         "Vendor Name: Acme Company\nTotal Amount: $1,200.00",
  19 |         "utf-8",
  20 |       ),
  21 |     });
  22 | 
  23 |   await expect(page.getByText("Uploaded sample-contract.txt.")).toBeVisible();
  24 |   await expect(
  25 |     page.getByRole("heading", { name: "New extraction" }),
  26 |   ).toBeVisible();
  27 | 
  28 |   await page.getByRole("combobox", { name: "Schema" }).selectOption("1");
  29 |   await expect(
  30 |     page.getByRole("button", { name: "Run extraction" }),
  31 |   ).toBeEnabled();
  32 |   await page.getByRole("button", { name: "Run extraction" }).click();
  33 | 
  34 |   await expect(
  35 |     page.getByText("Extraction job queued in the active workspace."),
  36 |   ).toBeVisible();
  37 |   await expect(
  38 |     page.getByRole("heading", { name: "1 fields need review" }),
  39 |   ).toBeVisible();
  40 |   await expect(
  41 |     page.getByRole("button", { name: /sample-contract\.txt.*need review/i }),
  42 |   ).toBeVisible();
  43 |   await expect(
  44 |     page.getByRole("button", { name: "Save review" }),
  45 |   ).toBeVisible();
  46 |   await expect(page.getByLabel("Vendor Name review value")).toHaveValue(
  47 |     "Acme Company",
  48 |   );
  49 |   await expect(page.getByRole("button", { name: "Export JSON" })).toBeVisible();
  50 | 
  51 |   await page.getByRole("button", { name: "Save review" }).click();
  52 | 
  53 |   await expect(
  54 |     page.getByText("Review saved and formulas recalculated."),
  55 |   ).toBeVisible();
  56 |   await expect(
  57 |     page.getByRole("heading", { name: "Extraction complete" }),
  58 |   ).toBeVisible();
  59 |   await expect(
  60 |     page.getByRole("button", {
  61 |       name: /sample-contract\.txt.*Ready to export/i,
  62 |     }),
  63 |   ).toBeVisible();
  64 |   await expect(page.getByRole("button", { name: "Save review" })).toHaveCount(
  65 |     0,
  66 |   );
  67 |   await expect(page.getByLabel("Vendor Name review value")).toHaveCount(0);
  68 |   await expect(page.getByText("No manual review required")).toBeVisible();
  69 |   await expect(page.getByRole("button", { name: "Export CSV" })).toBeVisible();
  70 |   await expect(
  71 |     page.getByRole("button", { name: "Export Excel" }),
  72 |   ).toBeVisible();
> 73 |   await expect(page.getByText("Acme Company")).toBeVisible();
     |                                                ^ Error: expect(locator).toBeVisible() failed
  74 | });
  75 | 
```