import { fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";

import { JsonObjectReviewEditor } from "./JsonObjectReviewEditor";

function ControlledEditor({
  onValidationChange,
}: {
  onValidationChange: (error: string | null) => void;
}) {
  const [draftValue, setDraftValue] = useState('{"valid": true}');
  return (
    <JsonObjectReviewEditor
      fieldLabel="Metadata"
      draftValue={draftValue}
      onChange={setDraftValue}
      onValidationChange={onValidationChange}
    />
  );
}

describe("JsonObjectReviewEditor", () => {
  it("reports invalid JSON on blur", () => {
    const onValidationChange = vi.fn();
    render(<ControlledEditor onValidationChange={onValidationChange} />);

    const textarea = screen.getByRole("textbox", {
      name: "Metadata review value",
    });
    fireEvent.change(textarea, { target: { value: "{" } });
    fireEvent.blur(textarea);

    expect(onValidationChange).toHaveBeenCalledWith("Enter valid JSON.");
  });
});
