import { useEffect, useState, type Dispatch, type SetStateAction } from "react";

import {
  buildLangExtractPreview,
  createEmptyLangExtractAttribute,
  createEmptyLangExtractExample,
  createEmptyLangExtractExtraction,
  getLangExtractDraftGuidance,
  getLangExtractFieldCoverage,
  type DraftLangExtractAttribute,
  type DraftLangExtractExample,
  type DraftLangExtractExtraction,
} from "./langextract";
import { Badge } from "./components/ui/Badge";
import { Button } from "./components/ui/Button";
import { Checklist } from "./components/ui/Checklist";
import { FormGrid } from "./components/ui/FormGrid";
import { InlineGroup } from "./components/ui/InlineGroup";
import { MetricLabel } from "./components/ui/MetricLabel";
import { PanelCard } from "./components/ui/PanelCard";
import { SectionHeader, SectionStack } from "./components/ui/SectionLayout";
import { SectionTitle } from "./components/ui/SectionTitle";
import { SupportingText } from "./components/ui/SupportingText";
import { cn } from "./lib/cn";

export type LangExtractDraftState = {
  langextract_prompt_description: string;
  langextract_examples: DraftLangExtractExample[];
};

export type LangExtractFeedbackSuggestion = {
  key: string;
  template_version_id: number;
  example_text: string;
  extractions: Array<{
    extraction_class: string;
    extraction_text: string;
    attributes: Record<string, string | string[]>;
  }>;
  occurrence_count: number;
  source_result_ids: number[];
  source_field_names: string[];
  last_reviewed_at?: string | null;
};

export type LangExtractFeedbackDiagnostics = {
  reviewed_result_count: number;
  reviewed_edit_count: number;
  generated_suggestion_count: number;
  dismissed_suggestion_count: number;
  visible_suggestion_count: number;
  skipped_missing_document_text: number;
  skipped_missing_target_field: number;
  skipped_missing_grounding: number;
  skipped_span_override: number;
  skipped_span_mismatch: number;
  skipped_empty_context: number;
  skipped_no_contextual_extractions: number;
};

type LangExtractEditorProps<T extends LangExtractDraftState> = {
  draft: T;
  setDraft: Dispatch<SetStateAction<T>>;
  validFieldNames: string[];
  requiredFieldNames: string[];
  feedbackSuggestions: LangExtractFeedbackSuggestion[];
  feedbackDiagnostics: LangExtractFeedbackDiagnostics;
  feedbackStatus: "idle" | "loading" | "ready" | "error";
  appliedSuggestionKeys: string[];
  dismissedSuggestionKeys: string[];
  onApplySuggestion: (suggestion: LangExtractFeedbackSuggestion) => void;
  onDismissSuggestion: (suggestionKey: string) => Promise<void> | void;
  onSaveSchema: () => void;
  saveBusy: boolean;
  sourceVersionLabel: string;
};

type FocusTarget =
  | { kind: "example-source"; exampleIndex: number }
  | { kind: "extraction-field"; exampleIndex: number; extractionIndex: number }
  | {
      kind: "attribute-name";
      exampleIndex: number;
      extractionIndex: number;
      attributeIndex: number;
    }
  | { kind: "add-attribute"; exampleIndex: number; extractionIndex: number }
  | {
      kind: "feedback-dismiss";
      suggestionPosition: number;
      expectedVisibleCount: number;
    };

function focusByDataId(dataFocusId: string) {
  const target = document.querySelector<HTMLElement>(
    `[data-focus-id="${dataFocusId}"]`,
  );
  if (!target) {
    return false;
  }

  target.focus();
  return true;
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

export function LangExtractEditor<T extends LangExtractDraftState>({
  draft,
  setDraft,
  validFieldNames,
  requiredFieldNames,
  feedbackSuggestions,
  feedbackDiagnostics,
  feedbackStatus,
  appliedSuggestionKeys,
  dismissedSuggestionKeys,
  onApplySuggestion,
  onDismissSuggestion,
  onSaveSchema,
  saveBusy,
  sourceVersionLabel,
}: LangExtractEditorProps<T>) {
  const introHeadingId = "langextract-training-heading";
  const statusHeadingId = "langextract-status-heading";
  const promptHeadingId = "langextract-prompt-heading";
  const coverageHeadingId = "langextract-coverage-heading";
  const guidanceHeadingId = "langextract-guidance-heading";
  const examplesHeadingId = "langextract-examples-heading";
  const feedbackHeadingId = "langextract-feedback-heading";
  const previewHeadingId = "langextract-preview-heading";
  const preview = buildLangExtractPreview(
    draft,
    validFieldNames,
    requiredFieldNames,
  );
  const coverage = getLangExtractFieldCoverage(
    draft.langextract_examples,
    validFieldNames,
    requiredFieldNames,
  );
  const qualityGuidance = getLangExtractDraftGuidance(
    draft,
    validFieldNames,
    requiredFieldNames,
  );
  const visibleSuggestions = feedbackSuggestions.filter(
    (suggestion) => !dismissedSuggestionKeys.includes(suggestion.key),
  );
  const actionableSuggestions = visibleSuggestions.filter(
    (suggestion) => !appliedSuggestionKeys.includes(suggestion.key),
  );
  const hasExamples = draft.langextract_examples.length > 0;
  const completeExampleCount = draft.langextract_examples.filter(
    isDraftExampleComplete,
  ).length;
  const blockingMessages = preview.error ? [preview.error] : [];
  const [pendingFocus, setPendingFocus] = useState<FocusTarget | null>(null);
  const feedbackIssues = [
    {
      count: feedbackDiagnostics.skipped_missing_document_text,
      label: "reviewed edits skipped because parsed text was unavailable",
    },
    {
      count: feedbackDiagnostics.skipped_span_mismatch,
      label:
        "reviewed edits skipped because stored spans no longer matched the document text",
    },
    {
      count: feedbackDiagnostics.skipped_span_override,
      label:
        "reviewed edits skipped because the reviewer changed the grounded span itself",
    },
    {
      count: feedbackDiagnostics.skipped_missing_grounding,
      label:
        "reviewed edits skipped because the original result was not safely grounded",
    },
    {
      count: feedbackDiagnostics.skipped_missing_target_field,
      label:
        "reviewed edits skipped because the target field was missing from the saved result",
    },
    {
      count: feedbackDiagnostics.skipped_empty_context,
      label:
        "reviewed edits skipped because no reusable context window could be built",
    },
    {
      count: feedbackDiagnostics.skipped_no_contextual_extractions,
      label:
        "reviewed edits skipped because the context window did not contain reusable grounded extractions",
    },
  ].filter((issue) => issue.count > 0);

  useEffect(() => {
    if (!pendingFocus) {
      return;
    }

    let focused = false;

    switch (pendingFocus.kind) {
      case "example-source":
        focused = focusByDataId(
          `langextract-example-${pendingFocus.exampleIndex + 1}-source`,
        );
        break;
      case "extraction-field":
        focused = focusByDataId(
          `langextract-example-${pendingFocus.exampleIndex + 1}-extraction-${pendingFocus.extractionIndex + 1}-field`,
        );
        break;
      case "attribute-name":
        focused = focusByDataId(
          `langextract-example-${pendingFocus.exampleIndex + 1}-extraction-${pendingFocus.extractionIndex + 1}-attribute-${pendingFocus.attributeIndex + 1}-name`,
        );
        break;
      case "add-attribute":
        focused = focusByDataId(
          `langextract-example-${pendingFocus.exampleIndex + 1}-extraction-${pendingFocus.extractionIndex + 1}-add-attribute`,
        );
        break;
      case "feedback-dismiss":
        if (visibleSuggestions.length > pendingFocus.expectedVisibleCount) {
          return;
        }
        focused =
          focusByDataId(
            `langextract-feedback-dismiss-${pendingFocus.suggestionPosition}`,
          ) ||
          focusByDataId(
            `langextract-feedback-dismiss-${pendingFocus.suggestionPosition - 1}`,
          ) ||
          focusByDataId("langextract-feedback-add-all") ||
          focusByDataId("langextract-feedback-heading");
        break;
    }

    if (focused) {
      setPendingFocus(null);
    }
  }, [draft.langextract_examples, pendingFocus, visibleSuggestions.length]);

  function updateExample(
    exampleIndex: number,
    updater: (example: DraftLangExtractExample) => DraftLangExtractExample,
  ) {
    setDraft((current) => ({
      ...current,
      langextract_examples: current.langextract_examples.map(
        (example, index) =>
          index === exampleIndex ? updater(example) : example,
      ),
    }));
  }

  function updateExtraction(
    exampleIndex: number,
    extractionIndex: number,
    updater: (
      extraction: DraftLangExtractExtraction,
    ) => DraftLangExtractExtraction,
  ) {
    updateExample(exampleIndex, (example) => ({
      ...example,
      extractions: example.extractions.map((extraction, index) =>
        index === extractionIndex ? updater(extraction) : extraction,
      ),
    }));
  }

  function updateAttribute(
    exampleIndex: number,
    extractionIndex: number,
    attributeIndex: number,
    updater: (
      attribute: DraftLangExtractAttribute,
    ) => DraftLangExtractAttribute,
  ) {
    updateExtraction(exampleIndex, extractionIndex, (extraction) => ({
      ...extraction,
      attributes: extraction.attributes.map((attribute, index) =>
        index === attributeIndex ? updater(attribute) : attribute,
      ),
    }));
  }

  return (
    <div className="col-span-full grid gap-[0.9rem]">
      <section
        className="flex flex-wrap items-start justify-between gap-4 pt-[0.2rem] pb-[0.1rem]"
        aria-labelledby={introHeadingId}
      >
        <div className="grid gap-[0.75rem]">
          <MetricLabel>Grounded schema examples</MetricLabel>
          <SectionTitle id={introHeadingId}>
            Teach this schema with the smallest set of reliable examples.
          </SectionTitle>
          <SupportingText>
            Start with grounded examples that prove the field behavior you want.
            Then promote reviewed suggestions only when they clearly improve the
            next saved version.
          </SupportingText>
        </div>
        <div className="grid gap-[0.75rem] justify-items-end max-[820px]:justify-items-stretch">
          <Badge tone="indigo">
            {completeExampleCount} complete example
            {completeExampleCount === 1 ? "" : "s"}
          </Badge>
          {actionableSuggestions.length ? (
            <Badge tone="indigo">
              {actionableSuggestions.length} reviewed suggestion
              {actionableSuggestions.length === 1 ? "" : "s"} ready
            </Badge>
          ) : null}
        </div>
      </section>

      <div className="grid items-start gap-4 [grid-template-columns:minmax(0,1.45fr)_minmax(280px,0.85fr)] max-[820px]:grid-cols-1">
        <div className="grid gap-[0.95rem]">
          <PanelCard
            as="section"
            tone="soft"
            spacing="cozy"
            aria-labelledby={promptHeadingId}
          >
            <SectionTitle id={promptHeadingId}>Extraction goal</SectionTitle>
            <label className="col-span-full">
              <span>What should LangExtract return?</span>
              <textarea
                aria-label="LangExtract prompt"
                rows={5}
                value={draft.langextract_prompt_description}
                placeholder="Describe the facts to find, the grounded evidence that matters, and when uncertain matches should stay review-required."
                onChange={(event) =>
                  setDraft((current) => ({
                    ...current,
                    langextract_prompt_description: event.target.value,
                  }))
                }
              />
            </label>
          </PanelCard>

          <SectionStack aria-labelledby={examplesHeadingId}>
            <SectionHeader>
              <div>
                <MetricLabel>Examples</MetricLabel>
                <SectionTitle id={examplesHeadingId} className="mt-[0.35rem]">
                  Grounded example set
                </SectionTitle>
                <SupportingText>
                  Paste a representative excerpt, choose the schema fields it
                  proves, and capture only the grounded spans LangExtract should
                  learn from.
                </SupportingText>
              </div>
              <InlineGroup spacing="relaxed">
                <Button
                  variant="secondary"
                  onClick={() => {
                    setPendingFocus({
                      kind: "example-source",
                      exampleIndex: draft.langextract_examples.length,
                    });
                    setDraft((current) => ({
                      ...current,
                      langextract_examples: [
                        ...current.langextract_examples,
                        createEmptyLangExtractExample(),
                      ],
                    }));
                  }}
                >
                  Add example
                </Button>
              </InlineGroup>
            </SectionHeader>
            <div className="grid gap-[0.9rem]">
              {hasExamples ? (
                draft.langextract_examples.map((example, exampleIndex) => (
                  <PanelCard
                    as="section"
                    key={`langextract-example-${exampleIndex}`}
                    spacing="spacious"
                    tone="plain"
                    data-testid={`langextract-example-${exampleIndex + 1}`}
                    aria-labelledby={`langextract-example-title-${exampleIndex + 1}`}
                  >
                    <SectionHeader className="gap-4">
                      <div>
                        <SectionTitle
                          id={`langextract-example-title-${exampleIndex + 1}`}
                          as="h4"
                        >
                          Example {exampleIndex + 1}
                        </SectionTitle>
                        <SupportingText>
                          {isDraftExampleComplete(example)
                            ? "Ready to save."
                            : "Still needs source text, grounded spans, or attribute values."}
                        </SupportingText>
                      </div>
                      <Button
                        variant="danger"
                        onClick={() => {
                          setPendingFocus({
                            kind: "example-source",
                            exampleIndex:
                              exampleIndex <
                              draft.langextract_examples.length - 1
                                ? exampleIndex
                                : exampleIndex - 1,
                          });
                          setDraft((current) => ({
                            ...current,
                            langextract_examples:
                              current.langextract_examples.filter(
                                (_, index) => index !== exampleIndex,
                              ),
                          }));
                        }}
                        disabled={draft.langextract_examples.length === 1}
                        aria-label={`Remove example ${exampleIndex + 1}`}
                      >
                        Remove example
                      </Button>
                    </SectionHeader>
                    <label className="col-span-full">
                      <span>Source text</span>
                      <textarea
                        aria-label={`LangExtract example ${exampleIndex + 1} source text`}
                        data-focus-id={`langextract-example-${exampleIndex + 1}-source`}
                        rows={4}
                        value={example.text}
                        placeholder="Paste the exact excerpt you want the schema to learn from."
                        onChange={(event) =>
                          updateExample(exampleIndex, (current) => ({
                            ...current,
                            text: event.target.value,
                          }))
                        }
                      />
                    </label>
                    <div className="mt-[0.95rem] grid gap-[0.9rem]">
                      {example.extractions.map(
                        (extraction, extractionIndex) => (
                          <div
                            key={`langextract-example-${exampleIndex}-extraction-${extractionIndex}`}
                            className={cn(
                              "grid gap-[0.85rem]",
                              extractionIndex > 0 &&
                                "border-t border-[rgba(122,138,179,0.16)] pt-4",
                            )}
                            data-testid={`langextract-example-${exampleIndex + 1}-extraction-${extractionIndex + 1}`}
                            role="group"
                            aria-labelledby={`langextract-example-${exampleIndex + 1}-extraction-title-${extractionIndex + 1}`}
                          >
                            <SectionHeader className="gap-4">
                              <div>
                                <SectionTitle
                                  id={`langextract-example-${exampleIndex + 1}-extraction-title-${extractionIndex + 1}`}
                                  as="h5"
                                >
                                  Extraction {extractionIndex + 1}
                                </SectionTitle>
                                <SupportingText>
                                  Choose the saved field and the grounded span
                                  that proves it.
                                </SupportingText>
                              </div>
                              <Button
                                variant="danger"
                                onClick={() => {
                                  setPendingFocus({
                                    kind: "extraction-field",
                                    exampleIndex,
                                    extractionIndex:
                                      extractionIndex <
                                      example.extractions.length - 1
                                        ? extractionIndex
                                        : extractionIndex - 1,
                                  });
                                  updateExample(exampleIndex, (current) => ({
                                    ...current,
                                    extractions: current.extractions.filter(
                                      (_, index) => index !== extractionIndex,
                                    ),
                                  }));
                                }}
                                disabled={example.extractions.length === 1}
                                aria-label={`Remove extraction ${extractionIndex + 1} from example ${exampleIndex + 1}`}
                              >
                                Remove extraction
                              </Button>
                            </SectionHeader>
                            <FormGrid>
                              <label>
                                <span>Field</span>
                                {validFieldNames.length ? (
                                  <select
                                    aria-label={`Example ${exampleIndex + 1} extraction ${extractionIndex + 1} field name`}
                                    data-focus-id={`langextract-example-${exampleIndex + 1}-extraction-${extractionIndex + 1}-field`}
                                    value={extraction.extraction_class}
                                    onChange={(event) =>
                                      updateExtraction(
                                        exampleIndex,
                                        extractionIndex,
                                        (current) => ({
                                          ...current,
                                          extraction_class: event.target.value,
                                        }),
                                      )
                                    }
                                  >
                                    <option value="">
                                      Select extracted field
                                    </option>
                                    {validFieldNames.map((fieldName) => (
                                      <option key={fieldName} value={fieldName}>
                                        {fieldName}
                                      </option>
                                    ))}
                                  </select>
                                ) : (
                                  <input
                                    aria-label={`Example ${exampleIndex + 1} extraction ${extractionIndex + 1} field name`}
                                    data-focus-id={`langextract-example-${exampleIndex + 1}-extraction-${extractionIndex + 1}-field`}
                                    value={extraction.extraction_class}
                                    placeholder="primary_subject"
                                    onChange={(event) =>
                                      updateExtraction(
                                        exampleIndex,
                                        extractionIndex,
                                        (current) => ({
                                          ...current,
                                          extraction_class: event.target.value,
                                        }),
                                      )
                                    }
                                  />
                                )}
                              </label>
                              <label>
                                <span>Grounded span</span>
                                <input
                                  aria-label={`Example ${exampleIndex + 1} extraction ${extractionIndex + 1} source span`}
                                  value={extraction.extraction_text}
                                  placeholder="Acme Corp"
                                  onChange={(event) =>
                                    updateExtraction(
                                      exampleIndex,
                                      extractionIndex,
                                      (current) => ({
                                        ...current,
                                        extraction_text: event.target.value,
                                      }),
                                    )
                                  }
                                />
                              </label>
                            </FormGrid>
                            <div className="grid gap-[0.9rem]">
                              {extraction.attributes.map(
                                (attribute, attributeIndex) => (
                                  <div
                                    key={`langextract-example-${exampleIndex}-extraction-${extractionIndex}-attribute-${attributeIndex}`}
                                    className={cn(
                                      "grid items-start gap-[0.75rem] [grid-template-columns:minmax(0,1fr)_minmax(140px,180px)_auto] max-[820px]:grid-cols-1",
                                      attributeIndex === 0
                                        ? "pt-0"
                                        : "border-t border-[rgba(122,138,179,0.12)] pt-[0.8rem]",
                                    )}
                                  >
                                    <label>
                                      <span>Attribute</span>
                                      <input
                                        aria-label={`Example ${exampleIndex + 1} extraction ${extractionIndex + 1} attribute ${attributeIndex + 1} name`}
                                        data-focus-id={`langextract-example-${exampleIndex + 1}-extraction-${extractionIndex + 1}-attribute-${attributeIndex + 1}-name`}
                                        value={attribute.key}
                                        placeholder="value"
                                        onChange={(event) =>
                                          updateAttribute(
                                            exampleIndex,
                                            extractionIndex,
                                            attributeIndex,
                                            (current) => ({
                                              ...current,
                                              key: event.target.value,
                                            }),
                                          )
                                        }
                                      />
                                    </label>
                                    <label>
                                      <span>Type</span>
                                      <select
                                        aria-label={`Example ${exampleIndex + 1} extraction ${extractionIndex + 1} attribute ${attributeIndex + 1} type`}
                                        value={attribute.value_kind}
                                        onChange={(event) =>
                                          updateAttribute(
                                            exampleIndex,
                                            extractionIndex,
                                            attributeIndex,
                                            (current) => ({
                                              ...current,
                                              value_kind: event.target
                                                .value as DraftLangExtractAttribute["value_kind"],
                                            }),
                                          )
                                        }
                                      >
                                        <option value="string">
                                          Single value
                                        </option>
                                        <option value="string_array">
                                          List
                                        </option>
                                      </select>
                                    </label>
                                    <label className="col-span-full">
                                      <span>
                                        {attribute.value_kind === "string_array"
                                          ? "Values (one per line)"
                                          : "Value"}
                                      </span>
                                      <textarea
                                        aria-label={`Example ${exampleIndex + 1} extraction ${extractionIndex + 1} attribute ${attributeIndex + 1} value`}
                                        rows={
                                          attribute.value_kind ===
                                          "string_array"
                                            ? 3
                                            : 2
                                        }
                                        value={attribute.value}
                                        placeholder={
                                          attribute.value_kind ===
                                          "string_array"
                                            ? "line one\nline two"
                                            : "Acme Corp"
                                        }
                                        onChange={(event) =>
                                          updateAttribute(
                                            exampleIndex,
                                            extractionIndex,
                                            attributeIndex,
                                            (current) => ({
                                              ...current,
                                              value: event.target.value,
                                            }),
                                          )
                                        }
                                      />
                                    </label>
                                    <Button
                                      variant="danger"
                                      onClick={() => {
                                        setPendingFocus(
                                          extraction.attributes.length > 1
                                            ? {
                                                kind: "attribute-name",
                                                exampleIndex,
                                                extractionIndex,
                                                attributeIndex:
                                                  attributeIndex <
                                                  extraction.attributes.length -
                                                    1
                                                    ? attributeIndex
                                                    : attributeIndex - 1,
                                              }
                                            : {
                                                kind: "add-attribute",
                                                exampleIndex,
                                                extractionIndex,
                                              },
                                        );
                                        updateExtraction(
                                          exampleIndex,
                                          extractionIndex,
                                          (current) => ({
                                            ...current,
                                            attributes:
                                              current.attributes.filter(
                                                (_, index) =>
                                                  index !== attributeIndex,
                                              ),
                                          }),
                                        );
                                      }}
                                      aria-label={`Remove attribute ${attributeIndex + 1} from extraction ${extractionIndex + 1} in example ${exampleIndex + 1}`}
                                    >
                                      Remove attribute
                                    </Button>
                                  </div>
                                ),
                              )}
                              <Button
                                variant="secondary"
                                onClick={() => {
                                  setPendingFocus({
                                    kind: "attribute-name",
                                    exampleIndex,
                                    extractionIndex,
                                    attributeIndex:
                                      extraction.attributes.length,
                                  });
                                  updateExtraction(
                                    exampleIndex,
                                    extractionIndex,
                                    (current) => ({
                                      ...current,
                                      attributes: [
                                        ...current.attributes,
                                        createEmptyLangExtractAttribute(),
                                      ],
                                    }),
                                  );
                                }}
                                aria-label={`Add attribute to extraction ${extractionIndex + 1} in example ${exampleIndex + 1}`}
                                data-focus-id={`langextract-example-${exampleIndex + 1}-extraction-${extractionIndex + 1}-add-attribute`}
                              >
                                Add attribute
                              </Button>
                            </div>
                          </div>
                        ),
                      )}
                    </div>
                    <Button
                      variant="secondary"
                      onClick={() => {
                        setPendingFocus({
                          kind: "extraction-field",
                          exampleIndex,
                          extractionIndex: example.extractions.length,
                        });
                        updateExample(exampleIndex, (current) => ({
                          ...current,
                          extractions: [
                            ...current.extractions,
                            createEmptyLangExtractExtraction(),
                          ],
                        }));
                      }}
                      aria-label={`Add extraction to example ${exampleIndex + 1}`}
                    >
                      Add extraction
                    </Button>
                  </PanelCard>
                ))
              ) : (
                <PanelCard tone="soft" spacing="cozy">
                  <strong>No grounded examples yet.</strong>
                  <SupportingText>
                    Add one reliable example before you trust reviewed
                    suggestions or save a new schema version.
                  </SupportingText>
                </PanelCard>
              )}
            </div>
          </SectionStack>

          {feedbackStatus !== "idle" || visibleSuggestions.length ? (
            <SectionStack aria-labelledby={feedbackHeadingId}>
              <SectionHeader>
                <div>
                  <MetricLabel>Reviewed run feedback</MetricLabel>
                  <SectionTitle
                    id={feedbackHeadingId}
                    tabIndex={-1}
                    data-focus-id="langextract-feedback-heading"
                    className="mt-[0.35rem]"
                  >
                    Suggestions ready to promote
                  </SectionTitle>
                  <SupportingText>
                    These came from grounded review edits. Promote them one at a
                    time when they clearly strengthen the draft you plan to save
                    next.
                  </SupportingText>
                </div>
                <InlineGroup spacing="relaxed">
                  <Badge tone="indigo">
                    {feedbackStatus === "loading"
                      ? "Loading"
                      : `${visibleSuggestions.length} suggestion${visibleSuggestions.length === 1 ? "" : "s"}`}
                  </Badge>
                </InlineGroup>
              </SectionHeader>
              {feedbackStatus === "error" ? (
                <PanelCard tone="soft" spacing="cozy">
                  <strong>Could not load reviewed suggestions.</strong>
                  <SupportingText>
                    Keep shaping the draft below. Reload reviewed feedback when
                    the schema version is reachable again.
                  </SupportingText>
                </PanelCard>
              ) : null}
              {feedbackStatus !== "error" && feedbackIssues.length ? (
                <PanelCard tone="soft" spacing="cozy">
                  <strong>Some reviewed runs were not reusable.</strong>
                  <SupportingText>
                    {feedbackDiagnostics.reviewed_edit_count} reviewed edit
                    {feedbackDiagnostics.reviewed_edit_count === 1
                      ? ""
                      : "s"}{" "}
                    were checked.{" "}
                    {feedbackDiagnostics.generated_suggestion_count} reusable
                    suggestion
                    {feedbackDiagnostics.generated_suggestion_count === 1
                      ? ""
                      : "s"}{" "}
                    were generated.
                  </SupportingText>
                  <Checklist>
                    {feedbackIssues.map((issue) => (
                      <li key={issue.label}>
                        {issue.count} {issue.label}
                      </li>
                    ))}
                  </Checklist>
                </PanelCard>
              ) : null}
              {feedbackStatus !== "error" && visibleSuggestions.length ? (
                <div className="grid gap-[0.9rem]">
                  {visibleSuggestions.map((suggestion, index) => {
                    const alreadyApplied = appliedSuggestionKeys.includes(
                      suggestion.key,
                    );
                    return (
                      <PanelCard
                        as="section"
                        key={suggestion.key}
                        spacing="roomy"
                        tone="soft"
                        data-testid={`langextract-feedback-suggestion-${index + 1}`}
                      >
                        <div className="flex flex-wrap items-start justify-between gap-4 max-[820px]:flex-col max-[820px]:items-stretch">
                          <details className="min-w-0">
                            <summary className="flex list-none items-start justify-between gap-4 cursor-pointer focus-visible:rounded-[12px] focus-visible:outline-none focus-visible:shadow-[var(--focus-ring)] max-[820px]:flex-col max-[820px]:items-stretch">
                              <span className="grid gap-[0.2rem]">
                                <strong>Suggestion {index + 1}</strong>
                                <SupportingText as="span">
                                  Fields:{" "}
                                  {suggestion.source_field_names.join(", ")}
                                </SupportingText>
                              </span>
                              <span className="flex flex-wrap justify-end gap-[0.45rem] max-[820px]:justify-start">
                                <Badge tone="indigo">
                                  Seen in {suggestion.occurrence_count} reviewed
                                  run
                                  {suggestion.occurrence_count === 1 ? "" : "s"}
                                </Badge>
                                <Badge tone="indigo">Open details</Badge>
                              </span>
                            </summary>
                            <div className="mt-[0.85rem] grid gap-[0.75rem]">
                              <pre className="mb-[0.85rem] overflow-x-auto rounded-[14px] bg-[rgba(15,23,42,0.95)] px-4 py-[0.95rem] text-[0.84rem] leading-[1.55] text-[rgba(241,245,249,0.96)]">
                                <code>{suggestion.example_text}</code>
                              </pre>
                              <Checklist>
                                {suggestion.extractions.map((extraction) => (
                                  <li
                                    key={`${suggestion.key}-${extraction.extraction_class}-${extraction.extraction_text}`}
                                  >
                                    <strong>
                                      {extraction.extraction_class}
                                    </strong>
                                    : {extraction.extraction_text}
                                  </li>
                                ))}
                              </Checklist>
                            </div>
                          </details>
                          <div className="flex flex-wrap items-center gap-[0.65rem] max-[820px]:[&>button]:w-full">
                            {alreadyApplied ? (
                              <Badge tone="success">Added to draft</Badge>
                            ) : (
                              <Button
                                variant="secondary"
                                onClick={() => {
                                  setPendingFocus({
                                    kind: "example-source",
                                    exampleIndex:
                                      draft.langextract_examples.length,
                                  });
                                  onApplySuggestion(suggestion);
                                }}
                                aria-label={`Promote suggestion ${index + 1} to the draft`}
                              >
                                Promote to draft
                              </Button>
                            )}
                            <Button
                              variant="danger"
                              onClick={() => {
                                setPendingFocus({
                                  kind: "feedback-dismiss",
                                  suggestionPosition: index + 1,
                                  expectedVisibleCount:
                                    visibleSuggestions.length - 1,
                                });
                                void onDismissSuggestion(suggestion.key);
                              }}
                              aria-label={`Dismiss suggestion ${index + 1}`}
                              data-focus-id={`langextract-feedback-dismiss-${index + 1}`}
                            >
                              Dismiss suggestion
                            </Button>
                          </div>
                        </div>
                      </PanelCard>
                    );
                  })}
                </div>
              ) : feedbackStatus !== "error" ? (
                <PanelCard tone="soft" spacing="cozy">
                  <strong>
                    {feedbackDiagnostics.reviewed_edit_count
                      ? "No reusable reviewed examples right now."
                      : "No reviewed examples yet."}
                  </strong>
                  <SupportingText>
                    {feedbackDiagnostics.dismissed_suggestion_count
                      ? "Every reusable suggestion for this schema version is currently dismissed."
                      : feedbackDiagnostics.reviewed_edit_count
                        ? "Reviewed runs exist, but none produced a reusable grounded example for this schema version."
                        : "Approve grounded review edits first. Safe suggestions appear here automatically."}
                  </SupportingText>
                </PanelCard>
              ) : null}
            </SectionStack>
          ) : null}
        </div>

        <aside className="grid gap-[0.95rem]">
          <PanelCard
            as="section"
            tone="soft"
            spacing="relaxed"
            aria-labelledby={statusHeadingId}
          >
            <MetricLabel>Draft status</MetricLabel>
            <SectionTitle id={statusHeadingId}>
              {blockingMessages.length
                ? "Fix these issues before saving"
                : "Ready for the next saved version"}
            </SectionTitle>
            <SupportingText>
              Based on schema version {sourceVersionLabel}. Save a new version
              only when this draft reflects the behavior you want future runs to
              inherit.
            </SupportingText>
            <InlineGroup>
              <Badge tone="indigo">
                {completeExampleCount} complete example
                {completeExampleCount === 1 ? "" : "s"}
              </Badge>
              {requiredFieldNames.length ? (
                <Badge tone="indigo">
                  {coverage.coveredRequiredFields.length}/
                  {requiredFieldNames.length} required fields covered
                </Badge>
              ) : null}
            </InlineGroup>
            {blockingMessages.length ? (
              <Checklist>
                {blockingMessages.map((message) => (
                  <li key={message}>{message}</li>
                ))}
              </Checklist>
            ) : (
              <SupportingText>
                No blocking payload issues are visible in this draft.
              </SupportingText>
            )}
            <Button
              variant="primary"
              onClick={onSaveSchema}
              disabled={saveBusy || blockingMessages.length > 0}
            >
              {saveBusy ? "Saving..." : "Save schema version"}
            </Button>
          </PanelCard>

          {requiredFieldNames.length ? (
            <PanelCard
              as="section"
              tone="soft"
              spacing="cozy"
              aria-labelledby={coverageHeadingId}
            >
              <MetricLabel>Required field coverage</MetricLabel>
              <SectionTitle id={coverageHeadingId}>
                {hasExamples
                  ? `${coverage.coveredRequiredFields.length} of ${requiredFieldNames.length} required fields covered`
                  : `Add examples to cover ${requiredFieldNames.length} required field${requiredFieldNames.length === 1 ? "" : "s"}`}
              </SectionTitle>
              <SupportingText role="status" aria-live="polite">
                {hasExamples
                  ? coverage.missingRequiredFields.length
                    ? `Missing required examples: ${coverage.missingRequiredFields.join(
                        ", ",
                      )}.`
                    : "Every required extracted field appears in at least one grounded example."
                  : "Coverage updates as soon as grounded examples mention each required extracted field."}
              </SupportingText>
            </PanelCard>
          ) : null}

          <PanelCard
            as="section"
            tone="soft"
            spacing="cozy"
            aria-labelledby={guidanceHeadingId}
          >
            <MetricLabel>Quality guidance</MetricLabel>
            <SectionTitle id={guidanceHeadingId}>
              {qualityGuidance.isReady
                ? "The draft structure is in good shape."
                : "Strengthen this draft before you trust it."}
            </SectionTitle>
            <Checklist>
              {qualityGuidance.messages.map((message) => (
                <li key={message}>{message}</li>
              ))}
            </Checklist>
          </PanelCard>

          <PanelCard
            as="details"
            tone="soft"
            spacing="relaxed"
            className="open:bg-[rgba(255,255,255,0.94)]"
            aria-labelledby={previewHeadingId}
          >
            <summary className="flex cursor-pointer list-none items-center justify-between gap-[0.85rem] max-[820px]:flex-col max-[820px]:items-stretch">
              <span className="grid gap-[0.2rem]">
                <MetricLabel>Advanced</MetricLabel>
                <strong id={previewHeadingId}>Saved payload preview</strong>
              </span>
              <Badge tone="indigo">langextract_config</Badge>
            </summary>
            <SupportingText>
              Open this only when you need to inspect the exact persisted
              structure for the next schema version.
            </SupportingText>
            {preview.content ? (
              <pre aria-label="LangExtract payload preview">
                <code>{preview.content}</code>
              </pre>
            ) : (
              <p
                className="mt-[0.85rem] text-[0.9rem] text-muted"
                role="status"
                aria-live="polite"
              >
                {preview.error ??
                  "Add a prompt or at least one complete example to inspect the saved payload."}
              </p>
            )}
          </PanelCard>
        </aside>
      </div>
    </div>
  );
}
