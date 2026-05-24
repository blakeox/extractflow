import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { StructuredObjectReviewEditor } from "./StructuredObjectReviewEditor";

describe("StructuredObjectReviewEditor", () => {
  it("falls back to JSON editor when schema has no properties", () => {
    const onChange = vi.fn();
    render(
      <StructuredObjectReviewEditor
        fieldLabel="Metadata"
        draftValue='{"vendor":"Acme"}'
        onChange={onChange}
      />,
    );

    expect(
      screen.getByRole("textbox", { name: "Metadata review value" }),
    ).toBeInTheDocument();
  });

  it("renders schema-driven fields and coerces boolean updates", () => {
    const onChange = vi.fn();
    render(
      <StructuredObjectReviewEditor
        fieldLabel="Party"
        draftValue='{"name":"Acme","active":"true"}'
        definition={{
          name: "party",
          label: "Party",
          type: "structured_object",
          schema: {
            properties: {
              name: { type: "string" },
              active: { type: "boolean" },
            },
          },
        }}
        onChange={onChange}
      />,
    );

    fireEvent.change(screen.getByRole("combobox", { name: "Party active" }), {
      target: { value: "false" },
    });

    const nextDraft = onChange.mock.calls.at(-1)?.[0] as string;
    expect(JSON.parse(nextDraft)).toEqual({ name: "Acme", active: false });
  });

  it("shows parse errors for invalid JSON when schema properties exist", () => {
    const onValidationChange = vi.fn();
    render(
      <StructuredObjectReviewEditor
        fieldLabel="Party"
        draftValue="{"
        definition={{
          name: "party",
          label: "Party",
          type: "structured_object",
          field_schema: {
            properties: {
              name: { type: "string" },
            },
          },
        }}
        onChange={vi.fn()}
        onValidationChange={onValidationChange}
      />,
    );

    expect(onValidationChange).toHaveBeenCalledWith(
      "Enter valid JSON for this structured field.",
    );
    expect(screen.getByText(/valid JSON/i)).toBeInTheDocument();
  });
});
