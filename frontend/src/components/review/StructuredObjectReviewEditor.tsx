import { useEffect, useMemo } from "react";

import type { TemplateFieldDefinition } from "../../lib/review-helpers";
import { JsonObjectReviewEditor } from "./JsonObjectReviewEditor";
import { SupportingText } from "../ui/SupportingText";

type StructuredObjectReviewEditorProps = {
  fieldLabel: string;
  draftValue: string;
  definition?: TemplateFieldDefinition | null;
  onChange: (value: string) => void;
  onValidationChange?: (error: string | null) => void;
};

function schemaProperties(
  definition?: TemplateFieldDefinition | null,
): Record<string, Record<string, unknown>> {
  const schema = definition?.schema ?? definition?.field_schema;
  if (!schema || typeof schema !== "object") {
    return {};
  }
  const properties = (schema as { properties?: Record<string, unknown> })
    .properties;
  if (!properties || typeof properties !== "object") {
    return {};
  }
  return properties as Record<string, Record<string, unknown>>;
}

function parseObjectDraft(raw: string): Record<string, string> {
  const trimmed = raw.trim();
  if (!trimmed) {
    return {};
  }
  const parsed = JSON.parse(trimmed) as Record<string, unknown>;
  return Object.fromEntries(
    Object.entries(parsed).map(([key, value]) => [key, String(value ?? "")]),
  );
}

export function StructuredObjectReviewEditor({
  fieldLabel,
  draftValue,
  definition,
  onChange,
  onValidationChange,
}: StructuredObjectReviewEditorProps) {
  const properties = schemaProperties(definition);
  const propertyNames = Object.keys(properties);
  const { values, parseError } = useMemo(() => {
    try {
      return {
        values: parseObjectDraft(draftValue),
        parseError: null as string | null,
      };
    } catch {
      return {
        values: {} as Record<string, string>,
        parseError: "Enter valid JSON for this structured field.",
      };
    }
  }, [draftValue]);

  useEffect(() => {
    if (propertyNames.length) {
      onValidationChange?.(parseError);
    }
  }, [parseError, onValidationChange, propertyNames.length]);

  if (!propertyNames.length) {
    return (
      <JsonObjectReviewEditor
        fieldLabel={fieldLabel}
        draftValue={draftValue}
        onChange={onChange}
        onValidationChange={onValidationChange}
      />
    );
  }

  function coerceValue(
    propertyName: string,
    nextValue: string,
  ): string | boolean | number {
    const propertyType = properties[propertyName]?.type;
    if (propertyType === "boolean") {
      if (nextValue === "true") return true;
      if (nextValue === "false") return false;
      return nextValue;
    }
    if (propertyType === "number" || propertyType === "integer") {
      const parsed = Number(nextValue);
      return Number.isNaN(parsed) ? nextValue : parsed;
    }
    return nextValue;
  }

  function updateValue(key: string, nextValue: string) {
    const nextEntries = propertyNames.map((propertyName) => [
      propertyName,
      propertyName === key
        ? coerceValue(propertyName, nextValue)
        : coerceValue(propertyName, values[propertyName] ?? ""),
    ]);
    onChange(JSON.stringify(Object.fromEntries(nextEntries), null, 2));
  }

  return (
    <div className="grid gap-[0.55rem]">
      {propertyNames.map((propertyName) => {
        const propertySchema = properties[propertyName] ?? {};
        const propertyType =
          typeof propertySchema.type === "string"
            ? String(propertySchema.type)
            : "string";
        const value = values[propertyName] ?? "";

        if (propertyType === "boolean") {
          return (
            <label
              key={propertyName}
              className="grid gap-[0.2rem] text-[0.9rem]"
            >
              <span>{propertyName}</span>
              <select
                aria-label={`${fieldLabel} ${propertyName}`}
                value={value}
                onChange={(event) =>
                  updateValue(propertyName, event.target.value)
                }
              >
                <option value="">Unknown</option>
                <option value="true">True</option>
                <option value="false">False</option>
              </select>
            </label>
          );
        }

        return (
          <label key={propertyName} className="grid gap-[0.2rem] text-[0.9rem]">
            <span>{propertyName}</span>
            <input
              aria-label={`${fieldLabel} ${propertyName}`}
              value={value}
              onChange={(event) =>
                updateValue(propertyName, event.target.value)
              }
            />
          </label>
        );
      })}
      {parseError ? (
        <SupportingText as="span" size="sm" className="text-[#b42318]">
          {parseError}
        </SupportingText>
      ) : (
        <SupportingText as="span" size="sm">
          Structured fields follow the template schema properties.
        </SupportingText>
      )}
    </div>
  );
}
