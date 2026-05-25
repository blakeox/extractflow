import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { ReviewFieldEditor } from "./ReviewFieldEditor";

describe("ReviewFieldEditor", () => {
  it("renders boolean and category editors", () => {
    const onChange = vi.fn();

    const { rerender } = render(
      <ReviewFieldEditor
        fieldLabel="Active"
        fieldType="boolean"
        draftValue="true"
        onChange={onChange}
      />,
    );

    fireEvent.change(
      screen.getByRole("combobox", { name: "Active review value" }),
      {
        target: { value: "false" },
      },
    );
    expect(onChange).toHaveBeenCalledWith("false");

    rerender(
      <ReviewFieldEditor
        fieldLabel="Status"
        fieldType="category"
        draftValue=""
        definition={{
          name: "status",
          label: "Status",
          type: "category",
          allowed_values: ["draft", "final"],
        }}
        onChange={onChange}
      />,
    );

    fireEvent.change(
      screen.getByRole("combobox", { name: "Status review value" }),
      {
        target: { value: "final" },
      },
    );
    expect(onChange).toHaveBeenCalledWith("final");
  });

  it("renders structured review editors", () => {
    const onChange = vi.fn();

    const { rerender } = render(
      <ReviewFieldEditor
        fieldLabel="Metadata"
        fieldType="json_object"
        draftValue='{"vendor":"Acme"}'
        onChange={onChange}
      />,
    );

    expect(
      screen.getByRole("textbox", { name: "Metadata review value" }),
    ).toBeInTheDocument();

    rerender(
      <ReviewFieldEditor
        fieldLabel="Line items"
        fieldType="table"
        draftValue='[{"sku":"A1"}]'
        onChange={onChange}
      />,
    );

    expect(
      screen.getByRole("textbox", { name: "Line items sku row 1" }),
    ).toBeInTheDocument();

    rerender(
      <ReviewFieldEditor
        fieldLabel="Party"
        fieldType="structured_object"
        draftValue='{"name":"Acme"}'
        definition={{
          name: "party",
          label: "Party",
          type: "structured_object",
          schema: {
            properties: {
              name: { type: "string" },
            },
          },
        }}
        onChange={onChange}
      />,
    );

    expect(
      screen.getByRole("textbox", { name: "Party name" }),
    ).toBeInTheDocument();
  });
});
