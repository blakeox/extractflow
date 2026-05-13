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
    <div className="langextract-editor full-line">
      <section
        className="langextract-editor-header"
        aria-labelledby={introHeadingId}
      >
        <div className="langextract-editor-heading">
          <span className="metric-label">Grounded schema examples</span>
          <h3 id={introHeadingId}>
            Teach this schema with the smallest set of reliable examples.
          </h3>
          <p className="langextract-editor-copy">
            Start with grounded examples that prove the field behavior you want.
            Then promote reviewed suggestions only when they clearly improve the
            next saved version.
          </p>
        </div>
        <div className="langextract-editor-header-actions">
          <span className="pill">
            {completeExampleCount} complete example
            {completeExampleCount === 1 ? "" : "s"}
          </span>
          {actionableSuggestions.length ? (
            <span className="pill">
              {actionableSuggestions.length} reviewed suggestion
              {actionableSuggestions.length === 1 ? "" : "s"} ready
            </span>
          ) : null}
        </div>
      </section>

      <div className="langextract-workspace">
        <div className="langextract-main">
          <section
            className="langextract-panel langextract-prompt-card"
            aria-labelledby={promptHeadingId}
          >
            <h3 id={promptHeadingId}>Extraction goal</h3>
            <label className="full-line">
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
          </section>

          <section
            className="langextract-section"
            aria-labelledby={examplesHeadingId}
          >
            <div className="langextract-section-header">
              <div>
                <span className="metric-label">Examples</span>
                <h3 id={examplesHeadingId}>Grounded example set</h3>
                <p className="langextract-editor-copy">
                  Paste a representative excerpt, choose the schema fields it
                  proves, and capture only the grounded spans LangExtract should
                  learn from.
                </p>
              </div>
              <div className="langextract-feedback-actions">
                <button
                  type="button"
                  className="secondary-button"
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
                </button>
              </div>
            </div>
            <div className="langextract-example-list">
              {hasExamples ? (
                draft.langextract_examples.map((example, exampleIndex) => (
                  <section
                    key={`langextract-example-${exampleIndex}`}
                    className="langextract-example-card"
                    data-testid={`langextract-example-${exampleIndex + 1}`}
                    aria-labelledby={`langextract-example-title-${exampleIndex + 1}`}
                  >
                    <div className="builder-item-topline">
                      <div>
                        <h4
                          id={`langextract-example-title-${exampleIndex + 1}`}
                        >
                          Example {exampleIndex + 1}
                        </h4>
                        <p className="langextract-editor-copy">
                          {isDraftExampleComplete(example)
                            ? "Ready to save."
                            : "Still needs source text, grounded spans, or attribute values."}
                        </p>
                      </div>
                      <button
                        type="button"
                        className="danger-button"
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
                      </button>
                    </div>
                    <label className="full-line">
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
                    <div className="langextract-extraction-list">
                      {example.extractions.map(
                        (extraction, extractionIndex) => (
                          <div
                            key={`langextract-example-${exampleIndex}-extraction-${extractionIndex}`}
                            className="langextract-extraction-block"
                            data-testid={`langextract-example-${exampleIndex + 1}-extraction-${extractionIndex + 1}`}
                            role="group"
                            aria-labelledby={`langextract-example-${exampleIndex + 1}-extraction-title-${extractionIndex + 1}`}
                          >
                            <div className="builder-item-topline">
                              <div>
                                <h5
                                  id={`langextract-example-${exampleIndex + 1}-extraction-title-${extractionIndex + 1}`}
                                >
                                  Extraction {extractionIndex + 1}
                                </h5>
                                <p className="langextract-editor-copy">
                                  Choose the saved field and the grounded span
                                  that proves it.
                                </p>
                              </div>
                              <button
                                type="button"
                                className="danger-button"
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
                              </button>
                            </div>
                            <div className="form-grid">
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
                            </div>
                            <div className="langextract-attribute-list">
                              {extraction.attributes.map(
                                (attribute, attributeIndex) => (
                                  <div
                                    key={`langextract-example-${exampleIndex}-extraction-${extractionIndex}-attribute-${attributeIndex}`}
                                    className="langextract-attribute-row"
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
                                    <label className="full-line">
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
                                    <button
                                      type="button"
                                      className="danger-button"
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
                                    </button>
                                  </div>
                                ),
                              )}
                              <button
                                type="button"
                                className="secondary-button"
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
                              </button>
                            </div>
                          </div>
                        ),
                      )}
                    </div>
                    <button
                      type="button"
                      className="secondary-button"
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
                    </button>
                  </section>
                ))
              ) : (
                <div className="langextract-panel">
                  <strong>No grounded examples yet.</strong>
                  <p className="langextract-editor-copy">
                    Add one reliable example before you trust reviewed
                    suggestions or save a new schema version.
                  </p>
                </div>
              )}
            </div>
          </section>

          {feedbackStatus !== "idle" || visibleSuggestions.length ? (
            <section
              className="langextract-section langextract-feedback-section"
              aria-labelledby={feedbackHeadingId}
            >
              <div className="langextract-section-header">
                <div>
                  <span className="metric-label">Reviewed run feedback</span>
                  <h3
                    id={feedbackHeadingId}
                    tabIndex={-1}
                    data-focus-id="langextract-feedback-heading"
                  >
                    Suggestions ready to promote
                  </h3>
                  <p className="langextract-editor-copy">
                    These came from grounded review edits. Promote them one at a
                    time when they clearly strengthen the draft you plan to save
                    next.
                  </p>
                </div>
                <div className="langextract-feedback-actions">
                  <span className="pill">
                    {feedbackStatus === "loading"
                      ? "Loading"
                      : `${visibleSuggestions.length} suggestion${visibleSuggestions.length === 1 ? "" : "s"}`}
                  </span>
                </div>
              </div>
              {feedbackStatus === "error" ? (
                <div className="langextract-panel">
                  <strong>Could not load reviewed suggestions.</strong>
                  <p className="langextract-editor-copy">
                    Keep shaping the draft below. Reload reviewed feedback when
                    the schema version is reachable again.
                  </p>
                </div>
              ) : null}
              {feedbackStatus !== "error" && feedbackIssues.length ? (
                <div className="langextract-panel">
                  <strong>Some reviewed runs were not reusable.</strong>
                  <p className="langextract-editor-copy">
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
                  </p>
                  <ul className="schema-checklist">
                    {feedbackIssues.map((issue) => (
                      <li key={issue.label}>
                        {issue.count} {issue.label}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
              {feedbackStatus !== "error" && visibleSuggestions.length ? (
                <div className="langextract-feedback-list">
                  {visibleSuggestions.map((suggestion, index) => {
                    const alreadyApplied = appliedSuggestionKeys.includes(
                      suggestion.key,
                    );
                    return (
                      <section
                        key={suggestion.key}
                        className="langextract-feedback-card"
                        data-testid={`langextract-feedback-suggestion-${index + 1}`}
                      >
                        <div className="langextract-feedback-card-header">
                          <details className="langextract-feedback-disclosure">
                            <summary className="langextract-feedback-summary">
                              <span className="langextract-feedback-summary-copy">
                                <strong>Suggestion {index + 1}</strong>
                                <span className="langextract-editor-copy">
                                  Fields:{" "}
                                  {suggestion.source_field_names.join(", ")}
                                </span>
                              </span>
                              <span className="langextract-feedback-summary-meta">
                                <span className="pill">
                                  Seen in {suggestion.occurrence_count} reviewed
                                  run
                                  {suggestion.occurrence_count === 1 ? "" : "s"}
                                </span>
                                <span className="pill">Open details</span>
                              </span>
                            </summary>
                            <div className="langextract-feedback-body">
                              <pre>
                                <code>{suggestion.example_text}</code>
                              </pre>
                              <ul className="schema-checklist">
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
                              </ul>
                            </div>
                          </details>
                          <div className="langextract-feedback-card-actions">
                            {alreadyApplied ? (
                              <span className="langextract-state-pill">
                                Added to draft
                              </span>
                            ) : (
                              <button
                                type="button"
                                className="secondary-button"
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
                              </button>
                            )}
                            <button
                              type="button"
                              className="danger-button"
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
                            </button>
                          </div>
                        </div>
                      </section>
                    );
                  })}
                </div>
              ) : feedbackStatus !== "error" ? (
                <div className="langextract-panel">
                  <strong>
                    {feedbackDiagnostics.reviewed_edit_count
                      ? "No reusable reviewed examples right now."
                      : "No reviewed examples yet."}
                  </strong>
                  <p className="langextract-editor-copy">
                    {feedbackDiagnostics.dismissed_suggestion_count
                      ? "Every reusable suggestion for this schema version is currently dismissed."
                      : feedbackDiagnostics.reviewed_edit_count
                        ? "Reviewed runs exist, but none produced a reusable grounded example for this schema version."
                        : "Approve grounded review edits first. Safe suggestions appear here automatically."}
                  </p>
                </div>
              ) : null}
            </section>
          ) : null}
        </div>

        <aside className="langextract-sidebar">
          <section
            className="langextract-panel langextract-status-card"
            aria-labelledby={statusHeadingId}
          >
            <span className="metric-label">Draft status</span>
            <h3 id={statusHeadingId}>
              {blockingMessages.length
                ? "Fix these issues before saving"
                : "Ready for the next saved version"}
            </h3>
            <p className="langextract-editor-copy">
              Based on schema version {sourceVersionLabel}. Save a new version
              only when this draft reflects the behavior you want future runs to
              inherit.
            </p>
            <div className="langextract-status-pills">
              <span className="pill">
                {completeExampleCount} complete example
                {completeExampleCount === 1 ? "" : "s"}
              </span>
              {requiredFieldNames.length ? (
                <span className="pill">
                  {coverage.coveredRequiredFields.length}/
                  {requiredFieldNames.length} required fields covered
                </span>
              ) : null}
            </div>
            {blockingMessages.length ? (
              <ul className="schema-checklist">
                {blockingMessages.map((message) => (
                  <li key={message}>{message}</li>
                ))}
              </ul>
            ) : (
              <p className="langextract-editor-copy">
                No blocking payload issues are visible in this draft.
              </p>
            )}
            <button
              type="button"
              className="primary-button"
              onClick={onSaveSchema}
              disabled={saveBusy || blockingMessages.length > 0}
            >
              {saveBusy ? "Saving..." : "Save schema version"}
            </button>
          </section>

          {requiredFieldNames.length ? (
            <section
              className="langextract-panel langextract-coverage-card"
              aria-labelledby={coverageHeadingId}
            >
              <span className="metric-label">Required field coverage</span>
              <h3 id={coverageHeadingId}>
                {hasExamples
                  ? `${coverage.coveredRequiredFields.length} of ${requiredFieldNames.length} required fields covered`
                  : `Add examples to cover ${requiredFieldNames.length} required field${requiredFieldNames.length === 1 ? "" : "s"}`}
              </h3>
              <p
                className="langextract-editor-copy"
                role="status"
                aria-live="polite"
              >
                {hasExamples
                  ? coverage.missingRequiredFields.length
                    ? `Missing required examples: ${coverage.missingRequiredFields.join(
                        ", ",
                      )}.`
                    : "Every required extracted field appears in at least one grounded example."
                  : "Coverage updates as soon as grounded examples mention each required extracted field."}
              </p>
            </section>
          ) : null}

          <section
            className="langextract-panel langextract-guidance-card"
            aria-labelledby={guidanceHeadingId}
          >
            <span className="metric-label">Quality guidance</span>
            <h3 id={guidanceHeadingId}>
              {qualityGuidance.isReady
                ? "The draft structure is in good shape."
                : "Strengthen this draft before you trust it."}
            </h3>
            <ul className="schema-checklist">
              {qualityGuidance.messages.map((message) => (
                <li key={message}>{message}</li>
              ))}
            </ul>
          </section>

          <details
            className="langextract-panel langextract-advanced-panel"
            aria-labelledby={previewHeadingId}
          >
            <summary className="langextract-advanced-summary">
              <span className="langextract-feedback-summary-copy">
                <span className="metric-label">Advanced</span>
                <strong id={previewHeadingId}>Saved payload preview</strong>
              </span>
              <span className="pill">langextract_config</span>
            </summary>
            <p className="langextract-editor-copy">
              Open this only when you need to inspect the exact persisted
              structure for the next schema version.
            </p>
            {preview.content ? (
              <pre aria-label="LangExtract payload preview">
                <code>{preview.content}</code>
              </pre>
            ) : (
              <p
                className="langextract-preview-empty"
                role="status"
                aria-live="polite"
              >
                {preview.error ??
                  "Add a prompt or at least one complete example to inspect the saved payload."}
              </p>
            )}
          </details>
        </aside>
      </div>
    </div>
  );
}
