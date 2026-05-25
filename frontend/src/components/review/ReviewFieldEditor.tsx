import { JsonObjectReviewEditor } from "./JsonObjectReviewEditor";
import { StructuredObjectReviewEditor } from "./StructuredObjectReviewEditor";
import { TableReviewEditor } from "./TableReviewEditor";
import type { TemplateFieldDefinition } from "../../lib/review-helpers";

type ReviewFieldEditorProps = {
  fieldLabel: string;
  fieldType: string;
  draftValue: string;
  definition?: TemplateFieldDefinition | null;
  onChange: (value: string) => void;
  onValidationChange?: (error: string | null) => void;
};

export function ReviewFieldEditor({
  fieldLabel,
  fieldType,
  draftValue,
  definition,
  onChange,
  onValidationChange,
}: ReviewFieldEditorProps) {
  const allowedValues = definition?.allowed_values ?? [];

  if (fieldType === "json_object") {
    return (
      <JsonObjectReviewEditor
        fieldLabel={fieldLabel}
        draftValue={draftValue}
        onChange={onChange}
        onValidationChange={onValidationChange}
      />
    );
  }

  if (fieldType === "structured_object") {
    return (
      <StructuredObjectReviewEditor
        fieldLabel={fieldLabel}
        draftValue={draftValue}
        definition={definition}
        onChange={onChange}
        onValidationChange={onValidationChange}
      />
    );
  }

  if (fieldType === "table") {
    return (
      <TableReviewEditor
        fieldLabel={fieldLabel}
        draftValue={draftValue}
        onChange={onChange}
        onValidationChange={onValidationChange}
      />
    );
  }

  if (fieldType === "boolean") {
    return (
      <select
        aria-label={`${fieldLabel} review value`}
        value={draftValue}
        onChange={(event) => onChange(event.target.value)}
      >
        <option value="">Unknown</option>
        <option value="true">True</option>
        <option value="false">False</option>
      </select>
    );
  }

  if (fieldType === "category" || fieldType === "multi_select") {
    if (allowedValues.length) {
      return (
        <select
          aria-label={`${fieldLabel} review value`}
          value={draftValue}
          onChange={(event) => onChange(event.target.value)}
        >
          <option value="">Select value</option>
          {allowedValues.map((value) => (
            <option key={value} value={value}>
              {value}
            </option>
          ))}
        </select>
      );
    }
  }

  if (fieldType === "paragraph") {
    return (
      <textarea
        aria-label={`${fieldLabel} review value`}
        rows={4}
        value={draftValue}
        onChange={(event) => onChange(event.target.value)}
      />
    );
  }

  if (
    fieldType === "number" ||
    fieldType === "currency" ||
    fieldType === "percentage"
  ) {
    return (
      <input
        aria-label={`${fieldLabel} review value`}
        type="number"
        step={fieldType === "percentage" ? "0.01" : "any"}
        value={draftValue}
        onChange={(event) => onChange(event.target.value)}
      />
    );
  }

  return (
    <input
      aria-label={`${fieldLabel} review value`}
      type={fieldType === "date" ? "date" : "text"}
      value={draftValue}
      onChange={(event) => onChange(event.target.value)}
    />
  );
}
