import { Page, Route } from "@playwright/test";

type ProviderSettings = {
  mode: "local" | "cloud";
  provider_type: string;
  provider_label?: string | null;
  api_style?: "mock" | "openai_compatible" | "azure_openai";
  base_url: string | null;
  api_key_env_var?: string | null;
  api_key_required?: boolean;
  deployment?: string | null;
  api_version?: string | null;
  model: string;
  temperature: number;
  max_tokens: number;
  supports_json_mode: boolean;
  allow_external_processing: boolean;
  timeout_seconds: number;
  retry_count: number;
  chunk_size: number;
};

type ProviderCatalogEntry = {
  key: string;
  label: string;
  description: string;
  mode: "local" | "cloud";
  provider_type: string;
  api_style: "mock" | "openai_compatible" | "azure_openai";
  base_url: string | null;
  model: string;
  enabled: boolean;
  recommended: boolean;
  api_key_env_var?: string | null;
  deployment?: string | null;
  tags: string[];
  capabilities: {
    supports_chat_completions: boolean;
    supports_json_mode: boolean;
    supports_streaming: boolean;
    supports_remote_processing: boolean;
    requires_api_key: boolean;
    supports_local_runtime: boolean;
  };
  settings: ProviderSettings;
};

type ProviderHealth = {
  provider_key: string;
  provider_type: string;
  ready: boolean;
  status: string;
  checks: string[];
};

type ProviderProbe = {
  provider_type: string;
  reachable: boolean;
  status: string;
  detail: string;
  endpoint?: string | null;
  status_code?: number | null;
};

type CustomProviderProfile = {
  id: string;
  name: string;
  settings: ProviderSettings;
  created_at: string;
  updated_at: string;
};

type TemplateSummary = {
  id: number;
  name: string;
  description: string;
  document_type: string;
  is_locked: boolean;
  latest_version: string;
  created_at: string;
  updated_at: string;
};

type TemplateVersionRecord = {
  id: number;
  template_id: number;
  version: string;
  definition: Record<string, unknown>;
  created_at: string;
};

type DocumentRecord = {
  id: number;
  original_filename: string;
  content_type: string;
  status: string;
  created_at: string;
};

type JobRecord = {
  id: number;
  document_id: number;
  template_version_id: number;
  status: string;
  error_message: string | null;
  progress_stage?: string | null;
  progress_pct?: number;
  attempt_count?: number;
  created_at: string;
  updated_at: string;
};

type ExportRecord = {
  id: number;
  result_id: number;
  job_id: number;
  export_format: string;
  file_path: string;
  created_at: string;
};

type ResultEnvelope = {
  result_id: number;
  job_id: number;
  result: {
    document_id: string;
    document_type: string;
    template_name: string;
    template_version: string;
    llm_provider: ProviderSettings;
    extraction_status: string;
    extracted_fields: Array<Record<string, unknown>>;
    calculated_fields: Array<Record<string, unknown>>;
    fields_requiring_review: string[];
    document_level_notes: string[];
    reviewed_at: string | null;
  };
};

type State = {
  provider: ProviderSettings;
  providerCatalog: ProviderCatalogEntry[];
  providerHealth: ProviderHealth[];
  customProfiles: CustomProviderProfile[];
  templates: TemplateSummary[];
  templateVersions: TemplateVersionRecord[];
  documents: DocumentRecord[];
  jobs: JobRecord[];
  exports: ExportRecord[];
  results: Record<number, ResultEnvelope>;
  auditEvents: Array<Record<string, unknown>>;
  exportPolicy: { require_review_cleared: boolean };
};

type JobScenario = "review" | "failed" | "queued";
type ExportScenario = "success" | "failed";

type MockOverrides = {
  templates?: TemplateSummary[];
  templateVersions?: TemplateVersionRecord[];
  jobScenarios?: JobScenario[];
  exportScenarios?: ExportScenario[];
  apiAvailable?: boolean;
  exportPolicy?: { require_review_cleared: boolean };
};

function json(route: Route, status: number, body: unknown) {
  return route.fulfill({
    status,
    contentType: "application/json",
    body: JSON.stringify(body),
  });
}

function buildReviewResult(
  jobId: number,
  provider: ProviderSettings,
): ResultEnvelope {
  return {
    result_id: 500 + jobId,
    job_id: jobId,
    result: {
      document_id: "1",
      document_type: "invoice",
      template_name: "Invoice Schema",
      template_version: "1.0.0",
      llm_provider: provider,
      extraction_status: "completed",
      extracted_fields: [
        {
          field_name: "vendor_name",
          label: "Vendor Name",
          field_kind: "extracted",
          data_type: "text",
          extracted_value: "Acme Company",
          normalized_value: { value: "Acme Company" },
          confidence_score: 0.41,
          source_text: "Acme Company",
          char_start: 16,
          char_end: 28,
          page_number: 1,
          location_reference: "Page 1",
          validation_status: "valid",
          validation_errors: [],
          extraction_notes: "Low confidence from mock extractor.",
          requires_review: true,
        },
        {
          field_name: "total_amount",
          label: "Total Amount",
          field_kind: "extracted",
          data_type: "currency",
          extracted_value: "$1,200.00",
          normalized_value: {
            amount: 1200,
            currency: "USD",
            display_value: "$1,200.00",
          },
          confidence_score: 0.91,
          source_text: "$1,200.00",
          page_number: 1,
          location_reference: "Page 1",
          validation_status: "valid",
          validation_errors: [],
          extraction_notes: "Extracted successfully.",
          requires_review: false,
        },
      ],
      calculated_fields: [],
      fields_requiring_review: ["vendor_name"],
      document_level_notes: [],
      reviewed_at: null,
    },
  };
}

function buildInitialState(): State {
  const now = "2026-05-02T12:00:00.000Z";
  const provider: ProviderSettings = {
    mode: "local",
    provider_type: "mock",
    provider_label: "Mock Extractor",
    api_style: "mock",
    base_url: null,
    api_key_required: false,
    model: "mock-extractor",
    temperature: 0.1,
    max_tokens: 4000,
    supports_json_mode: true,
    allow_external_processing: false,
    timeout_seconds: 120,
    retry_count: 2,
    chunk_size: 16000,
  };

  const templateDefinition = {
    template_name: "Invoice Schema",
    template_version: "1.0.0",
    document_type: "invoice",
    description: "Extract invoice vendor and totals.",
    llm_provider_settings: provider,
    extracted_fields: [
      {
        name: "vendor_name",
        label: "Vendor Name",
        type: "text",
        required: true,
        citation_required: true,
        description: "Invoice vendor name.",
      },
      {
        name: "total_amount",
        label: "Total Amount",
        type: "currency",
        required: true,
        citation_required: true,
        description: "Invoice total amount.",
      },
    ],
    calculated_fields: [],
    output_settings: {
      export_formats: ["json", "csv", "excel"],
    },
  };

  return {
    provider,
    providerCatalog: [
      {
        key: "mock",
        label: "Mock Extractor",
        description:
          "Bootstrap provider for local workflow validation without a live model runtime.",
        mode: "local",
        provider_type: "mock",
        api_style: "mock",
        base_url: null,
        model: "mock-extractor",
        enabled: true,
        recommended: false,
        tags: ["bootstrap"],
        capabilities: {
          supports_chat_completions: false,
          supports_json_mode: true,
          supports_streaming: false,
          supports_remote_processing: false,
          requires_api_key: false,
          supports_local_runtime: true,
        },
        settings: provider,
      },
    ],
    providerHealth: [
      {
        provider_key: "mock",
        provider_type: "mock",
        ready: true,
        status: "ready",
        checks: ["Bootstrap provider only"],
      },
    ],
    customProfiles: [],
    templates: [
      {
        id: 1,
        name: "Invoice Schema",
        description: "Extract invoice vendor and totals.",
        document_type: "invoice",
        is_locked: false,
        latest_version: "1.0.0",
        created_at: now,
        updated_at: now,
      },
    ],
    templateVersions: [
      {
        id: 101,
        template_id: 1,
        version: "1.0.0",
        definition: templateDefinition,
        created_at: now,
      },
    ],
    documents: [],
    jobs: [],
    exports: [],
    results: {},
    auditEvents: [],
    exportPolicy: { require_review_cleared: false },
  };
}

async function mockExtractionApiWithState(
  page: Page,
  state: State,
  options?: {
    jobScenarios?: JobScenario[];
    exportScenarios?: ExportScenario[];
    apiAvailable?: boolean;
  },
) {
  const jobScenarios = [...(options?.jobScenarios ?? ["review"])];
  const exportScenarios = [...(options?.exportScenarios ?? ["success"])];
  const apiAvailable = options?.apiAvailable ?? true;
  let nextJobId = 1;
  let nextExportId = 901;

  await page.route("**/api/**", async (route) => {
    const request = route.request();
    const method = request.method();
    const url = new URL(request.url());
    const path = url.pathname.replace(/.*\/api/, "");

    if (method === "GET" && path === "/templates") {
      return json(route, 200, state.templates);
    }
    if (method === "GET" && path === "/health") {
      if (!apiAvailable) {
        return route.fulfill({
          status: 503,
          contentType: "text/plain",
          body: "Backend health check failed.",
        });
      }
      return json(route, 200, { status: "ok" });
    }
    if (method === "GET" && path === "/documents") {
      return json(route, 200, state.documents);
    }
    if (method === "GET" && path === "/jobs") {
      return json(route, 200, state.jobs);
    }
    if (method === "GET" && path === "/exports") {
      return json(route, 200, state.exports);
    }
    if (method === "GET" && path === "/audit/events") {
      return json(route, 200, {
        events: state.auditEvents,
        total: state.auditEvents.length,
      });
    }
    if (method === "GET" && path === "/settings/export-policy") {
      return json(route, 200, state.exportPolicy);
    }
    if (method === "PUT" && path === "/settings/export-policy") {
      const payload = request.postDataJSON() as {
        require_review_cleared: boolean;
      };
      state.exportPolicy = payload;
      return json(route, 200, state.exportPolicy);
    }
    if (method === "GET" && /^\/documents\/\d+\/parsed-text$/.test(path)) {
      return json(route, 200, {
        document_id: 1,
        text: "Invoice Vendor: Acme Company\nTotal Due: $1,200.00",
        source: "parsed_file",
      });
    }
    if (method === "GET" && path === "/settings/provider") {
      return json(route, 200, state.provider);
    }
    if (method === "GET" && path === "/settings/providers") {
      return json(route, 200, { providers: state.providerCatalog });
    }
    if (method === "GET" && path === "/settings/providers/health") {
      return json(route, 200, state.providerHealth);
    }
    if (method === "GET" && path === "/settings/providers/controls") {
      return json(route, 200, { custom_provider_probe_max_age_hours: 24 });
    }
    if (method === "GET" && path === "/settings/providers/custom") {
      return json(route, 200, { profiles: state.customProfiles });
    }
    if (method === "POST" && path === "/settings/providers/custom") {
      const payload = request.postDataJSON() as {
        name: string;
        settings: ProviderSettings;
      };
      const profile: CustomProviderProfile = {
        id: "custom-1",
        name: payload.name,
        settings: payload.settings,
        last_probe_at: "2026-05-03T12:00:00.000Z",
        last_probe_status: "reachable",
        last_probe_detail: "Endpoint responded with HTTP 200.",
        created_at: "2026-05-03T12:00:00.000Z",
        updated_at: "2026-05-03T12:00:00.000Z",
      };
      state.customProfiles = [profile];
      return json(route, 200, profile);
    }
    if (method === "PUT" && /^\/settings\/providers\/custom\/.+$/.test(path)) {
      const payload = request.postDataJSON() as {
        name: string;
        settings: ProviderSettings;
      };
      const profileId = path.split("/").pop() ?? "custom-1";
      const profile: CustomProviderProfile = {
        id: profileId,
        name: payload.name,
        settings: payload.settings,
        last_probe_at: "2026-05-03T12:05:00.000Z",
        last_probe_status: "reachable",
        last_probe_detail: "Endpoint responded with HTTP 200.",
        created_at:
          state.customProfiles[0]?.created_at ?? "2026-05-03T12:00:00.000Z",
        updated_at: "2026-05-03T12:05:00.000Z",
      };
      state.customProfiles = state.customProfiles.map((item) =>
        item.id === profileId ? profile : item,
      );
      return json(route, 200, profile);
    }
    if (
      method === "DELETE" &&
      /^\/settings\/providers\/custom\/.+$/.test(path)
    ) {
      const profileId = path.split("/").pop() ?? "";
      state.customProfiles = state.customProfiles.filter(
        (item) => item.id !== profileId,
      );
      return json(route, 200, { deleted: true });
    }
    if (
      method === "POST" &&
      /^\/settings\/providers\/custom\/.+\/activate$/.test(path)
    ) {
      const profileId = path.split("/")[4];
      const profile = state.customProfiles.find(
        (item) => item.id === profileId,
      );
      if (!profile) {
        return json(route, 404, {
          detail: "Custom provider profile not found.",
        });
      }
      state.provider = profile.settings;
      return json(route, 200, state.provider);
    }
    if (method === "POST" && path === "/settings/providers/probe") {
      const payload = request.postDataJSON() as { settings: ProviderSettings };
      const response: ProviderProbe = {
        provider_type: payload.settings.provider_type,
        reachable: true,
        status: "reachable",
        detail: "Endpoint responded with HTTP 200.",
        endpoint: payload.settings.base_url,
        status_code: 200,
      };
      return json(route, 200, response);
    }
    if (method === "GET" && path === "/dev/status") {
      return json(route, 200, {
        templates: state.templates.length,
        documents: state.documents.length,
        jobs: state.jobs.length,
        results: Object.keys(state.results).length,
      });
    }
    if (method === "GET" && path === "/templates/1/versions") {
      return json(route, 200, state.templateVersions);
    }
    if (method === "GET" && /^\/jobs\/\d+\/result$/.test(path)) {
      const jobId = Number(path.split("/")[2]);
      const result = state.results[jobId];
      if (!result) {
        return json(route, 404, { detail: "Result not found." });
      }
      return json(route, 200, result);
    }
    if (method === "POST" && path === "/documents") {
      const now = "2026-05-02T12:05:00.000Z";
      const document: DocumentRecord = {
        id: 1,
        original_filename: "sample-contract.txt",
        content_type: "text/plain",
        status: "uploaded",
        created_at: now,
      };
      state.documents = [document];
      state.auditEvents.unshift({
        id: state.auditEvents.length + 1,
        actor: "local-user",
        action: "document.uploaded",
        object_type: "document",
        object_id: String(document.id),
        metadata: {
          document_id: document.id,
          original_filename: document.original_filename,
          content_type: document.content_type,
        },
        created_at: now,
      });
      return json(route, 200, document);
    }
    if (method === "POST" && /^\/jobs\/\d+\/retry$/.test(path)) {
      const jobId = Number(path.split("/")[2]);
      const existing = state.jobs.find((item) => item.id === jobId);
      if (!existing) {
        return json(route, 404, { detail: "Job not found." });
      }
      if (existing.status !== "failed") {
        return json(route, 409, { detail: "Only failed jobs can be retried." });
      }
      const now = "2026-05-02T12:07:00.000Z";
      const scenario = jobScenarios.shift() ?? "review";
      const retried: JobRecord = {
        ...existing,
        status: scenario === "failed" ? "failed" : "completed",
        error_message:
          scenario === "failed"
            ? "Provider timed out while extracting vendor_name. Check local runtime and rerun."
            : null,
        progress_stage: scenario === "failed" ? "failed" : "completed",
        progress_pct: scenario === "failed" ? 0 : 100,
        updated_at: now,
      };
      state.jobs = state.jobs.map((job) => (job.id === jobId ? retried : job));
      state.documents = state.documents.map((document) =>
        document.id === retried.document_id
          ? {
              ...document,
              status: scenario === "failed" ? "failed" : "completed",
            }
          : document,
      );
      if (scenario === "failed") {
        delete state.results[retried.id];
      } else {
        state.results[retried.id] = buildReviewResult(
          retried.id,
          state.provider,
        );
      }
      return json(route, 200, retried);
    }
    if (method === "POST" && path === "/jobs") {
      const payload = request.postDataJSON() as {
        document_id: number;
        template_version_id: number;
      };
      const now = "2026-05-02T12:06:00.000Z";
      const scenario = jobScenarios.shift() ?? "review";
      const job: JobRecord = {
        id: nextJobId,
        document_id: payload.document_id,
        template_version_id: payload.template_version_id,
        status:
          scenario === "failed"
            ? "failed"
            : scenario === "queued"
              ? "queued"
              : "completed",
        error_message:
          scenario === "failed"
            ? "Provider timed out while extracting vendor_name. Check local runtime and rerun."
            : null,
        progress_stage:
          scenario === "failed"
            ? "failed"
            : scenario === "queued"
              ? "queued"
              : "completed",
        progress_pct:
          scenario === "queued" ? 0 : scenario === "failed" ? 0 : 100,
        attempt_count: 1,
        created_at: now,
        updated_at: now,
      };
      nextJobId += 1;
      state.jobs = [job];
      state.documents = state.documents.map((document) =>
        document.id === payload.document_id
          ? {
              ...document,
              status:
                scenario === "failed"
                  ? "failed"
                  : scenario === "queued"
                    ? "queued"
                    : "completed",
            }
          : document,
      );
      if (scenario === "failed" || scenario === "queued") {
        delete state.results[job.id];
      } else {
        state.results[job.id] = buildReviewResult(job.id, state.provider);
      }
      return json(route, 200, job);
    }
    if (method === "POST" && /^\/results\/\d+\/review$/.test(path)) {
      const resultId = Number(path.split("/")[2]);
      const payload = request.postDataJSON() as {
        edits: Array<{
          field_name: string;
          normalized_value: unknown;
        }>;
      };
      const current = Object.values(state.results).find(
        (item) => item.result_id === resultId,
      );
      if (!current) {
        return json(route, 404, { detail: "Result not found." });
      }
      const edit = payload.edits[0];
      current.result.extracted_fields = current.result.extracted_fields.map(
        (field) => {
          if (edit && field.field_name === edit.field_name) {
            return {
              ...field,
              normalized_value: edit.normalized_value,
              validation_status: "reviewed",
              requires_review: false,
            };
          }
          if (field.requires_review) {
            return {
              ...field,
              validation_status: "reviewed",
              requires_review: false,
            };
          }
          return field;
        },
      );
      current.result.fields_requiring_review = [];
      current.result.reviewed_at = "2026-05-02T12:07:00.000Z";
      state.auditEvents.unshift({
        id: state.auditEvents.length + 1,
        actor: "local-ui",
        action: "review.saved",
        object_type: "result",
        object_id: String(current.result_id),
        metadata: {
          job_id: current.job_id,
          field_names: payload.edits.map((item) => item.field_name),
        },
        created_at: "2026-05-02T12:07:00.000Z",
      });
      return json(route, 200, current.result);
    }
    if (
      method === "POST" &&
      /^\/results\/\d+\/exports\/(json|csv|excel)$/.test(path)
    ) {
      const exportScenario = exportScenarios.shift() ?? "success";
      if (exportScenario === "failed") {
        return route.fulfill({
          status: 500,
          contentType: "text/plain",
          body: "Export generation failed at the backend.",
        });
      }

      const [, resultIdText, format] =
        path.match(/^\/results\/(\d+)\/exports\/(json|csv|excel)$/) ?? [];
      const resultId = Number(resultIdText);
      const result = Object.values(state.results).find(
        (item) => item.result_id === resultId,
      );
      if (!result) {
        return json(route, 404, { detail: "Result not found." });
      }
      if (
        state.exportPolicy.require_review_cleared &&
        result.result.fields_requiring_review.length > 0
      ) {
        return json(route, 409, {
          detail:
            "Export blocked until review is cleared. Save review decisions for all fields requiring review.",
        });
      }

      const exportRecord: ExportRecord = {
        id: nextExportId,
        result_id: resultId,
        job_id: result.job_id,
        export_format: format,
        file_path: `/tmp/${result.result.template_name.replace(/\s+/g, "-").toLowerCase()}-${nextExportId}.${format === "excel" ? "xlsx" : format}`,
        created_at: "2026-05-02T12:08:00.000Z",
      };
      nextExportId += 1;
      state.exports = [exportRecord, ...state.exports];
      state.auditEvents.unshift({
        id: state.auditEvents.length + 1,
        actor: "local-ui",
        action: "export.created",
        object_type: "export",
        object_id: String(exportRecord.id),
        metadata: {
          job_id: result.job_id,
          content_sha256: "abc123def456",
        },
        created_at: "2026-05-02T12:08:00.000Z",
      });
      return json(route, 200, {
        export_id: exportRecord.id,
        content_sha256:
          "abc123def4567890123456789012345678901234567890123456789012345678",
        manifest: {
          result_id: resultId,
          job_id: result.job_id,
          export_format: format,
        },
      });
    }
    if (method === "POST" && /^\/jobs\/\d+\/cancel$/.test(path)) {
      const jobId = Number(path.split("/")[2]);
      state.jobs = state.jobs.map((job) =>
        job.id === jobId
          ? {
              ...job,
              status: "cancelled",
              progress_stage: "cancelled",
              updated_at: "2026-05-02T12:06:00.000Z",
            }
          : job,
      );
      const job = state.jobs.find((item) => item.id === jobId);
      if (job) {
        state.auditEvents.unshift({
          id: state.auditEvents.length + 1,
          actor: "local-user",
          action: "job.cancelled",
          object_type: "job",
          object_id: String(job.id),
          metadata: {
            job_id: job.id,
            document_id: job.document_id,
          },
          created_at: "2026-05-02T12:06:00.000Z",
        });
      }
      return json(route, 200, job);
    }

    return json(route, 404, {
      detail: `Unhandled mock route: ${method} ${path}`,
    });
  });
}

export async function mockExtractionApi(page: Page, overrides?: MockOverrides) {
  const state = buildInitialState();
  if (overrides?.templates) {
    state.templates = overrides.templates;
  }
  if (overrides?.templateVersions) {
    state.templateVersions = overrides.templateVersions;
  }
  if (overrides?.exportPolicy) {
    state.exportPolicy = overrides.exportPolicy;
  }

  return mockExtractionApiWithState(page, state, {
    jobScenarios: overrides?.jobScenarios,
    exportScenarios: overrides?.exportScenarios,
    apiAvailable: overrides?.apiAvailable,
  });
}
