import type {
  ReviewFieldLike,
  TemplateFieldDefinition,
} from "./review-helpers";

const STRUCTURED_FIELD_TYPES = new Set([
  "json_object",
  "structured_object",
  "table",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function getReviewFieldType(
  field: ReviewFieldLike,
  definition?: TemplateFieldDefinition | null,
): string {
  return String(field.data_type ?? definition?.type ?? "text").toLowerCase();
}

export function formatStructuredDraftValue(value: unknown): string {
  if (value == null) {
    return "";
  }
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

export function getInitialReviewDraft(
  field: ReviewFieldLike,
  definition?: TemplateFieldDefinition | null,
): string {
  const value = field.normalized_value ?? field.extracted_value ?? null;
  const type = getReviewFieldType(field, definition);

  if (value == null) {
    return "";
  }

  if (STRUCTURED_FIELD_TYPES.has(type)) {
    return formatStructuredDraftValue(value);
  }

  if (
    type === "currency" &&
    isRecord(value) &&
    typeof value.amount === "number"
  ) {
    return String(value.amount);
  }

  if (type === "boolean") {
    if (typeof value === "boolean") return value ? "true" : "false";
    if (isRecord(value) && typeof value.value === "boolean")
      return value.value ? "true" : "false";
  }

  if (
    isRecord(value) &&
    (typeof value.value === "string" || typeof value.value === "number")
  ) {
    return String(value.value);
  }

  if (typeof value === "string" || typeof value === "number") {
    return String(value);
  }

  if (typeof value === "boolean") {
    return value ? "true" : "false";
  }

  return JSON.stringify(value);
}

function parseStructuredReviewDraft(
  fieldLabel: string,
  raw: string,
  fieldType: string,
): unknown {
  const trimmed = raw.trim();
  if (!trimmed) {
    return null;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    throw new Error(`${fieldLabel} must be valid JSON.`);
  }

  if (fieldType === "table") {
    if (!Array.isArray(parsed)) {
      throw new Error(`${fieldLabel} must be a JSON array of rows.`);
    }
    return parsed;
  }

  if (fieldType === "json_object" || fieldType === "structured_object") {
    if (!isRecord(parsed) && !Array.isArray(parsed)) {
      throw new Error(`${fieldLabel} must be a JSON object or array.`);
    }
    return parsed;
  }

  return parsed;
}

export function parseReviewDraft(
  field: ReviewFieldLike,
  raw: string,
  definition?: TemplateFieldDefinition | null,
): unknown {
  const trimmed = raw.trim();
  const type = getReviewFieldType(field, definition);

  if (!trimmed) {
    return null;
  }

  if (STRUCTURED_FIELD_TYPES.has(type)) {
    return parseStructuredReviewDraft(field.label, raw, type);
  }

  switch (type) {
    case "currency": {
      const amount = Number(trimmed);
      if (Number.isNaN(amount)) {
        throw new Error(`${field.label} must be a valid number.`);
      }
      const existing = isRecord(field.normalized_value)
        ? field.normalized_value
        : null;
      const currency =
        typeof existing?.currency === "string" ? existing.currency : "USD";
      return {
        amount,
        currency,
        display_value: `${currency} ${amount.toLocaleString([], { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
      };
    }
    case "date":
      return { value: trimmed, display_value: trimmed };
    case "number": {
      const value = Number(trimmed);
      if (Number.isNaN(value)) {
        throw new Error(`${field.label} must be a valid number.`);
      }
      return { value };
    }
    case "boolean":
      return trimmed === "true";
    default:
      return { value: raw };
  }
}

export function validateJsonDraft(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) {
    return null;
  }
  try {
    JSON.parse(trimmed);
    return null;
  } catch {
    return "Enter valid JSON.";
  }
}
