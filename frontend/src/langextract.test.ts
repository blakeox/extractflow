import { describe, expect, it } from "vitest";

import {
  buildDraftLangExtractExampleFromSuggestion,
  buildDraftLangExtractExamples,
  getLangExtractDraftGuidance,
  buildLangExtractExamples,
  buildLangExtractPreview,
  doesDraftLangExtractExampleMatchSuggestion,
  getAppliedLangExtractSuggestionKeys,
  getLangExtractFieldCoverage,
} from "./langextract";

describe("langextract helpers", () => {
  it("hydrates suggestion attributes into draft-friendly rows", () => {
    const draft = buildDraftLangExtractExampleFromSuggestion({
      example_text: "Invoice Vendor: Acme Corp\nTags: red, blue",
      extractions: [
        {
          extraction_class: "vendor_name",
          extraction_text: "Acme Corp",
          attributes: { value: "Acme Corporation" },
        },
        {
          extraction_class: "tags",
          extraction_text: "red, blue",
          attributes: { value: ["red", "blue"] },
        },
      ],
    });

    expect(draft).toEqual({
      text: "Invoice Vendor: Acme Corp\nTags: red, blue",
      extractions: [
        {
          extraction_class: "vendor_name",
          extraction_text: "Acme Corp",
          attributes: [
            { key: "value", value: "Acme Corporation", value_kind: "string" },
          ],
        },
        {
          extraction_class: "tags",
          extraction_text: "red, blue",
          attributes: [
            { key: "value", value: "red\nblue", value_kind: "string_array" },
          ],
        },
      ],
    });
  });

  it("round-trips saved langextract config into draft examples", () => {
    const examples = buildDraftLangExtractExamples({
      prompt_description: "Extract invoice facts.",
      examples: [
        {
          text: "Invoice Vendor: Acme Corp",
          extractions: [
            {
              extraction_class: "vendor_name",
              extraction_text: "Acme Corp",
              attributes: { value: "Acme Corp", aliases: ["Acme", "Corp"] },
            },
          ],
        },
      ],
    });

    expect(examples).toEqual([
      {
        text: "Invoice Vendor: Acme Corp",
        extractions: [
          {
            extraction_class: "vendor_name",
            extraction_text: "Acme Corp",
            attributes: [
              { key: "value", value: "Acme Corp", value_kind: "string" },
              {
                key: "aliases",
                value: "Acme\nCorp",
                value_kind: "string_array",
              },
            ],
          },
        ],
      },
    ]);
  });

  it("matches applied suggestions from canonicalized draft examples", () => {
    const draftExamples = [
      {
        text: "Invoice Vendor: Acme Corp\nTotal Due: $1,200.00",
        extractions: [
          {
            extraction_class: "vendor_name",
            extraction_text: "Acme Corp",
            attributes: [
              {
                key: "aliases",
                value: "Acme\nCorp",
                value_kind: "string_array" as const,
              },
              {
                key: "value",
                value: "Acme Corporation",
                value_kind: "string" as const,
              },
            ],
          },
          {
            extraction_class: "total_amount",
            extraction_text: "$1,200.00",
            attributes: [
              { key: "currency", value: "USD", value_kind: "string" as const },
            ],
          },
        ],
      },
    ];
    const suggestion = {
      key: "suggestion-1",
      example_text: "Invoice Vendor: Acme Corp\nTotal Due: $1,200.00",
      extractions: [
        {
          extraction_class: "vendor_name",
          extraction_text: "Acme Corp",
          attributes: {
            value: "Acme Corporation",
            aliases: ["Acme", "Corp"],
          },
        },
        {
          extraction_class: "total_amount",
          extraction_text: "$1,200.00",
          attributes: { currency: "USD" },
        },
      ],
    };

    expect(
      doesDraftLangExtractExampleMatchSuggestion(draftExamples[0], suggestion),
    ).toBe(true);
    expect(
      getAppliedLangExtractSuggestionKeys(draftExamples, [suggestion]),
    ).toEqual(["suggestion-1"]);
  });

  it("reports required coverage from only known fields", () => {
    const coverage = getLangExtractFieldCoverage(
      [
        {
          extractions: [
            { extraction_class: "vendor_name" },
            { extraction_class: "unknown_field" },
          ],
        },
      ],
      ["vendor_name", "total_amount"],
      ["vendor_name", "total_amount"],
    );

    expect(coverage.coveredFields).toEqual(["vendor_name"]);
    expect(coverage.coveredRequiredFields).toEqual(["vendor_name"]);
    expect(coverage.missingRequiredFields).toEqual(["total_amount"]);
  });

  it("rejects unknown fields during draft parsing", () => {
    expect(() =>
      buildLangExtractExamples(
        [
          {
            text: "Invoice Vendor: Acme Corp",
            extractions: [
              {
                extraction_class: "bogus_field",
                extraction_text: "Acme Corp",
                attributes: [],
              },
            ],
          },
        ],
        ["vendor_name"],
        [],
      ),
    ).toThrow('references unknown field "bogus_field"');
  });

  it("returns preview errors for incomplete required coverage", () => {
    const preview = buildLangExtractPreview(
      {
        langextract_prompt_description: "Extract invoice facts.",
        langextract_examples: [
          {
            text: "Invoice Vendor: Acme Corp",
            extractions: [
              {
                extraction_class: "vendor_name",
                extraction_text: "Acme Corp",
                attributes: [
                  { key: "value", value: "Acme Corp", value_kind: "string" },
                ],
              },
            ],
          },
        ],
      },
      ["vendor_name", "total_amount"],
      ["vendor_name", "total_amount"],
    );

    expect(preview.content).toBeNull();
    expect(preview.error).toContain(
      "Missing example coverage for: total_amount.",
    );
  });

  it("surfaces guidance for weak drafts", () => {
    const guidance = getLangExtractDraftGuidance({
      langextract_prompt_description: "",
      langextract_examples: [
        {
          text: "",
          extractions: [
            { extraction_class: "", extraction_text: "", attributes: [] },
          ],
        },
      ],
    });

    expect(guidance.isReady).toBe(false);
    expect(guidance.messages).toContain(
      "Add a prompt that names the target facts, grounding expectations, and when ambiguous matches should stay review-required.",
    );
    expect(guidance.messages).toContain(
      "Finish at least one complete grounded example before saving this draft.",
    );
  });

  it("reports ready guidance when prompt and examples are complete", () => {
    const guidance = getLangExtractDraftGuidance(
      {
        langextract_prompt_description:
          "Extract contract parties exactly as written, keep grounded spans verbatim, and leave ambiguous matches review-required instead of guessing.",
        langextract_examples: [
          {
            text: "Parties: Acme Corp and River Bank",
            extractions: [
              {
                extraction_class: "primary_subject",
                extraction_text: "Acme Corp",
                attributes: [],
              },
            ],
          },
          {
            text: "Borrower: Pine Street LLC",
            extractions: [
              {
                extraction_class: "primary_subject",
                extraction_text: "Pine Street LLC",
                attributes: [],
              },
            ],
          },
        ],
      },
      ["primary_subject"],
      ["primary_subject"],
    );

    expect(guidance).toEqual({
      isReady: true,
      messages: [
        "This draft has a usable prompt, multiple complete examples, and required field coverage. Next, vary layouts and phrasing before shipping.",
      ],
    });
  });
});
