export type DraftLangExtractAttribute = {
  key: string;
  value: string;
  value_kind: "string" | "string_array";
};

export type DraftLangExtractExtraction = {
  extraction_class: string;
  extraction_text: string;
  attributes: DraftLangExtractAttribute[];
};

export type DraftLangExtractExample = {
  text: string;
  extractions: DraftLangExtractExtraction[];
};

type LangExtractConfigShape =
  | {
      prompt_description: string;
      examples: Array<{
        text: string;
        extractions: Array<{
          extraction_class: string;
          extraction_text: string;
          attributes: Record<string, string | string[]>;
        }>;
      }>;
    }
  | null
  | undefined;

type LangExtractSuggestionShape = {
  example_text: string;
  extractions: Array<{
    extraction_class: string;
    extraction_text: string;
    attributes: Record<string, string | string[]>;
  }>;
};

type LangExtractDraftShape = {
  langextract_prompt_description: string;
  langextract_examples: DraftLangExtractExample[];
};

type ComparableLangExtractExtraction = {
  extraction_class: string;
  extraction_text: string;
  attributes: Record<string, string | string[]>;
};

type ComparableLangExtractExample = {
  text: string;
  extractions: ComparableLangExtractExtraction[];
};

export type LangExtractDraftGuidance = {
  isReady: boolean;
  messages: string[];
};

function isStringArray(value: unknown): value is string[] {
  return (
    Array.isArray(value) &&
    value.every((item: unknown): item is string => typeof item === "string")
  );
}

export function createEmptyLangExtractAttribute(): DraftLangExtractAttribute {
  return {
    key: "",
    value: "",
    value_kind: "string",
  };
}

export function createEmptyLangExtractExtraction(): DraftLangExtractExtraction {
  return {
    extraction_class: "",
    extraction_text: "",
    attributes: [],
  };
}

export function createEmptyLangExtractExample(): DraftLangExtractExample {
  return {
    text: "",
    extractions: [createEmptyLangExtractExtraction()],
  };
}

export function buildDraftLangExtractExamples(
  config?: LangExtractConfigShape,
): DraftLangExtractExample[] {
  return (config?.examples ?? []).map((example) => ({
    text: example.text,
    extractions: example.extractions.map((extraction) => ({
      extraction_class: extraction.extraction_class,
      extraction_text: extraction.extraction_text,
      attributes: Object.entries(extraction.attributes ?? {}).map(
        ([key, value]) => ({
          key,
          value: Array.isArray(value) ? value.join("\n") : value,
          value_kind: Array.isArray(value) ? "string_array" : "string",
        }),
      ),
    })),
  }));
}

export function buildDraftLangExtractExampleFromSuggestion(
  suggestion: LangExtractSuggestionShape,
): DraftLangExtractExample {
  return {
    text: suggestion.example_text,
    extractions: suggestion.extractions.map((extraction) => ({
      extraction_class: extraction.extraction_class,
      extraction_text: extraction.extraction_text,
      attributes: Object.entries(extraction.attributes ?? {}).map(
        ([key, value]) => ({
          key,
          value: Array.isArray(value) ? value.join("\n") : value,
          value_kind: Array.isArray(value) ? "string_array" : "string",
        }),
      ),
    })),
  };
}

function normalizeComparableText(value: string): string {
  return value.replace(/\r\n/g, "\n").trim();
}

function buildComparableDraftAttributes(
  attributes: DraftLangExtractAttribute[],
): Record<string, string | string[]> | null {
  const entries: Array<[string, string | string[]]> = [];
  for (const attribute of attributes) {
    const key = attribute.key.trim();
    if (!key) {
      return null;
    }
    if (attribute.value_kind === "string_array") {
      const values = attribute.value
        .split("\n")
        .map((value) => value.trim())
        .filter(Boolean);
      if (!values.length) {
        return null;
      }
      entries.push([key, values]);
      continue;
    }
    const value = attribute.value.trim();
    if (!value) {
      return null;
    }
    entries.push([key, value]);
  }
  return Object.fromEntries(
    [...entries].sort(([left], [right]) => left.localeCompare(right)),
  );
}

function buildComparableSuggestionAttributes(
  attributes: Record<string, string | string[]>,
): Record<string, string | string[]> {
  return Object.fromEntries(
    Object.entries(attributes ?? {})
      .map(([key, value]): [string, string | string[]] => [
        key.trim(),
        Array.isArray(value)
          ? value.map((item) => item.trim()).filter(Boolean)
          : value.trim(),
      ])
      .sort(([left], [right]) => left.localeCompare(right)),
  );
}

function buildComparableDraftExample(
  example: DraftLangExtractExample,
): ComparableLangExtractExample | null {
  const text = normalizeComparableText(example.text);
  if (!text || !example.extractions.length) {
    return null;
  }
  const extractions: ComparableLangExtractExtraction[] = [];
  for (const extraction of example.extractions) {
    const extractionClass = extraction.extraction_class.trim();
    const extractionText = extraction.extraction_text.trim();
    const attributes = buildComparableDraftAttributes(extraction.attributes);
    if (!extractionClass || !extractionText || attributes == null) {
      return null;
    }
    extractions.push({
      extraction_class: extractionClass,
      extraction_text: extractionText,
      attributes,
    });
  }
  return { text, extractions };
}

function buildComparableSuggestion(
  suggestion: LangExtractSuggestionShape,
): ComparableLangExtractExample {
  return {
    text: normalizeComparableText(suggestion.example_text),
    extractions: suggestion.extractions.map((extraction) => ({
      extraction_class: extraction.extraction_class.trim(),
      extraction_text: extraction.extraction_text.trim(),
      attributes: buildComparableSuggestionAttributes(
        extraction.attributes ?? {},
      ),
    })),
  };
}

export function doesDraftLangExtractExampleMatchSuggestion(
  example: DraftLangExtractExample,
  suggestion: LangExtractSuggestionShape,
): boolean {
  const comparableExample = buildComparableDraftExample(example);
  if (comparableExample == null) {
    return false;
  }
  return (
    JSON.stringify(comparableExample) ===
    JSON.stringify(buildComparableSuggestion(suggestion))
  );
}

export function getAppliedLangExtractSuggestionKeys(
  examples: DraftLangExtractExample[],
  suggestions: Array<LangExtractSuggestionShape & { key: string }>,
): string[] {
  return suggestions
    .filter((suggestion) =>
      examples.some((example) =>
        doesDraftLangExtractExampleMatchSuggestion(example, suggestion),
      ),
    )
    .map((suggestion) => suggestion.key);
}

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function validateLangExtractAttributes(
  value: unknown,
  exampleIndex: number,
  extractionIndex: number,
): asserts value is Record<string, string | string[]> {
  if (value === undefined) {
    return;
  }
  if (!isObjectRecord(value)) {
    throw new Error(
      `LangExtract examples[${exampleIndex + 1}].extractions[${
        extractionIndex + 1
      }].attributes must be an object.`,
    );
  }
  for (const [attributeName, attributeValue] of Object.entries(value)) {
    if (typeof attributeValue === "string") {
      continue;
    }
    if (isStringArray(attributeValue)) {
      continue;
    }
    throw new Error(
      `LangExtract examples[${exampleIndex + 1}].extractions[${
        extractionIndex + 1
      }].attributes.${attributeName} must be a string or string array.`,
    );
  }
}

type LangExtractProviderSettings = {
  provider_type?: string;
  api_style?: string;
};

type LangExtractTemplateDefinition = {
  extracted_fields: Array<{ name: string; required?: boolean }>;
  langextract_config?: {
    prompt_description?: string;
    examples?: Array<{
      extractions: Array<{
        extraction_class: string;
      }>;
    }>;
  } | null;
  llm_provider_settings?: LangExtractProviderSettings;
};

function isLangExtractProviderSettings(
  settings?: LangExtractProviderSettings | null,
): boolean {
  return (
    settings?.provider_type === "langextract" &&
    settings.api_style === "langextract"
  );
}

export function getLangExtractExtractionReadiness(
  definition: LangExtractTemplateDefinition,
  providerOverride?: LangExtractProviderSettings | null,
): { ready: boolean; message: string | null } {
  const settings = providerOverride ?? definition.llm_provider_settings;
  if (!isLangExtractProviderSettings(settings)) {
    return { ready: true, message: null };
  }

  const config = definition.langextract_config;
  if (!config?.examples?.length) {
    return {
      ready: false,
      message:
        "Add LangExtract examples in the schema builder before running extraction.",
    };
  }

  const validFieldNames = definition.extracted_fields.map(
    (field) => field.name,
  );
  const requiredFieldNames = definition.extracted_fields
    .filter((field) => field.required)
    .map((field) => field.name);
  const coverage = getLangExtractFieldCoverage(
    config.examples,
    validFieldNames,
    requiredFieldNames,
  );
  if (coverage.missingRequiredFields.length) {
    return {
      ready: false,
      message: `LangExtract examples must cover every required field. Missing: ${coverage.missingRequiredFields.join(", ")}.`,
    };
  }

  if (!config.prompt_description?.trim()) {
    return {
      ready: false,
      message:
        "Add a LangExtract prompt description in the schema builder before running extraction.",
    };
  }

  return { ready: true, message: null };
}

export function getLangExtractFieldCoverage(
  examples: Array<{
    extractions: Array<{
      extraction_class: string;
    }>;
  }>,
  validFieldNames: string[] = [],
  requiredFieldNames: string[] = [],
) {
  const validFieldSet = new Set(
    validFieldNames.map((fieldName) => fieldName.trim()).filter(Boolean),
  );
  const requiredFields = requiredFieldNames
    .map((fieldName) => fieldName.trim())
    .filter(Boolean);
  const coveredFieldSet = new Set<string>();

  for (const example of examples) {
    for (const extraction of example.extractions) {
      const extractionClass = extraction.extraction_class.trim();
      if (!extractionClass) {
        continue;
      }
      if (validFieldSet.size > 0 && !validFieldSet.has(extractionClass)) {
        continue;
      }
      coveredFieldSet.add(extractionClass);
    }
  }

  return {
    coveredFields: validFieldNames.filter((fieldName) =>
      coveredFieldSet.has(fieldName),
    ),
    coveredRequiredFields: requiredFields.filter((fieldName) =>
      coveredFieldSet.has(fieldName),
    ),
    missingRequiredFields: requiredFields.filter(
      (fieldName) => !coveredFieldSet.has(fieldName),
    ),
  };
}

function isDraftAttributeComplete(
  attribute: DraftLangExtractAttribute,
): boolean {
  if (!attribute.key.trim()) {
    return false;
  }
  if (attribute.value_kind === "string_array") {
    return attribute.value.split("\n").some((value) => value.trim());
  }
  return Boolean(attribute.value.trim());
}

function isDraftExtractionComplete(
  extraction: DraftLangExtractExtraction,
): boolean {
  return (
    Boolean(extraction.extraction_class.trim()) &&
    Boolean(extraction.extraction_text.trim()) &&
    extraction.attributes.every(isDraftAttributeComplete)
  );
}

function isDraftExampleComplete(example: DraftLangExtractExample): boolean {
  return (
    Boolean(example.text.trim()) &&
    example.extractions.length > 0 &&
    example.extractions.every(isDraftExtractionComplete)
  );
}

export function getLangExtractDraftGuidance(
  draft: LangExtractDraftShape,
  validFieldNames: string[] = [],
  requiredFieldNames: string[] = [],
): LangExtractDraftGuidance {
  const promptDescription = draft.langextract_prompt_description.trim();
  const completeExamples = draft.langextract_examples.filter(
    isDraftExampleComplete,
  );
  const incompleteExampleCount =
    draft.langextract_examples.length - completeExamples.length;
  const coverage = getLangExtractFieldCoverage(
    completeExamples,
    validFieldNames,
    requiredFieldNames,
  );
  const messages: string[] = [];

  if (!promptDescription) {
    messages.push(
      "Add a prompt that names the target facts, grounding expectations, and when ambiguous matches should stay review-required.",
    );
  } else if (promptDescription.length < 80) {
    messages.push(
      "Strengthen the prompt with edge cases or review guidance so the extraction rules are more specific than the field labels alone.",
    );
  }

  if (!completeExamples.length) {
    messages.push(
      "Finish at least one complete grounded example before saving this draft.",
    );
  } else if (completeExamples.length === 1) {
    messages.push(
      "Add a second complete example with different wording or layout so LangExtract does not overfit a single document pattern.",
    );
  }

  if (incompleteExampleCount > 0) {
    messages.push(
      `${incompleteExampleCount} example draft${incompleteExampleCount === 1 ? "" : "s"} still need complete source text, field names, spans, or attribute values.`,
    );
  }

  if (coverage.missingRequiredFields.length) {
    messages.push(
      `Cover the remaining required fields in complete examples: ${coverage.missingRequiredFields.join(
        ", ",
      )}.`,
    );
  }

  if (!messages.length) {
    messages.push(
      "This draft has a usable prompt, multiple complete examples, and required field coverage. Next, vary layouts and phrasing before shipping.",
    );
  }

  return {
    isReady: messages.length === 1,
    messages,
  };
}

export function buildLangExtractExamples(
  examples: DraftLangExtractExample[],
  validFieldNames: string[] = [],
  requiredFieldNames: string[] = [],
) {
  const knownFields = new Set(
    validFieldNames.map((fieldName) => fieldName.trim()).filter(Boolean),
  );
  const parsedExamples = examples.map((example, exampleIndex) => {
    const text = example.text.trim();
    if (!text) {
      throw new Error(
        `LangExtract example ${exampleIndex + 1} needs source text.`,
      );
    }
    if (!example.extractions.length) {
      throw new Error(
        `LangExtract example ${exampleIndex + 1} needs at least one extraction.`,
      );
    }

    return {
      text,
      extractions: example.extractions.map((extraction, extractionIndex) => {
        const extractionClass = extraction.extraction_class.trim();
        const extractionText = extraction.extraction_text.trim();
        if (!extractionClass) {
          throw new Error(
            `LangExtract example ${exampleIndex + 1} extraction ${
              extractionIndex + 1
            } needs a field name.`,
          );
        }
        if (knownFields.size > 0 && !knownFields.has(extractionClass)) {
          throw new Error(
            `LangExtract example ${exampleIndex + 1} extraction ${
              extractionIndex + 1
            } references unknown field "${extractionClass}". Available fields: ${[
              ...knownFields,
            ].join(", ")}.`,
          );
        }
        if (!extractionText) {
          throw new Error(
            `LangExtract example ${exampleIndex + 1} extraction ${
              extractionIndex + 1
            } needs source text.`,
          );
        }

        const attributes: Record<string, string | string[]> =
          Object.fromEntries(
            extraction.attributes.map((attribute, attributeIndex) => {
              const key = attribute.key.trim();
              if (!key) {
                throw new Error(
                  `LangExtract example ${exampleIndex + 1} extraction ${
                    extractionIndex + 1
                  } attribute ${attributeIndex + 1} needs a name.`,
                );
              }

              if (attribute.value_kind === "string_array") {
                const values = attribute.value
                  .split("\n")
                  .map((value) => value.trim())
                  .filter(Boolean);
                if (!values.length) {
                  throw new Error(
                    `LangExtract example ${exampleIndex + 1} extraction ${
                      extractionIndex + 1
                    } attribute ${attributeIndex + 1} needs at least one value.`,
                  );
                }
                return [key, values] as const;
              }

              const value = attribute.value.trim();
              if (!value) {
                throw new Error(
                  `LangExtract example ${exampleIndex + 1} extraction ${
                    extractionIndex + 1
                  } attribute ${attributeIndex + 1} needs a value.`,
                );
              }
              return [key, value] as const;
            }),
          );

        validateLangExtractAttributes(
          attributes,
          exampleIndex,
          extractionIndex,
        );
        return {
          extraction_class: extractionClass,
          extraction_text: extractionText,
          attributes,
        };
      }),
    };
  });
  const coverage = getLangExtractFieldCoverage(
    parsedExamples,
    validFieldNames,
    requiredFieldNames,
  );
  if (coverage.missingRequiredFields.length) {
    throw new Error(
      `LangExtract examples must cover every required extracted field. Missing example coverage for: ${coverage.missingRequiredFields.join(
        ", ",
      )}.`,
    );
  }
  return parsedExamples;
}

export function buildLangExtractPreview(
  draft: LangExtractDraftShape,
  validFieldNames: string[] = [],
  requiredFieldNames: string[] = [],
): {
  content: string | null;
  error: string | null;
} {
  const promptDescription = draft.langextract_prompt_description.trim();
  try {
    const examples = buildLangExtractExamples(
      draft.langextract_examples,
      validFieldNames,
      requiredFieldNames,
    );
    if (!promptDescription && !examples.length) {
      return { content: null, error: null };
    }
    return {
      content: JSON.stringify(
        {
          prompt_description: promptDescription,
          examples,
        },
        null,
        2,
      ),
      error: null,
    };
  } catch (error) {
    return {
      content: null,
      error:
        error instanceof Error
          ? error.message
          : "Preview unavailable until the LangExtract draft is valid.",
    };
  }
}
