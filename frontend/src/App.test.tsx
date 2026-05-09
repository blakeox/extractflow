import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { App } from "./App";

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

    expect(
      screen.getAllByRole("button", { name: "Open settings" }).length,
    ).toBeGreaterThan(0);
    expect(
      screen.getByRole("heading", { name: "New extraction" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Upload PDF or source file")).toBeInTheDocument();
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
    const examplesField = screen.getByLabelText(
      "LangExtract examples (JSON array)",
    );

    fireEvent.change(promptField, {
      target: { value: "Extract contract parties exactly as written." },
    });
    fireEvent.change(examplesField, {
      target: {
        value: JSON.stringify(
          [
            {
              text: "Parties: Acme Corp and River Bank",
              extractions: [
                {
                  extraction_class: "primary_subject",
                  extraction_text: "Acme Corp",
                  attributes: { value: "Acme Corp" },
                },
              ],
            },
          ],
          null,
          2,
        ),
      },
    });
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
    expect(langextractConfig.examples).toEqual([
      {
        text: "Parties: Acme Corp and River Bank",
        extractions: [
          {
            extraction_class: "primary_subject",
            extraction_text: "Acme Corp",
            attributes: { value: "Acme Corp" },
          },
        ],
      },
    ]);
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
    expect(screen.getAllByText("Chars 13-22").length).toBeGreaterThan(0);
  });

  it("shows desktop onboarding when the tauri backend is unavailable and starts the local stack", async () => {
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
      await screen.findByRole("dialog", {
        name: "Finish the runtime checks, then get back to the extraction workspace.",
      }),
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
        screen.getByText("Frontend can reach the API on 127.0.0.1:8000."),
      ).toBeInTheDocument();
    });

    fireEvent.click(
      screen.getByRole("button", { name: "Continue to extraction workspace" }),
    );

    await waitFor(() => {
      expect(
        screen.queryByRole("dialog", {
          name: "Finish the runtime checks, then get back to the extraction workspace.",
        }),
      ).not.toBeInTheDocument();
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
      within(screen.getAllByRole("navigation", { name: "Admin" })[0]).getByRole(
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
      within(screen.getAllByRole("navigation", { name: "Admin" })[0]).getByRole(
        "button",
        { name: "Settings" },
      ),
    );

    const customProviderSection = (
      await screen.findAllByRole("heading", { name: "Custom provider" })
    )[0].closest("section");
    expect(customProviderSection).not.toBeNull();
    const customProviderScope = within(customProviderSection as HTMLElement);

    fireEvent.change(customProviderScope.getByLabelText("Display label"), {
      target: { value: "" },
    });
    fireEvent.click(
      customProviderScope.getByRole("button", {
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
      within(screen.getAllByRole("navigation", { name: "Admin" })[0]).getByRole(
        "button",
        { name: "Settings" },
      ),
    );

    const customProviderSection = (
      await screen.findAllByRole("heading", { name: "Custom provider" })
    )[0].closest("section");
    expect(customProviderSection).not.toBeNull();
    const customProviderScope = within(customProviderSection as HTMLElement);

    fireEvent.change(customProviderScope.getByLabelText("Display label"), {
      target: { value: "QA Gateway" },
    });
    fireEvent.change(customProviderScope.getByLabelText("Base URL"), {
      target: { value: "https://gateway.example/v1" },
    });
    fireEvent.click(
      customProviderScope.getByRole("button", {
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
      within(screen.getAllByRole("navigation", { name: "Admin" })[0]).getByRole(
        "button",
        { name: "Settings" },
      ),
    );

    const customProviderSection = (
      await screen.findAllByRole("heading", { name: "Custom provider" })
    )[0].closest("section");
    expect(customProviderSection).not.toBeNull();
    const customProviderScope = within(customProviderSection as HTMLElement);

    fireEvent.change(customProviderScope.getByLabelText("Display label"), {
      target: { value: "QA Gateway" },
    });
    fireEvent.change(customProviderScope.getByLabelText("Base URL"), {
      target: { value: "https://gateway.example/v1" },
    });
    fireEvent.change(customProviderScope.getByLabelText("API key env var"), {
      target: { value: "OPENAI_API_KEY" },
    });
    fireEvent.click(
      customProviderScope.getByRole("button", { name: "Save profile" }),
    );

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
      within(screen.getAllByRole("navigation", { name: "Admin" })[0]).getByRole(
        "button",
        { name: "Settings" },
      ),
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
      within(screen.getAllByRole("navigation", { name: "Admin" })[0]).getByRole(
        "button",
        { name: "Settings" },
      ),
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
});
