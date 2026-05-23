import { describe, expect, it } from "vitest";

import { reviewFieldHint } from "./review-field-hint";

describe("reviewFieldHint", () => {
  it("returns currency guidance with schema currency", () => {
    expect(
      reviewFieldHint("currency", {
        name: "total",
        label: "Total",
        type: "currency",
        output_format: { currency: "EUR" },
      }),
    ).toBe("Enter the amount in EUR.");
  });

  it("returns category guidance when allowed values exist", () => {
    expect(
      reviewFieldHint("category", {
        name: "status",
        label: "Status",
        type: "category",
        allowed_values: ["draft", "final"],
      }),
    ).toBe("Pick one of the allowed schema values.");
  });
});
