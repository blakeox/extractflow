export const REVIEW_HIGH_CONFIDENCE_MIN = 0.85;

export type ReviewFieldLike = {
  field_name: string;
  label: string;
  data_type?: string;
  normalized_value?: unknown;
  extracted_value?: unknown;
  confidence_score?: number;
  validation_status: string;
  requires_review: boolean;
};

export type TemplateFieldDefinition = {
  name: string;
  label: string;
  type: string;
  allowed_values?: string[];
  output_format?: { currency?: string | null } | null;
  schema?: Record<string, unknown> | null;
  field_schema?: Record<string, unknown> | null;
};

export function isHighConfidenceField(
  field: ReviewFieldLike,
  threshold = REVIEW_HIGH_CONFIDENCE_MIN,
): boolean {
  if (!field.requires_review || field.validation_status === "invalid") {
    return false;
  }
  const score = field.confidence_score;
  return score != null && score >= threshold;
}
