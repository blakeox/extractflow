import { describe, expect, it } from "vitest";

import {
  getInitialReviewDraft,
  parseReviewDraft,
  validateJsonDraft,
} from "./review-draft";

describe("review-draft", () => {
  it("pretty-prints json_object values", () => {
    const draft = getInitialReviewDraft(
      {
        field_name: "metadata",
        label: "Metadata",
        data_type: "json_object",
        normalized_value: { vendor: "Acme", tier: "gold" },
        validation_status: "invalid",
        requires_review: true,
      },
      { name: "metadata", label: "Metadata", type: "json_object" },
    );

    expect(draft).toContain('"vendor": "Acme"');
    expect(JSON.parse(draft)).toEqual({ vendor: "Acme", tier: "gold" });
  });

  it("parses json_object drafts into objects", () => {
    const parsed = parseReviewDraft(
      {
        field_name: "metadata",
        label: "Metadata",
        data_type: "json_object",
        validation_status: "invalid",
        requires_review: true,
      },
      '{\n  "vendor": "Acme Updated"\n}',
      { name: "metadata", label: "Metadata", type: "json_object" },
    );

    expect(parsed).toEqual({ vendor: "Acme Updated" });
  });

  it("validates invalid JSON drafts", () => {
    expect(validateJsonDraft("{")).toMatch(/valid JSON/i);
    expect(validateJsonDraft('{"ok": true}')).toBeNull();
  });

  it("pretty-prints table values and parses table drafts", () => {
    const draft = getInitialReviewDraft(
      {
        field_name: "line_items",
        label: "Line items",
        data_type: "table",
        normalized_value: [{ sku: "A1", qty: 2 }],
        validation_status: "invalid",
        requires_review: true,
      },
      { name: "line_items", label: "Line items", type: "table" },
    );

    expect(JSON.parse(draft)).toEqual([{ sku: "A1", qty: 2 }]);

    const parsed = parseReviewDraft(
      {
        field_name: "line_items",
        label: "Line items",
        data_type: "table",
        validation_status: "invalid",
        requires_review: true,
      },
      '[{"sku":"B2","qty":1}]',
      { name: "line_items", label: "Line items", type: "table" },
    );

    expect(parsed).toEqual([{ sku: "B2", qty: 1 }]);
  });

  it("parses currency and boolean drafts", () => {
    const currency = parseReviewDraft(
      {
        field_name: "total",
        label: "Total",
        data_type: "currency",
        normalized_value: { amount: 1200, currency: "USD" },
        validation_status: "invalid",
        requires_review: true,
      },
      "1500",
      { name: "total", label: "Total", type: "currency" },
    );

    expect(currency).toMatchObject({ amount: 1500, currency: "USD" });

    expect(
      parseReviewDraft(
        {
          field_name: "active",
          label: "Active",
          data_type: "boolean",
          validation_status: "invalid",
          requires_review: true,
        },
        "true",
        { name: "active", label: "Active", type: "boolean" },
      ),
    ).toBe(true);
  });

  it("rejects invalid table drafts", () => {
    expect(() =>
      parseReviewDraft(
        {
          field_name: "line_items",
          label: "Line items",
          data_type: "table",
          validation_status: "invalid",
          requires_review: true,
        },
        '{"not":"array"}',
        { name: "line_items", label: "Line items", type: "table" },
      ),
    ).toThrow(/array/i);
  });
});
