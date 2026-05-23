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
});
