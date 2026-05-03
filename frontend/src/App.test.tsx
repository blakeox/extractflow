import { fireEvent, render, screen, waitFor } from "@testing-library/react";
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
    delete (window as Window & { __TAURI_INTERNALS__?: object }).__TAURI_INTERNALS__;
    vi.stubGlobal("fetch", vi.fn((input: string | URL | Request) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;

      if (url.endsWith("/templates")) return Promise.resolve(jsonResponse([]));
      if (url.endsWith("/documents")) return Promise.resolve(jsonResponse([]));
      if (url.endsWith("/jobs")) return Promise.resolve(jsonResponse([]));
      if (url.endsWith("/exports")) return Promise.resolve(jsonResponse([]));
      if (url.endsWith("/settings/provider")) return Promise.resolve(jsonResponse(null));
      if (url.endsWith("/settings/providers")) return Promise.resolve(jsonResponse({ providers: [] }));
      if (url.endsWith("/settings/providers/health")) return Promise.resolve(jsonResponse([]));
      if (url.endsWith("/settings/providers/probe")) return Promise.resolve(jsonResponse({ provider_type: "mock", reachable: true, status: "ready", detail: "ok" }));
      if (url.endsWith("/dev/status")) {
        return Promise.resolve(jsonResponse({ templates: 0, documents: 0, jobs: 0, results: 0 }));
      }

      return Promise.resolve(jsonResponse({}));
    }));
  });

  it("renders the workspace shell from mocked API state", async () => {
    render(<App />);

    expect(screen.getByRole("heading", { name: "ExtractFlow" })).toBeInTheDocument();

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Extractions" })).toBeInTheDocument();
    });

    expect(screen.getAllByRole("button", { name: "Open settings" }).length).toBeGreaterThan(0);
    expect(screen.getByRole("heading", { name: "New extraction" })).toBeInTheDocument();
    expect(screen.getByText("Upload PDF or source file")).toBeInTheDocument();
  });

  it("opens the most urgent reviewable job with typed review inputs", async () => {
    vi.stubGlobal("fetch", vi.fn((input: string | URL | Request) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;

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
                  { name: "vendor_name", label: "Vendor Name", type: "text", required: true, citation_required: true },
                  { name: "total_amount", label: "Total Amount", type: "currency", required: true, citation_required: true },
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
                  normalized_value: { amount: 1200, currency: "USD", display_value: "USD 1,200.00" },
                  confidence_score: 0.92,
                  source_text: "$1200.00",
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
      if (url.endsWith("/settings/provider")) return Promise.resolve(jsonResponse(null));
      if (url.endsWith("/settings/providers")) return Promise.resolve(jsonResponse({ providers: [] }));
      if (url.endsWith("/settings/providers/health")) return Promise.resolve(jsonResponse([]));
      if (url.endsWith("/dev/status")) {
        return Promise.resolve(jsonResponse({ templates: 1, documents: 1, jobs: 1, results: 1 }));
      }

      return Promise.resolve(jsonResponse({}));
    }));

    render(<App />);

    await waitFor(
      () => {
        expect(screen.getByRole("heading", { name: "1 fields need review" })).toBeInTheDocument();
      },
      { timeout: 3000 },
    );

    expect(screen.getByLabelText("Vendor Name review value")).toHaveValue("Acme Corp");
    expect(screen.getByText("Review only the exceptions")).toBeInTheDocument();
  });

  it("shows desktop onboarding when the tauri backend is unavailable and starts the local stack", async () => {
    (window as Window & { __TAURI_INTERNALS__?: object }).__TAURI_INTERNALS__ = {};

    let healthOk = false;
    invokeMock.mockImplementation(async (command: string) => {
      if (command === "get_desktop_status") {
        return makeDesktopStatus({
          backendReachable: healthOk,
          message: healthOk ? "Desktop runtime is ready." : "Desktop runtime needs backend startup.",
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

    vi.stubGlobal("fetch", vi.fn((input: string | URL | Request) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;

      if (url.endsWith("/health")) {
        return Promise.resolve(healthOk ? jsonResponse({ status: "ok" }) : textResponse("Backend health check failed.", 503));
      }
      if (url.endsWith("/templates")) return Promise.resolve(jsonResponse([]));
      if (url.endsWith("/documents")) return Promise.resolve(jsonResponse([]));
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
      if (url.endsWith("/settings/providers")) return Promise.resolve(jsonResponse({ providers: [] }));
      if (url.endsWith("/settings/providers/health")) return Promise.resolve(jsonResponse([]));
      if (url.endsWith("/dev/status")) return Promise.resolve(jsonResponse({ templates: 0, documents: 0, jobs: 0, results: 0 }));

      return Promise.resolve(jsonResponse({}));
    }));

    render(<App />);

    expect(await screen.findByRole("dialog", { name: "Finish the runtime checks, then get back to the extraction workspace." })).toBeInTheDocument();
    expect(screen.getByText("Backend is not yet reachable on 127.0.0.1:8000.")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Start local stack" }));

    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith("start_local_stack");
    });
    await waitFor(() => {
      expect(screen.getByText("Frontend can reach the API on 127.0.0.1:8000.")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: "Continue to extraction workspace" }));

    await waitFor(() => {
      expect(screen.queryByRole("dialog", { name: "Finish the runtime checks, then get back to the extraction workspace." })).not.toBeInTheDocument();
    });
  });

  it("refreshes desktop runtime status from settings after onboarding is dismissed", async () => {
    (window as Window & { __TAURI_INTERNALS__?: object }).__TAURI_INTERNALS__ = {};
    window.localStorage.setItem("extractflow.desktop.onboarding.dismissed.v1", "true");

    invokeMock.mockImplementation(async (command: string) => {
      if (command === "get_desktop_status") {
        return makeDesktopStatus({
          backendReachable: true,
          message: "Desktop runtime is ready.",
        });
      }
      throw new Error(`Unexpected invoke: ${command}`);
    });

    vi.stubGlobal("fetch", vi.fn((input: string | URL | Request) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;

      if (url.endsWith("/health")) return Promise.resolve(jsonResponse({ status: "ok" }));
      if (url.endsWith("/templates")) return Promise.resolve(jsonResponse([]));
      if (url.endsWith("/documents")) return Promise.resolve(jsonResponse([]));
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
      if (url.endsWith("/settings/providers")) return Promise.resolve(jsonResponse({ providers: [] }));
      if (url.endsWith("/settings/providers/health")) return Promise.resolve(jsonResponse([]));
      if (url.endsWith("/dev/status")) return Promise.resolve(jsonResponse({ templates: 0, documents: 0, jobs: 0, results: 0 }));

      return Promise.resolve(jsonResponse({}));
    }));

    render(<App />);

    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith("get_desktop_status");
    });
    invokeMock.mockClear();

    for (const button of screen.getAllByRole("button", { name: "Settings" })) {
      fireEvent.click(button);
    }

    expect((await screen.findAllByRole("button", { name: "Refresh status" })).length).toBeGreaterThan(0);

    fireEvent.click(screen.getAllByRole("button", { name: "Refresh status" })[0]);

    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith("get_desktop_status");
    });
  });
});
