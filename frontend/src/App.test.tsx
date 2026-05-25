import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { App } from "./App";
import { MOCK_PROVIDER_WARNING_DISMISS_KEY } from "./lib/mock-provider";

const invokeMock = vi.fn();

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
}));

function jsonResponse(payload: unknown) {
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

function textResponse(body: string, status: number) {
  return new Response(body, {
    status,
    headers: { "Content-Type": "text/plain" },
  });
}

function isoHoursAgo(hours: number) {
  return new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();
}

function makeDesktopStatus(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    tauriMode: true,
    projectRoot: "/tmp/extractflow",
    runtimeSource: "bundled_resources",
    appDataDir: "/tmp/extractflow-data",
    dockerAvailable: true,
    composeAvailable: true,
    backendHost: "127.0.0.1",
    backendPort: 8000,
    backendReachable: false,
    message: "Desktop runtime needs backend startup.",
    ...overrides,
  };
}

describe("App", () => {
  beforeEach(() => {
    invokeMock.mockReset();
    window.localStorage.clear();
    window.history.pushState({}, "", "/");
    delete (window as Window & { __TAURI_INTERNALS__?: object })
      .__TAURI_INTERNALS__;
    vi.stubGlobal(
      "fetch",
      vi.fn((input: string | URL | Request) => {
        const url =
          typeof input === "string"
            ? input
            : input instanceof URL
              ? input.toString()
              : input.url;

        if (url.endsWith("/templates"))
          return Promise.resolve(jsonResponse([]));
        if (url.endsWith("/documents"))
          return Promise.resolve(jsonResponse([]));
        if (url.endsWith("/jobs")) return Promise.resolve(jsonResponse([]));
        if (url.endsWith("/exports")) return Promise.resolve(jsonResponse([]));
        if (url.endsWith("/settings/provider"))
          return Promise.resolve(jsonResponse(null));
        if (url.endsWith("/settings/providers"))
          return Promise.resolve(jsonResponse({ providers: [] }));
        if (url.endsWith("/settings/providers/health"))
          return Promise.resolve(jsonResponse([]));
        if (url.endsWith("/settings/providers/custom"))
          return Promise.resolve(jsonResponse({ profiles: [] }));
        if (url.endsWith("/settings/providers/probe"))
          return Promise.resolve(
            jsonResponse({
              provider_type: "mock",
              reachable: true,
              status: "ready",
              detail: "ok",
            }),
          );
        if (url.endsWith("/dev/status")) {
          return Promise.resolve(
            jsonResponse({ templates: 0, documents: 0, jobs: 0, results: 0 }),
          );
        }
        if (url.includes("/audit/events")) {
          return Promise.resolve(jsonResponse({ events: [], total: 0 }));
        }
        if (url.endsWith("/settings/export-policy")) {
          return Promise.resolve(
            jsonResponse({ require_review_cleared: false }),
          );
        }

        return Promise.resolve(jsonResponse({}));
      }),
    );
  });

  it("renders the workspace shell from mocked API state", async () => {
    render(<App />);

    expect(
      screen.getByRole("heading", { name: "ExtractFlow" }),
    ).toBeInTheDocument();

    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: "Extractions" }),
      ).toBeInTheDocument();
    });

    expect(screen.getByRole("button", { name: "Audit" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Help" })).toBeInTheDocument();
    expect(
      screen.getAllByRole("button", { name: "Open settings" }).length,
    ).toBeGreaterThan(0);
    expect(
      screen.getByRole("heading", { name: "New extraction" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Upload PDF or source file")).toBeInTheDocument();
  });

  it("shows a production warning when the bootstrap mock provider is active", async () => {
    window.localStorage.removeItem(MOCK_PROVIDER_WARNING_DISMISS_KEY);

    vi.stubGlobal(
      "fetch",
      vi.fn((input: string | URL | Request) => {
        const url =
          typeof input === "string"
            ? input
            : input instanceof URL
              ? input.toString()
              : input.url;

        if (url.endsWith("/health"))
          return Promise.resolve(jsonResponse({ status: "ok" }));
        if (url.endsWith("/templates"))
          return Promise.resolve(jsonResponse([]));
        if (url.endsWith("/documents"))
          return Promise.resolve(jsonResponse([]));
        if (url.endsWith("/jobs")) return Promise.resolve(jsonResponse([]));
        if (url.endsWith("/exports")) return Promise.resolve(jsonResponse([]));
        if (url.endsWith("/settings/provider")) {
          return Promise.resolve(
            jsonResponse({
              mode: "local",
              provider_type: "mock",
              provider_label: "Mock Extractor",
              api_style: "mock",
              base_url: null,
              model: "mock-extractor",
              temperature: 0.1,
              max_tokens: 6000,
              supports_json_mode: true,
              allow_external_processing: false,
              api_key_required: false,
              timeout_seconds: 120,
              retry_count: 2,
              chunk_size: 16000,
            }),
          );
        }
        if (url.endsWith("/settings/providers"))
          return Promise.resolve(jsonResponse({ providers: [] }));
        if (url.endsWith("/settings/providers/health"))
          return Promise.resolve(jsonResponse([]));
        if (url.endsWith("/settings/providers/custom"))
          return Promise.resolve(jsonResponse({ profiles: [] }));
        if (url.endsWith("/dev/status")) {
          return Promise.resolve(
            jsonResponse({ templates: 0, documents: 0, jobs: 0, results: 0 }),
          );
        }

        return Promise.resolve(jsonResponse({}));
      }),
    );

    render(<App />);

    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent(
        /Bootstrap mock extractor is active/i,
      );
    });

    fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));

    await waitFor(() => {
      expect(
        screen.queryByText(/Bootstrap mock extractor is active/i),
      ).not.toBeInTheDocument();
    });
  });

  it("keeps the draft step focused when there is only one source", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn((input: string | URL | Request) => {
        const url =
          typeof input === "string"
            ? input
            : input instanceof URL
              ? input.toString()
              : input.url;

        if (url.endsWith("/health"))
          return Promise.resolve(jsonResponse({ status: "ok" }));
        if (url.endsWith("/templates"))
          return Promise.resolve(jsonResponse([]));
        if (url.endsWith("/documents")) {
          return Promise.resolve(
            jsonResponse([
              {
                id: 1,
                original_filename: "invoice.pdf",
                content_type: "application/pdf",
                status: "uploaded",
                created_at: "2026-05-02T00:00:00Z",
              },
            ]),
          );
        }
        if (url.endsWith("/jobs")) return Promise.resolve(jsonResponse([]));
        if (url.endsWith("/exports")) return Promise.resolve(jsonResponse([]));
        if (url.endsWith("/settings/provider"))
          return Promise.resolve(jsonResponse(null));
        if (url.endsWith("/settings/providers"))
          return Promise.resolve(jsonResponse({ providers: [] }));
        if (url.endsWith("/settings/providers/health"))
          return Promise.resolve(jsonResponse([]));
        if (url.endsWith("/settings/providers/custom"))
          return Promise.resolve(jsonResponse({ profiles: [] }));
        if (url.endsWith("/dev/status"))
          return Promise.resolve(
            jsonResponse({ templates: 0, documents: 1, jobs: 0, results: 0 }),
          );

        return Promise.resolve(jsonResponse({}));
      }),
    );

    render(<App />);

    await waitFor(() => {
      expect(
        screen.getByRole("heading", { name: "New extraction" }),
      ).toBeInTheDocument();
    });

    expect(screen.queryByText("Recent sources")).not.toBeInTheDocument();
  });

  it("turns the no-schema state into a direct help path", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn((input: string | URL | Request) => {
        const url =
          typeof input === "string"
            ? input
            : input instanceof URL
              ? input.toString()
              : input.url;

        if (url.endsWith("/health"))
          return Promise.resolve(jsonResponse({ status: "ok" }));
        if (url.endsWith("/templates"))
          return Promise.resolve(jsonResponse([]));
        if (url.endsWith("/documents"))
          return Promise.resolve(jsonResponse([]));
        if (url.endsWith("/jobs")) return Promise.resolve(jsonResponse([]));
        if (url.endsWith("/exports")) return Promise.resolve(jsonResponse([]));
        if (url.endsWith("/settings/provider"))
          return Promise.resolve(jsonResponse(null));
        if (url.endsWith("/settings/providers"))
          return Promise.resolve(jsonResponse({ providers: [] }));
        if (url.endsWith("/settings/providers/health"))
          return Promise.resolve(jsonResponse([]));
        if (url.endsWith("/settings/providers/custom"))
          return Promise.resolve(jsonResponse({ profiles: [] }));
        if (url.endsWith("/dev/status"))
          return Promise.resolve(
            jsonResponse({ templates: 0, documents: 0, jobs: 0, results: 0 }),
          );

        return Promise.resolve(jsonResponse({}));
      }),
    );

    render(<App />);

    fireEvent.click(await screen.findByRole("button", { name: "Open help" }));

    expect(
      await screen.findByRole("heading", {
        name: "Get the next step when setup, review, or evidence is unclear.",
      }),
    ).toBeInTheDocument();

    fireEvent.click(
      screen.getByRole("button", { name: "Open schema builder" }),
    );

    expect(
      await screen.findByRole("heading", {
        name: "Define what the model should look for before the document run starts.",
      }),
    ).toBeInTheDocument();
  });

  it("saves edited LangExtract prompt and examples into the template payload", async () => {
    let savedTemplateBody: Record<string, unknown> | null = null;

    vi.stubGlobal(
      "fetch",
      vi.fn((input: string | URL | Request, init?: RequestInit) => {
        const url =
          typeof input === "string"
            ? input
            : input instanceof URL
              ? input.toString()
              : input.url;

        if (url.endsWith("/health"))
          return Promise.resolve(jsonResponse({ status: "ok" }));
        if (url.endsWith("/templates") && init?.method === "POST") {
          savedTemplateBody = JSON.parse(String(init.body)) as Record<
            string,
            unknown
          >;
          return Promise.resolve(
            jsonResponse({
              id: 1,
              name: "LangExtract Schema",
              description: "Updated prompt",
              document_type: "General Document",
              is_locked: false,
              latest_version: "1.0.0",
              created_at: "2026-05-02T00:00:00Z",
              updated_at: "2026-05-02T00:00:00Z",
            }),
          );
        }
        if (url.endsWith("/templates"))
          return Promise.resolve(jsonResponse([]));
        if (url.endsWith("/documents"))
          return Promise.resolve(jsonResponse([]));
        if (url.endsWith("/jobs")) return Promise.resolve(jsonResponse([]));
        if (url.endsWith("/exports")) return Promise.resolve(jsonResponse([]));
        if (url.endsWith("/settings/provider")) {
          return Promise.resolve(
            jsonResponse({
              mode: "local",
              provider_type: "langextract",
              provider_label: "LangExtract (Ollama)",
              api_style: "langextract",
              base_url: "http://host.docker.internal:11434/v1",
              model: "qwen3.5:27b",
              temperature: 0.1,
              max_tokens: 6000,
              supports_json_mode: false,
              allow_external_processing: false,
              api_key_required: false,
              timeout_seconds: 120,
              retry_count: 2,
              chunk_size: 16000,
            }),
          );
        }
        if (url.endsWith("/settings/providers"))
          return Promise.resolve(jsonResponse({ providers: [] }));
        if (url.endsWith("/settings/providers/health"))
          return Promise.resolve(jsonResponse([]));
        if (url.endsWith("/settings/providers/custom"))
          return Promise.resolve(jsonResponse({ profiles: [] }));
        if (url.endsWith("/settings/providers/controls")) {
          return Promise.resolve(
            jsonResponse({ custom_provider_probe_max_age_hours: 24 }),
          );
        }
        if (url.endsWith("/dev/status")) {
          return Promise.resolve(
            jsonResponse({ templates: 0, documents: 0, jobs: 0, results: 0 }),
          );
        }

        return Promise.resolve(jsonResponse({}));
      }),
    );

    render(<App />);

    fireEvent.click(screen.getByRole("button", { name: "Schemas" }));

    const promptField = await screen.findByLabelText("LangExtract prompt");
    fireEvent.change(promptField, {
      target: { value: "Extract contract parties exactly as written." },
    });
    fireEvent.click(screen.getByRole("button", { name: "Add example" }));
    await waitFor(() => {
      expect(
        screen.getByLabelText("LangExtract example 2 source text"),
      ).toHaveFocus();
    });
    fireEvent.change(
      screen.getByLabelText("LangExtract example 2 source text"),
      {
        target: { value: "Parties: Acme Corp and River Bank" },
      },
    );
    fireEvent.change(
      screen.getByLabelText("Example 2 extraction 1 field name"),
      {
        target: { value: "primary_subject" },
      },
    );
    fireEvent.change(
      screen.getByLabelText("Example 2 extraction 1 source span"),
      {
        target: { value: "Acme Corp" },
      },
    );
    const exampleTwoSection = screen.getByTestId("langextract-example-2");
    fireEvent.click(
      within(exampleTwoSection).getByRole("button", {
        name: /Add attribute to extraction 1 in example 2/,
      }),
    );
    await waitFor(() => {
      expect(
        screen.getByLabelText("Example 2 extraction 1 attribute 1 name"),
      ).toHaveFocus();
    });
    fireEvent.change(
      screen.getByLabelText("Example 2 extraction 1 attribute 1 name"),
      {
        target: { value: "value" },
      },
    );
    fireEvent.change(
      screen.getByLabelText("Example 2 extraction 1 attribute 1 value"),
      {
        target: { value: "Acme Corp" },
      },
    );
    fireEvent.change(screen.getByLabelText("Schema name"), {
      target: { value: "LangExtract Schema" },
    });
    fireEvent.change(screen.getByLabelText("What should this run look for?"), {
      target: { value: "Updated prompt" },
    });

    fireEvent.click(screen.getByRole("button", { name: "Save schema" }));

    await waitFor(() => {
      expect(savedTemplateBody).not.toBeNull();
    });

    const definition = savedTemplateBody?.definition as Record<string, unknown>;
    const langextractConfig = definition.langextract_config as Record<
      string,
      unknown
    >;

    expect(langextractConfig.prompt_description).toBe(
      "Extract contract parties exactly as written.",
    );
    expect((langextractConfig.examples as Array<unknown>)[1]).toEqual({
      text: "Parties: Acme Corp and River Bank",
      extractions: [
        {
          extraction_class: "primary_subject",
          extraction_text: "Acme Corp",
          attributes: { value: "Acme Corp" },
        },
      ],
    });
  });

  it("persists dismissed LangExtract suggestions across reloads and batch-adds the rest", async () => {
    const langextractTemplate = {
      template_name: "LangExtract Schema",
      template_version: "1.0.0",
      document_type: "invoice",
      description: "Invoice extraction",
      llm_provider_settings: {
        mode: "local",
        provider_type: "langextract",
        provider_label: "LangExtract (Ollama)",
        api_style: "langextract",
        base_url: "http://host.docker.internal:11434/v1",
        model: "qwen3.5:27b",
        temperature: 0.1,
        max_tokens: 6000,
        supports_json_mode: false,
        allow_external_processing: false,
        api_key_required: false,
        timeout_seconds: 120,
        retry_count: 2,
        chunk_size: 16000,
      },
      langextract_config: {
        prompt_description: "Extract invoice facts exactly as written.",
        examples: [
          {
            text: "Invoice Vendor: Seed Corp\nTotal Due: $50.00",
            extractions: [
              {
                extraction_class: "vendor_name",
                extraction_text: "Seed Corp",
                attributes: { value: "Seed Corp" },
              },
            ],
          },
        ],
      },
      extracted_fields: [
        {
          name: "vendor_name",
          label: "Vendor Name",
          type: "text",
          required: true,
          citation_required: true,
          description: "Vendor",
        },
        {
          name: "total_amount",
          label: "Total Amount",
          type: "currency",
          required: true,
          citation_required: true,
          description: "Amount",
        },
      ],
      calculated_fields: [],
      output_settings: { export_formats: ["json"] },
    };
    const dismissedSuggestionKeys = new Set<string>();

    vi.stubGlobal(
      "fetch",
      vi.fn((input: string | URL | Request, init?: RequestInit) => {
        const url =
          typeof input === "string"
            ? input
            : input instanceof URL
              ? input.toString()
              : input.url;

        if (
          url.includes("/langextract-feedback-suggestions/") &&
          url.endsWith("/dismissal") &&
          init?.method === "PUT"
        ) {
          const suggestionKey = url.split("/").at(-2) ?? "";
          dismissedSuggestionKeys.add(suggestionKey);
          return Promise.resolve(
            jsonResponse({
              template_version_id: 101,
              suggestion_key: suggestionKey,
              dismissed: true,
              updated_at: "2026-05-03T01:00:00Z",
            }),
          );
        }

        if (url.endsWith("/health"))
          return Promise.resolve(jsonResponse({ status: "ok" }));
        if (url.endsWith("/templates"))
          return Promise.resolve(
            jsonResponse([
              {
                id: 1,
                name: "LangExtract Schema",
                description: "Invoice extraction",
                document_type: "invoice",
                is_locked: false,
                latest_version: "1.0.0",
                created_at: "2026-05-02T00:00:00Z",
                updated_at: "2026-05-02T00:00:00Z",
              },
            ]),
          );
        if (url.endsWith("/templates/1/versions"))
          return Promise.resolve(
            jsonResponse([
              {
                id: 101,
                template_id: 1,
                version: "1.0.0",
                definition: langextractTemplate,
                created_at: "2026-05-02T00:00:00Z",
              },
            ]),
          );
        if (
          url.endsWith(
            "/template-versions/101/langextract-feedback-suggestions",
          )
        ) {
          const suggestions = [
            {
              key: "suggestion-1",
              template_version_id: 101,
              example_text: "Invoice Vendor: Acme Corp\nTotal Due: $1,200.00",
              extractions: [
                {
                  extraction_class: "vendor_name",
                  extraction_text: "Acme Corp",
                  attributes: { value: "Acme Corporation" },
                },
                {
                  extraction_class: "total_amount",
                  extraction_text: "$1,200.00",
                  attributes: {
                    value: "$1,200.00",
                    currency: "USD",
                  },
                },
              ],
              occurrence_count: 2,
              source_result_ids: [5, 7],
              source_field_names: ["vendor_name"],
              last_reviewed_at: "2026-05-02T00:00:00Z",
            },
            {
              key: "suggestion-2",
              template_version_id: 101,
              example_text: "Invoice Vendor: Harbor Supply\nTotal Due: $320.15",
              extractions: [
                {
                  extraction_class: "vendor_name",
                  extraction_text: "Harbor Supply",
                  attributes: { value: "Harbor Supply" },
                },
                {
                  extraction_class: "total_amount",
                  extraction_text: "$320.15",
                  attributes: {
                    value: "$320.15",
                    currency: "USD",
                  },
                },
              ],
              occurrence_count: 1,
              source_result_ids: [8],
              source_field_names: ["vendor_name", "total_amount"],
              last_reviewed_at: "2026-05-03T00:00:00Z",
            },
          ].filter(
            (suggestion) => !dismissedSuggestionKeys.has(suggestion.key),
          );
          return Promise.resolve(
            jsonResponse({
              suggestions,
              diagnostics: {
                reviewed_result_count: 2,
                reviewed_edit_count: 2,
                generated_suggestion_count: suggestions.length,
                dismissed_suggestion_count: dismissedSuggestionKeys.size,
                visible_suggestion_count: suggestions.length,
                skipped_missing_document_text: 0,
                skipped_missing_target_field: 0,
                skipped_missing_grounding: 0,
                skipped_span_override: 0,
                skipped_span_mismatch: 0,
                skipped_empty_context: 0,
                skipped_no_contextual_extractions: 0,
              },
            }),
          );
        }
        if (url.endsWith("/documents"))
          return Promise.resolve(jsonResponse([]));
        if (url.endsWith("/jobs")) return Promise.resolve(jsonResponse([]));
        if (url.endsWith("/exports")) return Promise.resolve(jsonResponse([]));
        if (url.endsWith("/settings/provider"))
          return Promise.resolve(jsonResponse(null));
        if (url.endsWith("/settings/providers"))
          return Promise.resolve(jsonResponse({ providers: [] }));
        if (url.endsWith("/settings/providers/health"))
          return Promise.resolve(jsonResponse([]));
        if (url.endsWith("/settings/providers/custom"))
          return Promise.resolve(jsonResponse({ profiles: [] }));
        if (url.endsWith("/settings/providers/controls")) {
          return Promise.resolve(
            jsonResponse({ custom_provider_probe_max_age_hours: 24 }),
          );
        }
        if (url.endsWith("/dev/status")) {
          return Promise.resolve(
            jsonResponse({ templates: 1, documents: 0, jobs: 0, results: 0 }),
          );
        }

        return Promise.resolve(jsonResponse({}));
      }),
    );

    const view = render(<App />);

    fireEvent.click(screen.getByRole("button", { name: "Schemas" }));

    const dismissButtons = await screen.findAllByRole("button", {
      name: /Dismiss suggestion/,
    });
    fireEvent.click(dismissButtons[0]);

    await screen.findByText("Dismissed reviewed LangExtract suggestion.");
    await waitFor(() => {
      expect(
        screen.getAllByRole("button", { name: /Dismiss suggestion/ }),
      ).toHaveLength(1);
      expect(
        screen.getByRole("button", { name: "Dismiss suggestion 1" }),
      ).toHaveFocus();
    });
    view.unmount();

    render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: "Schemas" }));
    expect(
      await screen.findByRole("heading", {
        name: "3. Teach the schema with grounded examples",
      }),
    ).toBeInTheDocument();
    expect(await screen.findByText("1 suggestion")).toBeInTheDocument();
    expect(
      screen.getByText("Suggestions ready to promote"),
    ).toBeInTheDocument();

    fireEvent.click(
      screen.getByRole("button", {
        name: "Promote suggestion 1 to the draft",
      }),
    );
    expect(
      await screen.findByText(
        "Added reviewed LangExtract example to the draft schema. Save a new schema version before future runs use it.",
      ),
    ).toBeInTheDocument();

    const addedExample = await screen.findByLabelText(
      "LangExtract example 2 source text",
    );
    expect((addedExample as HTMLTextAreaElement).value).toBe(
      "Invoice Vendor: Harbor Supply\nTotal Due: $320.15",
    );
    expect(
      screen.queryByLabelText("LangExtract example 3 source text"),
    ).not.toBeInTheDocument();
    expect(screen.getByText("Added to draft")).toBeInTheDocument();
  });

  it("marks suggestions already present in the loaded draft as added to draft", async () => {
    const existingSuggestion = {
      key: "suggestion-1",
      template_version_id: 101,
      example_text: "Invoice Vendor: Acme Corp\nTotal Due: $1,200.00",
      extractions: [
        {
          extraction_class: "vendor_name",
          extraction_text: "Acme Corp",
          attributes: { value: "Acme Corporation" },
        },
        {
          extraction_class: "total_amount",
          extraction_text: "$1,200.00",
          attributes: {
            value: "$1,200.00",
            currency: "USD",
          },
        },
      ],
      occurrence_count: 2,
      source_result_ids: [5, 7],
      source_field_names: ["vendor_name"],
      last_reviewed_at: "2026-05-02T00:00:00Z",
    };
    const langextractTemplate = {
      template_name: "LangExtract Schema",
      template_version: "1.0.0",
      document_type: "invoice",
      description: "Invoice extraction",
      llm_provider_settings: {
        mode: "local",
        provider_type: "langextract",
        provider_label: "LangExtract (Ollama)",
        api_style: "langextract",
        base_url: "http://host.docker.internal:11434/v1",
        model: "qwen3.5:27b",
        temperature: 0.1,
        max_tokens: 6000,
        supports_json_mode: false,
        allow_external_processing: false,
        api_key_required: false,
        timeout_seconds: 120,
        retry_count: 2,
        chunk_size: 16000,
      },
      langextract_config: {
        prompt_description: "Extract invoice facts exactly as written.",
        examples: [
          {
            text: existingSuggestion.example_text,
            extractions: existingSuggestion.extractions,
          },
        ],
      },
      extracted_fields: [
        {
          name: "vendor_name",
          label: "Vendor Name",
          type: "text",
          required: true,
          citation_required: true,
          description: "Vendor",
        },
        {
          name: "total_amount",
          label: "Total Amount",
          type: "currency",
          required: true,
          citation_required: true,
          description: "Amount",
        },
      ],
      calculated_fields: [],
      output_settings: { export_formats: ["json"] },
    };

    vi.stubGlobal(
      "fetch",
      vi.fn((input: string | URL | Request) => {
        const url =
          typeof input === "string"
            ? input
            : input instanceof URL
              ? input.toString()
              : input.url;

        if (url.endsWith("/health"))
          return Promise.resolve(jsonResponse({ status: "ok" }));
        if (url.endsWith("/templates"))
          return Promise.resolve(
            jsonResponse([
              {
                id: 1,
                name: "LangExtract Schema",
                description: "Invoice extraction",
                document_type: "invoice",
                is_locked: false,
                latest_version: "1.0.0",
                created_at: "2026-05-02T00:00:00Z",
                updated_at: "2026-05-02T00:00:00Z",
              },
            ]),
          );
        if (url.endsWith("/templates/1/versions"))
          return Promise.resolve(
            jsonResponse([
              {
                id: 101,
                template_id: 1,
                version: "1.0.0",
                definition: langextractTemplate,
                created_at: "2026-05-02T00:00:00Z",
              },
            ]),
          );
        if (
          url.endsWith(
            "/template-versions/101/langextract-feedback-suggestions",
          )
        ) {
          return Promise.resolve(
            jsonResponse({
              suggestions: [existingSuggestion],
              diagnostics: {
                reviewed_result_count: 1,
                reviewed_edit_count: 1,
                generated_suggestion_count: 1,
                dismissed_suggestion_count: 0,
                visible_suggestion_count: 1,
                skipped_missing_document_text: 0,
                skipped_missing_target_field: 0,
                skipped_missing_grounding: 0,
                skipped_span_override: 0,
                skipped_span_mismatch: 0,
                skipped_empty_context: 0,
                skipped_no_contextual_extractions: 0,
              },
            }),
          );
        }
        if (url.endsWith("/documents"))
          return Promise.resolve(jsonResponse([]));
        if (url.endsWith("/jobs")) return Promise.resolve(jsonResponse([]));
        if (url.endsWith("/exports")) return Promise.resolve(jsonResponse([]));
        if (url.endsWith("/settings/provider"))
          return Promise.resolve(jsonResponse(null));
        if (url.endsWith("/settings/providers"))
          return Promise.resolve(jsonResponse({ providers: [] }));
        if (url.endsWith("/settings/providers/health"))
          return Promise.resolve(jsonResponse([]));
        if (url.endsWith("/settings/providers/custom"))
          return Promise.resolve(jsonResponse({ profiles: [] }));
        if (url.endsWith("/settings/providers/controls")) {
          return Promise.resolve(
            jsonResponse({ custom_provider_probe_max_age_hours: 24 }),
          );
        }
        if (url.endsWith("/dev/status")) {
          return Promise.resolve(
            jsonResponse({ templates: 1, documents: 0, jobs: 0, results: 0 }),
          );
        }

        return Promise.resolve(jsonResponse({}));
      }),
    );

    render(<App />);

    fireEvent.click(screen.getByRole("button", { name: "Schemas" }));

    expect(await screen.findByText("Added to draft")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Add all to draft" }),
    ).not.toBeInTheDocument();
  });

  it("keeps an applied suggestion marked as added after editing the draft example", async () => {
    const suggestion = {
      key: "suggestion-1",
      template_version_id: 101,
      example_text: "Invoice Vendor: Acme Corp\nTotal Due: $1,200.00",
      extractions: [
        {
          extraction_class: "vendor_name",
          extraction_text: "Acme Corp",
          attributes: { value: "Acme Corporation" },
        },
        {
          extraction_class: "total_amount",
          extraction_text: "$1,200.00",
          attributes: {
            value: "$1,200.00",
            currency: "USD",
          },
        },
      ],
      occurrence_count: 2,
      source_result_ids: [5, 7],
      source_field_names: ["vendor_name"],
      last_reviewed_at: "2026-05-02T00:00:00Z",
    };
    const langextractTemplate = {
      template_name: "LangExtract Schema",
      template_version: "1.0.0",
      document_type: "invoice",
      description: "Invoice extraction",
      llm_provider_settings: {
        mode: "local",
        provider_type: "langextract",
        provider_label: "LangExtract (Ollama)",
        api_style: "langextract",
        base_url: "http://host.docker.internal:11434/v1",
        model: "qwen3.5:27b",
        temperature: 0.1,
        max_tokens: 6000,
        supports_json_mode: false,
        allow_external_processing: false,
        api_key_required: false,
        timeout_seconds: 120,
        retry_count: 2,
        chunk_size: 16000,
      },
      langextract_config: {
        prompt_description: "Extract invoice facts exactly as written.",
        examples: [
          {
            text: "Invoice Vendor: Seed Corp\nTotal Due: $50.00",
            extractions: [
              {
                extraction_class: "vendor_name",
                extraction_text: "Seed Corp",
                attributes: { value: "Seed Corp" },
              },
            ],
          },
        ],
      },
      extracted_fields: [
        {
          name: "vendor_name",
          label: "Vendor Name",
          type: "text",
          required: true,
          citation_required: true,
          description: "Vendor",
        },
        {
          name: "total_amount",
          label: "Total Amount",
          type: "currency",
          required: true,
          citation_required: true,
          description: "Amount",
        },
      ],
      calculated_fields: [],
      output_settings: { export_formats: ["json"] },
    };

    vi.stubGlobal(
      "fetch",
      vi.fn((input: string | URL | Request) => {
        const url =
          typeof input === "string"
            ? input
            : input instanceof URL
              ? input.toString()
              : input.url;

        if (url.endsWith("/health"))
          return Promise.resolve(jsonResponse({ status: "ok" }));
        if (url.endsWith("/templates"))
          return Promise.resolve(
            jsonResponse([
              {
                id: 1,
                name: "LangExtract Schema",
                description: "Invoice extraction",
                document_type: "invoice",
                is_locked: false,
                latest_version: "1.0.0",
                created_at: "2026-05-02T00:00:00Z",
                updated_at: "2026-05-02T00:00:00Z",
              },
            ]),
          );
        if (url.endsWith("/templates/1/versions"))
          return Promise.resolve(
            jsonResponse([
              {
                id: 101,
                template_id: 1,
                version: "1.0.0",
                definition: langextractTemplate,
                created_at: "2026-05-02T00:00:00Z",
              },
            ]),
          );
        if (
          url.endsWith(
            "/template-versions/101/langextract-feedback-suggestions",
          )
        ) {
          return Promise.resolve(
            jsonResponse({
              suggestions: [suggestion],
              diagnostics: {
                reviewed_result_count: 1,
                reviewed_edit_count: 1,
                generated_suggestion_count: 1,
                dismissed_suggestion_count: 0,
                visible_suggestion_count: 1,
                skipped_missing_document_text: 0,
                skipped_missing_target_field: 0,
                skipped_missing_grounding: 0,
                skipped_span_override: 0,
                skipped_span_mismatch: 0,
                skipped_empty_context: 0,
                skipped_no_contextual_extractions: 0,
              },
            }),
          );
        }
        if (url.endsWith("/documents"))
          return Promise.resolve(jsonResponse([]));
        if (url.endsWith("/jobs")) return Promise.resolve(jsonResponse([]));
        if (url.endsWith("/exports")) return Promise.resolve(jsonResponse([]));
        if (url.endsWith("/settings/provider"))
          return Promise.resolve(jsonResponse(null));
        if (url.endsWith("/settings/providers"))
          return Promise.resolve(jsonResponse({ providers: [] }));
        if (url.endsWith("/settings/providers/health"))
          return Promise.resolve(jsonResponse([]));
        if (url.endsWith("/settings/providers/custom"))
          return Promise.resolve(jsonResponse({ profiles: [] }));
        if (url.endsWith("/settings/providers/controls")) {
          return Promise.resolve(
            jsonResponse({ custom_provider_probe_max_age_hours: 24 }),
          );
        }
        if (url.endsWith("/dev/status")) {
          return Promise.resolve(
            jsonResponse({ templates: 1, documents: 0, jobs: 0, results: 0 }),
          );
        }

        return Promise.resolve(jsonResponse({}));
      }),
    );

    render(<App />);

    fireEvent.click(screen.getByRole("button", { name: "Schemas" }));

    fireEvent.click(
      await screen.findByRole("button", {
        name: /Promote suggestion \d+ to the draft/,
      }),
    );
    expect(
      await screen.findByText(
        "Added reviewed LangExtract example to the draft schema. Save a new schema version before future runs use it.",
      ),
    ).toBeInTheDocument();
    fireEvent.change(
      await screen.findByLabelText("LangExtract example 2 source text"),
      {
        target: {
          value:
            "Invoice Vendor: Acme Corp\nTotal Due: $1,200.00\nAnalyst note: keep",
        },
      },
    );

    expect(screen.getByText("Added to draft")).toBeInTheDocument();
  });

  it("shows LangExtract feedback diagnostics when reviewed runs are not reusable", async () => {
    const langextractTemplate = {
      template_name: "LangExtract Schema",
      template_version: "1.0.0",
      document_type: "invoice",
      description: "Invoice extraction",
      llm_provider_settings: {
        mode: "local",
        provider_type: "langextract",
        provider_label: "LangExtract (Ollama)",
        api_style: "langextract",
        base_url: "http://host.docker.internal:11434/v1",
        model: "qwen3.5:27b",
        temperature: 0.1,
        max_tokens: 6000,
        supports_json_mode: false,
        allow_external_processing: false,
        api_key_required: false,
        timeout_seconds: 120,
        retry_count: 2,
        chunk_size: 16000,
      },
      langextract_config: {
        prompt_description: "Extract invoice facts exactly as written.",
        examples: [
          {
            text: "Invoice Vendor: Seed Corp\nTotal Due: $50.00",
            extractions: [
              {
                extraction_class: "vendor_name",
                extraction_text: "Seed Corp",
                attributes: { value: "Seed Corp" },
              },
            ],
          },
        ],
      },
      extracted_fields: [
        {
          name: "vendor_name",
          label: "Vendor Name",
          type: "text",
          required: true,
          citation_required: true,
          description: "Vendor",
        },
      ],
      calculated_fields: [],
      output_settings: { export_formats: ["json"] },
    };

    vi.stubGlobal(
      "fetch",
      vi.fn((input: string | URL | Request) => {
        const url =
          typeof input === "string"
            ? input
            : input instanceof URL
              ? input.toString()
              : input.url;

        if (url.endsWith("/health"))
          return Promise.resolve(jsonResponse({ status: "ok" }));
        if (url.endsWith("/templates"))
          return Promise.resolve(
            jsonResponse([
              {
                id: 1,
                name: "LangExtract Schema",
                description: "Invoice extraction",
                document_type: "invoice",
                is_locked: false,
                latest_version: "1.0.0",
                created_at: "2026-05-02T00:00:00Z",
                updated_at: "2026-05-02T00:00:00Z",
              },
            ]),
          );
        if (url.endsWith("/templates/1/versions"))
          return Promise.resolve(
            jsonResponse([
              {
                id: 101,
                template_id: 1,
                version: "1.0.0",
                definition: langextractTemplate,
                created_at: "2026-05-02T00:00:00Z",
              },
            ]),
          );
        if (
          url.endsWith(
            "/template-versions/101/langextract-feedback-suggestions",
          )
        ) {
          return Promise.resolve(
            jsonResponse({
              suggestions: [],
              diagnostics: {
                reviewed_result_count: 2,
                reviewed_edit_count: 2,
                generated_suggestion_count: 0,
                dismissed_suggestion_count: 0,
                visible_suggestion_count: 0,
                skipped_missing_document_text: 1,
                skipped_missing_target_field: 0,
                skipped_missing_grounding: 0,
                skipped_span_override: 0,
                skipped_span_mismatch: 1,
                skipped_empty_context: 0,
                skipped_no_contextual_extractions: 0,
              },
            }),
          );
        }
        if (url.endsWith("/documents"))
          return Promise.resolve(jsonResponse([]));
        if (url.endsWith("/jobs")) return Promise.resolve(jsonResponse([]));
        if (url.endsWith("/exports")) return Promise.resolve(jsonResponse([]));
        if (url.endsWith("/settings/provider"))
          return Promise.resolve(jsonResponse(null));
        if (url.endsWith("/settings/providers"))
          return Promise.resolve(jsonResponse({ providers: [] }));
        if (url.endsWith("/settings/providers/health"))
          return Promise.resolve(jsonResponse([]));
        if (url.endsWith("/settings/providers/custom"))
          return Promise.resolve(jsonResponse({ profiles: [] }));
        if (url.endsWith("/settings/providers/controls")) {
          return Promise.resolve(
            jsonResponse({ custom_provider_probe_max_age_hours: 24 }),
          );
        }
        if (url.endsWith("/dev/status")) {
          return Promise.resolve(
            jsonResponse({ templates: 1, documents: 0, jobs: 0, results: 0 }),
          );
        }

        return Promise.resolve(jsonResponse({}));
      }),
    );

    render(<App />);

    fireEvent.click(screen.getByRole("button", { name: "Schemas" }));

    expect(
      await screen.findByText("Some reviewed runs were not reusable."),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "1 reviewed edits skipped because parsed text was unavailable",
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "1 reviewed edits skipped because stored spans no longer matched the document text",
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByText("No reusable reviewed examples right now."),
    ).toBeInTheDocument();
  });

  it("serializes LangExtract list attributes as string arrays", async () => {
    let savedTemplateBody: Record<string, unknown> | null = null;

    vi.stubGlobal(
      "fetch",
      vi.fn((input: string | URL | Request, init?: RequestInit) => {
        const url =
          typeof input === "string"
            ? input
            : input instanceof URL
              ? input.toString()
              : input.url;

        if (url.endsWith("/health"))
          return Promise.resolve(jsonResponse({ status: "ok" }));
        if (url.endsWith("/templates") && init?.method === "POST") {
          savedTemplateBody = JSON.parse(String(init.body)) as Record<
            string,
            unknown
          >;
          return Promise.resolve(
            jsonResponse({
              id: 1,
              name: "LangExtract Schema",
              description: "Updated prompt",
              document_type: "General Document",
              is_locked: false,
              latest_version: "1.0.0",
              created_at: "2026-05-02T00:00:00Z",
              updated_at: "2026-05-02T00:00:00Z",
            }),
          );
        }
        if (url.endsWith("/templates"))
          return Promise.resolve(jsonResponse([]));
        if (url.endsWith("/documents"))
          return Promise.resolve(jsonResponse([]));
        if (url.endsWith("/jobs")) return Promise.resolve(jsonResponse([]));
        if (url.endsWith("/exports")) return Promise.resolve(jsonResponse([]));
        if (url.endsWith("/settings/provider")) {
          return Promise.resolve(
            jsonResponse({
              mode: "local",
              provider_type: "langextract",
              provider_label: "LangExtract (Ollama)",
              api_style: "langextract",
              base_url: "http://host.docker.internal:11434/v1",
              model: "qwen3.5:27b",
              temperature: 0.1,
              max_tokens: 6000,
              supports_json_mode: false,
              allow_external_processing: false,
              api_key_required: false,
              timeout_seconds: 120,
              retry_count: 2,
              chunk_size: 16000,
            }),
          );
        }
        if (url.endsWith("/settings/providers"))
          return Promise.resolve(jsonResponse({ providers: [] }));
        if (url.endsWith("/settings/providers/health"))
          return Promise.resolve(jsonResponse([]));
        if (url.endsWith("/settings/providers/custom"))
          return Promise.resolve(jsonResponse({ profiles: [] }));
        if (url.endsWith("/settings/providers/controls")) {
          return Promise.resolve(
            jsonResponse({ custom_provider_probe_max_age_hours: 24 }),
          );
        }
        if (url.endsWith("/dev/status")) {
          return Promise.resolve(
            jsonResponse({ templates: 0, documents: 0, jobs: 0, results: 0 }),
          );
        }

        return Promise.resolve(jsonResponse({}));
      }),
    );

    render(<App />);

    fireEvent.click(screen.getByRole("button", { name: "Schemas" }));

    await screen.findByLabelText("LangExtract prompt");
    fireEvent.click(screen.getByRole("button", { name: "Add example" }));
    fireEvent.change(
      screen.getByLabelText("LangExtract example 2 source text"),
      {
        target: { value: "Vendor aliases: Acme Corp, Acme Company" },
      },
    );
    fireEvent.change(
      screen.getByLabelText("Example 2 extraction 1 field name"),
      {
        target: { value: "primary_subject" },
      },
    );
    fireEvent.change(
      screen.getByLabelText("Example 2 extraction 1 source span"),
      {
        target: { value: "Acme Corp, Acme Company" },
      },
    );
    const exampleTwoSection = screen.getByTestId("langextract-example-2");
    fireEvent.click(
      within(exampleTwoSection).getByRole("button", {
        name: /Add attribute to extraction 1 in example 2/,
      }),
    );
    fireEvent.change(
      screen.getByLabelText("Example 2 extraction 1 attribute 1 name"),
      {
        target: { value: "aliases" },
      },
    );
    fireEvent.change(
      screen.getByLabelText("Example 2 extraction 1 attribute 1 type"),
      {
        target: { value: "string_array" },
      },
    );
    fireEvent.change(
      screen.getByLabelText("Example 2 extraction 1 attribute 1 value"),
      {
        target: { value: "Acme Corp\nAcme Company" },
      },
    );

    fireEvent.click(screen.getByRole("button", { name: "Save schema" }));

    await waitFor(() => {
      expect(savedTemplateBody).not.toBeNull();
    });

    const definition = savedTemplateBody?.definition as Record<string, unknown>;
    const langextractConfig = definition.langextract_config as Record<
      string,
      unknown
    >;
    expect((langextractConfig.examples as Array<unknown>)[1]).toEqual({
      text: "Vendor aliases: Acme Corp, Acme Company",
      extractions: [
        {
          extraction_class: "primary_subject",
          extraction_text: "Acme Corp, Acme Company",
          attributes: { aliases: ["Acme Corp", "Acme Company"] },
        },
      ],
    });
  });

  it("shows a live LangExtract payload preview while editing", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn((input: string | URL | Request) => {
        const url =
          typeof input === "string"
            ? input
            : input instanceof URL
              ? input.toString()
              : input.url;

        if (url.endsWith("/health"))
          return Promise.resolve(jsonResponse({ status: "ok" }));
        if (url.endsWith("/templates"))
          return Promise.resolve(jsonResponse([]));
        if (url.endsWith("/documents"))
          return Promise.resolve(jsonResponse([]));
        if (url.endsWith("/jobs")) return Promise.resolve(jsonResponse([]));
        if (url.endsWith("/exports")) return Promise.resolve(jsonResponse([]));
        if (url.endsWith("/settings/provider")) {
          return Promise.resolve(
            jsonResponse({
              mode: "local",
              provider_type: "langextract",
              provider_label: "LangExtract (Ollama)",
              api_style: "langextract",
              base_url: "http://host.docker.internal:11434/v1",
              model: "qwen3.5:27b",
              temperature: 0.1,
              max_tokens: 6000,
              supports_json_mode: false,
              allow_external_processing: false,
              api_key_required: false,
              timeout_seconds: 120,
              retry_count: 2,
              chunk_size: 16000,
            }),
          );
        }
        if (url.endsWith("/settings/providers"))
          return Promise.resolve(jsonResponse({ providers: [] }));
        if (url.endsWith("/settings/providers/health"))
          return Promise.resolve(jsonResponse([]));
        if (url.endsWith("/settings/providers/custom"))
          return Promise.resolve(jsonResponse({ profiles: [] }));
        if (url.endsWith("/settings/providers/controls")) {
          return Promise.resolve(
            jsonResponse({ custom_provider_probe_max_age_hours: 24 }),
          );
        }
        if (url.endsWith("/dev/status")) {
          return Promise.resolve(
            jsonResponse({ templates: 0, documents: 0, jobs: 0, results: 0 }),
          );
        }

        return Promise.resolve(jsonResponse({}));
      }),
    );

    render(<App />);

    fireEvent.click(screen.getByRole("button", { name: "Schemas" }));
    await screen.findByLabelText("LangExtract prompt");

    fireEvent.click(screen.getAllByText(/Saved payload preview/)[0]);
    await screen.findByLabelText("LangExtract payload preview");

    fireEvent.change(screen.getByLabelText("LangExtract prompt"), {
      target: { value: "Extract contract parties exactly as written." },
    });
    fireEvent.click(screen.getByRole("button", { name: "Add example" }));
    fireEvent.change(
      screen.getByLabelText("LangExtract example 2 source text"),
      {
        target: { value: "Parties: Acme Corp and River Bank" },
      },
    );
    fireEvent.change(
      screen.getByLabelText("Example 2 extraction 1 field name"),
      {
        target: { value: "primary_subject" },
      },
    );
    fireEvent.change(
      screen.getByLabelText("Example 2 extraction 1 source span"),
      {
        target: { value: "Acme Corp" },
      },
    );
    const exampleTwoSection = screen.getByTestId("langextract-example-2");
    fireEvent.click(
      within(exampleTwoSection).getByRole("button", {
        name: /Add attribute to extraction 1 in example 2/,
      }),
    );
    fireEvent.change(
      screen.getByLabelText("Example 2 extraction 1 attribute 1 name"),
      {
        target: { value: "value" },
      },
    );
    fireEvent.change(
      screen.getByLabelText("Example 2 extraction 1 attribute 1 value"),
      {
        target: { value: "Acme Corp" },
      },
    );

    const preview = screen.getByLabelText("LangExtract payload preview");
    expect(preview).toHaveTextContent('"prompt_description":');
    expect(preview).toHaveTextContent(
      "Extract contract parties exactly as written.",
    );
    expect(preview).toHaveTextContent(
      '"text": "Parties: Acme Corp and River Bank"',
    );
    expect(preview).toHaveTextContent('"extraction_class": "primary_subject"');
  });

  it("keeps focus on the next sensible LangExtract editor control after structural edits", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn((input: string | URL | Request) => {
        const url =
          typeof input === "string"
            ? input
            : input instanceof URL
              ? input.toString()
              : input.url;

        if (url.endsWith("/health"))
          return Promise.resolve(jsonResponse({ status: "ok" }));
        if (url.endsWith("/templates"))
          return Promise.resolve(jsonResponse([]));
        if (url.endsWith("/documents"))
          return Promise.resolve(jsonResponse([]));
        if (url.endsWith("/jobs")) return Promise.resolve(jsonResponse([]));
        if (url.endsWith("/exports")) return Promise.resolve(jsonResponse([]));
        if (url.endsWith("/settings/provider")) {
          return Promise.resolve(
            jsonResponse({
              mode: "local",
              provider_type: "langextract",
              provider_label: "LangExtract (Ollama)",
              api_style: "langextract",
              base_url: "http://host.docker.internal:11434/v1",
              model: "qwen3.5:27b",
              temperature: 0.1,
              max_tokens: 6000,
              supports_json_mode: false,
              allow_external_processing: false,
              api_key_required: false,
              timeout_seconds: 120,
              retry_count: 2,
              chunk_size: 16000,
            }),
          );
        }
        if (url.endsWith("/settings/providers"))
          return Promise.resolve(jsonResponse({ providers: [] }));
        if (url.endsWith("/settings/providers/health"))
          return Promise.resolve(jsonResponse([]));
        if (url.endsWith("/settings/providers/custom"))
          return Promise.resolve(jsonResponse({ profiles: [] }));
        if (url.endsWith("/settings/providers/controls")) {
          return Promise.resolve(
            jsonResponse({ custom_provider_probe_max_age_hours: 24 }),
          );
        }
        if (url.endsWith("/dev/status")) {
          return Promise.resolve(
            jsonResponse({ templates: 0, documents: 0, jobs: 0, results: 0 }),
          );
        }

        return Promise.resolve(jsonResponse({}));
      }),
    );

    render(<App />);

    fireEvent.click(screen.getByRole("button", { name: "Schemas" }));

    await screen.findByLabelText("LangExtract prompt");
    fireEvent.click(screen.getByRole("button", { name: "Add example" }));

    await waitFor(() => {
      expect(
        screen.getByLabelText("LangExtract example 2 source text"),
      ).toHaveFocus();
    });

    const exampleTwoSection = screen.getByTestId("langextract-example-2");
    fireEvent.click(
      within(exampleTwoSection).getByRole("button", {
        name: /Add extraction to example 2/,
      }),
    );

    await waitFor(() => {
      expect(
        screen.getByLabelText("Example 2 extraction 2 field name"),
      ).toHaveFocus();
    });

    const exampleTwoExtractionTwo = screen.getByTestId(
      "langextract-example-2-extraction-2",
    );
    fireEvent.click(
      within(exampleTwoExtractionTwo).getByRole("button", {
        name: /Add attribute to extraction 2 in example 2/,
      }),
    );

    await waitFor(() => {
      expect(
        screen.getByLabelText("Example 2 extraction 2 attribute 1 name"),
      ).toHaveFocus();
    });

    fireEvent.click(
      screen.getByRole("button", {
        name: /Remove attribute 1 from extraction 2 in example 2/,
      }),
    );

    await waitFor(() => {
      expect(
        within(exampleTwoExtractionTwo).getByRole("button", {
          name: /Add attribute to extraction 2 in example 2/,
        }),
      ).toHaveFocus();
    });

    fireEvent.click(
      within(exampleTwoSection).getByRole("button", {
        name: "Remove example 2",
      }),
    );

    await waitFor(() => {
      expect(
        screen.getByLabelText("LangExtract example 1 source text"),
      ).toHaveFocus();
    });
  });

  it("shows a targeted error when a LangExtract example is missing source text", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn((input: string | URL | Request) => {
        const url =
          typeof input === "string"
            ? input
            : input instanceof URL
              ? input.toString()
              : input.url;

        if (url.endsWith("/health"))
          return Promise.resolve(jsonResponse({ status: "ok" }));
        if (url.endsWith("/templates"))
          return Promise.resolve(jsonResponse([]));
        if (url.endsWith("/documents"))
          return Promise.resolve(jsonResponse([]));
        if (url.endsWith("/jobs")) return Promise.resolve(jsonResponse([]));
        if (url.endsWith("/exports")) return Promise.resolve(jsonResponse([]));
        if (url.endsWith("/settings/provider")) {
          return Promise.resolve(
            jsonResponse({
              mode: "local",
              provider_type: "langextract",
              provider_label: "LangExtract (Ollama)",
              api_style: "langextract",
              base_url: "http://host.docker.internal:11434/v1",
              model: "qwen3.5:27b",
              temperature: 0.1,
              max_tokens: 6000,
              supports_json_mode: false,
              allow_external_processing: false,
              api_key_required: false,
              timeout_seconds: 120,
              retry_count: 2,
              chunk_size: 16000,
            }),
          );
        }
        if (url.endsWith("/settings/providers"))
          return Promise.resolve(jsonResponse({ providers: [] }));
        if (url.endsWith("/settings/providers/health"))
          return Promise.resolve(jsonResponse([]));
        if (url.endsWith("/settings/providers/custom"))
          return Promise.resolve(jsonResponse({ profiles: [] }));
        if (url.endsWith("/settings/providers/controls")) {
          return Promise.resolve(
            jsonResponse({ custom_provider_probe_max_age_hours: 24 }),
          );
        }
        if (url.endsWith("/dev/status")) {
          return Promise.resolve(
            jsonResponse({ templates: 0, documents: 0, jobs: 0, results: 0 }),
          );
        }

        return Promise.resolve(jsonResponse({}));
      }),
    );

    render(<App />);

    fireEvent.click(screen.getByRole("button", { name: "Schemas" }));

    await screen.findByLabelText("LangExtract example 1 source text");

    fireEvent.change(
      screen.getByLabelText("LangExtract example 1 source text"),
      {
        target: { value: "" },
      },
    );
    fireEvent.click(screen.getByRole("button", { name: "Save schema" }));

    expect(
      await screen.findAllByText("LangExtract example 1 needs source text."),
    ).not.toHaveLength(0);
  });

  it("shows an inline preview warning when the LangExtract draft is incomplete", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn((input: string | URL | Request) => {
        const url =
          typeof input === "string"
            ? input
            : input instanceof URL
              ? input.toString()
              : input.url;

        if (url.endsWith("/health"))
          return Promise.resolve(jsonResponse({ status: "ok" }));
        if (url.endsWith("/templates"))
          return Promise.resolve(jsonResponse([]));
        if (url.endsWith("/documents"))
          return Promise.resolve(jsonResponse([]));
        if (url.endsWith("/jobs")) return Promise.resolve(jsonResponse([]));
        if (url.endsWith("/exports")) return Promise.resolve(jsonResponse([]));
        if (url.endsWith("/settings/provider")) {
          return Promise.resolve(
            jsonResponse({
              mode: "local",
              provider_type: "langextract",
              provider_label: "LangExtract (Ollama)",
              api_style: "langextract",
              base_url: "http://host.docker.internal:11434/v1",
              model: "qwen3.5:27b",
              temperature: 0.1,
              max_tokens: 6000,
              supports_json_mode: false,
              allow_external_processing: false,
              api_key_required: false,
              timeout_seconds: 120,
              retry_count: 2,
              chunk_size: 16000,
            }),
          );
        }
        if (url.endsWith("/settings/providers"))
          return Promise.resolve(jsonResponse({ providers: [] }));
        if (url.endsWith("/settings/providers/health"))
          return Promise.resolve(jsonResponse([]));
        if (url.endsWith("/settings/providers/custom"))
          return Promise.resolve(jsonResponse({ profiles: [] }));
        if (url.endsWith("/settings/providers/controls")) {
          return Promise.resolve(
            jsonResponse({ custom_provider_probe_max_age_hours: 24 }),
          );
        }
        if (url.endsWith("/dev/status")) {
          return Promise.resolve(
            jsonResponse({ templates: 0, documents: 0, jobs: 0, results: 0 }),
          );
        }

        return Promise.resolve(jsonResponse({}));
      }),
    );

    render(<App />);

    fireEvent.click(screen.getByRole("button", { name: "Schemas" }));

    await screen.findByLabelText("LangExtract example 1 source text");
    fireEvent.change(
      screen.getByLabelText("LangExtract example 1 source text"),
      {
        target: { value: "" },
      },
    );
    expect(
      await screen.findAllByText("LangExtract example 1 needs source text."),
    ).not.toHaveLength(0);
    expect(
      screen.queryByLabelText("LangExtract payload preview"),
    ).not.toBeInTheDocument();
  });

  it("shows a targeted error when a LangExtract extraction is missing a field name", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn((input: string | URL | Request) => {
        const url =
          typeof input === "string"
            ? input
            : input instanceof URL
              ? input.toString()
              : input.url;

        if (url.endsWith("/health"))
          return Promise.resolve(jsonResponse({ status: "ok" }));
        if (url.endsWith("/templates"))
          return Promise.resolve(jsonResponse([]));
        if (url.endsWith("/documents"))
          return Promise.resolve(jsonResponse([]));
        if (url.endsWith("/jobs")) return Promise.resolve(jsonResponse([]));
        if (url.endsWith("/exports")) return Promise.resolve(jsonResponse([]));
        if (url.endsWith("/settings/provider")) {
          return Promise.resolve(
            jsonResponse({
              mode: "local",
              provider_type: "langextract",
              provider_label: "LangExtract (Ollama)",
              api_style: "langextract",
              base_url: "http://host.docker.internal:11434/v1",
              model: "qwen3.5:27b",
              temperature: 0.1,
              max_tokens: 6000,
              supports_json_mode: false,
              allow_external_processing: false,
              api_key_required: false,
              timeout_seconds: 120,
              retry_count: 2,
              chunk_size: 16000,
            }),
          );
        }
        if (url.endsWith("/settings/providers"))
          return Promise.resolve(jsonResponse({ providers: [] }));
        if (url.endsWith("/settings/providers/health"))
          return Promise.resolve(jsonResponse([]));
        if (url.endsWith("/settings/providers/custom"))
          return Promise.resolve(jsonResponse({ profiles: [] }));
        if (url.endsWith("/settings/providers/controls")) {
          return Promise.resolve(
            jsonResponse({ custom_provider_probe_max_age_hours: 24 }),
          );
        }
        if (url.endsWith("/dev/status")) {
          return Promise.resolve(
            jsonResponse({ templates: 0, documents: 0, jobs: 0, results: 0 }),
          );
        }

        return Promise.resolve(jsonResponse({}));
      }),
    );

    render(<App />);

    fireEvent.click(screen.getByRole("button", { name: "Schemas" }));

    await screen.findByLabelText("Example 1 extraction 1 field name");

    fireEvent.change(
      screen.getByLabelText("Example 1 extraction 1 field name"),
      {
        target: { value: "" },
      },
    );
    fireEvent.click(screen.getByRole("button", { name: "Save schema" }));

    expect(
      await screen.findAllByText(
        "LangExtract example 1 extraction 1 needs a field name.",
      ),
    ).not.toHaveLength(0);
  });

  it("uses a field picker so LangExtract extractions cannot reference unknown fields", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn((input: string | URL | Request) => {
        const url =
          typeof input === "string"
            ? input
            : input instanceof URL
              ? input.toString()
              : input.url;

        if (url.endsWith("/health"))
          return Promise.resolve(jsonResponse({ status: "ok" }));
        if (url.endsWith("/templates"))
          return Promise.resolve(jsonResponse([]));
        if (url.endsWith("/documents"))
          return Promise.resolve(jsonResponse([]));
        if (url.endsWith("/jobs")) return Promise.resolve(jsonResponse([]));
        if (url.endsWith("/exports")) return Promise.resolve(jsonResponse([]));
        if (url.endsWith("/settings/provider")) {
          return Promise.resolve(
            jsonResponse({
              mode: "local",
              provider_type: "langextract",
              provider_label: "LangExtract (Ollama)",
              api_style: "langextract",
              base_url: "http://host.docker.internal:11434/v1",
              model: "qwen3.5:27b",
              temperature: 0.1,
              max_tokens: 6000,
              supports_json_mode: false,
              allow_external_processing: false,
              api_key_required: false,
              timeout_seconds: 120,
              retry_count: 2,
              chunk_size: 16000,
            }),
          );
        }
        if (url.endsWith("/settings/providers"))
          return Promise.resolve(jsonResponse({ providers: [] }));
        if (url.endsWith("/settings/providers/health"))
          return Promise.resolve(jsonResponse([]));
        if (url.endsWith("/settings/providers/custom"))
          return Promise.resolve(jsonResponse({ profiles: [] }));
        if (url.endsWith("/settings/providers/controls")) {
          return Promise.resolve(
            jsonResponse({ custom_provider_probe_max_age_hours: 24 }),
          );
        }
        if (url.endsWith("/dev/status")) {
          return Promise.resolve(
            jsonResponse({ templates: 0, documents: 0, jobs: 0, results: 0 }),
          );
        }

        return Promise.resolve(jsonResponse({}));
      }),
    );

    render(<App />);

    fireEvent.click(screen.getByRole("button", { name: "Schemas" }));

    await screen.findByLabelText("Example 1 extraction 1 field name");

    const fieldPicker = screen.getByLabelText(
      "Example 1 extraction 1 field name",
    ) as HTMLSelectElement;
    expect(fieldPicker.tagName).toBe("SELECT");
    expect(
      within(fieldPicker).queryByRole("option", { name: "bogus_field" }),
    ).not.toBeInTheDocument();

    fireEvent.change(fieldPicker, {
      target: { value: "bogus_field" },
    });

    expect(fieldPicker).not.toHaveValue("bogus_field");
  });

  it("shows missing required LangExtract field coverage before save", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn((input: string | URL | Request) => {
        const url =
          typeof input === "string"
            ? input
            : input instanceof URL
              ? input.toString()
              : input.url;

        if (url.endsWith("/health"))
          return Promise.resolve(jsonResponse({ status: "ok" }));
        if (url.endsWith("/templates"))
          return Promise.resolve(jsonResponse([]));
        if (url.endsWith("/documents"))
          return Promise.resolve(jsonResponse([]));
        if (url.endsWith("/jobs")) return Promise.resolve(jsonResponse([]));
        if (url.endsWith("/exports")) return Promise.resolve(jsonResponse([]));
        if (url.endsWith("/settings/provider")) {
          return Promise.resolve(
            jsonResponse({
              mode: "local",
              provider_type: "langextract",
              provider_label: "LangExtract (Ollama)",
              api_style: "langextract",
              base_url: "http://host.docker.internal:11434/v1",
              model: "qwen3.5:27b",
              temperature: 0.1,
              max_tokens: 6000,
              supports_json_mode: false,
              allow_external_processing: false,
              api_key_required: false,
              timeout_seconds: 120,
              retry_count: 2,
              chunk_size: 16000,
            }),
          );
        }
        if (url.endsWith("/settings/providers"))
          return Promise.resolve(jsonResponse({ providers: [] }));
        if (url.endsWith("/settings/providers/health"))
          return Promise.resolve(jsonResponse([]));
        if (url.endsWith("/settings/providers/custom"))
          return Promise.resolve(jsonResponse({ profiles: [] }));
        if (url.endsWith("/settings/providers/controls")) {
          return Promise.resolve(
            jsonResponse({ custom_provider_probe_max_age_hours: 24 }),
          );
        }
        if (url.endsWith("/dev/status")) {
          return Promise.resolve(
            jsonResponse({ templates: 0, documents: 0, jobs: 0, results: 0 }),
          );
        }

        return Promise.resolve(jsonResponse({}));
      }),
    );

    render(<App />);

    fireEvent.click(screen.getByRole("button", { name: "Schemas" }));

    await screen.findByText("1 of 1 required fields covered");
    fireEvent.change(
      screen.getByLabelText("Example 1 extraction 1 field name"),
      {
        target: { value: "total_amount" },
      },
    );

    expect(
      await screen.findByText("0 of 1 required fields covered"),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Missing required examples: primary_subject."),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Save schema" }));

    expect(
      await screen.findAllByText(
        "LangExtract examples must cover every required extracted field. Missing example coverage for: primary_subject.",
      ),
    ).not.toHaveLength(0);
  });

  it("does not persist LangExtract config for non-LangExtract schema saves", async () => {
    let savedTemplateBody: Record<string, unknown> | null = null;

    vi.stubGlobal(
      "fetch",
      vi.fn((input: string | URL | Request, init?: RequestInit) => {
        const url =
          typeof input === "string"
            ? input
            : input instanceof URL
              ? input.toString()
              : input.url;

        if (url.endsWith("/health"))
          return Promise.resolve(jsonResponse({ status: "ok" }));
        if (url.endsWith("/templates") && init?.method === "POST") {
          savedTemplateBody = JSON.parse(String(init.body)) as Record<
            string,
            unknown
          >;
          return Promise.resolve(
            jsonResponse({
              id: 1,
              name: "Invoice Schema",
              description: "Invoice extraction schema.",
              document_type: "General Document",
              is_locked: false,
              latest_version: "1.0.0",
              created_at: "2026-05-02T00:00:00Z",
              updated_at: "2026-05-02T00:00:00Z",
            }),
          );
        }
        if (url.endsWith("/templates"))
          return Promise.resolve(jsonResponse([]));
        if (url.endsWith("/documents"))
          return Promise.resolve(jsonResponse([]));
        if (url.endsWith("/jobs")) return Promise.resolve(jsonResponse([]));
        if (url.endsWith("/exports")) return Promise.resolve(jsonResponse([]));
        if (url.endsWith("/settings/provider")) {
          return Promise.resolve(
            jsonResponse({
              mode: "local",
              provider_type: "mock",
              provider_label: "Mock Extractor",
              api_style: "mock",
              base_url: null,
              model: "mock-extractor",
              temperature: 0.1,
              max_tokens: 6000,
              supports_json_mode: true,
              allow_external_processing: false,
              api_key_required: false,
              timeout_seconds: 120,
              retry_count: 2,
              chunk_size: 16000,
            }),
          );
        }
        if (url.endsWith("/settings/providers"))
          return Promise.resolve(jsonResponse({ providers: [] }));
        if (url.endsWith("/settings/providers/health"))
          return Promise.resolve(jsonResponse([]));
        if (url.endsWith("/settings/providers/custom"))
          return Promise.resolve(jsonResponse({ profiles: [] }));
        if (url.endsWith("/settings/providers/controls")) {
          return Promise.resolve(
            jsonResponse({ custom_provider_probe_max_age_hours: 24 }),
          );
        }
        if (url.endsWith("/dev/status")) {
          return Promise.resolve(
            jsonResponse({ templates: 0, documents: 0, jobs: 0, results: 0 }),
          );
        }

        return Promise.resolve(jsonResponse({}));
      }),
    );

    render(<App />);

    fireEvent.click(screen.getByRole("button", { name: "Schemas" }));
    fireEvent.change(screen.getByLabelText("Schema name"), {
      target: { value: "Invoice Schema" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save schema" }));

    await waitFor(() => {
      expect(savedTemplateBody).not.toBeNull();
    });

    const definition = savedTemplateBody?.definition as Record<string, unknown>;
    expect(definition.langextract_config).toBeNull();
  });

  it("loads saved LangExtract prompt and examples back into the guided editor", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn((input: string | URL | Request) => {
        const url =
          typeof input === "string"
            ? input
            : input instanceof URL
              ? input.toString()
              : input.url;

        if (url.endsWith("/templates")) {
          return Promise.resolve(
            jsonResponse([
              {
                id: 1,
                name: "Contract Schema",
                description: "Contract extraction schema.",
                document_type: "contract",
                is_locked: false,
                latest_version: "1.0.0",
                created_at: "2026-05-02T00:00:00Z",
                updated_at: "2026-05-02T00:00:00Z",
              },
            ]),
          );
        }
        if (url.endsWith("/templates/1/versions")) {
          return Promise.resolve(
            jsonResponse([
              {
                id: 11,
                template_id: 1,
                version: "1.0.0",
                definition: {
                  template_name: "Contract Schema",
                  template_version: "1.0.0",
                  document_type: "contract",
                  description: "Contract extraction schema.",
                  llm_provider_settings: {
                    mode: "local",
                    provider_type: "langextract",
                    provider_label: "LangExtract (Ollama)",
                    api_style: "langextract",
                    base_url: "http://host.docker.internal:11434/v1",
                    model: "qwen3.5:27b",
                    temperature: 0.1,
                    max_tokens: 6000,
                    supports_json_mode: false,
                    allow_external_processing: false,
                    api_key_required: false,
                    timeout_seconds: 120,
                    retry_count: 2,
                    chunk_size: 16000,
                  },
                  langextract_config: {
                    prompt_description:
                      "Extract saved vendor aliases exactly as written.",
                    examples: [
                      {
                        text: "Aliases: Acme Corp, Acme Company",
                        extractions: [
                          {
                            extraction_class: "vendor_name",
                            extraction_text: "Acme Corp, Acme Company",
                            attributes: {
                              aliases: ["Acme Corp", "Acme Company"],
                            },
                          },
                        ],
                      },
                    ],
                  },
                  extracted_fields: [],
                  calculated_fields: [],
                  output_settings: { export_formats: ["json", "csv", "excel"] },
                },
                created_at: "2026-05-02T00:00:00Z",
              },
            ]),
          );
        }
        if (url.endsWith("/documents"))
          return Promise.resolve(jsonResponse([]));
        if (url.endsWith("/jobs")) return Promise.resolve(jsonResponse([]));
        if (url.endsWith("/exports")) return Promise.resolve(jsonResponse([]));
        if (url.endsWith("/settings/provider")) {
          return Promise.resolve(
            jsonResponse({
              mode: "local",
              provider_type: "mock",
              provider_label: "Mock Extractor",
              is_persisted_default: false,
              api_style: "mock",
              base_url: null,
              model: "mock-extractor",
              temperature: 0.1,
              max_tokens: 6000,
              supports_json_mode: true,
              allow_external_processing: false,
              api_key_required: false,
              timeout_seconds: 120,
              retry_count: 2,
              chunk_size: 16000,
            }),
          );
        }
        if (url.endsWith("/settings/providers"))
          return Promise.resolve(jsonResponse({ providers: [] }));
        if (url.endsWith("/settings/providers/health"))
          return Promise.resolve(jsonResponse([]));
        if (url.endsWith("/settings/providers/custom"))
          return Promise.resolve(jsonResponse({ profiles: [] }));
        if (url.endsWith("/settings/providers/controls")) {
          return Promise.resolve(
            jsonResponse({ custom_provider_probe_max_age_hours: 24 }),
          );
        }
        if (url.endsWith("/dev/status")) {
          return Promise.resolve(
            jsonResponse({ templates: 1, documents: 0, jobs: 0, results: 0 }),
          );
        }
        if (url.endsWith("/health"))
          return Promise.resolve(jsonResponse({ status: "ok" }));

        return Promise.resolve(jsonResponse({}));
      }),
    );

    render(<App />);

    fireEvent.click(screen.getByRole("button", { name: "Schemas" }));

    await waitFor(() => {
      expect(screen.getByLabelText("LangExtract prompt")).toHaveValue(
        "Extract saved vendor aliases exactly as written.",
      );
    });
    expect(
      screen.getByLabelText("LangExtract example 1 source text"),
    ).toHaveValue("Aliases: Acme Corp, Acme Company");
    expect(
      screen.getByLabelText("Example 1 extraction 1 field name"),
    ).toHaveValue("vendor_name");
    expect(
      screen.getByLabelText("Example 1 extraction 1 attribute 1 type"),
    ).toHaveValue("string_array");
    expect(
      screen.getByLabelText("Example 1 extraction 1 attribute 1 value"),
    ).toHaveValue("Acme Corp\nAcme Company");
  });

  it("blocks LangExtract extraction when schema examples are incomplete", async () => {
    let queuedJobBody: Record<string, unknown> | null = null;

    vi.stubGlobal(
      "fetch",
      vi.fn((input: string | URL | Request, init?: RequestInit) => {
        const url =
          typeof input === "string"
            ? input
            : input instanceof URL
              ? input.toString()
              : input.url;

        if (url.endsWith("/templates")) {
          return Promise.resolve(
            jsonResponse([
              {
                id: 1,
                name: "Invoice Schema",
                description: "Invoice extraction schema.",
                document_type: "invoice",
                is_locked: false,
                latest_version: "1.0.0",
                created_at: "2026-05-02T00:00:00Z",
                updated_at: "2026-05-02T00:00:00Z",
              },
            ]),
          );
        }
        if (url.endsWith("/templates/1/versions")) {
          return Promise.resolve(
            jsonResponse([
              {
                id: 11,
                template_id: 1,
                version: "1.0.0",
                definition: {
                  template_name: "Invoice Extraction",
                  template_version: "1.0.0",
                  document_type: "invoice",
                  description: "Invoice extraction schema.",
                  llm_provider_settings: {
                    mode: "local",
                    provider_type: "langextract",
                    provider_label: "LangExtract (Ollama)",
                    api_style: "langextract",
                    base_url: "http://host.docker.internal:11434/v1",
                    model: "qwen3.5:27b",
                    temperature: 0.1,
                    max_tokens: 6000,
                    supports_json_mode: false,
                    allow_external_processing: false,
                    api_key_required: false,
                    timeout_seconds: 120,
                    retry_count: 2,
                    chunk_size: 16000,
                  },
                  extracted_fields: [
                    {
                      name: "primary_subject",
                      label: "Primary subject",
                      type: "text",
                      required: true,
                    },
                    {
                      name: "total_amount",
                      label: "Total amount",
                      type: "currency",
                      required: true,
                    },
                  ],
                  calculated_fields: [],
                  langextract_config: {
                    prompt_description: "Extract invoice facts.",
                    examples: [
                      {
                        text: "Invoice for Acme",
                        extractions: [
                          {
                            extraction_class: "total_amount",
                            extraction_text: "$100",
                            attributes: { value: "100" },
                          },
                        ],
                      },
                    ],
                  },
                  output_settings: { export_formats: ["json", "csv", "excel"] },
                },
                created_at: "2026-05-02T00:00:00Z",
              },
            ]),
          );
        }
        if (url.endsWith("/documents")) {
          return Promise.resolve(
            jsonResponse([
              {
                id: 7,
                original_filename: "invoice.txt",
                content_type: "text/plain",
                status: "uploaded",
                created_at: "2026-05-02T00:00:00Z",
              },
            ]),
          );
        }
        if (url.endsWith("/jobs") && init?.method === "POST") {
          queuedJobBody = JSON.parse(String(init.body)) as Record<
            string,
            unknown
          >;
          return Promise.resolve(
            jsonResponse({
              id: 99,
              document_id: 7,
              template_version_id: 11,
              status: "queued",
              error_message: null,
              created_at: "2026-05-02T00:00:00Z",
              updated_at: "2026-05-02T00:00:00Z",
            }),
          );
        }
        if (url.endsWith("/jobs")) return Promise.resolve(jsonResponse([]));
        if (url.endsWith("/exports")) return Promise.resolve(jsonResponse([]));
        if (url.endsWith("/settings/provider")) {
          return Promise.resolve(
            jsonResponse({
              mode: "local",
              provider_type: "langextract",
              provider_label: "LangExtract (Ollama)",
              is_persisted_default: true,
              api_style: "langextract",
              base_url: "http://host.docker.internal:11434/v1",
              model: "qwen3.5:27b",
              temperature: 0.1,
              max_tokens: 6000,
              supports_json_mode: false,
              allow_external_processing: false,
              api_key_required: false,
              timeout_seconds: 120,
              retry_count: 2,
              chunk_size: 16000,
            }),
          );
        }
        if (url.endsWith("/settings/providers"))
          return Promise.resolve(jsonResponse({ providers: [] }));
        if (url.endsWith("/settings/providers/health"))
          return Promise.resolve(jsonResponse([]));
        if (url.endsWith("/settings/providers/custom"))
          return Promise.resolve(jsonResponse({ profiles: [] }));
        if (url.endsWith("/settings/providers/controls")) {
          return Promise.resolve(
            jsonResponse({ custom_provider_probe_max_age_hours: 24 }),
          );
        }
        if (url.endsWith("/dev/status")) {
          return Promise.resolve(
            jsonResponse({ templates: 1, documents: 1, jobs: 0, results: 0 }),
          );
        }
        if (url.endsWith("/health"))
          return Promise.resolve(jsonResponse({ status: "ok" }));

        return Promise.resolve(jsonResponse({}));
      }),
    );

    render(<App />);

    const runButton = await screen.findByRole("button", {
      name: "Run extraction",
    });
    await waitFor(() => {
      expect(runButton).toBeDisabled();
    });
    expect(await screen.findByText(/primary_subject/i)).toBeInTheDocument();

    fireEvent.click(runButton);

    expect(queuedJobBody).toBeNull();
    expect(await screen.findByText(/primary_subject/i)).toBeInTheDocument();
  });

  it("queues jobs with provider_override when a persisted default provider is configured", async () => {
    let queuedJobBody: Record<string, unknown> | null = null;

    vi.stubGlobal(
      "fetch",
      vi.fn((input: string | URL | Request, init?: RequestInit) => {
        const url =
          typeof input === "string"
            ? input
            : input instanceof URL
              ? input.toString()
              : input.url;

        if (url.endsWith("/templates")) {
          return Promise.resolve(
            jsonResponse([
              {
                id: 1,
                name: "Invoice Schema",
                description: "Invoice extraction schema.",
                document_type: "invoice",
                is_locked: false,
                latest_version: "1.0.0",
                created_at: "2026-05-02T00:00:00Z",
                updated_at: "2026-05-02T00:00:00Z",
              },
            ]),
          );
        }
        if (url.endsWith("/templates/1/versions")) {
          return Promise.resolve(
            jsonResponse([
              {
                id: 11,
                template_id: 1,
                version: "1.0.0",
                definition: {
                  template_name: "Invoice Extraction",
                  template_version: "1.0.0",
                  document_type: "invoice",
                  description: "Invoice extraction schema.",
                  llm_provider_settings: {
                    mode: "local",
                    provider_type: "mock",
                    provider_label: "Mock Extractor",
                    api_style: "mock",
                    base_url: null,
                    model: "mock-extractor",
                    temperature: 0.1,
                    max_tokens: 6000,
                    supports_json_mode: true,
                    allow_external_processing: false,
                    api_key_required: false,
                    timeout_seconds: 120,
                    retry_count: 2,
                    chunk_size: 16000,
                  },
                  extracted_fields: [
                    {
                      name: "vendor_name",
                      label: "Vendor",
                      type: "text",
                      required: true,
                    },
                  ],
                  calculated_fields: [],
                  langextract_config: {
                    prompt_description: "Extract vendor facts.",
                    examples: [
                      {
                        text: "Vendor: Acme Corp",
                        extractions: [
                          {
                            extraction_class: "vendor_name",
                            extraction_text: "Acme Corp",
                            attributes: { value: "Acme Corp" },
                          },
                        ],
                      },
                    ],
                  },
                  output_settings: { export_formats: ["json", "csv", "excel"] },
                },
                created_at: "2026-05-02T00:00:00Z",
              },
            ]),
          );
        }
        if (url.endsWith("/documents")) {
          return Promise.resolve(
            jsonResponse([
              {
                id: 7,
                original_filename: "invoice.txt",
                content_type: "text/plain",
                status: "uploaded",
                created_at: "2026-05-02T00:00:00Z",
              },
            ]),
          );
        }
        if (url.endsWith("/jobs") && init?.method === "POST") {
          queuedJobBody = JSON.parse(String(init.body)) as Record<
            string,
            unknown
          >;
          return Promise.resolve(
            jsonResponse({
              id: 99,
              document_id: 7,
              template_version_id: 11,
              status: "queued",
              error_message: null,
              created_at: "2026-05-02T00:00:00Z",
              updated_at: "2026-05-02T00:00:00Z",
            }),
          );
        }
        if (url.endsWith("/jobs")) return Promise.resolve(jsonResponse([]));
        if (url.endsWith("/exports")) return Promise.resolve(jsonResponse([]));
        if (url.endsWith("/settings/provider")) {
          return Promise.resolve(
            jsonResponse({
              mode: "local",
              provider_type: "langextract",
              provider_label: "LangExtract (Ollama)",
              is_persisted_default: true,
              api_style: "langextract",
              base_url: "http://host.docker.internal:11434/v1",
              model: "qwen3.5:27b",
              temperature: 0.1,
              max_tokens: 6000,
              supports_json_mode: false,
              allow_external_processing: false,
              api_key_required: false,
              timeout_seconds: 120,
              retry_count: 2,
              chunk_size: 16000,
            }),
          );
        }
        if (url.endsWith("/settings/providers"))
          return Promise.resolve(jsonResponse({ providers: [] }));
        if (url.endsWith("/settings/providers/health"))
          return Promise.resolve(jsonResponse([]));
        if (url.endsWith("/settings/providers/custom"))
          return Promise.resolve(jsonResponse({ profiles: [] }));
        if (url.endsWith("/settings/providers/controls")) {
          return Promise.resolve(
            jsonResponse({ custom_provider_probe_max_age_hours: 24 }),
          );
        }
        if (url.endsWith("/dev/status")) {
          return Promise.resolve(
            jsonResponse({ templates: 1, documents: 1, jobs: 0, results: 0 }),
          );
        }

        return Promise.resolve(jsonResponse({}));
      }),
    );

    render(<App />);

    const runButton = await screen.findByRole("button", {
      name: "Run extraction",
    });
    await waitFor(() => {
      expect(runButton).toBeEnabled();
    });
    fireEvent.click(runButton);

    await waitFor(() => {
      expect(queuedJobBody).not.toBeNull();
    });

    expect(queuedJobBody).toMatchObject({
      document_id: 7,
      template_version_id: 11,
      provider_override: expect.objectContaining({
        provider_type: "langextract",
        model: "qwen3.5:27b",
      }),
    });
  });

  it("does not send provider_override when only the fallback default provider is loaded", async () => {
    let queuedJobBody: Record<string, unknown> | null = null;

    vi.stubGlobal(
      "fetch",
      vi.fn((input: string | URL | Request, init?: RequestInit) => {
        const url =
          typeof input === "string"
            ? input
            : input instanceof URL
              ? input.toString()
              : input.url;

        if (url.endsWith("/health")) {
          return Promise.resolve(jsonResponse({ status: "ok" }));
        }
        if (url.endsWith("/templates")) {
          return Promise.resolve(
            jsonResponse([
              {
                id: 1,
                name: "Invoice Schema",
                description: "Invoice extraction schema.",
                document_type: "invoice",
                is_locked: false,
                latest_version: "1.0.0",
                created_at: "2026-05-02T00:00:00Z",
                updated_at: "2026-05-02T00:00:00Z",
              },
            ]),
          );
        }
        if (url.endsWith("/templates/1/versions")) {
          return Promise.resolve(
            jsonResponse([
              {
                id: 11,
                template_id: 1,
                version: "1.0.0",
                definition: {
                  template_name: "Invoice Extraction",
                  template_version: "1.0.0",
                  document_type: "invoice",
                  description: "Invoice extraction schema.",
                  llm_provider_settings: {
                    mode: "cloud",
                    provider_type: "openai",
                    provider_label: "OpenAI",
                    api_style: "openai_compatible",
                    base_url: "https://api.openai.com/v1",
                    model: "gpt-4.1",
                    temperature: 0.1,
                    max_tokens: 6000,
                    supports_json_mode: true,
                    allow_external_processing: true,
                    api_key_required: true,
                    api_key_env_var: "OPENAI_API_KEY",
                    timeout_seconds: 120,
                    retry_count: 2,
                    chunk_size: 16000,
                  },
                  extracted_fields: [],
                  calculated_fields: [],
                  output_settings: { export_formats: ["json", "csv", "excel"] },
                },
                created_at: "2026-05-02T00:00:00Z",
              },
            ]),
          );
        }
        if (url.endsWith("/documents")) {
          return Promise.resolve(
            jsonResponse([
              {
                id: 7,
                original_filename: "invoice.txt",
                content_type: "text/plain",
                status: "uploaded",
                created_at: "2026-05-02T00:00:00Z",
              },
            ]),
          );
        }
        if (url.endsWith("/jobs") && init?.method === "POST") {
          queuedJobBody = JSON.parse(String(init.body)) as Record<
            string,
            unknown
          >;
          return Promise.resolve(
            jsonResponse({
              id: 99,
              document_id: 7,
              template_version_id: 11,
              status: "queued",
              error_message: null,
              created_at: "2026-05-02T00:00:00Z",
              updated_at: "2026-05-02T00:00:00Z",
            }),
          );
        }
        if (url.endsWith("/jobs")) return Promise.resolve(jsonResponse([]));
        if (url.endsWith("/exports")) return Promise.resolve(jsonResponse([]));
        if (url.endsWith("/settings/provider")) {
          return Promise.resolve(
            jsonResponse({
              mode: "local",
              provider_type: "mock",
              provider_label: "Mock Extractor",
              is_persisted_default: false,
              api_style: "mock",
              base_url: null,
              model: "mock-extractor",
              temperature: 0.1,
              max_tokens: 6000,
              supports_json_mode: true,
              allow_external_processing: false,
              api_key_required: false,
              timeout_seconds: 120,
              retry_count: 2,
              chunk_size: 16000,
            }),
          );
        }
        if (url.endsWith("/settings/providers"))
          return Promise.resolve(jsonResponse({ providers: [] }));
        if (url.endsWith("/settings/providers/health"))
          return Promise.resolve(jsonResponse([]));
        if (url.endsWith("/settings/providers/custom"))
          return Promise.resolve(jsonResponse({ profiles: [] }));
        if (url.endsWith("/settings/providers/controls")) {
          return Promise.resolve(
            jsonResponse({ custom_provider_probe_max_age_hours: 24 }),
          );
        }
        if (url.endsWith("/dev/status")) {
          return Promise.resolve(
            jsonResponse({ templates: 1, documents: 1, jobs: 0, results: 0 }),
          );
        }

        return Promise.resolve(jsonResponse({}));
      }),
    );

    render(<App />);

    const runButton = await screen.findByRole("button", {
      name: "Run extraction",
    });
    await waitFor(() => {
      expect(runButton).toBeEnabled();
    });
    fireEvent.click(runButton);

    await waitFor(() => {
      expect(queuedJobBody).not.toBeNull();
    });

    expect(queuedJobBody).toMatchObject({
      document_id: 7,
      template_version_id: 11,
    });
    expect(queuedJobBody).not.toHaveProperty("provider_override");
  });

  it("opens the most urgent reviewable job with typed review inputs", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn((input: string | URL | Request) => {
        const url =
          typeof input === "string"
            ? input
            : input instanceof URL
              ? input.toString()
              : input.url;

        if (url.endsWith("/templates")) {
          return Promise.resolve(
            jsonResponse([
              {
                id: 1,
                name: "Invoice Schema",
                description: "Invoice extraction schema.",
                document_type: "invoice",
                is_locked: false,
                latest_version: "1.0.0",
                created_at: "2026-05-02T00:00:00Z",
                updated_at: "2026-05-02T00:00:00Z",
              },
            ]),
          );
        }

        if (url.endsWith("/templates/1/versions")) {
          return Promise.resolve(
            jsonResponse([
              {
                id: 11,
                template_id: 1,
                version: "1.0.0",
                created_at: "2026-05-02T00:00:00Z",
                definition: {
                  template_name: "Invoice Schema",
                  template_version: "1.0.0",
                  document_type: "invoice",
                  description: "Invoice extraction schema.",
                  llm_provider_settings: {
                    mode: "local",
                    provider_type: "mock",
                    base_url: null,
                    model: "mock-extractor",
                    temperature: 0.1,
                    max_tokens: 4000,
                    supports_json_mode: true,
                    allow_external_processing: false,
                    timeout_seconds: 120,
                    retry_count: 2,
                    chunk_size: 16000,
                  },
                  extracted_fields: [
                    {
                      name: "vendor_name",
                      label: "Vendor Name",
                      type: "text",
                      required: true,
                      citation_required: true,
                    },
                    {
                      name: "total_amount",
                      label: "Total Amount",
                      type: "currency",
                      required: true,
                      citation_required: true,
                    },
                  ],
                  calculated_fields: [],
                  output_settings: { export_formats: ["json", "csv", "excel"] },
                },
              },
            ]),
          );
        }

        if (url.endsWith("/documents")) {
          return Promise.resolve(
            jsonResponse([
              {
                id: 2,
                original_filename: "invoice.pdf",
                content_type: "application/pdf",
                status: "completed",
                created_at: "2026-05-02T00:00:00Z",
              },
            ]),
          );
        }

        if (url.endsWith("/jobs")) {
          return Promise.resolve(
            jsonResponse([
              {
                id: 7,
                document_id: 2,
                template_version_id: 11,
                status: "completed",
                error_message: null,
                created_at: "2026-05-02T00:00:00Z",
                updated_at: "2026-05-02T00:01:00Z",
              },
            ]),
          );
        }

        if (url.endsWith("/jobs/7/result")) {
          return Promise.resolve(
            jsonResponse({
              result_id: 21,
              job_id: 7,
              result: {
                document_id: "2",
                document_type: "invoice",
                template_name: "Invoice Schema",
                template_version: "1.0.0",
                llm_provider: {
                  mode: "local",
                  provider_type: "mock",
                  base_url: null,
                  model: "mock-extractor",
                  temperature: 0.1,
                  max_tokens: 4000,
                  supports_json_mode: true,
                  allow_external_processing: false,
                  timeout_seconds: 120,
                  retry_count: 2,
                  chunk_size: 16000,
                },
                extraction_status: "completed",
                extracted_fields: [
                  {
                    field_name: "vendor_name",
                    label: "Vendor Name",
                    field_kind: "extracted",
                    data_type: "text",
                    extracted_value: "Acme Corp",
                    normalized_value: { value: "Acme Corp" },
                    confidence_score: 0.42,
                    source_text: "Acme Corp",
                    char_start: 13,
                    char_end: 22,
                    page_number: 1,
                    location_reference: "Page 1",
                    validation_status: "invalid",
                    validation_errors: ["Vendor name needs review."],
                    extraction_notes: "Low confidence extraction.",
                    requires_review: true,
                  },
                  {
                    field_name: "total_amount",
                    label: "Total Amount",
                    field_kind: "extracted",
                    data_type: "currency",
                    extracted_value: "$1200.00",
                    normalized_value: {
                      amount: 1200,
                      currency: "USD",
                      display_value: "USD 1,200.00",
                    },
                    confidence_score: 0.92,
                    source_text: "$1200.00",
                    char_start: 41,
                    char_end: 49,
                    page_number: 1,
                    location_reference: "Page 1",
                    validation_status: "valid",
                    validation_errors: [],
                    extraction_notes: "Confident extraction.",
                    requires_review: false,
                  },
                ],
                calculated_fields: [],
                fields_requiring_review: ["vendor_name"],
                document_level_notes: [],
                reviewed_at: null,
              },
            }),
          );
        }

        if (url.endsWith("/exports")) return Promise.resolve(jsonResponse([]));
        if (url.endsWith("/settings/provider"))
          return Promise.resolve(jsonResponse(null));
        if (url.endsWith("/settings/providers"))
          return Promise.resolve(jsonResponse({ providers: [] }));
        if (url.endsWith("/settings/providers/health"))
          return Promise.resolve(jsonResponse([]));
        if (url.endsWith("/dev/status")) {
          return Promise.resolve(
            jsonResponse({ templates: 1, documents: 1, jobs: 1, results: 1 }),
          );
        }

        return Promise.resolve(jsonResponse({}));
      }),
    );

    render(<App />);

    await waitFor(
      () => {
        expect(
          screen.getByRole("heading", { name: "1 fields need review" }),
        ).toBeInTheDocument();
      },
      { timeout: 3000 },
    );

    expect(screen.getByLabelText("Vendor Name review value")).toHaveValue(
      "Acme Corp",
    );
    expect(screen.getByText("Review only the exceptions")).toBeInTheDocument();
    expect(screen.getByText("mock (mock-extractor)")).toBeInTheDocument();
    expect(screen.getAllByText("Chars 13-22").length).toBeGreaterThan(0);
    expect(screen.getByText("Review signals")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /invoice\.pdf/i }),
    ).toHaveAttribute("aria-current", "true");
    expect(
      screen.getByRole("button", { name: /Vendor Name/i }),
    ).toHaveAttribute("aria-current", "true");
    expect(
      screen.getAllByText("Vendor name needs review.").length,
    ).toBeGreaterThan(0);
    expect(
      screen.getAllByText("Low confidence extraction.").length,
    ).toBeGreaterThan(0);
  });

  it("shows non-blocking desktop recovery guidance when the tauri backend is unavailable", async () => {
    (window as Window & { __TAURI_INTERNALS__?: object }).__TAURI_INTERNALS__ =
      {};

    let healthOk = false;
    invokeMock.mockImplementation(async (command: string) => {
      if (command === "get_desktop_status") {
        return makeDesktopStatus({
          backendReachable: healthOk,
          message: healthOk
            ? "Desktop runtime is ready."
            : "Desktop runtime needs backend startup.",
        });
      }
      if (command === "start_local_stack") {
        healthOk = true;
        return makeDesktopStatus({
          backendReachable: true,
          message: "Desktop runtime is ready.",
        });
      }
      throw new Error(`Unexpected invoke: ${command}`);
    });

    vi.stubGlobal(
      "fetch",
      vi.fn((input: string | URL | Request) => {
        const url =
          typeof input === "string"
            ? input
            : input instanceof URL
              ? input.toString()
              : input.url;

        if (url.endsWith("/health")) {
          return Promise.resolve(
            healthOk
              ? jsonResponse({ status: "ok" })
              : textResponse("Backend health check failed.", 503),
          );
        }
        if (url.endsWith("/templates"))
          return Promise.resolve(jsonResponse([]));
        if (url.endsWith("/documents"))
          return Promise.resolve(jsonResponse([]));
        if (url.endsWith("/jobs")) return Promise.resolve(jsonResponse([]));
        if (url.endsWith("/exports")) return Promise.resolve(jsonResponse([]));
        if (url.endsWith("/settings/provider")) {
          return Promise.resolve(
            jsonResponse({
              mode: "local",
              provider_type: "mock",
              base_url: null,
              model: "mock-extractor",
              temperature: 0.1,
              max_tokens: 4000,
              supports_json_mode: true,
              allow_external_processing: false,
              timeout_seconds: 120,
              retry_count: 2,
              chunk_size: 16000,
            }),
          );
        }
        if (url.endsWith("/settings/providers"))
          return Promise.resolve(jsonResponse({ providers: [] }));
        if (url.endsWith("/settings/providers/health"))
          return Promise.resolve(jsonResponse([]));
        if (url.endsWith("/settings/providers/custom"))
          return Promise.resolve(jsonResponse({ profiles: [] }));
        if (url.endsWith("/dev/status"))
          return Promise.resolve(
            jsonResponse({ templates: 0, documents: 0, jobs: 0, results: 0 }),
          );

        return Promise.resolve(jsonResponse({}));
      }),
    );

    render(<App />);

    expect(
      await screen.findByText(
        "Desktop setup needs attention, but it no longer blocks the workspace.",
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "New extraction" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Backend is not yet reachable on 127.0.0.1:8000."),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Start local stack" }));

    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith("start_local_stack");
    });
    await waitFor(() => {
      expect(
        screen.getByText(
          "Desktop runtime is ready. Confirm the defaults once, then get back to extraction.",
        ),
      ).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: "Dismiss reminder" }));

    await waitFor(() => {
      expect(
        screen.queryByText(
          "Desktop runtime is ready. Confirm the defaults once, then get back to extraction.",
        ),
      ).not.toBeInTheDocument();
    });
  });

  it("shows the configured provider for in-flight jobs before a result exists", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn((input: string | URL | Request) => {
        const url =
          typeof input === "string"
            ? input
            : input instanceof URL
              ? input.toString()
              : input.url;

        if (url.endsWith("/templates")) {
          return Promise.resolve(
            jsonResponse([
              {
                id: 1,
                name: "Invoice Schema",
                description: "Invoice extraction schema.",
                document_type: "invoice",
                is_locked: false,
                latest_version: "1.0.0",
                created_at: "2026-05-02T00:00:00Z",
                updated_at: "2026-05-02T00:00:00Z",
              },
            ]),
          );
        }

        if (url.endsWith("/templates/1/versions")) {
          return Promise.resolve(
            jsonResponse([
              {
                id: 11,
                template_id: 1,
                version: "1.0.0",
                definition: {
                  template_name: "Invoice Schema",
                  template_version: "1.0.0",
                  document_type: "invoice",
                  description: "Invoice extraction schema.",
                  llm_provider_settings: {
                    mode: "local",
                    provider_type: "mock",
                    provider_label: "Mock Extractor",
                    api_style: "mock",
                    base_url: null,
                    model: "mock-extractor",
                    temperature: 0.1,
                    max_tokens: 4000,
                    supports_json_mode: true,
                    allow_external_processing: false,
                    timeout_seconds: 120,
                    retry_count: 2,
                    chunk_size: 16000,
                  },
                  extracted_fields: [],
                  calculated_fields: [],
                  output_settings: { export_formats: ["json", "csv", "excel"] },
                },
                created_at: "2026-05-02T00:00:00Z",
              },
            ]),
          );
        }

        if (url.endsWith("/documents")) {
          return Promise.resolve(
            jsonResponse([
              {
                id: 2,
                original_filename: "invoice.pdf",
                content_type: "application/pdf",
                status: "processing",
                created_at: "2026-05-02T00:00:00Z",
              },
            ]),
          );
        }

        if (url.endsWith("/jobs")) {
          return Promise.resolve(
            jsonResponse([
              {
                id: 7,
                document_id: 2,
                template_version_id: 11,
                provider_override: {
                  mode: "local",
                  provider_type: "langextract",
                  provider_label: "LangExtract (Ollama)",
                  api_style: "langextract",
                  base_url: "http://host.docker.internal:11434/v1",
                  model: "qwen3.5:27b",
                  temperature: 0.1,
                  max_tokens: 4000,
                  supports_json_mode: false,
                  allow_external_processing: false,
                  timeout_seconds: 120,
                  retry_count: 2,
                  chunk_size: 16000,
                },
                status: "running",
                error_message: null,
                created_at: "2026-05-02T00:00:00Z",
                updated_at: "2026-05-02T00:01:00Z",
              },
            ]),
          );
        }

        if (url.endsWith("/exports")) return Promise.resolve(jsonResponse([]));
        if (url.endsWith("/settings/provider"))
          return Promise.resolve(jsonResponse(null));
        if (url.endsWith("/settings/providers"))
          return Promise.resolve(jsonResponse({ providers: [] }));
        if (url.endsWith("/settings/providers/health"))
          return Promise.resolve(jsonResponse([]));
        if (url.endsWith("/dev/status")) {
          return Promise.resolve(
            jsonResponse({ templates: 1, documents: 1, jobs: 1, results: 0 }),
          );
        }

        return Promise.resolve(jsonResponse({}));
      }),
    );

    render(<App />);

    await waitFor(() => {
      expect(
        screen.getByRole("heading", { name: "Processing invoice.pdf" }),
      ).toBeInTheDocument();
    });

    expect(screen.getByText("langextract (qwen3.5:27b)")).toBeInTheDocument();
  });

  it("shows a probe-required badge for LangExtract settings health", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn((input: string | URL | Request) => {
        const url =
          typeof input === "string"
            ? input
            : input instanceof URL
              ? input.toString()
              : input.url;

        if (url.endsWith("/templates"))
          return Promise.resolve(jsonResponse([]));
        if (url.endsWith("/documents"))
          return Promise.resolve(jsonResponse([]));
        if (url.endsWith("/jobs")) return Promise.resolve(jsonResponse([]));
        if (url.endsWith("/exports")) return Promise.resolve(jsonResponse([]));
        if (url.endsWith("/settings/provider"))
          return Promise.resolve(jsonResponse(null));
        if (url.endsWith("/settings/providers")) {
          return Promise.resolve(
            jsonResponse({
              providers: [
                {
                  key: "langextract-ollama",
                  label: "LangExtract (Ollama)",
                  description: "Experimental grounded extraction adapter.",
                  mode: "local",
                  provider_type: "langextract",
                  api_style: "langextract",
                  base_url: "http://host.docker.internal:11434/v1",
                  model: "qwen3.5:27b",
                  enabled: true,
                  recommended: false,
                  tags: ["local", "experimental", "grounded", "ollama"],
                  capabilities: {
                    supports_chat_completions: false,
                    supports_json_mode: false,
                    supports_streaming: false,
                    supports_remote_processing: false,
                    requires_api_key: false,
                    supports_local_runtime: true,
                  },
                  settings: {
                    mode: "local",
                    provider_type: "langextract",
                    provider_label: "LangExtract (Ollama)",
                    api_style: "langextract",
                    base_url: "http://host.docker.internal:11434/v1",
                    model: "qwen3.5:27b",
                    temperature: 0.1,
                    max_tokens: 6000,
                    supports_json_mode: false,
                    allow_external_processing: false,
                    timeout_seconds: 120,
                    retry_count: 2,
                    chunk_size: 16000,
                  },
                },
              ],
            }),
          );
        }
        if (url.endsWith("/settings/providers/health")) {
          return Promise.resolve(
            jsonResponse([
              {
                provider_key: "langextract-ollama",
                provider_type: "langextract",
                ready: false,
                status: "probe_required",
                checks: [
                  "Run a live probe to confirm Ollama runtime and model availability",
                ],
              },
            ]),
          );
        }
        if (url.endsWith("/settings/providers/custom"))
          return Promise.resolve(jsonResponse({ profiles: [] }));
        if (url.endsWith("/settings/providers/controls")) {
          return Promise.resolve(
            jsonResponse({ custom_provider_probe_max_age_hours: 24 }),
          );
        }
        if (url.endsWith("/dev/status")) {
          return Promise.resolve(
            jsonResponse({ templates: 0, documents: 0, jobs: 0, results: 0 }),
          );
        }

        return Promise.resolve(jsonResponse({}));
      }),
    );

    render(<App />);

    fireEvent.click(screen.getByRole("button", { name: "Settings" }));

    await waitFor(() => {
      expect(screen.getByText("Probe required")).toBeInTheDocument();
    });

    expect(screen.queryByText("Base URL")).not.toBeInTheDocument();
    const detailsButton = screen.getByRole("button", { name: "Show details" });
    expect(detailsButton).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(detailsButton);
    expect(
      screen.getByRole("button", { name: "Hide details" }),
    ).toHaveAttribute("aria-expanded", "true");
    expect(await screen.findByText("Base URL")).toBeInTheDocument();
  });

  it("offers direct recovery actions when the web backend is unavailable", async () => {
    const fetchMock = vi.fn((input: string | URL | Request) => {
      const url =
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.toString()
            : input.url;

      if (url.endsWith("/health")) {
        return Promise.resolve(
          textResponse("Backend health check failed.", 503),
        );
      }
      if (url.endsWith("/dev/status")) {
        return Promise.resolve(
          jsonResponse({ templates: 0, documents: 0, jobs: 0, results: 0 }),
        );
      }
      return Promise.resolve(jsonResponse({}));
    });

    vi.stubGlobal("fetch", fetchMock);

    render(<App />);

    const outageBanner = await screen.findByRole("alert");
    expect(outageBanner).toHaveTextContent(
      /Backend unavailable\. The extraction workspace is open/,
    );
    expect(
      screen.getAllByRole("button", { name: "Retry connection" }).length,
    ).toBeGreaterThan(0);
    expect(
      screen.getAllByRole("button", { name: "Open settings" }).length,
    ).toBeGreaterThan(0);
    expect(
      screen.getAllByRole("button", { name: "Open settings" }).length,
    ).toBeGreaterThan(1);
    expect(
      screen.getAllByRole("button", { name: "Open help" }).length,
    ).toBeGreaterThan(0);
    expect(screen.getByText("Workspace data unavailable")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Reconnect backend to upload" }),
    ).toBeDisabled();

    fireEvent.click(screen.getAllByRole("button", { name: "Open help" })[0]);
    expect(
      await screen.findByRole("heading", {
        name: "Get the next step when setup, review, or evidence is unclear.",
      }),
    ).toBeInTheDocument();

    const healthCallsBeforeRetry = fetchMock.mock.calls.filter(([request]) => {
      const url =
        typeof request === "string"
          ? request
          : request instanceof URL
            ? request.toString()
            : request.url;
      return url.endsWith("/health");
    }).length;

    fireEvent.click(screen.getByRole("button", { name: "Extractions" }));
    fireEvent.click(
      screen.getAllByRole("button", { name: "Retry connection" })[0],
    );

    await waitFor(() => {
      const healthCallsAfterRetry = fetchMock.mock.calls.filter(([request]) => {
        const url =
          typeof request === "string"
            ? request
            : request instanceof URL
              ? request.toString()
              : request.url;
        return url.endsWith("/health");
      }).length;
      expect(healthCallsAfterRetry).toBeGreaterThan(healthCallsBeforeRetry);
    });
  });

  it("refreshes desktop runtime status from settings after onboarding is dismissed", async () => {
    (window as Window & { __TAURI_INTERNALS__?: object }).__TAURI_INTERNALS__ =
      {};
    window.localStorage.setItem(
      "extractflow.desktop.onboarding.dismissed.v1",
      "true",
    );

    invokeMock.mockImplementation(async (command: string) => {
      if (command === "get_desktop_status") {
        return makeDesktopStatus({
          backendReachable: true,
          message: "Desktop runtime is ready.",
        });
      }
      throw new Error(`Unexpected invoke: ${command}`);
    });

    vi.stubGlobal(
      "fetch",
      vi.fn((input: string | URL | Request) => {
        const url =
          typeof input === "string"
            ? input
            : input instanceof URL
              ? input.toString()
              : input.url;

        if (url.endsWith("/health"))
          return Promise.resolve(jsonResponse({ status: "ok" }));
        if (url.endsWith("/templates"))
          return Promise.resolve(jsonResponse([]));
        if (url.endsWith("/documents"))
          return Promise.resolve(jsonResponse([]));
        if (url.endsWith("/jobs")) return Promise.resolve(jsonResponse([]));
        if (url.endsWith("/exports")) return Promise.resolve(jsonResponse([]));
        if (url.endsWith("/settings/provider")) {
          return Promise.resolve(
            jsonResponse({
              mode: "local",
              provider_type: "mock",
              base_url: null,
              model: "mock-extractor",
              temperature: 0.1,
              max_tokens: 4000,
              supports_json_mode: true,
              allow_external_processing: false,
              timeout_seconds: 120,
              retry_count: 2,
              chunk_size: 16000,
            }),
          );
        }
        if (url.endsWith("/settings/providers"))
          return Promise.resolve(jsonResponse({ providers: [] }));
        if (url.endsWith("/settings/providers/health"))
          return Promise.resolve(jsonResponse([]));
        if (url.endsWith("/settings/providers/custom"))
          return Promise.resolve(jsonResponse({ profiles: [] }));
        if (url.endsWith("/dev/status"))
          return Promise.resolve(
            jsonResponse({ templates: 0, documents: 0, jobs: 0, results: 0 }),
          );

        return Promise.resolve(jsonResponse({}));
      }),
    );

    render(<App />);

    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith("get_desktop_status");
    });
    invokeMock.mockClear();

    fireEvent.click(
      within(screen.getAllByRole("navigation", { name: "Setup" })[0]).getByRole(
        "button",
        { name: "Settings" },
      ),
    );

    expect(
      (await screen.findAllByRole("button", { name: "Refresh status" })).length,
    ).toBeGreaterThan(0);

    fireEvent.click(
      screen.getAllByRole("button", { name: "Refresh status" })[0],
    );

    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith("get_desktop_status");
    });
  });

  it("rejects an invalid custom provider draft before saving", async () => {
    const fetchMock = vi.fn((input: string | URL | Request) => {
      const url =
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.toString()
            : input.url;

      if (url.endsWith("/health"))
        return Promise.resolve(jsonResponse({ status: "ok" }));
      if (url.endsWith("/templates")) return Promise.resolve(jsonResponse([]));
      if (url.endsWith("/documents")) return Promise.resolve(jsonResponse([]));
      if (url.endsWith("/jobs")) return Promise.resolve(jsonResponse([]));
      if (url.endsWith("/exports")) return Promise.resolve(jsonResponse([]));
      if (url.endsWith("/settings/provider"))
        return Promise.resolve(jsonResponse(null));
      if (url.endsWith("/settings/providers"))
        return Promise.resolve(jsonResponse({ providers: [] }));
      if (url.endsWith("/settings/providers/health"))
        return Promise.resolve(jsonResponse([]));
      if (url.endsWith("/settings/providers/custom"))
        return Promise.resolve(jsonResponse({ profiles: [] }));
      if (url.endsWith("/dev/status"))
        return Promise.resolve(
          jsonResponse({ templates: 0, documents: 0, jobs: 0, results: 0 }),
        );

      return Promise.resolve(jsonResponse({}));
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<App />);

    fireEvent.click(
      within(screen.getAllByRole("navigation", { name: "Setup" })[0]).getByRole(
        "button",
        { name: "Settings" },
      ),
    );

    const advancedProfilesButton = screen.getByRole("button", {
      name: "Open advanced provider profiles",
    });
    expect(advancedProfilesButton).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(advancedProfilesButton);
    expect(
      screen.getByRole("button", { name: "Hide advanced provider profiles" }),
    ).toHaveAttribute("aria-expanded", "true");

    await screen.findByRole("heading", {
      name: "Advanced provider profiles",
    });

    fireEvent.change(screen.getByLabelText("Display label"), {
      target: { value: "" },
    });
    fireEvent.click(
      screen.getByRole("button", {
        name: "Set custom provider as default",
      }),
    );

    expect(
      await screen.findByText("Custom provider label is required."),
    ).toBeInTheDocument();
    expect(
      fetchMock.mock.calls.some(([input, init]) => {
        const url =
          typeof input === "string"
            ? input
            : input instanceof URL
              ? input.toString()
              : input.url;
        return (
          url.endsWith("/settings/provider") &&
          (init as RequestInit | undefined)?.method === "PUT"
        );
      }),
    ).toBe(false);
  });

  it("probes the custom provider draft and surfaces the live probe result", async () => {
    const fetchMock = vi.fn(
      (input: string | URL | Request, init?: RequestInit) => {
        const url =
          typeof input === "string"
            ? input
            : input instanceof URL
              ? input.toString()
              : input.url;

        if (url.endsWith("/health"))
          return Promise.resolve(jsonResponse({ status: "ok" }));
        if (url.endsWith("/templates"))
          return Promise.resolve(jsonResponse([]));
        if (url.endsWith("/documents"))
          return Promise.resolve(jsonResponse([]));
        if (url.endsWith("/jobs")) return Promise.resolve(jsonResponse([]));
        if (url.endsWith("/exports")) return Promise.resolve(jsonResponse([]));
        if (url.endsWith("/settings/provider"))
          return Promise.resolve(jsonResponse(null));
        if (url.endsWith("/settings/providers"))
          return Promise.resolve(jsonResponse({ providers: [] }));
        if (url.endsWith("/settings/providers/health"))
          return Promise.resolve(jsonResponse([]));
        if (url.endsWith("/settings/providers/custom"))
          return Promise.resolve(jsonResponse({ profiles: [] }));
        if (
          url.endsWith("/settings/providers/probe") &&
          init?.method === "POST"
        ) {
          return Promise.resolve(
            jsonResponse({
              provider_type: "private_gateway",
              reachable: true,
              status: "reachable",
              detail: "Endpoint responded with HTTP 200.",
              endpoint: "https://gateway.example/v1",
              status_code: 200,
            }),
          );
        }
        if (url.endsWith("/dev/status"))
          return Promise.resolve(
            jsonResponse({ templates: 0, documents: 0, jobs: 0, results: 0 }),
          );

        return Promise.resolve(jsonResponse({}));
      },
    );
    vi.stubGlobal("fetch", fetchMock);

    render(<App />);

    fireEvent.click(
      within(screen.getAllByRole("navigation", { name: "Setup" })[0]).getByRole(
        "button",
        { name: "Settings" },
      ),
    );

    fireEvent.click(
      screen.getByRole("button", { name: "Open advanced provider profiles" }),
    );

    await screen.findByRole("heading", {
      name: "Advanced provider profiles",
    });

    fireEvent.change(screen.getByLabelText("Display label"), {
      target: { value: "QA Gateway" },
    });
    fireEvent.change(screen.getByLabelText("Base URL"), {
      target: { value: "https://gateway.example/v1" },
    });
    fireEvent.click(
      screen.getByRole("button", {
        name: "Probe custom provider",
      }),
    );

    await waitFor(() => {
      const probeCall = fetchMock.mock.calls.find(([input, requestInit]) => {
        const url =
          typeof input === "string"
            ? input
            : input instanceof URL
              ? input.toString()
              : input.url;
        return (
          url.endsWith("/settings/providers/probe") &&
          requestInit?.method === "POST"
        );
      });
      expect(probeCall).toBeTruthy();
      const request = probeCall?.[1] as RequestInit;
      expect(request.body).toContain("https://gateway.example/v1");
    });
    expect(
      await screen.findByText("QA Gateway: Endpoint responded with HTTP 200."),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Reachable: Endpoint responded with HTTP 200."),
    ).toBeInTheDocument();
  });

  it("blocks saving a custom provider profile until the probe succeeds", async () => {
    const fetchMock = vi.fn(
      (input: string | URL | Request, init?: RequestInit) => {
        const url =
          typeof input === "string"
            ? input
            : input instanceof URL
              ? input.toString()
              : input.url;

        if (url.endsWith("/health"))
          return Promise.resolve(jsonResponse({ status: "ok" }));
        if (url.endsWith("/templates"))
          return Promise.resolve(jsonResponse([]));
        if (url.endsWith("/documents"))
          return Promise.resolve(jsonResponse([]));
        if (url.endsWith("/jobs")) return Promise.resolve(jsonResponse([]));
        if (url.endsWith("/exports")) return Promise.resolve(jsonResponse([]));
        if (url.endsWith("/settings/provider"))
          return Promise.resolve(jsonResponse(null));
        if (url.endsWith("/settings/providers"))
          return Promise.resolve(jsonResponse({ providers: [] }));
        if (url.endsWith("/settings/providers/health"))
          return Promise.resolve(jsonResponse([]));
        if (url.endsWith("/settings/providers/custom"))
          return Promise.resolve(jsonResponse({ profiles: [] }));
        if (
          url.endsWith("/settings/providers/probe") &&
          init?.method === "POST"
        ) {
          return Promise.resolve(
            jsonResponse({
              provider_type: "private_gateway",
              reachable: false,
              status: "not_ready",
              detail: "Missing environment variable OPENAI_API_KEY.",
              endpoint: null,
              status_code: null,
            }),
          );
        }
        if (url.endsWith("/dev/status"))
          return Promise.resolve(
            jsonResponse({ templates: 0, documents: 0, jobs: 0, results: 0 }),
          );

        return Promise.resolve(jsonResponse({}));
      },
    );
    vi.stubGlobal("fetch", fetchMock);

    render(<App />);

    fireEvent.click(
      within(screen.getAllByRole("navigation", { name: "Setup" })[0]).getByRole(
        "button",
        { name: "Settings" },
      ),
    );

    fireEvent.click(
      screen.getByRole("button", { name: "Open advanced provider profiles" }),
    );

    await screen.findByRole("heading", {
      name: "Advanced provider profiles",
    });

    fireEvent.change(screen.getByLabelText("Display label"), {
      target: { value: "QA Gateway" },
    });
    fireEvent.change(screen.getByLabelText("Base URL"), {
      target: { value: "https://gateway.example/v1" },
    });
    fireEvent.change(screen.getByLabelText("API key env var"), {
      target: { value: "OPENAI_API_KEY" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save profile" }));

    expect(
      await screen.findByText(
        "Custom provider save blocked until provider probe succeeds. Missing environment variable OPENAI_API_KEY.",
      ),
    ).toBeInTheDocument();
    expect(
      fetchMock.mock.calls.some(([input, requestInit]) => {
        const url =
          typeof input === "string"
            ? input
            : input instanceof URL
              ? input.toString()
              : input.url;
        return (
          url.endsWith("/settings/providers/custom") &&
          requestInit?.method === "POST"
        );
      }),
    ).toBe(false);
  });

  it("activates a saved custom provider profile as the default provider", async () => {
    let activeProvider: Record<string, unknown> | null = null;
    const profile = {
      id: "profile-1",
      name: "Finance Gateway",
      last_probe_at: isoHoursAgo(1),
      last_probe_status: "reachable",
      last_probe_detail: "Endpoint responded with HTTP 200.",
      updated_at: isoHoursAgo(120),
      settings: {
        mode: "cloud",
        provider_type: "finance_gateway",
        provider_label: "Finance Gateway",
        api_style: "openai_compatible",
        base_url: "https://finance.example/v1",
        api_key_env_var: "FINANCE_API_KEY",
        api_key_required: true,
        model: "finance-llm",
        temperature: 0.1,
        max_tokens: 6000,
        supports_json_mode: true,
        allow_external_processing: true,
        timeout_seconds: 120,
        retry_count: 2,
        chunk_size: 16000,
      },
    };

    vi.stubGlobal(
      "fetch",
      vi.fn((input: string | URL | Request, init?: RequestInit) => {
        const url =
          typeof input === "string"
            ? input
            : input instanceof URL
              ? input.toString()
              : input.url;

        if (url.endsWith("/health"))
          return Promise.resolve(jsonResponse({ status: "ok" }));
        if (url.endsWith("/templates"))
          return Promise.resolve(jsonResponse([]));
        if (url.endsWith("/documents"))
          return Promise.resolve(jsonResponse([]));
        if (url.endsWith("/jobs")) return Promise.resolve(jsonResponse([]));
        if (url.endsWith("/exports")) return Promise.resolve(jsonResponse([]));
        if (url.endsWith("/settings/provider"))
          return Promise.resolve(jsonResponse(activeProvider));
        if (url.endsWith("/settings/providers"))
          return Promise.resolve(jsonResponse({ providers: [] }));
        if (url.endsWith("/settings/providers/health"))
          return Promise.resolve(jsonResponse([]));
        if (
          url.endsWith("/settings/providers/probe") &&
          init?.method === "POST"
        ) {
          return Promise.resolve(
            jsonResponse({
              provider_type: "finance_gateway",
              reachable: true,
              status: "reachable",
              detail: "Endpoint responded with HTTP 200.",
              endpoint: "https://finance.example/v1/models",
              status_code: 200,
            }),
          );
        }
        if (
          url.endsWith("/settings/providers/custom/profile-1/activate") &&
          init?.method === "POST"
        ) {
          activeProvider = profile.settings;
          return Promise.resolve(jsonResponse(profile.settings));
        }
        if (url.endsWith("/settings/providers/custom"))
          return Promise.resolve(jsonResponse({ profiles: [profile] }));
        if (url.endsWith("/dev/status"))
          return Promise.resolve(
            jsonResponse({ templates: 0, documents: 0, jobs: 0, results: 0 }),
          );

        return Promise.resolve(jsonResponse({}));
      }),
    );

    render(<App />);

    for (const button of screen.getAllByRole("button", { name: "Settings" })) {
      fireEvent.click(button);
    }

    fireEvent.click(
      screen.getByRole("button", { name: "Open advanced provider profiles" }),
    );

    expect(await screen.findByText("Finance Gateway")).toBeInTheDocument();
    expect(
      screen.getByText("reachable: Endpoint responded with HTTP 200."),
    ).toBeInTheDocument();
    expect(screen.getByText("Verified")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Activate default" }));

    expect(
      await screen.findByText(
        'Activated custom provider profile "Finance Gateway" as default.',
      ),
    ).toBeInTheDocument();
    expect(screen.getAllByText("finance_gateway").length).toBeGreaterThan(0);
    expect(screen.getAllByText("finance-llm").length).toBeGreaterThan(0);
  });

  it("blocks activating a stale custom provider profile until it is reverified", async () => {
    const staleProfile = {
      id: "profile-stale",
      name: "Stale Gateway",
      last_probe_at: isoHoursAgo(48),
      last_probe_status: "reachable",
      last_probe_detail: "Endpoint responded with HTTP 200.",
      updated_at: isoHoursAgo(48),
      settings: {
        mode: "cloud",
        provider_type: "stale_gateway",
        provider_label: "Stale Gateway",
        api_style: "openai_compatible",
        base_url: "https://stale.example/v1",
        api_key_env_var: "STALE_API_KEY",
        api_key_required: true,
        model: "stale-llm",
        temperature: 0.1,
        max_tokens: 6000,
        supports_json_mode: true,
        allow_external_processing: true,
        timeout_seconds: 120,
        retry_count: 2,
        chunk_size: 16000,
      },
    };

    const fetchMock = vi.fn((input: string | URL | Request) => {
      const url =
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.toString()
            : input.url;

      if (url.endsWith("/health"))
        return Promise.resolve(jsonResponse({ status: "ok" }));
      if (url.endsWith("/templates")) return Promise.resolve(jsonResponse([]));
      if (url.endsWith("/documents")) return Promise.resolve(jsonResponse([]));
      if (url.endsWith("/jobs")) return Promise.resolve(jsonResponse([]));
      if (url.endsWith("/exports")) return Promise.resolve(jsonResponse([]));
      if (url.endsWith("/settings/provider"))
        return Promise.resolve(jsonResponse(null));
      if (url.endsWith("/settings/providers"))
        return Promise.resolve(jsonResponse({ providers: [] }));
      if (url.endsWith("/settings/providers/health"))
        return Promise.resolve(jsonResponse([]));
      if (url.endsWith("/settings/providers/custom")) {
        return Promise.resolve(jsonResponse({ profiles: [staleProfile] }));
      }
      if (url.endsWith("/dev/status")) {
        return Promise.resolve(
          jsonResponse({ templates: 0, documents: 0, jobs: 0, results: 0 }),
        );
      }

      return Promise.resolve(jsonResponse({}));
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<App />);

    fireEvent.click(
      within(screen.getAllByRole("navigation", { name: "Setup" })[0]).getByRole(
        "button",
        { name: "Settings" },
      ),
    );

    fireEvent.click(
      screen.getByRole("button", { name: "Open advanced provider profiles" }),
    );

    expect(await screen.findByText("Stale Gateway")).toBeInTheDocument();
    expect(screen.getByText("Stale")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Activate default" }));

    expect(
      await screen.findByText(
        'Custom provider activation blocked until "Stale Gateway" is reverified. The last successful probe is missing or older than 24 hours.',
      ),
    ).toBeInTheDocument();
    expect(
      fetchMock.mock.calls.some(([input, requestInit]) => {
        const url =
          typeof input === "string"
            ? input
            : input instanceof URL
              ? input.toString()
              : input.url;
        return (
          url.endsWith("/settings/providers/custom/profile-stale/activate") &&
          requestInit?.method === "POST"
        );
      }),
    ).toBe(false);
  });

  it("reverifies a stale custom provider profile from the saved profile card", async () => {
    const staleProfile = {
      id: "profile-stale",
      name: "Stale Gateway",
      last_probe_at: isoHoursAgo(48),
      last_probe_status: "reachable",
      last_probe_detail: "Endpoint responded with HTTP 200.",
      updated_at: isoHoursAgo(48),
      settings: {
        mode: "cloud",
        provider_type: "stale_gateway",
        provider_label: "Stale Gateway",
        api_style: "openai_compatible",
        base_url: "https://stale.example/v1",
        api_key_env_var: "STALE_API_KEY",
        api_key_required: true,
        model: "stale-llm",
        temperature: 0.1,
        max_tokens: 6000,
        supports_json_mode: true,
        allow_external_processing: true,
        timeout_seconds: 120,
        retry_count: 2,
        chunk_size: 16000,
      },
    };
    const verifiedProfile = {
      ...staleProfile,
      last_probe_at: isoHoursAgo(1),
      last_probe_status: "reachable",
      last_probe_detail: "Endpoint responded with HTTP 200.",
    };
    let profiles = [staleProfile];

    vi.stubGlobal(
      "fetch",
      vi.fn((input: string | URL | Request, init?: RequestInit) => {
        const url =
          typeof input === "string"
            ? input
            : input instanceof URL
              ? input.toString()
              : input.url;

        if (url.endsWith("/health"))
          return Promise.resolve(jsonResponse({ status: "ok" }));
        if (url.endsWith("/templates"))
          return Promise.resolve(jsonResponse([]));
        if (url.endsWith("/documents"))
          return Promise.resolve(jsonResponse([]));
        if (url.endsWith("/jobs")) return Promise.resolve(jsonResponse([]));
        if (url.endsWith("/exports")) return Promise.resolve(jsonResponse([]));
        if (url.endsWith("/settings/provider"))
          return Promise.resolve(jsonResponse(null));
        if (url.endsWith("/settings/providers"))
          return Promise.resolve(jsonResponse({ providers: [] }));
        if (url.endsWith("/settings/providers/health"))
          return Promise.resolve(jsonResponse([]));
        if (
          url.endsWith("/settings/providers/custom/profile-stale/reverify") &&
          init?.method === "POST"
        ) {
          profiles = [verifiedProfile];
          return Promise.resolve(jsonResponse(verifiedProfile));
        }
        if (url.endsWith("/settings/providers/custom"))
          return Promise.resolve(jsonResponse({ profiles }));
        if (url.endsWith("/dev/status")) {
          return Promise.resolve(
            jsonResponse({ templates: 0, documents: 0, jobs: 0, results: 0 }),
          );
        }

        return Promise.resolve(jsonResponse({}));
      }),
    );

    render(<App />);

    fireEvent.click(
      within(screen.getAllByRole("navigation", { name: "Setup" })[0]).getByRole(
        "button",
        { name: "Settings" },
      ),
    );

    fireEvent.click(
      screen.getByRole("button", { name: "Open advanced provider profiles" }),
    );

    expect(await screen.findByText("Stale Gateway")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Reverify" }));

    expect(
      await screen.findByText(
        'Reverified custom provider profile "Stale Gateway".',
      ),
    ).toBeInTheDocument();
    expect(screen.getByText("Verified")).toBeInTheDocument();
  });

  it("runs schema dry-run and surfaces version diff on the schema page", async () => {
    const invoiceDefinition = {
      template_name: "Invoice Schema",
      template_version: "1.0.0",
      document_type: "invoice",
      description: "Invoice extraction schema.",
      llm_provider_settings: {
        mode: "local",
        provider_type: "mock",
        provider_label: "Mock Extractor",
        api_style: "mock",
        base_url: null,
        model: "mock-extractor",
        temperature: 0.1,
        max_tokens: 6000,
        supports_json_mode: true,
        allow_external_processing: false,
        timeout_seconds: 120,
        retry_count: 2,
        chunk_size: 16000,
      },
      langextract_config: null,
      extracted_fields: [
        {
          name: "vendor_name",
          label: "Vendor Name",
          type: "text",
          required: true,
          citation_required: true,
          description: "Vendor",
        },
      ],
      calculated_fields: [],
      output_settings: { export_formats: ["json"] },
      minimum_confidence_threshold: 0.5,
      review_required_on_low_confidence: true,
    };

    vi.stubGlobal(
      "fetch",
      vi.fn((input: string | URL | Request, init?: RequestInit) => {
        const url =
          typeof input === "string"
            ? input
            : input instanceof URL
              ? input.toString()
              : input.url;

        if (url.endsWith("/health"))
          return Promise.resolve(jsonResponse({ status: "ok" }));
        if (url.endsWith("/templates/dry-run") && init?.method === "POST") {
          return Promise.resolve(
            jsonResponse({
              ok: true,
              schema_errors: [],
              document_level_notes: [],
              extracted_fields: [
                {
                  field_name: "vendor_name",
                  label: "Vendor Name",
                  data_type: "text",
                  validation_status: "valid",
                  validation_errors: [],
                  requires_review: false,
                  confidence_score: 0.72,
                  extracted_value: "Acme Corp",
                  normalized_value: { value: "Acme Corp" },
                  source_text: "Acme Corp",
                  extraction_notes: "Mock extraction used.",
                },
              ],
              fields_requiring_review: [],
            }),
          );
        }
        if (
          url.endsWith("/templates/version-diff") &&
          init?.method === "POST"
        ) {
          return Promise.resolve(
            jsonResponse({
              before_version: "1.0.0",
              after_version: "1.1.0",
              extracted_added: ["purchase_order"],
              extracted_removed: [],
              extracted_changed: [],
              calculated_added: [],
              calculated_removed: [],
              calculated_changed: [],
              langextract_changed: false,
            }),
          );
        }
        if (url.endsWith("/templates"))
          return Promise.resolve(
            jsonResponse([
              {
                id: 1,
                name: "Invoice Schema",
                description: "Invoice extraction schema.",
                document_type: "invoice",
                is_locked: false,
                latest_version: "1.0.0",
                created_at: "2026-05-02T00:00:00Z",
                updated_at: "2026-05-02T00:00:00Z",
              },
            ]),
          );
        if (url.endsWith("/templates/1/versions")) {
          return Promise.resolve(
            jsonResponse([
              {
                id: 101,
                template_id: 1,
                version: "1.0.0",
                definition: invoiceDefinition,
                created_at: "2026-05-02T00:00:00Z",
              },
            ]),
          );
        }
        if (url.endsWith("/documents"))
          return Promise.resolve(jsonResponse([]));
        if (url.endsWith("/jobs")) return Promise.resolve(jsonResponse([]));
        if (url.endsWith("/exports")) return Promise.resolve(jsonResponse([]));
        if (url.endsWith("/settings/provider")) {
          return Promise.resolve(
            jsonResponse(invoiceDefinition.llm_provider_settings),
          );
        }
        if (url.endsWith("/settings/providers"))
          return Promise.resolve(jsonResponse({ providers: [] }));
        if (url.endsWith("/settings/providers/health"))
          return Promise.resolve(jsonResponse([]));
        if (url.endsWith("/settings/providers/custom"))
          return Promise.resolve(jsonResponse({ profiles: [] }));
        if (url.endsWith("/settings/providers/controls")) {
          return Promise.resolve(
            jsonResponse({ custom_provider_probe_max_age_hours: 24 }),
          );
        }
        if (url.endsWith("/dev/status")) {
          return Promise.resolve(
            jsonResponse({ templates: 1, documents: 0, jobs: 0, results: 0 }),
          );
        }

        return Promise.resolve(jsonResponse({}));
      }),
    );

    render(<App />);

    fireEvent.click(await screen.findByRole("button", { name: "Schemas" }));

    fireEvent.change(await screen.findByLabelText("Base schema"), {
      target: { value: "1" },
    });
    fireEvent.change(screen.getByLabelText("Version"), {
      target: { value: "101" },
    });

    expect(
      await screen.findByText("Added fields: purchase_order"),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Run dry run" }));

    expect(await screen.findByText("valid")).toBeInTheDocument();
    expect(
      screen.getByText("Dry run passed validation for all extracted fields."),
    ).toBeInTheDocument();
  });

  it("loads audit events on the Audit page", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn((input: string | URL | Request) => {
        const url =
          typeof input === "string"
            ? input
            : input instanceof URL
              ? input.toString()
              : input.url;

        if (url.includes("/audit/events")) {
          return Promise.resolve(
            jsonResponse({
              events: [
                {
                  id: 1,
                  actor: "qa-user",
                  action: "review.saved",
                  object_type: "result",
                  object_id: "21",
                  metadata: {
                    job_id: 7,
                    field_names: ["vendor_name"],
                  },
                  created_at: "2026-05-02T12:07:00.000Z",
                },
              ],
              total: 1,
            }),
          );
        }
        if (url.endsWith("/templates"))
          return Promise.resolve(jsonResponse([]));
        if (url.endsWith("/documents"))
          return Promise.resolve(jsonResponse([]));
        if (url.endsWith("/jobs")) return Promise.resolve(jsonResponse([]));
        if (url.endsWith("/exports")) return Promise.resolve(jsonResponse([]));
        if (url.endsWith("/settings/provider"))
          return Promise.resolve(jsonResponse(null));
        if (url.endsWith("/settings/providers"))
          return Promise.resolve(jsonResponse({ providers: [] }));
        if (url.endsWith("/settings/providers/health"))
          return Promise.resolve(jsonResponse([]));
        if (url.endsWith("/settings/export-policy")) {
          return Promise.resolve(
            jsonResponse({ require_review_cleared: false }),
          );
        }
        if (url.endsWith("/dev/status")) {
          return Promise.resolve(
            jsonResponse({ templates: 0, documents: 0, jobs: 0, results: 0 }),
          );
        }

        return Promise.resolve(jsonResponse({}));
      }),
    );

    render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: "Audit" }));

    expect(await screen.findByText("review · saved")).toBeInTheDocument();
    expect(screen.getByText("qa-user")).toBeInTheDocument();
  });

  it("honors ?job= deep links when the workspace loads", async () => {
    window.history.pushState({}, "", "/?job=7");

    vi.stubGlobal(
      "fetch",
      vi.fn((input: string | URL | Request) => {
        const url =
          typeof input === "string"
            ? input
            : input instanceof URL
              ? input.toString()
              : input.url;

        if (url.endsWith("/templates")) {
          return Promise.resolve(
            jsonResponse([
              {
                id: 1,
                name: "Invoice Schema",
                description: "Invoice extraction schema.",
                document_type: "invoice",
                is_locked: false,
                latest_version: "1.0.0",
                created_at: "2026-05-02T00:00:00Z",
                updated_at: "2026-05-02T00:00:00Z",
              },
            ]),
          );
        }
        if (url.endsWith("/templates/1/versions")) {
          return Promise.resolve(
            jsonResponse([
              {
                id: 11,
                template_id: 1,
                version: "1.0.0",
                created_at: "2026-05-02T00:00:00Z",
                definition: {
                  template_name: "Invoice Schema",
                  template_version: "1.0.0",
                  document_type: "invoice",
                  description: "Invoice extraction schema.",
                  llm_provider_settings: {
                    mode: "local",
                    provider_type: "mock",
                    base_url: null,
                    model: "mock-extractor",
                    temperature: 0.1,
                    max_tokens: 4000,
                    supports_json_mode: true,
                    allow_external_processing: false,
                    timeout_seconds: 120,
                    retry_count: 2,
                    chunk_size: 16000,
                  },
                  extracted_fields: [
                    {
                      name: "vendor_name",
                      label: "Vendor Name",
                      type: "text",
                      required: true,
                      citation_required: true,
                    },
                  ],
                  calculated_fields: [],
                  output_settings: { export_formats: ["json"] },
                },
              },
            ]),
          );
        }
        if (url.endsWith("/documents")) {
          return Promise.resolve(
            jsonResponse([
              {
                id: 2,
                original_filename: "invoice.pdf",
                content_type: "application/pdf",
                status: "completed",
                created_at: "2026-05-02T00:00:00Z",
              },
            ]),
          );
        }
        if (url.endsWith("/jobs")) {
          return Promise.resolve(
            jsonResponse([
              {
                id: 7,
                document_id: 2,
                template_version_id: 11,
                status: "completed",
                error_message: null,
                created_at: "2026-05-02T00:00:00Z",
                updated_at: "2026-05-02T00:01:00Z",
              },
            ]),
          );
        }
        if (url.endsWith("/jobs/7/result")) {
          return Promise.resolve(
            jsonResponse({
              result_id: 21,
              job_id: 7,
              result: {
                document_id: "2",
                document_type: "invoice",
                template_name: "Invoice Schema",
                template_version: "1.0.0",
                llm_provider: {
                  mode: "local",
                  provider_type: "mock",
                  base_url: null,
                  model: "mock-extractor",
                  temperature: 0.1,
                  max_tokens: 4000,
                  supports_json_mode: true,
                  allow_external_processing: false,
                  timeout_seconds: 120,
                  retry_count: 2,
                  chunk_size: 16000,
                },
                extraction_status: "completed",
                extracted_fields: [
                  {
                    field_name: "vendor_name",
                    label: "Vendor Name",
                    field_kind: "extracted",
                    data_type: "text",
                    extracted_value: "Acme Corp",
                    normalized_value: { value: "Acme Corp" },
                    confidence_score: 0.42,
                    validation_status: "invalid",
                    validation_errors: [],
                    requires_review: true,
                  },
                ],
                calculated_fields: [],
                fields_requiring_review: ["vendor_name"],
                document_level_notes: [],
                reviewed_at: null,
              },
            }),
          );
        }
        if (url.endsWith("/documents/2/parsed-text")) {
          return Promise.resolve(
            jsonResponse({
              document_id: 2,
              text: "Vendor Name: Acme Corp",
              source: "parsed_file",
            }),
          );
        }
        if (url.endsWith("/exports")) return Promise.resolve(jsonResponse([]));
        if (url.endsWith("/settings/provider"))
          return Promise.resolve(jsonResponse(null));
        if (url.endsWith("/settings/providers"))
          return Promise.resolve(jsonResponse({ providers: [] }));
        if (url.endsWith("/settings/providers/health"))
          return Promise.resolve(jsonResponse([]));
        if (url.endsWith("/settings/export-policy")) {
          return Promise.resolve(
            jsonResponse({ require_review_cleared: false }),
          );
        }
        if (url.includes("/audit/events")) {
          return Promise.resolve(jsonResponse({ events: [], total: 0 }));
        }
        if (url.endsWith("/dev/status")) {
          return Promise.resolve(
            jsonResponse({ templates: 1, documents: 1, jobs: 1, results: 1 }),
          );
        }

        return Promise.resolve(jsonResponse({}));
      }),
    );

    render(<App />);

    await waitFor(() => {
      expect(screen.getByLabelText("Vendor Name review value")).toHaveValue(
        "Acme Corp",
      );
    });
    expect(
      screen.getByRole("button", { name: /invoice\.pdf/i }),
    ).toHaveAttribute("aria-current", "true");
  });

  it("blocks export when review backlog policy is enabled", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn((input: string | URL | Request) => {
        const url =
          typeof input === "string"
            ? input
            : input instanceof URL
              ? input.toString()
              : input.url;

        if (url.endsWith("/templates")) {
          return Promise.resolve(
            jsonResponse([
              {
                id: 1,
                name: "Invoice Schema",
                description: "Invoice extraction schema.",
                document_type: "invoice",
                is_locked: false,
                latest_version: "1.0.0",
                created_at: "2026-05-02T00:00:00Z",
                updated_at: "2026-05-02T00:00:00Z",
              },
            ]),
          );
        }
        if (url.endsWith("/templates/1/versions")) {
          return Promise.resolve(
            jsonResponse([
              {
                id: 11,
                template_id: 1,
                version: "1.0.0",
                created_at: "2026-05-02T00:00:00Z",
                definition: {
                  template_name: "Invoice Schema",
                  template_version: "1.0.0",
                  document_type: "invoice",
                  description: "Invoice extraction schema.",
                  llm_provider_settings: {
                    mode: "local",
                    provider_type: "mock",
                    base_url: null,
                    model: "mock-extractor",
                    temperature: 0.1,
                    max_tokens: 4000,
                    supports_json_mode: true,
                    allow_external_processing: false,
                    timeout_seconds: 120,
                    retry_count: 2,
                    chunk_size: 16000,
                  },
                  extracted_fields: [
                    {
                      name: "vendor_name",
                      label: "Vendor Name",
                      type: "text",
                      required: true,
                    },
                  ],
                  calculated_fields: [],
                  output_settings: { export_formats: ["json"] },
                },
              },
            ]),
          );
        }
        if (url.endsWith("/documents")) {
          return Promise.resolve(
            jsonResponse([
              {
                id: 2,
                original_filename: "invoice.pdf",
                content_type: "application/pdf",
                status: "completed",
                created_at: "2026-05-02T00:00:00Z",
              },
            ]),
          );
        }
        if (url.endsWith("/jobs")) {
          return Promise.resolve(
            jsonResponse([
              {
                id: 7,
                document_id: 2,
                template_version_id: 11,
                status: "completed",
                error_message: null,
                created_at: "2026-05-02T00:00:00Z",
                updated_at: "2026-05-02T00:01:00Z",
              },
            ]),
          );
        }
        if (url.endsWith("/jobs/7/result")) {
          return Promise.resolve(
            jsonResponse({
              result_id: 21,
              job_id: 7,
              result: {
                document_id: "2",
                document_type: "invoice",
                template_name: "Invoice Schema",
                template_version: "1.0.0",
                llm_provider: {
                  mode: "local",
                  provider_type: "mock",
                  base_url: null,
                  model: "mock-extractor",
                  temperature: 0.1,
                  max_tokens: 4000,
                  supports_json_mode: true,
                  allow_external_processing: false,
                  timeout_seconds: 120,
                  retry_count: 2,
                  chunk_size: 16000,
                },
                extraction_status: "completed",
                extracted_fields: [
                  {
                    field_name: "vendor_name",
                    label: "Vendor Name",
                    field_kind: "extracted",
                    data_type: "text",
                    extracted_value: "Acme Corp",
                    normalized_value: { value: "Acme Corp" },
                    confidence_score: 0.42,
                    validation_status: "invalid",
                    validation_errors: [],
                    requires_review: true,
                  },
                ],
                calculated_fields: [],
                fields_requiring_review: ["vendor_name"],
                document_level_notes: [],
                reviewed_at: null,
              },
            }),
          );
        }
        if (url.endsWith("/exports")) return Promise.resolve(jsonResponse([]));
        if (url.endsWith("/settings/provider"))
          return Promise.resolve(jsonResponse(null));
        if (url.endsWith("/settings/providers"))
          return Promise.resolve(jsonResponse({ providers: [] }));
        if (url.endsWith("/settings/providers/health"))
          return Promise.resolve(jsonResponse([]));
        if (url.endsWith("/settings/export-policy")) {
          return Promise.resolve(
            jsonResponse({ require_review_cleared: true }),
          );
        }
        if (url.includes("/audit/events")) {
          return Promise.resolve(jsonResponse({ events: [], total: 0 }));
        }
        if (url.endsWith("/dev/status")) {
          return Promise.resolve(
            jsonResponse({ templates: 1, documents: 1, jobs: 1, results: 1 }),
          );
        }

        return Promise.resolve(jsonResponse({}));
      }),
    );

    render(<App />);

    await waitFor(() => {
      expect(
        screen.getByText("Export blocked until review is cleared."),
      ).toBeInTheDocument();
    });
    expect(screen.getByRole("button", { name: "Export JSON" })).toBeDisabled();
  });

  it("requires saving pending review before export when no fields are flagged", async () => {
    let reviewStatus = "pending";
    let reviewedAt: string | null = null;

    vi.stubGlobal(
      "fetch",
      vi.fn((input: string | URL | Request, init?: RequestInit) => {
        const url =
          typeof input === "string"
            ? input
            : input instanceof URL
              ? input.toString()
              : input.url;

        if (url.endsWith("/results/21/review") && init?.method === "POST") {
          reviewStatus = "reviewed";
          reviewedAt = "2026-05-02T00:03:00Z";
          return Promise.resolve(
            jsonResponse({
              document_id: "2",
              document_type: "invoice",
              template_name: "Invoice Schema",
              template_version: "1.0.0",
              llm_provider: {
                mode: "local",
                provider_type: "mock",
                base_url: null,
                model: "mock-extractor",
                temperature: 0.1,
                max_tokens: 4000,
                supports_json_mode: true,
                allow_external_processing: false,
                timeout_seconds: 120,
                retry_count: 2,
                chunk_size: 16000,
              },
              extraction_status: "completed",
              extracted_fields: [
                {
                  field_name: "vendor_name",
                  label: "Vendor Name",
                  field_kind: "extracted",
                  data_type: "text",
                  extracted_value: "Acme Corp",
                  normalized_value: { value: "Acme Corp" },
                  confidence_score: 0.99,
                  validation_status: "reviewed",
                  validation_errors: [],
                  requires_review: false,
                },
              ],
              calculated_fields: [],
              fields_requiring_review: [],
              document_level_notes: [],
              reviewed_at: reviewedAt,
              review_status: reviewStatus,
            }),
          );
        }
        if (url.endsWith("/templates")) {
          return Promise.resolve(
            jsonResponse([
              {
                id: 1,
                name: "Invoice Schema",
                description: "Invoice extraction schema.",
                document_type: "invoice",
                is_locked: false,
                latest_version: "1.0.0",
                created_at: "2026-05-02T00:00:00Z",
                updated_at: "2026-05-02T00:00:00Z",
              },
            ]),
          );
        }
        if (url.endsWith("/templates/1/versions")) {
          return Promise.resolve(
            jsonResponse([
              {
                id: 11,
                template_id: 1,
                version: "1.0.0",
                created_at: "2026-05-02T00:00:00Z",
                definition: {
                  template_name: "Invoice Schema",
                  template_version: "1.0.0",
                  document_type: "invoice",
                  description: "Invoice extraction schema.",
                  llm_provider_settings: {
                    mode: "local",
                    provider_type: "mock",
                    base_url: null,
                    model: "mock-extractor",
                    temperature: 0.1,
                    max_tokens: 4000,
                    supports_json_mode: true,
                    allow_external_processing: false,
                    timeout_seconds: 120,
                    retry_count: 2,
                    chunk_size: 16000,
                  },
                  extracted_fields: [
                    {
                      name: "vendor_name",
                      label: "Vendor Name",
                      type: "text",
                      required: true,
                    },
                  ],
                  calculated_fields: [],
                  output_settings: { export_formats: ["json"] },
                },
              },
            ]),
          );
        }
        if (url.endsWith("/documents")) {
          return Promise.resolve(
            jsonResponse([
              {
                id: 2,
                original_filename: "invoice.pdf",
                content_type: "application/pdf",
                status: "completed",
                created_at: "2026-05-02T00:00:00Z",
              },
            ]),
          );
        }
        if (url.endsWith("/jobs")) {
          return Promise.resolve(
            jsonResponse([
              {
                id: 7,
                document_id: 2,
                template_version_id: 11,
                status: "completed",
                error_message: null,
                created_at: "2026-05-02T00:00:00Z",
                updated_at: "2026-05-02T00:01:00Z",
              },
            ]),
          );
        }
        if (url.endsWith("/jobs/7/result")) {
          return Promise.resolve(
            jsonResponse({
              result_id: 21,
              job_id: 7,
              result: {
                document_id: "2",
                document_type: "invoice",
                template_name: "Invoice Schema",
                template_version: "1.0.0",
                llm_provider: {
                  mode: "local",
                  provider_type: "mock",
                  base_url: null,
                  model: "mock-extractor",
                  temperature: 0.1,
                  max_tokens: 4000,
                  supports_json_mode: true,
                  allow_external_processing: false,
                  timeout_seconds: 120,
                  retry_count: 2,
                  chunk_size: 16000,
                },
                extraction_status: "completed",
                extracted_fields: [
                  {
                    field_name: "vendor_name",
                    label: "Vendor Name",
                    field_kind: "extracted",
                    data_type: "text",
                    extracted_value: "Acme Corp",
                    normalized_value: { value: "Acme Corp" },
                    confidence_score: 0.99,
                    validation_status: "reviewed",
                    validation_errors: [],
                    requires_review: false,
                  },
                ],
                calculated_fields: [],
                fields_requiring_review: [],
                document_level_notes: [],
                reviewed_at: reviewedAt,
                review_status: reviewStatus,
              },
            }),
          );
        }
        if (url.endsWith("/exports")) return Promise.resolve(jsonResponse([]));
        if (url.endsWith("/settings/provider"))
          return Promise.resolve(jsonResponse(null));
        if (url.endsWith("/settings/providers"))
          return Promise.resolve(jsonResponse({ providers: [] }));
        if (url.endsWith("/settings/providers/health"))
          return Promise.resolve(jsonResponse([]));
        if (url.endsWith("/settings/export-policy")) {
          return Promise.resolve(
            jsonResponse({ require_review_cleared: true }),
          );
        }
        if (url.includes("/audit/events")) {
          return Promise.resolve(jsonResponse({ events: [], total: 0 }));
        }
        if (url.endsWith("/dev/status")) {
          return Promise.resolve(
            jsonResponse({ templates: 1, documents: 1, jobs: 1, results: 1 }),
          );
        }

        return Promise.resolve(jsonResponse({}));
      }),
    );

    render(<App />);

    await waitFor(() => {
      expect(
        screen.getByText("Review confirmation required"),
      ).toBeInTheDocument();
    });
    expect(
      screen.getByRole("button", { name: "Save review" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Export JSON" })).toBeDisabled();

    fireEvent.click(screen.getByRole("button", { name: "Save review" }));

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Export JSON" })).toBeEnabled();
    });
    expect(
      screen.queryByRole("button", { name: "Save review" }),
    ).not.toBeInTheDocument();
  });

  it("cancels a queued extraction job from the workspace", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn((input: string | URL | Request, init?: RequestInit) => {
        const url =
          typeof input === "string"
            ? input
            : input instanceof URL
              ? input.toString()
              : input.url;

        if (url.endsWith("/jobs/7/cancel") && init?.method === "POST") {
          return Promise.resolve(
            jsonResponse({
              id: 7,
              document_id: 2,
              template_version_id: 11,
              status: "cancelled",
              error_message: "Cancelled by operator.",
              progress_stage: "cancelled",
              progress_pct: 0,
              created_at: "2026-05-02T00:00:00Z",
              updated_at: "2026-05-02T00:02:00Z",
            }),
          );
        }
        if (url.endsWith("/templates")) {
          return Promise.resolve(
            jsonResponse([
              {
                id: 1,
                name: "Invoice Schema",
                description: "Invoice extraction schema.",
                document_type: "invoice",
                is_locked: false,
                latest_version: "1.0.0",
                created_at: "2026-05-02T00:00:00Z",
                updated_at: "2026-05-02T00:00:00Z",
              },
            ]),
          );
        }
        if (url.endsWith("/documents")) {
          return Promise.resolve(
            jsonResponse([
              {
                id: 2,
                original_filename: "invoice.pdf",
                content_type: "application/pdf",
                status: "queued",
                created_at: "2026-05-02T00:00:00Z",
              },
            ]),
          );
        }
        if (url.endsWith("/jobs")) {
          return Promise.resolve(
            jsonResponse([
              {
                id: 7,
                document_id: 2,
                template_version_id: 11,
                status: "queued",
                error_message: null,
                progress_stage: "queued",
                progress_pct: 0,
                created_at: "2026-05-02T00:00:00Z",
                updated_at: "2026-05-02T00:00:00Z",
              },
            ]),
          );
        }
        if (url.endsWith("/exports")) return Promise.resolve(jsonResponse([]));
        if (url.endsWith("/settings/provider"))
          return Promise.resolve(jsonResponse(null));
        if (url.endsWith("/settings/providers"))
          return Promise.resolve(jsonResponse({ providers: [] }));
        if (url.endsWith("/settings/providers/health"))
          return Promise.resolve(jsonResponse([]));
        if (url.endsWith("/settings/export-policy")) {
          return Promise.resolve(
            jsonResponse({ require_review_cleared: false }),
          );
        }
        if (url.includes("/audit/events")) {
          return Promise.resolve(jsonResponse({ events: [], total: 0 }));
        }
        if (url.endsWith("/dev/status")) {
          return Promise.resolve(
            jsonResponse({ templates: 1, documents: 1, jobs: 1, results: 0 }),
          );
        }

        return Promise.resolve(jsonResponse({}));
      }),
    );

    render(<App />);

    fireEvent.click(await screen.findByRole("button", { name: "Cancel job" }));
    expect(
      await screen.findByText("Extraction job cancelled."),
    ).toBeInTheDocument();
  });

  it("shows audit page load errors", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn((input: string | URL | Request) => {
        const url =
          typeof input === "string"
            ? input
            : input instanceof URL
              ? input.toString()
              : input.url;

        if (url.includes("/audit/events")) {
          return Promise.resolve(
            textResponse("Audit service unavailable.", 503),
          );
        }
        if (url.endsWith("/templates"))
          return Promise.resolve(jsonResponse([]));
        if (url.endsWith("/documents"))
          return Promise.resolve(jsonResponse([]));
        if (url.endsWith("/jobs")) return Promise.resolve(jsonResponse([]));
        if (url.endsWith("/exports")) return Promise.resolve(jsonResponse([]));
        if (url.endsWith("/settings/provider"))
          return Promise.resolve(jsonResponse(null));
        if (url.endsWith("/settings/providers"))
          return Promise.resolve(jsonResponse({ providers: [] }));
        if (url.endsWith("/settings/providers/health"))
          return Promise.resolve(jsonResponse([]));
        if (url.endsWith("/settings/export-policy")) {
          return Promise.resolve(
            jsonResponse({ require_review_cleared: false }),
          );
        }
        if (url.endsWith("/dev/status")) {
          return Promise.resolve(
            jsonResponse({ templates: 0, documents: 0, jobs: 0, results: 0 }),
          );
        }

        return Promise.resolve(jsonResponse({}));
      }),
    );

    render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: "Audit" }));

    expect(
      await screen.findByText("Audit service unavailable."),
    ).toBeInTheDocument();
  });
});
