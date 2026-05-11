import type { Dispatch, SetStateAction } from "react";

import {
  buildLangExtractPreview,
  createEmptyLangExtractAttribute,
  createEmptyLangExtractExample,
  createEmptyLangExtractExtraction,
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
  onApplyAllSuggestions: () => void;
  onDismissSuggestion: (suggestionKey: string) => Promise<void> | void;
};

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
  onApplyAllSuggestions,
  onDismissSuggestion,
}: LangExtractEditorProps<T>) {
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
  const visibleSuggestions = feedbackSuggestions.filter(
    (suggestion) => !dismissedSuggestionKeys.includes(suggestion.key),
  );
  const actionableSuggestions = visibleSuggestions.filter(
    (suggestion) => !appliedSuggestionKeys.includes(suggestion.key),
  );
  const hasExamples = draft.langextract_examples.length > 0;
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
      <div className="langextract-editor-header">
        <div className="langextract-editor-heading">
          <span className="metric-label">LangExtract training set</span>
          <strong>
            Author grounded examples before you trust reviewed reuse.
          </strong>
          <p className="langextract-editor-copy">
            Write the extraction prompt, ground it with document examples, then
            fold in reviewed suggestions only when they improve the draft.
          </p>
        </div>
        <div className="langextract-editor-header-actions">
          {visibleSuggestions.length ? (
            <span className="pill">
              {visibleSuggestions.length} reviewed suggestion
              {visibleSuggestions.length === 1 ? "" : "s"}
            </span>
          ) : null}
          <button
            type="button"
            className="secondary-button"
            onClick={() =>
              setDraft((current) => ({
                ...current,
                langextract_examples: [
                  ...current.langextract_examples,
                  createEmptyLangExtractExample(),
                ],
              }))
            }
          >
            Add example
          </button>
        </div>
      </div>

      <div className="langextract-panel langextract-prompt-card">
        <label className="full-line">
          <span>LangExtract prompt</span>
          <textarea
            rows={5}
            value={draft.langextract_prompt_description}
            placeholder="Describe exactly what LangExtract should extract and how grounded spans should behave."
            onChange={(event) =>
              setDraft((current) => ({
                ...current,
                langextract_prompt_description: event.target.value,
              }))
            }
          />
        </label>
      </div>

      {requiredFieldNames.length ? (
        <div className="langextract-panel langextract-coverage-card">
          <span className="metric-label">Required field coverage</span>
          <strong>
            {hasExamples
              ? `${coverage.coveredRequiredFields.length} of ${requiredFieldNames.length} required fields covered`
              : `Add examples to cover ${requiredFieldNames.length} required field${requiredFieldNames.length === 1 ? "" : "s"}`}
          </strong>
          <p className="langextract-editor-copy">
            {hasExamples
              ? coverage.missingRequiredFields.length
                ? `Missing required examples: ${coverage.missingRequiredFields.join(
                    ", ",
                  )}.`
                : "Every required extracted field appears in at least one LangExtract example."
              : "Coverage updates as soon as grounded examples mention each required extracted field."}
          </p>
        </div>
      ) : null}

      <div className="langextract-section">
        <div className="langextract-section-header">
          <div>
            <span className="metric-label">Examples</span>
            <p className="langextract-editor-copy">
              Show the document text, then mark the grounded spans LangExtract
              should return. This is a training set, not a JSON puzzle.
            </p>
          </div>
        </div>
        <div className="langextract-example-list">
          {hasExamples ? (
            draft.langextract_examples.map((example, exampleIndex) => (
              <section
                key={`langextract-example-${exampleIndex}`}
                className="langextract-example-card"
                data-testid={`langextract-example-${exampleIndex + 1}`}
              >
                <div className="builder-item-topline">
                  <strong>Example {exampleIndex + 1}</strong>
                  <button
                    type="button"
                    className="ghost-button"
                    onClick={() =>
                      setDraft((current) => ({
                        ...current,
                        langextract_examples:
                          current.langextract_examples.filter(
                            (_, index) => index !== exampleIndex,
                          ),
                      }))
                    }
                    disabled={draft.langextract_examples.length === 1}
                  >
                    Remove example {exampleIndex + 1}
                  </button>
                </div>
                <label className="full-line">
                  <span>Source text</span>
                  <textarea
                    aria-label={`LangExtract example ${exampleIndex + 1} source text`}
                    rows={4}
                    value={example.text}
                    placeholder="Paste the relevant document excerpt exactly as it appears."
                    onChange={(event) =>
                      updateExample(exampleIndex, (current) => ({
                        ...current,
                        text: event.target.value,
                      }))
                    }
                  />
                </label>
                <div className="langextract-extraction-list">
                  {example.extractions.map((extraction, extractionIndex) => (
                    <div
                      key={`langextract-example-${exampleIndex}-extraction-${extractionIndex}`}
                      className="langextract-extraction-block"
                      data-testid={`langextract-example-${exampleIndex + 1}-extraction-${extractionIndex + 1}`}
                    >
                      <div className="builder-item-topline">
                        <strong>Extraction {extractionIndex + 1}</strong>
                        <button
                          type="button"
                          className="ghost-button"
                          onClick={() =>
                            updateExample(exampleIndex, (current) => ({
                              ...current,
                              extractions: current.extractions.filter(
                                (_, index) => index !== extractionIndex,
                              ),
                            }))
                          }
                          disabled={example.extractions.length === 1}
                        >
                          Remove extraction {extractionIndex + 1}
                        </button>
                      </div>
                      <div className="form-grid">
                        <label>
                          <span>Field name</span>
                          <input
                            aria-label={`Example ${exampleIndex + 1} extraction ${extractionIndex + 1} field name`}
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
                                  <option value="string">Single value</option>
                                  <option value="string_array">List</option>
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
                                    attribute.value_kind === "string_array"
                                      ? 3
                                      : 2
                                  }
                                  value={attribute.value}
                                  placeholder={
                                    attribute.value_kind === "string_array"
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
                                className="ghost-button"
                                onClick={() =>
                                  updateExtraction(
                                    exampleIndex,
                                    extractionIndex,
                                    (current) => ({
                                      ...current,
                                      attributes: current.attributes.filter(
                                        (_, index) => index !== attributeIndex,
                                      ),
                                    }),
                                  )
                                }
                              >
                                Remove attribute {attributeIndex + 1}
                              </button>
                            </div>
                          ),
                        )}
                        <button
                          type="button"
                          className="secondary-button"
                          onClick={() =>
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
                            )
                          }
                        >
                          Add attribute
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
                <button
                  type="button"
                  className="secondary-button"
                  onClick={() =>
                    updateExample(exampleIndex, (current) => ({
                      ...current,
                      extractions: [
                        ...current.extractions,
                        createEmptyLangExtractExtraction(),
                      ],
                    }))
                  }
                >
                  Add extraction
                </button>
              </section>
            ))
          ) : (
            <div className="langextract-panel">
              <strong>No examples yet</strong>
              <p className="langextract-editor-copy">
                Add at least one example so LangExtract has grounded behavior to
                follow.
              </p>
            </div>
          )}
        </div>
      </div>

      {feedbackStatus !== "idle" || visibleSuggestions.length ? (
        <div className="langextract-section langextract-feedback-section">
          <div className="langextract-section-header">
            <div>
              <span className="metric-label">Reviewed run feedback</span>
              <p className="langextract-editor-copy">
                These candidate examples came from grounded review edits. Keep
                them secondary to the draft until they earn a place in the
                training set.
              </p>
            </div>
            <div className="langextract-feedback-actions">
              <span className="pill">
                {feedbackStatus === "loading"
                  ? "Loading"
                  : `${visibleSuggestions.length} suggestion${visibleSuggestions.length === 1 ? "" : "s"}`}
              </span>
              {actionableSuggestions.length ? (
                <button
                  type="button"
                  className="secondary-button"
                  onClick={onApplyAllSuggestions}
                >
                  Add all to draft
                </button>
              ) : null}
            </div>
          </div>
          {feedbackStatus === "error" ? (
            <div className="langextract-panel">
              <strong>Could not load review feedback.</strong>
              <p className="langextract-editor-copy">
                The schema editor still works, but the reviewed-example feed is
                unavailable right now.
              </p>
            </div>
          ) : null}
          {feedbackStatus !== "error" && feedbackIssues.length ? (
            <div className="langextract-panel">
              <strong>Some reviewed runs were not reusable.</strong>
              <p className="langextract-editor-copy">
                {feedbackDiagnostics.reviewed_edit_count} reviewed edit
                {feedbackDiagnostics.reviewed_edit_count === 1 ? "" : "s"} were
                checked. {feedbackDiagnostics.generated_suggestion_count}{" "}
                reusable suggestion
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
                          <div>
                            <strong>Suggestion {index + 1}</strong>
                            <p className="langextract-editor-copy">
                              Fields: {suggestion.source_field_names.join(", ")}
                            </p>
                          </div>
                          <div className="langextract-feedback-summary-meta">
                            <span className="pill">
                              Seen in {suggestion.occurrence_count} reviewed run
                              {suggestion.occurrence_count === 1 ? "" : "s"}
                            </span>
                            <span className="pill">Expand details</span>
                          </div>
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
                                <strong>{extraction.extraction_class}</strong>:{" "}
                                {extraction.extraction_text}
                              </li>
                            ))}
                          </ul>
                        </div>
                      </details>
                      <div className="langextract-feedback-card-actions">
                        <button
                          type="button"
                          className="tertiary-button"
                          onClick={() =>
                            void onDismissSuggestion(suggestion.key)
                          }
                        >
                          Dismiss
                        </button>
                        <button
                          type="button"
                          className="secondary-button"
                          onClick={() => onApplySuggestion(suggestion)}
                          disabled={alreadyApplied}
                        >
                          {alreadyApplied ? "Added to draft" : "Add to draft"}
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
                    ? "Reviewed runs exist, but none produced a reusable LangExtract example for this schema version."
                    : "Approve grounded LangExtract review edits first. Safe suggestions show up here automatically."}
              </p>
            </div>
          ) : null}
        </div>
      ) : null}

      <div className="langextract-preview-card">
        <div className="builder-item-topline">
          <strong>Saved payload preview</strong>
          <span className="pill">langextract_config</span>
        </div>
        <p className="langextract-editor-copy">
          This is the exact structure the schema save will persist for
          LangExtract.
        </p>
        {preview.content ? (
          <pre aria-label="LangExtract payload preview">
            <code>{preview.content}</code>
          </pre>
        ) : (
          <p className="langextract-preview-empty">
            {preview.error ??
              "Add a prompt or at least one complete example to generate a preview."}
          </p>
        )}
      </div>
    </div>
  );
}
