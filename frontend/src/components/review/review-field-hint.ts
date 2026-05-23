import type { TemplateFieldDefinition } from "../../lib/review-helpers";

export function reviewFieldHint(
  fieldType: string,
  definition?: TemplateFieldDefinition | null,
): string {
  if (fieldType === "boolean") {
    return "Choose the confirmed value.";
  }
  if (fieldType === "paragraph") {
    return "Save the verified text exactly as it should appear in the result.";
  }
  if (fieldType === "date") {
    return "Use the normalized date when the source is clear.";
  }
  if (fieldType === "category" || fieldType === "multi_select") {
    return definition?.allowed_values?.length
      ? "Pick one of the allowed schema values."
      : "Enter the confirmed category value.";
  }
  if (fieldType === "currency") {
    const currency = definition?.output_format?.currency ?? "USD";
    return `Enter the amount in ${currency}.`;
  }
  if (fieldType === "number" || fieldType === "percentage") {
    return "Enter the confirmed numeric value.";
  }
  return "Edit the normalized value before saving.";
}
