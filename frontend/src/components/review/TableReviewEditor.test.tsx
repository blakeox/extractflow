import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { TableReviewEditor } from "./TableReviewEditor";

describe("TableReviewEditor", () => {
  it("updates row values as JSON array", () => {
    const onChange = vi.fn();
    render(
      <TableReviewEditor
        fieldLabel="Line items"
        draftValue='[{"sku":"A1","qty":"2"}]'
        onChange={onChange}
      />,
    );

    fireEvent.change(
      screen.getByRole("textbox", { name: "Line items qty row 1" }),
      {
        target: { value: "3" },
      },
    );

    expect(onChange).toHaveBeenCalled();
    const nextDraft = onChange.mock.calls.at(-1)?.[0] as string;
    expect(JSON.parse(nextDraft)).toEqual([{ sku: "A1", qty: "3" }]);
  });

  it("surfaces invalid table JSON", () => {
    const onValidationChange = vi.fn();
    render(
      <TableReviewEditor
        fieldLabel="Line items"
        draftValue="{"
        onChange={vi.fn()}
        onValidationChange={onValidationChange}
      />,
    );

    expect(onValidationChange).toHaveBeenCalledWith(
      expect.stringMatching(/JSON/i),
    );
  });
});
