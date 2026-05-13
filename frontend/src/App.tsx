import { invoke } from "@tauri-apps/api/core";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type ReactNode,
  type SetStateAction,
} from "react";

import { API_BASE } from "./lib/config";
import {
  LangExtractEditor,
  type LangExtractFeedbackDiagnostics,
  type LangExtractFeedbackSuggestion,
} from "./LangExtractEditor";
import {
  buildDraftLangExtractExampleFromSuggestion,
  buildDraftLangExtractExamples,
  getAppliedLangExtractSuggestionKeys,
  buildLangExtractExamples,
  type DraftLangExtractExample,
} from "./langextract";

type PageId = "extractions" | "templates" | "settings" | "audit" | "help";

type NavItem = {
  id: PageId;
  label: string;
  icon: "extractions" | "templates" | "settings" | "audit" | "help";
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

type TemplateDefinitionField = {
  name: string;
  label: string;
  type: string;
  required?: boolean;
  citation_required?: boolean;
  description?: string;
  instructions?: string;
};

type TemplateDefinitionCalculated = {
  name: string;
  label: string;
  formula: string;
  output_type: string;
};

type ProviderSettings = {
  mode: "local" | "cloud";
  provider_type: string;
  provider_label?: string | null;
  is_persisted_default?: boolean;
  api_style?: "mock" | "openai_compatible" | "azure_openai" | "langextract";
  base_url?: string | null;
  api_key_env_var?: string | null;
  api_key_required?: boolean;
  deployment?: string | null;
  api_version?: string | null;
  model: string;
  temperature: number;
  max_tokens: number;
  supports_json_mode: boolean;
  allow_external_processing: boolean;
  timeout_seconds?: number;
  retry_count?: number;
  chunk_size?: number;
};

type ProviderCatalogEntry = {
  key: string;
  label: string;
  description: string;
  mode: "local" | "cloud";
  provider_type: string;
  api_style: "mock" | "openai_compatible" | "azure_openai" | "langextract";
  base_url?: string | null;
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

type ProviderControls = {
  custom_provider_probe_max_age_hours: number;
};

type CustomProviderProfile = {
  id: string;
  name: string;
  settings: ProviderSettings;
  last_probe_at?: string | null;
  last_probe_status?: string | null;
  last_probe_detail?: string | null;
  created_at: string;
  updated_at: string;
};

type CustomProviderDraft = {
  label: string;
  mode: "local" | "cloud";
  api_style: "openai_compatible" | "azure_openai";
  provider_type: string;
  base_url: string;
  api_key_env_var: string;
  model: string;
  deployment: string;
  api_version: string;
  allow_external_processing: boolean;
  supports_json_mode: boolean;
  temperature: string;
  max_tokens: string;
  timeout_seconds: string;
  retry_count: string;
  chunk_size: string;
};

type TemplateDefinition = {
  template_name: string;
  template_version: string;
  document_type: string;
  description: string;
  llm_provider_settings: ProviderSettings;
  langextract_config?: {
    prompt_description: string;
    examples: Array<{
      text: string;
      extractions: Array<{
        extraction_class: string;
        extraction_text: string;
        attributes: Record<string, string | string[]>;
      }>;
    }>;
  } | null;
  extracted_fields: TemplateDefinitionField[];
  calculated_fields: TemplateDefinitionCalculated[];
  output_settings: {
    export_formats: string[];
  };
};

type TemplateVersionRecord = {
  id: number;
  template_id: number;
  version: string;
  definition: TemplateDefinition;
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
  provider_override?: ProviderSettings | null;
  status: string;
  error_message?: string | null;
  created_at: string;
  updated_at: string;
};

type LangExtractFeedbackSuggestionDismissal = {
  template_version_id: number;
  suggestion_key: string;
  dismissed: boolean;
  updated_at: string;
};

type LangExtractFeedbackSuggestionListResponse = {
  suggestions: LangExtractFeedbackSuggestion[];
  diagnostics: LangExtractFeedbackDiagnostics;
};

type ReviewFieldResult = {
  field_name: string;
  label: string;
  field_kind: "extracted" | "calculated";
  data_type?: string;
  output_type?: string;
  extracted_value?: unknown;
  normalized_value?: unknown;
  calculated_value?: unknown;
  confidence_score?: number;
  source_text?: string;
  char_start?: number | null;
  char_end?: number | null;
  page_number?: number | null;
  location_reference?: string;
  validation_status: string;
  validation_errors: string[];
  extraction_notes?: string;
  calculation_notes?: string;
  requires_review: boolean;
};

type ResultPayload = {
  document_id: string;
  document_type: string;
  template_name: string;
  template_version: string;
  llm_provider: ProviderSettings;
  extraction_status: string;
  extracted_fields: ReviewFieldResult[];
  calculated_fields: ReviewFieldResult[];
  fields_requiring_review: string[];
  document_level_notes: string[];
  reviewed_at?: string | null;
};

type ResultEnvelope = {
  result_id: number;
  job_id: number;
  result: ResultPayload;
};

type ExportRecord = {
  id: number;
  result_id: number;
  job_id: number;
  export_format: string;
  file_path: string;
  created_at: string;
};

type DevStatus = {
  templates: number;
  documents: number;
  jobs: number;
  results: number;
};

type DesktopStatus = {
  tauriMode: boolean;
  projectRoot?: string | null;
  runtimeSource: string;
  appDataDir?: string | null;
  dockerAvailable: boolean;
  composeAvailable: boolean;
  backendHost: string;
  backendPort: number;
  backendReachable: boolean;
  message: string;
};

type DesktopLogs = {
  source: string;
  content: string;
};

type DraftTemplate = {
  template_name: string;
  document_type: string;
  description: string;
  template_version: string;
  local_only: boolean;
  langextract_prompt_description: string;
  langextract_examples: DraftLangExtractExample[];
};

type WorkspaceStage = "draft" | "processing" | "review" | "ready" | "failed";

const primaryNavigation: NavItem[] = [
  { id: "extractions", label: "Extractions", icon: "extractions" },
  { id: "templates", label: "Schemas", icon: "templates" },
];

const secondaryNavigation: NavItem[] = [
  { id: "settings", label: "Settings", icon: "settings" },
  { id: "audit", label: "Audit", icon: "audit" },
  { id: "help", label: "Help", icon: "help" },
];

const CUSTOM_PROVIDER_KEY = "custom-provider-draft";
const DEFAULT_CUSTOM_PROVIDER_PROBE_MAX_AGE_HOURS = 24;

const DEFAULT_CUSTOM_PROVIDER_DRAFT: CustomProviderDraft = {
  label: "Private Gateway",
  mode: "local",
  api_style: "openai_compatible",
  provider_type: "private_gateway",
  base_url: "http://localhost:8001/v1",
  api_key_env_var: "",
  model: "document-extractor-default",
  deployment: "",
  api_version: "2024-10-21",
  allow_external_processing: false,
  supports_json_mode: true,
  temperature: "0.1",
  max_tokens: "6000",
  timeout_seconds: "120",
  retry_count: "2",
  chunk_size: "16000",
};

const EMPTY_LANGEXTRACT_FEEDBACK_DIAGNOSTICS: LangExtractFeedbackDiagnostics = {
  reviewed_result_count: 0,
  reviewed_edit_count: 0,
  generated_suggestion_count: 0,
  dismissed_suggestion_count: 0,
  visible_suggestion_count: 0,
  skipped_missing_document_text: 0,
  skipped_missing_target_field: 0,
  skipped_missing_grounding: 0,
  skipped_span_override: 0,
  skipped_span_mismatch: 0,
  skipped_empty_context: 0,
  skipped_no_contextual_extractions: 0,
};

function loadSavedCustomProviderDraft(): CustomProviderDraft {
  if (typeof window === "undefined") {
    return DEFAULT_CUSTOM_PROVIDER_DRAFT;
  }

  const savedDraft = window.localStorage.getItem(CUSTOM_PROVIDER_KEY);
  if (!savedDraft) {
    return DEFAULT_CUSTOM_PROVIDER_DRAFT;
  }

  try {
    const parsed = JSON.parse(savedDraft) as Partial<CustomProviderDraft>;
    return { ...DEFAULT_CUSTOM_PROVIDER_DRAFT, ...parsed };
  } catch {
    window.localStorage.removeItem(CUSTOM_PROVIDER_KEY);
    return DEFAULT_CUSTOM_PROVIDER_DRAFT;
  }
}

function customProviderProfileProbeIsStale(
  profile: CustomProviderProfile,
  maxAgeHours: number,
): boolean {
  if (!profile.last_probe_at) {
    return true;
  }
  if (profile.last_probe_status !== "reachable") {
    return true;
  }
  const ageMs = Date.now() - new Date(profile.last_probe_at).getTime();
  return ageMs > maxAgeHours * 60 * 60 * 1000;
}

const starterTemplateDefinition: TemplateDefinition = {
  template_name: "General Document Extraction Schema",
  template_version: "1.0.0",
  document_type: "General Document",
  description:
    "Reusable starter schema for legal, medical, accounting, finance, HR, and operations document extraction workflows.",
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
  langextract_config: {
    prompt_description:
      "Extract the primary subject, effective date, and total amount exactly as they appear in the document. Keep extractions grounded to verbatim source spans and in order of appearance.",
    examples: [
      {
        text: "Client: Willow Creek HOA\nEffective Date: 2025-01-15\nTotal Amount Due: $4,250.00",
        extractions: [
          {
            extraction_class: "primary_subject",
            extraction_text: "Willow Creek HOA",
            attributes: { value: "Willow Creek HOA" },
          },
          {
            extraction_class: "effective_date",
            extraction_text: "2025-01-15",
            attributes: { value: "2025-01-15" },
          },
          {
            extraction_class: "total_amount",
            extraction_text: "$4,250.00",
            attributes: { currency: "USD" },
          },
        ],
      },
    ],
  },
  extracted_fields: [
    {
      name: "primary_subject",
      label: "Primary Subject",
      type: "text",
      required: true,
      citation_required: true,
      description:
        "The main subject, entity, patient, client, contract, or matter described by the document.",
      instructions:
        "Extract the primary named subject exactly as stated in the document.",
    },
    {
      name: "effective_date",
      label: "Effective Date",
      type: "date",
      required: false,
      citation_required: true,
      description:
        "The date the document, service, agreement, or record takes effect.",
      instructions:
        "Extract the most relevant effective, service, filing, or issue date and normalize it when possible.",
    },
    {
      name: "total_amount",
      label: "Total Amount",
      type: "currency",
      required: false,
      citation_required: true,
      description:
        "The primary total monetary amount stated in the document, if applicable.",
      instructions:
        "Extract the main total amount only when the document clearly states one.",
    },
  ],
  calculated_fields: [
    {
      name: "amount_with_buffer",
      label: "Amount With Buffer",
      formula: "coalesce(total_amount.amount, 0) * 1.10",
      output_type: "currency",
    },
  ],
  output_settings: {
    export_formats: ["json", "csv", "excel"],
  },
};

const auditRows = [
  [
    "May 16, 2025 10:24 AM",
    "Alex Morgan",
    "Extraction completed",
    "Invoice_0042.pdf",
    "42 fields extracted, 1 needs review",
  ],
  [
    "May 16, 2025 10:19 AM",
    "Alex Morgan",
    "Field edited",
    "Total Amount",
    "Adjusted to match footer total",
  ],
  [
    "May 16, 2025 10:18 AM",
    "System",
    "Formula recalculated",
    "Invoice Processing v1.4",
    "Cost Per Unit updated",
  ],
  [
    "May 16, 2025 9:12 AM",
    "Alex Morgan",
    "Document uploaded",
    "MSA_Contract.docx",
    "Stored in local volume",
  ],
];

const helpTopics = [
  "Reusable schemas and version history",
  "User-defined extraction fields",
  "Typed validation and allowed values",
  "Calculated formula fields with null handling",
  "Human review, audit logging, and exports",
  "Local-first processing with optional cloud providers",
];

const DESKTOP_ONBOARDING_KEY = "extractflow.desktop.onboarding.dismissed.v1";

function classNames(...values: Array<string | false | null | undefined>) {
  return values.filter(Boolean).join(" ");
}

function NavGlyph({ icon }: { icon: NavItem["icon"] }) {
  const common = {
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.8,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
  };

  switch (icon) {
    case "templates":
      return (
        <svg viewBox="0 0 20 20" aria-hidden="true">
          <rect {...common} x="3.5" y="4" width="13" height="12" rx="2" />
          <path {...common} d="M7 4v12M9.5 7h4M9.5 10h4M9.5 13h3" />
        </svg>
      );
    case "settings":
      return (
        <svg viewBox="0 0 20 20" aria-hidden="true">
          <circle {...common} cx="10" cy="10" r="2.25" />
          <path
            {...common}
            d="M10 3.25v1.5M10 15.25v1.5M15.25 10h1.5M3.25 10h1.5M14.77 5.23l1.06-1.06M4.17 15.83l1.06-1.06M14.77 14.77l1.06 1.06M4.17 4.17l1.06 1.06"
          />
        </svg>
      );
    case "audit":
      return (
        <svg viewBox="0 0 20 20" aria-hidden="true">
          <path {...common} d="M6 4.5h8M6 8.5h8M6 12.5h5" />
          <rect {...common} x="4" y="3" width="12" height="14" rx="2" />
        </svg>
      );
    case "help":
      return (
        <svg viewBox="0 0 20 20" aria-hidden="true">
          <path
            {...common}
            d="M7.75 7.25a2.5 2.5 0 1 1 4.2 1.82c-.77.69-1.7 1.28-1.7 2.43"
          />
          <circle fill="currentColor" cx="10" cy="14.75" r="1" />
          <circle {...common} cx="10" cy="10" r="7" />
        </svg>
      );
    case "extractions":
    default:
      return (
        <svg viewBox="0 0 20 20" aria-hidden="true">
          <path
            {...common}
            d="M5 3.5h7.5L16 7v9.5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1v-12a1 1 0 0 1 1-1Z"
          />
          <path {...common} d="M12.5 3.5V7H16" />
          <path {...common} d="M7 10h6M7 13h6" />
        </svg>
      );
  }
}

function basename(path: string) {
  const parts = path.split("/");
  return parts[parts.length - 1] || path;
}

function isTauriRuntime() {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function formatTimestamp(value?: string | null) {
  if (!value) {
    return "—";
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return date.toLocaleString([], {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function getDocumentTypeLabel(contentType: string) {
  if (contentType.includes("pdf")) return "PDF";
  if (contentType.includes("word") || contentType.includes("docx"))
    return "DOCX";
  if (contentType.includes("image")) return "Image";
  if (contentType.includes("text")) return "Text";
  return "File";
}

function parseOptionalId(value: string) {
  return value ? Number(value) : null;
}

function formatConfidence(score?: number) {
  return score == null ? "—" : `${Math.round(score * 100)}%`;
}

function formatCharInterval(
  field: Pick<ReviewFieldResult, "char_start" | "char_end">,
) {
  return field.char_start != null && field.char_end != null
    ? `Chars ${field.char_start}-${field.char_end}`
    : "Chars —";
}

function formatValue(value: unknown): string {
  if (value == null) {
    return "—";
  }
  if (typeof value === "string") {
    return value;
  }
  if (typeof value === "number") {
    return String(value);
  }
  if (typeof value === "boolean") {
    return value ? "Yes" : "No";
  }
  if (isRecord(value)) {
    if (typeof value.display_value === "string" && value.display_value) {
      return value.display_value;
    }
    if (typeof value.value === "string" || typeof value.value === "number") {
      return String(value.value);
    }
    if (typeof value.amount === "number") {
      const currency =
        typeof value.currency === "string" ? value.currency : "USD";
      return `${currency} ${value.amount.toLocaleString([], { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    }
  }
  return JSON.stringify(value);
}

function getFieldType(
  field: ReviewFieldResult,
  definition?: TemplateDefinitionField | null,
) {
  return String(field.data_type ?? definition?.type ?? "text").toLowerCase();
}

function getFieldDefinition(
  definition: TemplateDefinition | null,
  fieldName: string,
) {
  return (
    definition?.extracted_fields.find((item) => item.name === fieldName) ?? null
  );
}

function getInitialReviewDraft(
  field: ReviewFieldResult,
  definition?: TemplateDefinitionField | null,
) {
  const value = field.normalized_value ?? field.extracted_value ?? null;
  const type = getFieldType(field, definition);

  if (value == null) {
    return "";
  }

  if (
    type === "currency" &&
    isRecord(value) &&
    typeof value.amount === "number"
  ) {
    return String(value.amount);
  }

  if (type === "boolean") {
    if (typeof value === "boolean") return value ? "true" : "false";
    if (isRecord(value) && typeof value.value === "boolean")
      return value.value ? "true" : "false";
  }

  if (
    isRecord(value) &&
    (typeof value.value === "string" || typeof value.value === "number")
  ) {
    return String(value.value);
  }

  if (typeof value === "string" || typeof value === "number") {
    return String(value);
  }

  if (typeof value === "boolean") {
    return value ? "true" : "false";
  }

  return JSON.stringify(value);
}

function isLangExtractProvider(settings?: ProviderSettings | null) {
  return (
    settings?.provider_type === "langextract" &&
    settings.api_style === "langextract"
  );
}

function getReviewSignals(field: ReviewFieldResult): string[] {
  const signals = [...field.validation_errors];
  if (field.extraction_notes) {
    signals.push(field.extraction_notes);
  }
  if (!signals.length && field.requires_review) {
    signals.push("This field needs confirmation before export.");
  }
  return [...new Set(signals.map((signal) => signal.trim()).filter(Boolean))];
}

function parseReviewDraft(
  field: ReviewFieldResult,
  raw: string,
  definition?: TemplateDefinitionField | null,
): unknown {
  const trimmed = raw.trim();
  const type = getFieldType(field, definition);

  if (!trimmed) {
    return null;
  }

  switch (type) {
    case "currency": {
      const amount = Number(trimmed);
      if (Number.isNaN(amount)) {
        throw new Error(`${field.label} must be a valid number.`);
      }
      const existing = isRecord(field.normalized_value)
        ? field.normalized_value
        : null;
      const currency =
        typeof existing?.currency === "string" ? existing.currency : "USD";
      return {
        amount,
        currency,
        display_value: `${currency} ${amount.toLocaleString([], { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
      };
    }
    case "date":
      return { value: trimmed, display_value: trimmed };
    case "number": {
      const value = Number(trimmed);
      if (Number.isNaN(value)) {
        throw new Error(`${field.label} must be a valid number.`);
      }
      return { value };
    }
    case "boolean":
      return trimmed === "true";
    default:
      return { value: raw };
  }
}

function stringifyLangExtractExamples(
  config?: TemplateDefinition["langextract_config"],
) {
  return JSON.stringify(config?.examples ?? [], null, 2);
}

function parseLangExtractExamplesJson(raw: string) {
  const trimmed = raw.trim();
  if (!trimmed) {
    return [];
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed) as unknown;
  } catch {
    throw new Error("LangExtract examples must be valid JSON.");
  }
  if (!Array.isArray(parsed)) {
    throw new Error("LangExtract examples must be a JSON array.");
  }
  return parsed as NonNullable<
    TemplateDefinition["langextract_config"]
  >["examples"];
}

function buildTemplatePayload(
  draft: DraftTemplate,
  provider: ProviderSettings | null,
  base?: TemplateDefinition,
): TemplateDefinition {
  const seed = base ?? starterTemplateDefinition;
  const effectiveProvider = provider ?? seed.llm_provider_settings;
  const usesLangExtractConfig =
    effectiveProvider.api_style === "langextract" ||
    seed.llm_provider_settings.api_style === "langextract";
  const langextractPromptDescription =
    draft.langextract_prompt_description.trim();
  const parsedLangExtractExamples = usesLangExtractConfig
    ? buildLangExtractExamples(
        draft.langextract_examples,
        seed.extracted_fields.map((field) => field.name),
        seed.extracted_fields
          .filter((field) => field.required)
          .map((field) => field.name),
      )
    : [];
  const langextractConfig =
    usesLangExtractConfig &&
    (langextractPromptDescription || parsedLangExtractExamples.length)
      ? {
          prompt_description: langextractPromptDescription,
          examples: parsedLangExtractExamples,
        }
      : null;

  return {
    ...seed,
    template_name: draft.template_name,
    template_version: draft.template_version,
    document_type: draft.document_type,
    description: draft.description,
    llm_provider_settings: effectiveProvider,
    langextract_config: langextractConfig,
  };
}

function buildDraftTemplateFromDefinition(
  definition: TemplateDefinition,
): DraftTemplate {
  return {
    template_name: `${definition.template_name} Copy`,
    document_type: definition.document_type,
    description: definition.description,
    template_version: definition.template_version,
    local_only: !definition.llm_provider_settings.allow_external_processing,
    langextract_prompt_description:
      definition.langextract_config?.prompt_description ?? "",
    langextract_examples: buildDraftLangExtractExamples(
      definition.langextract_config,
    ),
  };
}

async function readJson<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, init);
  if (!response.ok) {
    throw new Error(await response.text());
  }
  return (await response.json()) as T;
}

async function uploadDocument(file: File): Promise<DocumentRecord> {
  const formData = new FormData();
  formData.append("file", file);
  const response = await fetch(`${API_BASE}/documents`, {
    method: "POST",
    body: formData,
  });
  if (!response.ok) {
    throw new Error(await response.text());
  }
  return (await response.json()) as DocumentRecord;
}

function buildProviderPayload(input: ProviderCatalogEntry): ProviderSettings {
  return input.settings;
}

function buildCustomProviderSettings(
  input: CustomProviderDraft,
): ProviderSettings {
  const isAzure = input.api_style === "azure_openai";
  const trimmedBaseUrl = input.base_url.trim();
  const trimmedApiKeyEnvVar = input.api_key_env_var.trim();
  const trimmedDeployment = input.deployment.trim();
  const trimmedApiVersion = input.api_version.trim();

  return {
    mode: input.mode,
    provider_type: input.provider_type.trim(),
    provider_label: input.label.trim(),
    api_style: input.api_style,
    base_url: trimmedBaseUrl || null,
    api_key_env_var: trimmedApiKeyEnvVar || null,
    api_key_required: input.mode === "cloud" || Boolean(trimmedApiKeyEnvVar),
    deployment: isAzure ? trimmedDeployment || null : null,
    api_version: isAzure ? trimmedApiVersion || null : null,
    model: input.model.trim(),
    temperature: Number(input.temperature) || 0.1,
    max_tokens: Number(input.max_tokens) || 6000,
    supports_json_mode: input.supports_json_mode,
    allow_external_processing: input.allow_external_processing,
    timeout_seconds: Number(input.timeout_seconds) || 120,
    retry_count: Number(input.retry_count) || 2,
    chunk_size: Number(input.chunk_size) || 16000,
  };
}

function validateCustomProviderDraft(
  input: CustomProviderDraft,
): string | null {
  if (!input.label.trim()) {
    return "Custom provider label is required.";
  }
  if (!input.provider_type.trim()) {
    return "Custom provider type is required.";
  }
  if (!input.base_url.trim()) {
    return "Custom provider base URL is required.";
  }
  if (!input.model.trim()) {
    return "Custom provider model is required.";
  }
  if (input.api_style === "azure_openai" && !input.deployment.trim()) {
    return "Azure deployment is required.";
  }
  if (input.api_style === "azure_openai" && !input.api_version.trim()) {
    return "Azure API version is required.";
  }
  if (!Number.isFinite(Number(input.temperature))) {
    return "Temperature must be numeric.";
  }
  if (!Number.isFinite(Number(input.max_tokens))) {
    return "Max tokens must be numeric.";
  }
  if (!Number.isFinite(Number(input.timeout_seconds))) {
    return "Timeout seconds must be numeric.";
  }
  if (!Number.isFinite(Number(input.retry_count))) {
    return "Retry count must be numeric.";
  }
  if (!Number.isFinite(Number(input.chunk_size))) {
    return "Chunk size must be numeric.";
  }
  return null;
}

function buildCustomProviderDraftFromSettings(
  settings: ProviderSettings,
): CustomProviderDraft {
  return {
    label: settings.provider_label ?? settings.provider_type,
    mode: settings.mode,
    api_style:
      settings.api_style === "azure_openai"
        ? "azure_openai"
        : "openai_compatible",
    provider_type: settings.provider_type,
    base_url: settings.base_url ?? "",
    api_key_env_var: settings.api_key_env_var ?? "",
    model: settings.model,
    deployment: settings.deployment ?? "",
    api_version: settings.api_version ?? "2024-10-21",
    allow_external_processing: settings.allow_external_processing,
    supports_json_mode: settings.supports_json_mode,
    temperature: String(settings.temperature),
    max_tokens: String(settings.max_tokens),
    timeout_seconds: String(settings.timeout_seconds ?? 120),
    retry_count: String(settings.retry_count ?? 2),
    chunk_size: String(settings.chunk_size ?? 16000),
  };
}

function AppSidebar({
  activePage,
  onSelectPage,
  provider,
  reviewCount,
}: {
  activePage: PageId;
  onSelectPage: (page: PageId) => void;
  provider: ProviderSettings | null;
  reviewCount: number;
}) {
  return (
    <aside className="sidebar">
      <div className="brand-block">
        <div className="brand-mark">E</div>
        <div>
          <h1>ExtractFlow</h1>
          <p>One workspace from PDF to trusted export.</p>
        </div>
      </div>

      <div className="nav-section">
        <span className="nav-section-label">Primary</span>
        <nav className="nav-list" aria-label="Primary">
          {primaryNavigation.map((item) => (
            <button
              key={item.id}
              type="button"
              className={classNames(
                "nav-item",
                activePage === item.id && "active",
              )}
              onClick={() => onSelectPage(item.id)}
            >
              <span className="nav-icon" aria-hidden="true">
                <NavGlyph icon={item.icon} />
              </span>
              <span>{item.label}</span>
              {item.id === "extractions" && reviewCount > 0 ? (
                <span className="nav-badge">{reviewCount}</span>
              ) : null}
            </button>
          ))}
        </nav>
      </div>

      <div className="nav-section">
        <span className="nav-section-label">Admin</span>
        <nav className="nav-list" aria-label="Admin">
          {secondaryNavigation.map((item) => (
            <button
              key={item.id}
              type="button"
              className={classNames(
                "nav-item",
                activePage === item.id && "active",
              )}
              onClick={() => onSelectPage(item.id)}
            >
              <span className="nav-icon" aria-hidden="true">
                <NavGlyph icon={item.icon} />
              </span>
              <span>{item.label}</span>
            </button>
          ))}
        </nav>
      </div>

      <div className="local-mode-card">
        <div className="local-mode-dot" />
        <div>
          <strong>
            {provider?.mode === "cloud" ? "Cloud Mode" : "Local Mode"}
          </strong>
          <p>
            {provider?.provider_type ?? "mock"} (
            {provider?.model ?? "qwen3.5:27b"})
          </p>
          <span>
            {reviewCount
              ? `${reviewCount} fields waiting on review`
              : "No review backlog right now"}
          </span>
        </div>
        <button
          type="button"
          className="tertiary-button"
          onClick={() => onSelectPage("settings")}
        >
          Open settings
        </button>
      </div>
    </aside>
  );
}

function TopBar({ activePage }: { activePage: PageId }) {
  const activeLabel =
    primaryNavigation.find((item) => item.id === activePage)?.label ??
    secondaryNavigation.find((item) => item.id === activePage)?.label ??
    "Workspace";

  const subtitles: Record<PageId, string> = {
    extractions:
      "Upload a document, run extraction, review only exceptions, and export from one place.",
    templates:
      "Schemas stay reusable, but they should not interrupt the extraction job.",
    settings:
      "Provider, privacy, and runtime controls live here instead of hijacking the main workflow.",
    audit:
      "Track operational history without putting it in the user’s critical path.",
    help: "Support the workflow after first value, not before it.",
  };

  return (
    <header className="topbar">
      <div className="topbar-copy">
        <strong>{activeLabel}</strong>
        <span>{subtitles[activePage]}</span>
      </div>
    </header>
  );
}

function StatusBadge({
  children,
  tone,
}: {
  children: string;
  tone: "success" | "warning" | "danger" | "info" | "indigo" | "neutral";
}) {
  return (
    <span className={classNames("badge", `badge-${tone}`)}>{children}</span>
  );
}

function SummaryStat({
  label,
  value,
  support,
  tone = "default",
}: {
  label: string;
  value: ReactNode;
  support?: string;
  tone?: "default" | "accent" | "success" | "warning" | "danger";
}) {
  return (
    <div
      className={classNames(
        "metric-card",
        tone !== "default" && `metric-card-${tone}`,
      )}
    >
      <span className="metric-label">{label}</span>
      <strong className="metric-value">{value}</strong>
      {support ? <p className="metric-support">{support}</p> : null}
    </div>
  );
}

function SwitchField({
  label,
  checked,
  onToggle,
  hint,
}: {
  label: string;
  checked: boolean;
  onToggle: () => void;
  hint?: string;
}) {
  return (
    <div className="switch-field">
      <div className="switch-copy">
        <span>{label}</span>
        {hint ? <p>{hint}</p> : null}
      </div>
      {checked ? (
        <button
          type="button"
          role="switch"
          aria-checked="true"
          aria-label={label}
          className={classNames("switch-control", "active")}
          onClick={onToggle}
        >
          <span className="switch-thumb" aria-hidden="true" />
          <span className="switch-state">On</span>
        </button>
      ) : (
        <button
          type="button"
          role="switch"
          aria-checked="false"
          aria-label={label}
          className="switch-control"
          onClick={onToggle}
        >
          <span className="switch-thumb" aria-hidden="true" />
          <span className="switch-state">Off</span>
        </button>
      )}
    </div>
  );
}

function FieldShell({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <label className="field-shell">
      <span className="field-shell-label">{label}</span>
      {children}
      {hint ? <span className="field-shell-hint">{hint}</span> : null}
    </label>
  );
}

function PageHeader({
  eyebrow,
  title,
  description,
  actions,
}: {
  eyebrow: string;
  title: string;
  description?: string;
  actions?: ReactNode;
}) {
  return (
    <div className="page-section-header">
      <div className="page-section-copy">
        <span className="hero-label">{eyebrow}</span>
        <h2>{title}</h2>
        {description ? <p>{description}</p> : null}
      </div>
      {actions ? <div className="page-section-actions">{actions}</div> : null}
    </div>
  );
}

function CardHeader({
  title,
  subtitle,
  titleId,
}: {
  title: string;
  subtitle?: string;
  titleId?: string;
}) {
  return (
    <div className="card-header">
      <div className="card-header-copy">
        <h2 id={titleId}>{title}</h2>
        {subtitle ? <p>{subtitle}</p> : null}
      </div>
    </div>
  );
}

function DesktopSetupPanel({
  desktopStatus,
  busyAction,
  logs,
  onRefresh,
  onStart,
  onRestart,
  onStop,
  onOpenProjectRoot,
  onOpenAppDataDir,
  onLoadLogs,
}: {
  desktopStatus: DesktopStatus | null;
  busyAction: string | null;
  logs: DesktopLogs | null;
  onRefresh: () => Promise<void>;
  onStart: () => Promise<void>;
  onRestart: () => Promise<void>;
  onStop: () => Promise<void>;
  onOpenProjectRoot: () => Promise<void>;
  onOpenAppDataDir: () => Promise<void>;
  onLoadLogs: () => Promise<void>;
}) {
  if (!desktopStatus?.tauriMode) {
    return null;
  }

  const checklist = [
    {
      label: "Desktop shell has a project root",
      complete: Boolean(desktopStatus.projectRoot),
      detail:
        desktopStatus.projectRoot ??
        "The shell does not know where the backend project lives.",
    },
    {
      label: "Docker daemon is available",
      complete: desktopStatus.dockerAvailable,
      detail: desktopStatus.dockerAvailable
        ? "Docker can manage backend and worker services."
        : "Start Docker Desktop before managing the local stack.",
    },
    {
      label: "Docker Compose is available",
      complete: desktopStatus.composeAvailable,
      detail: desktopStatus.composeAvailable
        ? "Compose commands can start backend and worker services."
        : "Install or enable Docker Compose for this machine.",
    },
    {
      label: "Backend API is reachable",
      complete: desktopStatus.backendReachable,
      detail: desktopStatus.backendReachable
        ? `Frontend can reach the local API on ${desktopStatus.backendHost}:${desktopStatus.backendPort}.`
        : `The API is not reachable on ${desktopStatus.backendHost}:${desktopStatus.backendPort}. Start or restart the local stack.`,
    },
  ];

  return (
    <section className="surface desktop-setup-surface">
      <CardHeader
        title="Desktop runtime"
        subtitle="Use this recovery path when the desktop shell is open but the local extraction stack is not ready."
      />
      <div className="desktop-setup-grid">
        <div className="desktop-setup-main">
          <div className="desktop-status-banner">
            <strong>{desktopStatus.message}</strong>
            <p>
              Runtime source:{" "}
              {desktopStatus.runtimeSource === "bundled_resources"
                ? "Bundled desktop payload"
                : "Repo checkout"}
              <br />
              Runtime root: {desktopStatus.projectRoot ?? "Unavailable"}
              <br />
              App data: {desktopStatus.appDataDir ?? "Unavailable"}
              <br />
              Backend target: {desktopStatus.backendHost}:
              {desktopStatus.backendPort}
            </p>
          </div>

          <div className="desktop-checklist">
            {checklist.map((item) => (
              <div
                key={item.label}
                className={classNames(
                  "desktop-check-item",
                  item.complete && "complete",
                )}
              >
                <div className="desktop-check-state" aria-hidden="true">
                  {item.complete ? "✓" : "!"}
                </div>
                <div>
                  <strong>{item.label}</strong>
                  <p>{item.detail}</p>
                </div>
              </div>
            ))}
          </div>

          <div className="desktop-action-groups">
            <div className="desktop-action-row">
              <button
                type="button"
                className="primary-button"
                onClick={() => void onStart()}
                disabled={busyAction === "desktop-start"}
              >
                {busyAction === "desktop-start"
                  ? "Starting..."
                  : "Start local stack"}
              </button>
              <button
                type="button"
                className="secondary-button"
                onClick={() => void onRestart()}
                disabled={busyAction === "desktop-restart"}
              >
                {busyAction === "desktop-restart"
                  ? "Restarting..."
                  : "Restart stack"}
              </button>
              <button
                type="button"
                className="secondary-button"
                onClick={() => void onStop()}
                disabled={busyAction === "desktop-stop"}
              >
                {busyAction === "desktop-stop" ? "Stopping..." : "Stop stack"}
              </button>
            </div>
            <div className="desktop-action-row">
              <button
                type="button"
                className="secondary-button"
                onClick={() => void onRefresh()}
                disabled={busyAction === "desktop-refresh"}
              >
                Refresh status
              </button>
              <button
                type="button"
                className="secondary-button"
                onClick={() => void onLoadLogs()}
                disabled={busyAction === "desktop-logs"}
              >
                {busyAction === "desktop-logs"
                  ? "Loading logs..."
                  : "Load backend logs"}
              </button>
              <button
                type="button"
                className="secondary-button"
                onClick={() => void onOpenProjectRoot()}
                disabled={busyAction === "desktop-open-root"}
              >
                Open runtime root
              </button>
              <button
                type="button"
                className="secondary-button"
                onClick={() => void onOpenAppDataDir()}
                disabled={busyAction === "desktop-open-data"}
              >
                Open app data
              </button>
            </div>
          </div>
        </div>

        <div className="desktop-setup-side">
          <div className="desktop-side-card">
            <span className="eyebrow">Recommended sequence</span>
            <ol className="desktop-step-list">
              <li>Confirm Docker Desktop is running.</li>
              <li>Start the local stack from this shell.</li>
              <li>Refresh status after the backend becomes reachable.</li>
              <li>Load logs only if the backend still fails to respond.</li>
            </ol>
          </div>
          <div className="desktop-side-card">
            <span className="eyebrow">Why this is secondary</span>
            <p>
              Runtime setup belongs behind the extraction flow, not in front of
              it.
            </p>
          </div>
        </div>
      </div>

      {logs ? (
        <div className="desktop-logs-shell">
          <div className="desktop-logs-header">
            <strong>Backend logs</strong>
            <span>{logs.source}</span>
          </div>
          <pre>{logs.content || "No log output returned."}</pre>
        </div>
      ) : null}
    </section>
  );
}

function DesktopOnboardingOverlay({
  desktopStatus,
  provider,
  apiUnavailable,
  busyAction,
  onStartDesktopStack,
  onOpenSettings,
  onDismiss,
}: {
  desktopStatus: DesktopStatus | null;
  provider: ProviderSettings | null;
  apiUnavailable: boolean;
  busyAction: string | null;
  onStartDesktopStack: () => Promise<void>;
  onOpenSettings: () => void;
  onDismiss: () => void;
}) {
  if (!desktopStatus?.tauriMode) {
    return null;
  }

  const checklist = [
    {
      label: "Desktop runtime bundle available",
      complete:
        desktopStatus.runtimeSource === "bundled_resources" ||
        desktopStatus.runtimeSource === "repo_checkout",
      detail:
        desktopStatus.runtimeSource === "bundled_resources"
          ? "The app is running against its bundled runtime payload."
          : "The app is connected to a repo-backed desktop runtime.",
    },
    {
      label: "Docker Desktop running",
      complete: desktopStatus.dockerAvailable,
      detail: desktopStatus.dockerAvailable
        ? "Container runtime is available for backend and worker services."
        : "Start Docker Desktop before continuing.",
    },
    {
      label: "Local backend reachable",
      complete: desktopStatus.backendReachable && !apiUnavailable,
      detail:
        desktopStatus.backendReachable && !apiUnavailable
          ? `Frontend can reach the API on ${desktopStatus.backendHost}:${desktopStatus.backendPort}.`
          : `Backend is not yet reachable on ${desktopStatus.backendHost}:${desktopStatus.backendPort}.`,
    },
    {
      label: "Default provider selected",
      complete: Boolean(provider),
      detail: provider
        ? `${provider.provider_type} (${provider.model}) is configured as the current default provider.`
        : "Choose a local or cloud provider before running real extraction jobs.",
    },
  ];

  return (
    <div
      className="desktop-onboarding-overlay"
      role="dialog"
      aria-modal="true"
      aria-labelledby="desktopOnboardingTitle"
    >
      <div className="desktop-onboarding-card">
        <div className="desktop-onboarding-header">
          <div>
            <span className="hero-label">Desktop setup</span>
            <h2 id="desktopOnboardingTitle">
              Finish the runtime checks, then get back to the extraction
              workspace.
            </h2>
            <p>
              The desktop shell is packaged, but local runtime health still
              determines whether extraction and review actually work.
            </p>
          </div>
          <button
            type="button"
            className="icon-button"
            onClick={onDismiss}
            aria-label="Dismiss onboarding"
          >
            ×
          </button>
        </div>

        <div className="desktop-onboarding-grid">
          <div className="desktop-checklist">
            {checklist.map((item) => (
              <div
                key={item.label}
                className={classNames(
                  "desktop-check-item",
                  item.complete && "complete",
                )}
              >
                <div className="desktop-check-state" aria-hidden="true">
                  {item.complete ? "✓" : "!"}
                </div>
                <div>
                  <strong>{item.label}</strong>
                  <p>{item.detail}</p>
                </div>
              </div>
            ))}
          </div>

          <div className="desktop-onboarding-side">
            <div className="desktop-side-card">
              <span className="eyebrow">Required sequence</span>
              <ol className="desktop-step-list">
                <li>Start Docker Desktop.</li>
                <li>Start the local stack from the desktop shell.</li>
                <li>Confirm backend reachability.</li>
                <li>Choose the default LLM provider.</li>
              </ol>
            </div>
            <div className="desktop-action-groups">
              <button
                type="button"
                className="primary-button"
                onClick={() => void onStartDesktopStack()}
                disabled={busyAction === "desktop-start"}
              >
                {busyAction === "desktop-start"
                  ? "Starting..."
                  : "Start local stack"}
              </button>
              <button
                type="button"
                className="secondary-button"
                onClick={onOpenSettings}
              >
                Open settings
              </button>
              <button
                type="button"
                className="tertiary-button"
                onClick={onDismiss}
              >
                Continue to extraction workspace
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function SchemaPage({
  templates,
  templateVersions,
  selectedTemplateId,
  setSelectedTemplateId,
  selectedTemplateVersionId,
  setSelectedTemplateVersionId,
  currentTemplateDefinition,
  provider,
  draft,
  setDraft,
  langextractFeedbackSuggestions,
  langextractFeedbackDiagnostics,
  langextractFeedbackStatus,
  appliedLangExtractSuggestionKeys,
  dismissedLangExtractSuggestionKeys,
  onApplyLangExtractSuggestion,
  onDismissLangExtractSuggestion,
  onCreateTemplate,
  busyAction,
}: {
  templates: TemplateSummary[];
  templateVersions: TemplateVersionRecord[];
  selectedTemplateId: number | null;
  setSelectedTemplateId: (id: number | null) => void;
  selectedTemplateVersionId: number | null;
  setSelectedTemplateVersionId: (id: number | null) => void;
  currentTemplateDefinition: TemplateDefinition | null;
  provider: ProviderSettings | null;
  draft: DraftTemplate;
  setDraft: Dispatch<SetStateAction<DraftTemplate>>;
  langextractFeedbackSuggestions: LangExtractFeedbackSuggestion[];
  langextractFeedbackDiagnostics: LangExtractFeedbackDiagnostics;
  langextractFeedbackStatus: "idle" | "loading" | "ready" | "error";
  appliedLangExtractSuggestionKeys: string[];
  dismissedLangExtractSuggestionKeys: string[];
  onApplyLangExtractSuggestion: (
    suggestion: LangExtractFeedbackSuggestion,
  ) => void;
  onDismissLangExtractSuggestion: (
    suggestionKey: string,
  ) => Promise<void> | void;
  onCreateTemplate: () => Promise<void>;
  busyAction: string | null;
}) {
  const definition = currentTemplateDefinition ?? starterTemplateDefinition;
  const effectiveProvider = provider ?? definition.llm_provider_settings;
  const showLangExtractEditor =
    effectiveProvider.api_style === "langextract" ||
    definition.llm_provider_settings.api_style === "langextract";
  const selectedSchema =
    templates.find((item) => item.id === selectedTemplateId) ?? null;
  const selectedVersions = templateVersions.filter(
    (item) => item.template_id === selectedTemplateId,
  );
  const requiredFieldCount = definition.extracted_fields.filter(
    (field) => field.required,
  ).length;
  const citationFieldCount = definition.extracted_fields.filter(
    (field) => field.citation_required,
  ).length;
  const optionalFieldCount =
    definition.extracted_fields.length - requiredFieldCount;
  const exportFormatsLabel =
    definition.output_settings.export_formats.join(" · ");
  const searchParametersStepNumber = showLangExtractEditor ? 4 : 3;
  const outputRulesStepNumber = showLangExtractEditor ? 5 : 4;

  return (
    <div className="page-stack">
      <section className="surface page-header-surface">
        <PageHeader
          eyebrow="Schemas"
          title="Define what the model should look for before the document run starts."
          description="Keep the setup sequence obvious: choose a reusable schema, describe the extraction job, review the search parameters, then confirm evidence and export rules."
          actions={
            <button
              type="button"
              className="secondary-button"
              onClick={() => void onCreateTemplate()}
              disabled={busyAction === "save-template"}
            >
              {busyAction === "save-template" ? "Saving..." : "Save schema"}
            </button>
          }
        />
      </section>

      <div className="detail-grid">
        <section
          className="surface span-12 schema-selector-surface"
          aria-labelledby="schema-base-step-title"
        >
          <CardHeader
            titleId="schema-base-step-title"
            title="1. Start from the closest existing schema"
            subtitle="Most operators should begin from a reusable schema and only change the brief when the job truly differs."
          />
          <div className="schema-selector-grid">
            <FieldShell
              label="Base schema"
              hint="Choose the reusable extraction pattern that is closest to this job."
            >
              <select
                aria-label="Base schema"
                value={selectedTemplateId ?? ""}
                onChange={(event) =>
                  setSelectedTemplateId(parseOptionalId(event.target.value))
                }
              >
                <option value="">Select schema</option>
                {templates.map((template) => (
                  <option key={template.id} value={template.id}>
                    {template.name}
                  </option>
                ))}
              </select>
            </FieldShell>
            <FieldShell
              label="Version"
              hint="Use the exact saved version the extraction run should follow."
            >
              <select
                aria-label="Version"
                value={selectedTemplateVersionId ?? ""}
                onChange={(event) =>
                  setSelectedTemplateVersionId(
                    parseOptionalId(event.target.value),
                  )
                }
              >
                <option value="">Select schema version</option>
                {selectedVersions.map((version) => (
                  <option key={version.id} value={version.id}>
                    {version.version}
                  </option>
                ))}
              </select>
            </FieldShell>
            <div className="schema-active-card">
              <span className="metric-label">Active setup</span>
              <strong>
                {selectedSchema?.name ?? definition.template_name}
              </strong>
              <p>
                {selectedSchema?.description ||
                  definition.description ||
                  "Use this starter schema as the base contract for the extraction job below."}
              </p>
              <div className="inline-badges">
                <StatusBadge tone="indigo">
                  {selectedTemplateVersionId
                    ? "Version selected"
                    : "Starter template"}
                </StatusBadge>
                <span className="pill">
                  {selectedVersions.length
                    ? `${selectedVersions.length} saved versions`
                    : "No saved versions yet"}
                </span>
              </div>
            </div>
          </div>
        </section>

        <section
          className="surface span-7"
          aria-labelledby="schema-brief-step-title"
        >
          <CardHeader
            titleId="schema-brief-step-title"
            title="2. Describe the extraction brief"
            subtitle="Tell the system what class of document this is and what information the run is meant to find."
          />
          <div className="schema-brief-grid">
            <div className="form-grid">
              <label>
                <span>Schema name</span>
                <input
                  value={draft.template_name}
                  onChange={(event) =>
                    setDraft((current) => ({
                      ...current,
                      template_name: event.target.value,
                    }))
                  }
                />
              </label>
              <label>
                <span>Document family</span>
                <input
                  value={draft.document_type}
                  onChange={(event) =>
                    setDraft((current) => ({
                      ...current,
                      document_type: event.target.value,
                    }))
                  }
                />
              </label>
              <label className="full-line">
                <span>What should this run look for?</span>
                <textarea
                  rows={4}
                  value={draft.description}
                  placeholder="Example: Extract every bank account reference, the account holder, the institution, and the exact source sentence or row that proves each value."
                  onChange={(event) =>
                    setDraft((current) => ({
                      ...current,
                      description: event.target.value,
                    }))
                  }
                />
              </label>
              <label>
                <span>Schema version</span>
                <input
                  value={draft.template_version}
                  onChange={(event) =>
                    setDraft((current) => ({
                      ...current,
                      template_version: event.target.value,
                    }))
                  }
                />
              </label>
              <SwitchField
                label="Local-only processing"
                checked={draft.local_only}
                hint="Keep this on when the schema should stay inside the local runtime by default."
                onToggle={() =>
                  setDraft((current) => ({
                    ...current,
                    local_only: !current.local_only,
                  }))
                }
              />
              {showLangExtractEditor ? (
                <>
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
                  <label className="full-line">
                    <span>LangExtract examples (JSON array)</span>
                    <textarea
                      rows={12}
                      value={draft.langextract_examples_json}
                      placeholder='[{"text":"...","extractions":[{"extraction_class":"field_name","extraction_text":"...","attributes":{"value":"..."}}]}]'
                      onChange={(event) =>
                        setDraft((current) => ({
                          ...current,
                          langextract_examples_json: event.target.value,
                        }))
                      }
                    />
                  </label>
                </>
              ) : null}
            </div>
            <div className="schema-guidance-stack">
              <div className="schema-guidance-card">
                <span className="metric-label">Best practice</span>
                <strong>Describe the extraction goal, not the model.</strong>
                <p>
                  Write the task the operator cares about: what values must be
                  found, what evidence matters, and what should happen when the
                  value is missing or ambiguous.
                </p>
              </div>
              <div className="schema-guidance-card muted">
                <span className="metric-label">Current search surface</span>
                <ul className="schema-checklist">
                  <li>
                    {definition.extracted_fields.length} extraction targets
                    defined
                  </li>
                  <li>{requiredFieldCount} required values must be found</li>
                  <li>{citationFieldCount} fields expect source evidence</li>
                </ul>
              </div>
            </div>
          </div>
        </section>

        {showLangExtractEditor ? (
          <section
            className="surface span-12"
            aria-labelledby="langextract-step-title"
          >
            <CardHeader
              titleId="langextract-step-title"
              title="3. Teach the schema with grounded examples"
              subtitle="Start with the smallest grounded example set that proves the behavior you want, then promote reviewed suggestions only when they deserve the next saved version."
            />
            <LangExtractEditor
              draft={draft}
              setDraft={setDraft}
              validFieldNames={definition.extracted_fields.map(
                (field) => field.name,
              )}
              requiredFieldNames={definition.extracted_fields
                .filter((field) => field.required)
                .map((field) => field.name)}
              feedbackSuggestions={langextractFeedbackSuggestions}
              feedbackDiagnostics={langextractFeedbackDiagnostics}
              feedbackStatus={langextractFeedbackStatus}
              appliedSuggestionKeys={appliedLangExtractSuggestionKeys}
              dismissedSuggestionKeys={dismissedLangExtractSuggestionKeys}
              onApplySuggestion={onApplyLangExtractSuggestion}
              onDismissSuggestion={onDismissLangExtractSuggestion}
              onSaveSchema={() => void onCreateTemplate()}
              saveBusy={busyAction === "save-template"}
              sourceVersionLabel={definition.template_version}
            />
          </section>
        ) : null}

        <section className="surface span-5" aria-labelledby="setup-map-title">
          <CardHeader
            titleId="setup-map-title"
            title="Setup map"
            subtitle="Keep the configuration sequence obvious so the user always knows what comes next."
          />
          <ol className="schema-step-list">
            <li className="schema-step-card active" aria-current="step">
              <span className="schema-step-number" aria-hidden="true">
                1
              </span>
              <div>
                <strong>Choose a schema base</strong>
                <p>
                  Reuse the closest existing definition before creating a new
                  one.
                </p>
              </div>
            </li>
            <li className="schema-step-card active" aria-current="step">
              <span className="schema-step-number" aria-hidden="true">
                2
              </span>
              <div>
                <strong>Describe the extraction goal</strong>
                <p>
                  State what the run should search for in plain operational
                  terms.
                </p>
              </div>
            </li>
            {showLangExtractEditor ? (
              <li className="schema-step-card active" aria-current="step">
                <span className="schema-step-number" aria-hidden="true">
                  3
                </span>
                <div>
                  <strong>Teach the schema with examples</strong>
                  <p>
                    Ground the schema with reliable spans before promoting
                    reviewed suggestions.
                  </p>
                </div>
              </li>
            ) : null}
            <li className="schema-step-card">
              <span className="schema-step-number" aria-hidden="true">
                {searchParametersStepNumber}
              </span>
              <div>
                <strong>Review search parameters</strong>
                <p>
                  Confirm the exact fields, evidence requirements, and output
                  types.
                </p>
              </div>
            </li>
            <li className="schema-step-card">
              <span className="schema-step-number" aria-hidden="true">
                {outputRulesStepNumber}
              </span>
              <div>
                <strong>Confirm review and export rules</strong>
                <p>
                  Make sure the output and human-review burden match the
                  workflow.
                </p>
              </div>
            </li>
          </ol>

          <div className="summary-grid top-gap">
            <SummaryStat
              label="Search targets"
              value={definition.extracted_fields.length}
              support={`${requiredFieldCount} required · ${optionalFieldCount} optional`}
              tone="accent"
            />
            <SummaryStat
              label="Evidence-backed"
              value={citationFieldCount}
              support="Fields expecting source citations"
            />
            <SummaryStat
              label="Calculated outputs"
              value={definition.calculated_fields.length}
              support="Deterministic formulas after extraction"
            />
            <SummaryStat
              label="Exports"
              value={exportFormatsLabel}
              support="Standardized output formats"
            />
          </div>
        </section>

        <section
          className="surface span-7"
          aria-labelledby="search-parameters-step-title"
        >
          <CardHeader
            titleId="search-parameters-step-title"
            title={`${searchParametersStepNumber}. Review the search parameters`}
            subtitle="This is the actual search contract the extraction run will follow."
          />
          <div className="builder-list parameter-list">
            {definition.extracted_fields.map((field, index) => (
              <div key={field.name} className="builder-item parameter-card">
                <div className="parameter-card-header">
                  <div className="parameter-index">{index + 1}</div>
                  <div className="parameter-copy">
                    <div className="builder-item-topline">
                      <strong>{field.label}</strong>
                      <div className="inline-badges">
                        <span className="pill">{field.type}</span>
                        <StatusBadge tone={field.required ? "info" : "warning"}>
                          {field.required ? "Required" : "Optional"}
                        </StatusBadge>
                        {field.citation_required ? (
                          <span className="pill">Evidence required</span>
                        ) : null}
                      </div>
                    </div>
                    <p>
                      {field.instructions ??
                        field.description ??
                        "Field instructions not defined."}
                    </p>
                  </div>
                </div>
                <div className="parameter-meta-grid">
                  <div className="parameter-meta-cell">
                    <span className="metric-label">Field key</span>
                    <strong>{field.name}</strong>
                  </div>
                  <div className="parameter-meta-cell">
                    <span className="metric-label">Output type</span>
                    <strong>{field.type}</strong>
                  </div>
                  <div className="parameter-meta-cell">
                    <span className="metric-label">Null handling</span>
                    <strong>
                      {field.required
                        ? "Do not allow missing values"
                        : "Allow null when absent"}
                    </strong>
                  </div>
                  <div className="parameter-meta-cell">
                    <span className="metric-label">Review posture</span>
                    <strong>
                      {field.citation_required
                        ? "Operator should confirm source evidence"
                        : "Evidence optional for this field"}
                    </strong>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </section>

        <section
          className="surface span-5"
          aria-labelledby="output-rules-step-title"
        >
          <CardHeader
            titleId="output-rules-step-title"
            title={`${outputRulesStepNumber}. Review output and trust rules`}
            subtitle="Keep deterministic logic and export behavior visible before the schema is saved."
          />
          <div className="schema-guidance-stack">
            <div className="schema-policy-card">
              <span className="metric-label">Provider</span>
              <strong>{definition.llm_provider_settings.provider_type}</strong>
              <p>
                Chunk size{" "}
                {definition.llm_provider_settings.chunk_size ?? 16000}{" "}
                characters ·{" "}
                {draft.local_only
                  ? "local-first boundary"
                  : "external processing allowed"}
              </p>
              {definition.langextract_config?.examples?.length ? (
                <p>
                  LangExtract examples{" "}
                  {definition.langextract_config.examples.length}
                </p>
              ) : null}
            </div>
            <div className="schema-policy-card">
              <span className="metric-label">Review threshold</span>
              <strong>
                {citationFieldCount
                  ? "Evidence-backed review expected"
                  : "Light review posture"}
              </strong>
              <p>
                Required fields and low-confidence values should be reviewed
                before the export is treated as final.
              </p>
            </div>
          </div>

          <div className="formula-editor-shell top-gap">
            <div className="hint-box">
              <strong>Calculated outputs stay deterministic.</strong>
              <p>
                Keep formulas in the product so the model only extracts source
                values and the application owns the final math.
              </p>
            </div>
            {definition.calculated_fields.length ? (
              definition.calculated_fields.map((field) => (
                <div key={field.name} className="formula-chip">
                  {field.label} = {field.formula}
                </div>
              ))
            ) : (
              <div className="hint-box">
                <strong>No calculated outputs yet.</strong>
                <p>
                  Add formulas only when the workflow needs deterministic values
                  after extraction.
                </p>
              </div>
            )}
            <div className="hint-box">
              <strong>Export formats</strong>
              <p>{exportFormatsLabel}</p>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}

function ExtractionWorkspacePage({
  documents,
  jobs,
  templateVersions,
  templates,
  resultsByJob,
  exportsList,
  selectedJobId,
  selectedDocumentId,
  selectedTemplateId,
  selectedTemplateVersionId,
  reviewDrafts,
  focusedFieldName,
  busyAction,
  onSelectJob,
  onStartNew,
  onUpload,
  onSelectDocument,
  onSelectTemplate,
  onSelectTemplateVersion,
  onSetReviewDraft,
  onSetFocusedField,
  onRunExtraction,
  onSaveReview,
  onExport,
  onOpenSchemas,
}: {
  documents: DocumentRecord[];
  jobs: JobRecord[];
  templateVersions: TemplateVersionRecord[];
  templates: TemplateSummary[];
  resultsByJob: Record<number, ResultEnvelope>;
  exportsList: ExportRecord[];
  selectedJobId: number | null;
  selectedDocumentId: number | null;
  selectedTemplateId: number | null;
  selectedTemplateVersionId: number | null;
  reviewDrafts: Record<string, string>;
  focusedFieldName: string | null;
  busyAction: string | null;
  onSelectJob: (jobId: number) => void;
  onStartNew: () => void;
  onUpload: (file: File) => Promise<void>;
  onSelectDocument: (id: number | null) => void;
  onSelectTemplate: (id: number | null) => void;
  onSelectTemplateVersion: (id: number | null) => void;
  onSetReviewDraft: (fieldName: string, value: string) => void;
  onSetFocusedField: (fieldName: string) => void;
  onRunExtraction: () => Promise<void>;
  onSaveReview: () => Promise<void>;
  onExport: (format: "json" | "csv" | "excel") => Promise<void>;
  onOpenSchemas: () => void;
}) {
  const uploadInputRef = useRef<HTMLInputElement | null>(null);
  const selectedJob = selectedJobId
    ? (jobs.find((job) => job.id === selectedJobId) ?? null)
    : null;
  const selectedResult = selectedJob
    ? (resultsByJob[selectedJob.id] ?? null)
    : null;
  const selectedDocument =
    (selectedJob
      ? documents.find((item) => item.id === selectedJob.document_id)
      : null) ??
    documents.find((item) => item.id === selectedDocumentId) ??
    null;
  const selectedTemplateVersion =
    (selectedJob
      ? templateVersions.find(
          (item) => item.id === selectedJob.template_version_id,
        )
      : null) ??
    templateVersions.find((item) => item.id === selectedTemplateVersionId) ??
    null;
  const selectedTemplate =
    templates.find(
      (item) => item.id === selectedTemplateVersion?.template_id,
    ) ??
    templates.find((item) => item.id === selectedTemplateId) ??
    null;
  const selectedSchemaVersions = templateVersions.filter(
    (item) => item.template_id === (selectedTemplate?.id ?? selectedTemplateId),
  );
  const stage: WorkspaceStage = selectedJob
    ? selectedJob.status === "failed"
      ? "failed"
      : selectedJob.status === "completed"
        ? selectedResult &&
          selectedResult.result.fields_requiring_review.length > 0
          ? "review"
          : "ready"
        : "processing"
    : "draft";

  const extractedFields = selectedResult?.result.extracted_fields ?? [];
  const calculatedFields = selectedResult?.result.calculated_fields ?? [];
  const fieldsNeedingReview = extractedFields.filter(
    (field) => field.requires_review || field.validation_status === "invalid",
  );
  const validatedFields = extractedFields.filter(
    (field) =>
      !fieldsNeedingReview.some((item) => item.field_name === field.field_name),
  );
  const exportHistory = selectedJob
    ? exportsList.filter((item) => item.job_id === selectedJob.id)
    : [];
  const focusedField =
    extractedFields.find((field) => field.field_name === focusedFieldName) ??
    fieldsNeedingReview[0] ??
    extractedFields[0] ??
    null;
  const selectedRunProvider =
    selectedResult?.result.llm_provider ??
    selectedJob?.provider_override ??
    selectedTemplateVersion?.definition.llm_provider_settings ??
    null;
  const selectedRunProviderLabel = selectedRunProvider
    ? `${selectedRunProvider.provider_type} (${selectedRunProvider.model})`
    : "Unknown provider";

  const jobGroups = [
    {
      label: "Processing",
      items: jobs.filter(
        (job) => job.status === "queued" || job.status === "running",
      ),
    },
    {
      label: "Needs review",
      items: jobs.filter(
        (job) =>
          (resultsByJob[job.id]?.result.fields_requiring_review.length ?? 0) >
          0,
      ),
    },
    { label: "Failed", items: jobs.filter((job) => job.status === "failed") },
    {
      label: "Completed",
      items: jobs.filter(
        (job) =>
          job.status === "completed" &&
          (resultsByJob[job.id]?.result.fields_requiring_review.length ?? 0) ===
            0,
      ),
    },
  ].filter((group) => group.items.length > 0);

  const progressSteps = [
    { label: "File uploaded", complete: Boolean(selectedDocument) },
    { label: "Schema selected", complete: Boolean(selectedTemplateVersion) },
    { label: "Extraction queued", complete: Boolean(selectedJob) },
    {
      label: "Fields processed",
      complete: Boolean(selectedJob && selectedJob.status !== "queued"),
    },
    {
      label: stage === "review" ? "Review waiting" : "Result ready",
      complete: stage === "review" || stage === "ready",
    },
  ];

  const headerTitle =
    stage === "draft"
      ? "New extraction"
      : stage === "processing"
        ? `Processing ${selectedDocument?.original_filename ?? "document"}`
        : stage === "failed"
          ? `Fix and rerun ${selectedDocument?.original_filename ?? "document"}`
          : stage === "review"
            ? `${fieldsNeedingReview.length} fields need review`
            : "Extraction complete";

  const headerCopy =
    stage === "draft"
      ? "Upload a document, confirm one schema, and keep the whole job in one workspace."
      : stage === "processing"
        ? "Stay here while the backend works. Progress belongs in the job, not on a separate page."
        : stage === "failed"
          ? "The job failed. Show the problem clearly and keep the user one action away from recovery."
          : stage === "review"
            ? "Review only the fields that need a human decision, then save once."
            : "The output is ready. Export it from the same place where you trusted it.";

  return (
    <div className="page-stack">
      <div className="workspace-layout">
        <aside className="surface job-rail">
          <CardHeader
            title="Extraction jobs"
            subtitle="Treat each extraction as one object from upload to export."
          />
          <button
            type="button"
            className="primary-button full-width"
            onClick={onStartNew}
          >
            New extraction
          </button>
          <div className="job-rail-sections">
            {jobGroups.length ? (
              jobGroups.map((group) => (
                <div key={group.label} className="job-group">
                  <span className="job-group-label">{group.label}</span>
                  <div className="queue-list">
                    {group.items.map((job) => {
                      const result = resultsByJob[job.id];
                      const document = documents.find(
                        (item) => item.id === job.document_id,
                      );
                      const reviewCount =
                        result?.result.fields_requiring_review.length ?? 0;
                      return (
                        <button
                          key={job.id}
                          type="button"
                          className={classNames(
                            "queue-item",
                            selectedJobId === job.id && "selected",
                          )}
                          onClick={() => onSelectJob(job.id)}
                        >
                          <strong>
                            {document?.original_filename ??
                              `Document ${job.document_id}`}
                          </strong>
                          <span>{formatTimestamp(job.updated_at)}</span>
                          <em>
                            {job.status === "completed"
                              ? reviewCount
                                ? `${reviewCount} need review`
                                : "Ready to export"
                              : job.status === "failed"
                                ? "Failed"
                                : "Processing"}
                          </em>
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))
            ) : (
              <div className="note-card compact">
                <strong>No extraction history yet</strong>
                <p>
                  Your first upload should not require a tour of the product.
                </p>
              </div>
            )}
          </div>
        </aside>

        <div className="workspace-stage">
          <section className="surface">
            <PageHeader
              eyebrow="Extraction workspace"
              title={headerTitle}
              description={headerCopy}
              actions={
                <>
                  {stage === "review" ? (
                    <button
                      type="button"
                      className="primary-button"
                      onClick={() => void onSaveReview()}
                      disabled={busyAction === "save-review"}
                    >
                      {busyAction === "save-review"
                        ? "Saving..."
                        : "Save changes"}
                    </button>
                  ) : null}
                  {stage === "ready" || stage === "review" ? (
                    <>
                      <button
                        type="button"
                        className="secondary-button"
                        onClick={() => void onExport("json")}
                        disabled={busyAction === "export-json"}
                      >
                        {busyAction === "export-json"
                          ? "Exporting JSON..."
                          : "Export JSON"}
                      </button>
                      <button
                        type="button"
                        className="secondary-button"
                        onClick={() => void onExport("csv")}
                        disabled={busyAction === "export-csv"}
                      >
                        {busyAction === "export-csv"
                          ? "Exporting CSV..."
                          : "Export CSV"}
                      </button>
                      <button
                        type="button"
                        className="secondary-button"
                        onClick={() => void onExport("excel")}
                        disabled={busyAction === "export-excel"}
                      >
                        {busyAction === "export-excel"
                          ? "Exporting Excel..."
                          : "Export Excel"}
                      </button>
                    </>
                  ) : null}
                  {(stage === "draft" || stage === "failed") &&
                  templates.length ? (
                    <button
                      type="button"
                      className="primary-button"
                      onClick={() => void onRunExtraction()}
                      disabled={
                        !selectedDocument ||
                        !selectedTemplateVersion ||
                        busyAction === "run"
                      }
                    >
                      {busyAction === "run" ? "Queueing..." : "Run extraction"}
                    </button>
                  ) : null}
                </>
              }
            />

            <div className="workspace-detail-grid">
              <section className="surface section-surface">
                <CardHeader
                  title="Source"
                  subtitle="Keep the document, schema, and evidence together so the next action stays obvious."
                />
                {stage === "draft" ? (
                  <div className="draft-source-stack">
                    <div className="upload-zone">
                      <div className="upload-glyph">↑</div>
                      <strong>Upload PDF or source file</strong>
                      <p>PDF, DOCX, JPG, PNG, TIFF, TXT</p>
                      <button
                        type="button"
                        className="primary-button"
                        onClick={() => uploadInputRef.current?.click()}
                      >
                        Choose file
                      </button>
                      <span>
                        Stay in this workspace after upload. Do not get kicked
                        to another destination.
                      </span>
                      <input
                        ref={uploadInputRef}
                        type="file"
                        aria-label="Choose document file"
                        className="hidden-input"
                        onChange={(event) => {
                          const file = event.target.files?.[0];
                          if (file) {
                            void onUpload(file);
                          }
                          event.currentTarget.value = "";
                        }}
                      />
                    </div>

                    <div className="settings-grid">
                      <SummaryStat
                        label="Selected document"
                        value={
                          selectedDocument?.original_filename ?? "None yet"
                        }
                        tone="accent"
                      />
                      <SummaryStat
                        label="Type"
                        value={
                          selectedDocument
                            ? getDocumentTypeLabel(
                                selectedDocument.content_type,
                              )
                            : "—"
                        }
                      />
                    </div>

                    {documents.length ? (
                      <label>
                        <span>Recent sources</span>
                        <select
                          value={selectedDocumentId ?? ""}
                          onChange={(event) =>
                            onSelectDocument(
                              parseOptionalId(event.target.value),
                            )
                          }
                        >
                          <option value="">Select document</option>
                          {documents.map((document) => (
                            <option key={document.id} value={document.id}>
                              {document.original_filename}
                            </option>
                          ))}
                        </select>
                      </label>
                    ) : null}

                    {templates.length ? (
                      <div className="form-grid">
                        <label>
                          <span>Schema</span>
                          <select
                            value={selectedTemplate?.id ?? ""}
                            onChange={(event) =>
                              onSelectTemplate(
                                parseOptionalId(event.target.value),
                              )
                            }
                          >
                            <option value="">Select schema</option>
                            {templates.map((template) => (
                              <option key={template.id} value={template.id}>
                                {template.name}
                              </option>
                            ))}
                          </select>
                        </label>
                        <label>
                          <span>Advanced: version</span>
                          <select
                            value={selectedTemplateVersion?.id ?? ""}
                            onChange={(event) =>
                              onSelectTemplateVersion(
                                parseOptionalId(event.target.value),
                              )
                            }
                          >
                            <option value="">Select version</option>
                            {selectedSchemaVersions.map((version) => (
                              <option key={version.id} value={version.id}>
                                {version.version}
                              </option>
                            ))}
                          </select>
                        </label>
                      </div>
                    ) : (
                      <div className="note-card">
                        <strong>No schemas yet</strong>
                        <p>
                          You only need to leave this workspace if a schema
                          truly does not exist.
                        </p>
                        <button
                          type="button"
                          className="secondary-button top-gap"
                          onClick={onOpenSchemas}
                        >
                          Open schema builder
                        </button>
                      </div>
                    )}
                  </div>
                ) : selectedResult ? (
                  <div className="evidence-stack">
                    <div className="evidence-preview">
                      <strong>
                        {selectedDocument?.original_filename ??
                          "Selected document"}
                      </strong>
                      <p>
                        {focusedField
                          ? "Source evidence should justify the field the user is editing."
                          : "No field is currently selected."}
                      </p>
                    </div>
                    {focusedField ? (
                      <div className="note-card">
                        <strong>{focusedField.label}</strong>
                        <p>
                          {focusedField.source_text ||
                            "No citation snippet returned for this field."}
                        </p>
                        <div className="inline-actions top-gap">
                          <span className="pill">
                            {focusedField.page_number
                              ? `Page ${focusedField.page_number}`
                              : "Page —"}
                          </span>
                          <span className="pill">
                            {focusedField.location_reference ||
                              "Unknown location"}
                          </span>
                          <span className="pill">
                            {formatCharInterval(focusedField)}
                          </span>
                          <span className="pill">
                            Confidence{" "}
                            {formatConfidence(focusedField.confidence_score)}
                          </span>
                        </div>
                      </div>
                    ) : null}
                    <div className="evidence-list">
                      {extractedFields.map((field) => (
                        <button
                          key={field.field_name}
                          type="button"
                          className={classNames(
                            "evidence-row",
                            focusedField?.field_name === field.field_name &&
                              "selected",
                          )}
                          onClick={() => onSetFocusedField(field.field_name)}
                        >
                          <div>
                            <strong>{field.label}</strong>
                            <p>
                              {field.source_text ||
                                field.extraction_notes ||
                                "No source snippet returned."}
                            </p>
                          </div>
                          <StatusBadge
                            tone={
                              field.validation_status === "invalid"
                                ? "danger"
                                : field.requires_review
                                  ? "warning"
                                  : "success"
                            }
                          >
                            {field.requires_review
                              ? "Needs Review"
                              : field.validation_status === "invalid"
                                ? "Invalid"
                                : "Valid"}
                          </StatusBadge>
                        </button>
                      ))}
                    </div>
                  </div>
                ) : (
                  <div className="processing-stack">
                    <div className="evidence-preview">
                      <strong>
                        {selectedDocument?.original_filename ??
                          "Selected document"}
                      </strong>
                      <p>
                        {selectedDocument
                          ? `${getDocumentTypeLabel(selectedDocument.content_type)} · uploaded ${formatTimestamp(selectedDocument.created_at)}`
                          : "Choose a document to begin."}
                      </p>
                    </div>
                    <div className="progress-list">
                      {progressSteps.map((step) => (
                        <div
                          key={step.label}
                          className={classNames(
                            "progress-step",
                            step.complete && "complete",
                          )}
                        >
                          <div className="progress-dot" aria-hidden="true" />
                          <span>{step.label}</span>
                        </div>
                      ))}
                    </div>
                    {selectedJob?.error_message ? (
                      <div className="note-card">
                        <strong>Failure detail</strong>
                        <p>{selectedJob.error_message}</p>
                      </div>
                    ) : null}
                  </div>
                )}
              </section>

              <section className="surface section-surface">
                {stage === "draft" ? (
                  <>
                    <CardHeader
                      title="Outcome preview"
                      subtitle="The user should know what progress looks like before they press run."
                    />
                    <div className="summary-grid">
                      <SummaryStat
                        label="Schema"
                        value={selectedTemplate?.name ?? "Choose one schema"}
                        tone="accent"
                      />
                      <SummaryStat
                        label="Version"
                        value={
                          selectedTemplateVersion?.version ?? "Advanced only"
                        }
                      />
                      <SummaryStat
                        label="Fields to extract"
                        value={
                          selectedTemplateVersion?.definition.extracted_fields
                            .length ?? 0
                        }
                      />
                      <SummaryStat
                        label="Export formats"
                        value={
                          selectedTemplateVersion?.definition.output_settings.export_formats.join(
                            " · ",
                          ) ?? "JSON · CSV · Excel"
                        }
                      />
                    </div>
                    <div className="note-card">
                      <strong>What happens next</strong>
                      <p>
                        Upload a PDF, keep the recommended schema unless it is
                        wrong, run extraction, then review only the uncertain
                        fields.
                      </p>
                    </div>
                    {selectedTemplateVersion ? (
                      <div className="preview-list">
                        {selectedTemplateVersion.definition.extracted_fields.map(
                          (field) => (
                            <div key={field.name} className="preview-row">
                              <div className="field-token">
                                {field.label.charAt(0).toUpperCase()}
                              </div>
                              <div className="preview-copy">
                                <strong>{field.label}</strong>
                                <span>{field.type}</span>
                              </div>
                              <div className="preview-meta">
                                <StatusBadge
                                  tone={field.required ? "info" : "warning"}
                                >
                                  {field.required ? "Required" : "Optional"}
                                </StatusBadge>
                                {field.citation_required ? (
                                  <span className="pill">Citation</span>
                                ) : null}
                              </div>
                            </div>
                          ),
                        )}
                      </div>
                    ) : null}
                  </>
                ) : stage === "processing" || stage === "failed" ? (
                  <>
                    <CardHeader
                      title="Progress"
                      subtitle="This replaces the old Runs page. Status belongs inside the active job."
                    />
                    <div className="summary-grid">
                      <SummaryStat
                        label="Status"
                        value={selectedJob?.status ?? "Queued"}
                        tone={
                          stage === "failed"
                            ? "danger"
                            : stage === "processing"
                              ? "warning"
                              : "accent"
                        }
                      />
                      <SummaryStat
                        label="Schema"
                        value={
                          selectedTemplateVersion?.definition.template_name ??
                          "Unknown schema"
                        }
                      />
                      <SummaryStat
                        label="Run provider"
                        value={selectedRunProviderLabel}
                      />
                      <SummaryStat
                        label="Started"
                        value={formatTimestamp(selectedJob?.created_at)}
                      />
                      <SummaryStat
                        label="Last update"
                        value={formatTimestamp(selectedJob?.updated_at)}
                      />
                    </div>
                    <div className="progress-list">
                      {progressSteps.map((step) => (
                        <div
                          key={step.label}
                          className={classNames(
                            "progress-step",
                            step.complete && "complete",
                          )}
                        >
                          <div className="progress-dot" aria-hidden="true" />
                          <span>{step.label}</span>
                        </div>
                      ))}
                    </div>
                    <div className="note-card">
                      <strong>
                        {stage === "failed"
                          ? "Recovery path"
                          : "Why this stays here"}
                      </strong>
                      <p>
                        {stage === "failed"
                          ? "The user should be one action away from retrying instead of hunting through a job table."
                          : "Web and desktop users both need live job progress without leaving the extraction workspace."}
                      </p>
                    </div>
                  </>
                ) : (
                  <>
                    <CardHeader
                      title={
                        stage === "review"
                          ? "Review only the exceptions"
                          : "Trusted result"
                      }
                      subtitle={
                        stage === "review"
                          ? `${fieldsNeedingReview.length} fields need a human decision before export.`
                          : "The extraction finished cleanly. Export directly from the trusted result."
                      }
                    />
                    <div className="summary-grid">
                      <SummaryStat
                        label="Extracted fields"
                        value={extractedFields.length}
                      />
                      <SummaryStat
                        label="Run provider"
                        value={selectedRunProviderLabel}
                      />
                      <SummaryStat
                        label="Needs review"
                        value={fieldsNeedingReview.length}
                        tone={
                          fieldsNeedingReview.length ? "warning" : "success"
                        }
                      />
                      <SummaryStat
                        label="Calculated fields"
                        value={calculatedFields.length}
                      />
                      <SummaryStat
                        label="Reviewed"
                        value={
                          selectedResult?.result.reviewed_at
                            ? formatTimestamp(selectedResult.result.reviewed_at)
                            : "Not yet"
                        }
                      />
                    </div>

                    {fieldsNeedingReview.length ? (
                      <div className="review-groups">
                        <div className="review-group">
                          <div className="review-group-header">
                            <strong>Needs review</strong>
                            <span>{fieldsNeedingReview.length} fields</span>
                          </div>
                          {fieldsNeedingReview.map((field) => {
                            const definition = getFieldDefinition(
                              selectedTemplateVersion?.definition ?? null,
                              field.field_name,
                            );
                            const reviewSignals = getReviewSignals(field);
                            const fieldType = getFieldType(field, definition);
                            const draftValue =
                              reviewDrafts[field.field_name] ??
                              getInitialReviewDraft(field, definition);
                            return (
                              <div
                                key={field.field_name}
                                className={classNames(
                                  "triage-card",
                                  focusedField?.field_name ===
                                    field.field_name && "selected-card",
                                )}
                              >
                                <div className="review-card-header">
                                  <div>
                                    <strong>{field.label}</strong>
                                    <p>
                                      {reviewSignals[0] ??
                                        "This field needs confirmation."}
                                    </p>
                                  </div>
                                  <StatusBadge
                                    tone={
                                      field.validation_status === "invalid"
                                        ? "danger"
                                        : "warning"
                                    }
                                  >
                                    {field.validation_status === "invalid"
                                      ? "Invalid"
                                      : "Needs Review"}
                                  </StatusBadge>
                                </div>
                                {reviewSignals.length ? (
                                  <div className="review-signals">
                                    <span className="metric-label">
                                      Review signals
                                    </span>
                                    <ul className="review-signal-list">
                                      {reviewSignals.map((signal) => (
                                        <li key={signal}>{signal}</li>
                                      ))}
                                    </ul>
                                  </div>
                                ) : null}
                                <FieldShell
                                  label="Review value"
                                  hint={
                                    fieldType === "boolean"
                                      ? "Choose the confirmed value."
                                      : fieldType === "paragraph"
                                        ? "Save the verified text exactly as it should appear in the result."
                                        : fieldType === "date"
                                          ? "Use the normalized date when the source is clear."
                                          : "Edit the normalized value before saving."
                                  }
                                >
                                  {fieldType === "boolean" ? (
                                    <select
                                      aria-label={`${field.label} review value`}
                                      value={draftValue}
                                      onChange={(event) =>
                                        onSetReviewDraft(
                                          field.field_name,
                                          event.target.value,
                                        )
                                      }
                                    >
                                      <option value="">Unknown</option>
                                      <option value="true">True</option>
                                      <option value="false">False</option>
                                    </select>
                                  ) : fieldType === "paragraph" ? (
                                    <textarea
                                      aria-label={`${field.label} review value`}
                                      rows={4}
                                      value={draftValue}
                                      onChange={(event) =>
                                        onSetReviewDraft(
                                          field.field_name,
                                          event.target.value,
                                        )
                                      }
                                    />
                                  ) : (
                                    <input
                                      aria-label={`${field.label} review value`}
                                      type={
                                        fieldType === "date" ? "date" : "text"
                                      }
                                      value={draftValue}
                                      onChange={(event) =>
                                        onSetReviewDraft(
                                          field.field_name,
                                          event.target.value,
                                        )
                                      }
                                    />
                                  )}
                                </FieldShell>
                                <div className="triage-meta">
                                  <span>
                                    Current value:{" "}
                                    {formatValue(
                                      field.normalized_value ??
                                        field.extracted_value,
                                    )}
                                  </span>
                                  <span>
                                    {field.page_number
                                      ? `Page ${field.page_number}`
                                      : "Page —"}{" "}
                                    ·{" "}
                                    {field.location_reference ||
                                      "Unknown location"}
                                  </span>
                                  <span>{formatCharInterval(field)}</span>
                                  <span>
                                    Confidence{" "}
                                    {formatConfidence(field.confidence_score)}
                                  </span>
                                </div>
                                <div className="inline-actions top-gap">
                                  <button
                                    type="button"
                                    className="text-link"
                                    onClick={() =>
                                      onSetFocusedField(field.field_name)
                                    }
                                  >
                                    Show source
                                  </button>
                                  <span className="pill">{fieldType}</span>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    ) : (
                      <div className="note-card">
                        <strong>No manual review required</strong>
                        <p>
                          The result is already ready for export. Do not make
                          the user visit another page just to download it.
                        </p>
                      </div>
                    )}

                    {validatedFields.length ? (
                      <div className="review-group">
                        <div className="review-group-header">
                          <strong>Looks good</strong>
                          <span>{validatedFields.length} fields</span>
                        </div>
                        <div className="preview-list">
                          {validatedFields.slice(0, 6).map((field) => (
                            <div key={field.field_name} className="preview-row">
                              <div className="field-token">
                                {field.label.charAt(0).toUpperCase()}
                              </div>
                              <div className="preview-copy">
                                <strong>{field.label}</strong>
                                <span>
                                  {formatValue(
                                    field.normalized_value ??
                                      field.extracted_value,
                                  )}
                                </span>
                              </div>
                              <div className="preview-meta">
                                <StatusBadge tone="success">Valid</StatusBadge>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    ) : null}

                    {calculatedFields.length ? (
                      <div className="review-group">
                        <div className="review-group-header">
                          <strong>Calculated fields</strong>
                          <span>{calculatedFields.length}</span>
                        </div>
                        <div className="preview-list">
                          {calculatedFields.map((field) => (
                            <div key={field.field_name} className="preview-row">
                              <div className="field-token">
                                {field.label.charAt(0).toUpperCase()}
                              </div>
                              <div className="preview-copy">
                                <strong>{field.label}</strong>
                                <span>
                                  {formatValue(field.calculated_value)}
                                </span>
                              </div>
                              <div className="preview-meta">
                                <StatusBadge
                                  tone={
                                    field.validation_status === "invalid"
                                      ? "danger"
                                      : "success"
                                  }
                                >
                                  {field.validation_status === "invalid"
                                    ? "Invalid"
                                    : "Valid"}
                                </StatusBadge>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    ) : null}

                    <div className="review-group">
                      <div className="review-group-header">
                        <strong>Export history</strong>
                        <span>{exportHistory.length}</span>
                      </div>
                      {exportHistory.length ? (
                        <div className="preview-list">
                          {exportHistory.map((record) => (
                            <div key={record.id} className="preview-row">
                              <div className="field-token">
                                {record.export_format.charAt(0).toUpperCase()}
                              </div>
                              <div className="preview-copy">
                                <strong>{basename(record.file_path)}</strong>
                                <span>
                                  {formatTimestamp(record.created_at)}
                                </span>
                              </div>
                              <div className="preview-meta">
                                <a
                                  className="text-link"
                                  href={`${API_BASE}/exports/${record.id}/download`}
                                  target="_blank"
                                  rel="noreferrer"
                                >
                                  Download
                                </a>
                              </div>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <div className="note-card compact">
                          <strong>No exports yet</strong>
                          <p>
                            Exports should be available from this result, not
                            hidden behind another destination.
                          </p>
                        </div>
                      )}
                    </div>
                  </>
                )}
              </section>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}

function SettingsPage({
  provider,
  providerCatalog,
  providerHealth,
  customProviderDraft,
  selectedCustomProfileId,
  customProfiles,
  providerControls,
  onCustomProviderDraftChange,
  onSetProvider,
  onProbeProvider,
  onSetCustomProvider,
  onProbeCustomProvider,
  onSaveCustomProfile,
  onLoadCustomProfile,
  onReverifyCustomProfile,
  onActivateCustomProfile,
  onDeleteCustomProfile,
  probeResults,
  busyAction,
  desktopStatus,
  onRefreshDesktopStatus,
  onStartDesktopStack,
  onRestartDesktopStack,
  onStopDesktopStack,
  onOpenDesktopProjectRoot,
  onOpenDesktopAppDataDir,
  onLoadDesktopLogs,
  desktopLogs,
}: {
  provider: ProviderSettings | null;
  providerCatalog: ProviderCatalogEntry[];
  providerHealth: Record<string, ProviderHealth>;
  customProviderDraft: CustomProviderDraft;
  selectedCustomProfileId: string | null;
  customProfiles: CustomProviderProfile[];
  providerControls: ProviderControls;
  onCustomProviderDraftChange: Dispatch<SetStateAction<CustomProviderDraft>>;
  onSetProvider: (provider: ProviderSettings) => Promise<void>;
  onProbeProvider: (provider: ProviderCatalogEntry) => Promise<void>;
  onSetCustomProvider: () => Promise<void>;
  onProbeCustomProvider: () => Promise<void>;
  onSaveCustomProfile: () => Promise<void>;
  onLoadCustomProfile: (profile: CustomProviderProfile) => void;
  onReverifyCustomProfile: (profile: CustomProviderProfile) => Promise<void>;
  onActivateCustomProfile: (profile: CustomProviderProfile) => Promise<void>;
  onDeleteCustomProfile: (profile: CustomProviderProfile) => Promise<void>;
  probeResults: Record<string, ProviderProbe>;
  busyAction: string | null;
  desktopStatus: DesktopStatus | null;
  onRefreshDesktopStatus: () => Promise<void>;
  onStartDesktopStack: () => Promise<void>;
  onRestartDesktopStack: () => Promise<void>;
  onStopDesktopStack: () => Promise<void>;
  onOpenDesktopProjectRoot: () => Promise<void>;
  onOpenDesktopAppDataDir: () => Promise<void>;
  onLoadDesktopLogs: () => Promise<void>;
  desktopLogs: DesktopLogs | null;
}) {
  const savedCustomProfiles = customProfiles ?? [];
  const probeMaxAgeHours =
    providerControls.custom_provider_probe_max_age_hours ||
    DEFAULT_CUSTOM_PROVIDER_PROBE_MAX_AGE_HOURS;

  return (
    <div className="page-stack">
      <section className="surface page-header-surface">
        <PageHeader
          eyebrow="Settings"
          title="Provider and runtime controls belong here, not in the user’s first-run workflow."
          description="Keep setup and admin power accessible without making every operator think about it on every extraction."
        />
      </section>

      <section className="surface">
        <CardHeader
          title="Provider presets"
          subtitle="Choose where extraction runs without hiding where documents are processed."
        />
        <div className="provider-grid">
          {providerCatalog.map((item) => {
            const selected =
              provider?.provider_type === item.settings.provider_type &&
              provider?.model === item.settings.model;
            const health = providerHealth[item.key];
            const probe = probeResults[item.key];
            return (
              <section key={item.key} className="provider-card">
                <div className="provider-header">
                  <div>
                    <span
                      className={classNames(
                        "provider-mode",
                        item.mode === "local" ? "local" : "cloud",
                      )}
                    >
                      {item.mode === "local" ? "Local" : "Cloud"}
                    </span>
                    <h3>{item.label}</h3>
                  </div>
                  <StatusBadge
                    tone={
                      selected
                        ? "info"
                        : health?.ready
                          ? "success"
                          : health?.status === "probe_required"
                            ? "warning"
                            : item.recommended
                              ? "indigo"
                              : item.enabled
                                ? "neutral"
                                : "danger"
                    }
                  >
                    {selected
                      ? "Default"
                      : health?.ready
                        ? "Ready"
                        : health?.status === "probe_required"
                          ? "Probe required"
                          : item.recommended
                            ? "Recommended"
                            : item.enabled
                              ? "Available"
                              : "Disabled"}
                  </StatusBadge>
                </div>
                <div className="provider-body">
                  <p>{item.description}</p>
                  <div className="provider-item">
                    <span>Base URL</span>
                    <strong>{item.base_url ?? "No network endpoint"}</strong>
                  </div>
                  <div className="provider-item">
                    <span>Model</span>
                    <strong>{item.model}</strong>
                  </div>
                  {item.settings.deployment ? (
                    <div className="provider-item">
                      <span>Deployment</span>
                      <strong>{item.settings.deployment}</strong>
                    </div>
                  ) : null}
                  <div className="provider-item">
                    <span>Controls</span>
                    <strong>
                      {item.capabilities.requires_api_key
                        ? `API key via ${item.api_key_env_var}`
                        : "No API key required"}
                    </strong>
                  </div>
                  <div className="provider-item">
                    <span>Policy</span>
                    <strong>
                      {item.settings.allow_external_processing
                        ? "External processing allowed"
                        : "Local-only processing"}
                    </strong>
                  </div>
                  <div className="provider-item">
                    <span>Readiness</span>
                    <strong>
                      {health
                        ? health.checks.join(" • ")
                        : "No health data loaded"}
                    </strong>
                  </div>
                  <div className="provider-item">
                    <span>Probe</span>
                    <strong>
                      {probe
                        ? `${probe.reachable ? "Reachable" : "Not reachable"}${probe.status_code ? ` (HTTP ${probe.status_code})` : ""}: ${probe.detail}`
                        : "No live probe run"}
                    </strong>
                  </div>
                </div>
                <div className="inline-actions">
                  <button
                    type="button"
                    className="primary-button"
                    onClick={() =>
                      void onSetProvider(buildProviderPayload(item))
                    }
                    disabled={busyAction === "save-provider"}
                  >
                    {selected
                      ? "Default provider"
                      : busyAction === "save-provider"
                        ? "Saving..."
                        : "Set as default"}
                  </button>
                  <button
                    type="button"
                    className="secondary-button"
                    onClick={() => void onProbeProvider(item)}
                    disabled={busyAction === `probe-${item.key}`}
                  >
                    {busyAction === `probe-${item.key}`
                      ? "Probing..."
                      : "Probe"}
                  </button>
                </div>
              </section>
            );
          })}
        </div>
      </section>

      <section className="surface">
        <CardHeader
          title="Product defaults"
          subtitle="Keep the defaults predictable so users rarely need this page."
        />
        <div className="settings-grid settings-grid-wide">
          {[
            [
              "App mode",
              provider?.mode === "cloud" ? "Cloud-assisted" : "Local",
            ],
            ["Default provider", provider?.provider_type ?? "Not configured"],
            ["Default model", provider?.model ?? "Not configured"],
            ["Storage location", "/data"],
            ["OCR settings", "Enabled for scanned PDFs"],
            ["Export defaults", "JSON + CSV + Excel"],
            ["Profile reverify threshold", `${probeMaxAgeHours} hours`],
            ["Logging preference", "Minimal document text logging"],
            [
              "Privacy mode",
              provider?.allow_external_processing
                ? "Cloud allowed"
                : "Local-only by default",
            ],
          ].map(([label, value]) => (
            <SummaryStat key={label} label={label} value={value} />
          ))}
        </div>
      </section>

      <section className="surface">
        <CardHeader
          title="Custom provider"
          subtitle="Register a private OpenAI-compatible or Azure endpoint without editing environment catalog JSON."
        />
        <div className="form-grid">
          <label>
            <span>Display label</span>
            <input
              value={customProviderDraft.label}
              onChange={(event) =>
                onCustomProviderDraftChange((current) => ({
                  ...current,
                  label: event.target.value,
                }))
              }
            />
          </label>
          <label>
            <span>Provider type</span>
            <input
              value={customProviderDraft.provider_type}
              onChange={(event) =>
                onCustomProviderDraftChange((current) => ({
                  ...current,
                  provider_type: event.target.value,
                }))
              }
            />
          </label>
          <label>
            <span>Mode</span>
            <select
              value={customProviderDraft.mode}
              onChange={(event) =>
                onCustomProviderDraftChange((current) => ({
                  ...current,
                  mode: event.target.value as CustomProviderDraft["mode"],
                  allow_external_processing: event.target.value === "cloud",
                }))
              }
            >
              <option value="local">Local</option>
              <option value="cloud">Cloud</option>
            </select>
          </label>
          <label>
            <span>API style</span>
            <select
              value={customProviderDraft.api_style}
              onChange={(event) =>
                onCustomProviderDraftChange((current) => ({
                  ...current,
                  api_style: event.target
                    .value as CustomProviderDraft["api_style"],
                }))
              }
            >
              <option value="openai_compatible">OpenAI-compatible</option>
              <option value="azure_openai">Azure OpenAI</option>
            </select>
          </label>
          <label className="full-line">
            <span>Base URL</span>
            <input
              value={customProviderDraft.base_url}
              placeholder="https://llm.company.internal/v1"
              onChange={(event) =>
                onCustomProviderDraftChange((current) => ({
                  ...current,
                  base_url: event.target.value,
                }))
              }
            />
          </label>
          <label>
            <span>Model</span>
            <input
              value={customProviderDraft.model}
              onChange={(event) =>
                onCustomProviderDraftChange((current) => ({
                  ...current,
                  model: event.target.value,
                }))
              }
            />
          </label>
          <label>
            <span>API key env var</span>
            <input
              value={customProviderDraft.api_key_env_var}
              placeholder="OPENAI_API_KEY"
              onChange={(event) =>
                onCustomProviderDraftChange((current) => ({
                  ...current,
                  api_key_env_var: event.target.value,
                }))
              }
            />
          </label>
          {customProviderDraft.api_style === "azure_openai" ? (
            <>
              <label>
                <span>Deployment</span>
                <input
                  value={customProviderDraft.deployment}
                  onChange={(event) =>
                    onCustomProviderDraftChange((current) => ({
                      ...current,
                      deployment: event.target.value,
                    }))
                  }
                />
              </label>
              <label>
                <span>API version</span>
                <input
                  value={customProviderDraft.api_version}
                  onChange={(event) =>
                    onCustomProviderDraftChange((current) => ({
                      ...current,
                      api_version: event.target.value,
                    }))
                  }
                />
              </label>
            </>
          ) : null}
          <label>
            <span>Temperature</span>
            <input
              value={customProviderDraft.temperature}
              onChange={(event) =>
                onCustomProviderDraftChange((current) => ({
                  ...current,
                  temperature: event.target.value,
                }))
              }
            />
          </label>
          <label>
            <span>Max tokens</span>
            <input
              value={customProviderDraft.max_tokens}
              onChange={(event) =>
                onCustomProviderDraftChange((current) => ({
                  ...current,
                  max_tokens: event.target.value,
                }))
              }
            />
          </label>
          <label>
            <span>Timeout seconds</span>
            <input
              value={customProviderDraft.timeout_seconds}
              onChange={(event) =>
                onCustomProviderDraftChange((current) => ({
                  ...current,
                  timeout_seconds: event.target.value,
                }))
              }
            />
          </label>
          <label>
            <span>Retry count</span>
            <input
              value={customProviderDraft.retry_count}
              onChange={(event) =>
                onCustomProviderDraftChange((current) => ({
                  ...current,
                  retry_count: event.target.value,
                }))
              }
            />
          </label>
          <label>
            <span>Chunk size</span>
            <input
              value={customProviderDraft.chunk_size}
              onChange={(event) =>
                onCustomProviderDraftChange((current) => ({
                  ...current,
                  chunk_size: event.target.value,
                }))
              }
            />
          </label>
          <SwitchField
            label="External processing allowed"
            checked={customProviderDraft.allow_external_processing}
            hint="Turn this on only when documents may leave the local environment."
            onToggle={() =>
              onCustomProviderDraftChange((current) => ({
                ...current,
                allow_external_processing: !current.allow_external_processing,
              }))
            }
          />
          <SwitchField
            label="JSON mode requested"
            checked={customProviderDraft.supports_json_mode}
            hint="Request structured JSON responses when the provider supports them."
            onToggle={() =>
              onCustomProviderDraftChange((current) => ({
                ...current,
                supports_json_mode: !current.supports_json_mode,
              }))
            }
          />
        </div>
        <div className="provider-item top-gap">
          <span>Current draft probe</span>
          <strong>
            {probeResults[CUSTOM_PROVIDER_KEY]
              ? `${probeResults[CUSTOM_PROVIDER_KEY].reachable ? "Reachable" : "Not reachable"}: ${probeResults[CUSTOM_PROVIDER_KEY].detail}`
              : "No live probe run"}
          </strong>
        </div>
        <div className="inline-actions top-gap">
          <button
            type="button"
            className="secondary-button"
            onClick={() => void onSaveCustomProfile()}
            disabled={busyAction === "save-custom-profile"}
          >
            {busyAction === "save-custom-profile"
              ? "Saving profile..."
              : selectedCustomProfileId
                ? "Update saved profile"
                : "Save profile"}
          </button>
          <button
            type="button"
            className="primary-button"
            onClick={() => void onSetCustomProvider()}
            disabled={busyAction === "save-provider"}
          >
            {busyAction === "save-provider"
              ? "Saving..."
              : "Set custom provider as default"}
          </button>
          <button
            type="button"
            className="secondary-button"
            onClick={() => void onProbeCustomProvider()}
            disabled={busyAction === `probe-${CUSTOM_PROVIDER_KEY}`}
          >
            {busyAction === `probe-${CUSTOM_PROVIDER_KEY}`
              ? "Probing..."
              : "Probe custom provider"}
          </button>
        </div>
        {savedCustomProfiles.length ? (
          <div className="provider-grid top-gap">
            {savedCustomProfiles.map((profile) => {
              const profileProbeIsStale = customProviderProfileProbeIsStale(
                profile,
                probeMaxAgeHours,
              );
              return (
                <section key={profile.id} className="provider-card">
                  <div className="provider-header">
                    <div>
                      <span
                        className={classNames(
                          "provider-mode",
                          profile.settings.mode === "local" ? "local" : "cloud",
                        )}
                      >
                        {profile.settings.mode === "local" ? "Local" : "Cloud"}
                      </span>
                      <h3>{profile.name}</h3>
                    </div>
                    <StatusBadge
                      tone={
                        selectedCustomProfileId === profile.id
                          ? "info"
                          : profile.last_probe_at && !profileProbeIsStale
                            ? "success"
                            : profile.last_probe_at
                              ? "warning"
                              : "neutral"
                      }
                    >
                      {selectedCustomProfileId === profile.id
                        ? "Loaded"
                        : profile.last_probe_at && !profileProbeIsStale
                          ? "Verified"
                          : profile.last_probe_at
                            ? "Stale"
                            : "Saved"}
                    </StatusBadge>
                  </div>
                  <div className="provider-body">
                    <div className="provider-item">
                      <span>Provider type</span>
                      <strong>{profile.settings.provider_type}</strong>
                    </div>
                    <div className="provider-item">
                      <span>Model</span>
                      <strong>{profile.settings.model}</strong>
                    </div>
                    <div className="provider-item">
                      <span>Updated</span>
                      <strong>
                        {new Date(profile.updated_at).toLocaleString()}
                      </strong>
                    </div>
                    <div className="provider-item">
                      <span>Last verified</span>
                      <strong>
                        {profile.last_probe_at
                          ? `${formatTimestamp(profile.last_probe_at)}${profileProbeIsStale ? ` (${probeMaxAgeHours}h threshold exceeded)` : ""}`
                          : "No successful probe recorded"}
                      </strong>
                    </div>
                    <div className="provider-item">
                      <span>Probe status</span>
                      <strong>
                        {profile.last_probe_status && profile.last_probe_detail
                          ? `${profile.last_probe_status}: ${profile.last_probe_detail}`
                          : "No successful probe recorded"}
                      </strong>
                    </div>
                  </div>
                  <div className="inline-actions">
                    <button
                      type="button"
                      className="secondary-button"
                      onClick={() => onLoadCustomProfile(profile)}
                    >
                      Load into form
                    </button>
                    <button
                      type="button"
                      className="secondary-button"
                      onClick={() => void onReverifyCustomProfile(profile)}
                      disabled={busyAction === `reverify-${profile.id}`}
                    >
                      {busyAction === `reverify-${profile.id}`
                        ? "Reverifying..."
                        : "Reverify"}
                    </button>
                    <button
                      type="button"
                      className="primary-button"
                      onClick={() => void onActivateCustomProfile(profile)}
                      disabled={busyAction === `activate-${profile.id}`}
                    >
                      {busyAction === `activate-${profile.id}`
                        ? "Activating..."
                        : "Activate default"}
                    </button>
                    <button
                      type="button"
                      className="secondary-button"
                      onClick={() => void onDeleteCustomProfile(profile)}
                      disabled={busyAction === `delete-${profile.id}`}
                    >
                      {busyAction === `delete-${profile.id}`
                        ? "Deleting..."
                        : "Delete"}
                    </button>
                  </div>
                </section>
              );
            })}
          </div>
        ) : null}
      </section>

      <DesktopSetupPanel
        desktopStatus={desktopStatus}
        busyAction={busyAction}
        logs={desktopLogs}
        onRefresh={onRefreshDesktopStatus}
        onStart={onStartDesktopStack}
        onRestart={onRestartDesktopStack}
        onStop={onStopDesktopStack}
        onOpenProjectRoot={onOpenDesktopProjectRoot}
        onOpenAppDataDir={onOpenDesktopAppDataDir}
        onLoadLogs={onLoadDesktopLogs}
      />
    </div>
  );
}

function AuditPage() {
  return (
    <div className="page-stack">
      <section className="surface page-header-surface">
        <PageHeader
          eyebrow="Audit"
          title="Track uploads, review edits, recalculations, and exports without turning audit into the main workflow."
        />
      </section>
      <section className="surface">
        <CardHeader
          title="Recent activity"
          subtitle="Audit should be scannable at a glance without looking like another primary workspace."
        />
        <div className="table-toolbar">
          <SummaryStat
            label="Recorded events"
            value={auditRows.length}
            tone="accent"
          />
          <p className="table-toolbar-copy">
            Uploads, review edits, recalculations, and exports should read like
            one coherent timeline.
          </p>
        </div>
        <div className="table-shell">
          <table>
            <thead>
              <tr>
                <th>Timestamp</th>
                <th>User</th>
                <th>Action</th>
                <th>Object</th>
                <th>Details</th>
              </tr>
            </thead>
            <tbody>
              {auditRows.map((row) => (
                <tr key={`${row[0]}-${row[2]}`}>
                  <td>{row[0]}</td>
                  <td>{row[1]}</td>
                  <td>
                    <span className="table-event">{row[2]}</span>
                  </td>
                  <td>{row[3]}</td>
                  <td>{row[4]}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

function HelpPage() {
  return (
    <div className="page-stack">
      <section className="surface page-header-surface">
        <PageHeader
          eyebrow="Help"
          title="Support the extraction job after first value, not before it."
        />
      </section>
      <div className="detail-grid">
        <section className="surface span-6">
          <CardHeader title="Getting started" />
          <div className="note-list">
            <div className="note-card">
              <strong>First schema missing?</strong>
              <p>
                Create one reusable extraction schema, then return to the
                extraction workspace.
              </p>
            </div>
            <div className="note-card">
              <strong>Review is for exceptions</strong>
              <p>
                The app should let the model extract first, then ask a human
                only for the uncertain fields.
              </p>
            </div>
            <div className="note-card">
              <strong>Why source evidence matters</strong>
              <p>
                Users trust extraction when the cited snippet makes the decision
                easy.
              </p>
            </div>
          </div>
        </section>
        <section className="surface span-6">
          <CardHeader title="Supported concepts" />
          <div className="note-list">
            {helpTopics.map((item) => (
              <div key={item} className="note-card compact">
                <strong>{item}</strong>
              </div>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}

export function App() {
  const [activePage, setActivePage] = useState<PageId>("extractions");
  const [templates, setTemplates] = useState<TemplateSummary[]>([]);
  const [templateVersions, setTemplateVersions] = useState<
    TemplateVersionRecord[]
  >([]);
  const [documents, setDocuments] = useState<DocumentRecord[]>([]);
  const [jobs, setJobs] = useState<JobRecord[]>([]);
  const [exportsList, setExportsList] = useState<ExportRecord[]>([]);
  const [provider, setProvider] = useState<ProviderSettings | null>(null);
  const [providerCatalog, setProviderCatalog] = useState<
    ProviderCatalogEntry[]
  >([]);
  const [providerHealth, setProviderHealth] = useState<
    Record<string, ProviderHealth>
  >({});
  const [probeResults, setProbeResults] = useState<
    Record<string, ProviderProbe>
  >({});
  const [customProviderDraft, setCustomProviderDraft] =
    useState<CustomProviderDraft>(() => loadSavedCustomProviderDraft());
  const [customProfiles, setCustomProfiles] = useState<CustomProviderProfile[]>(
    [],
  );
  const [selectedCustomProfileId, setSelectedCustomProfileId] = useState<
    string | null
  >(null);
  const [providerControls, setProviderControls] = useState<ProviderControls>({
    custom_provider_probe_max_age_hours:
      DEFAULT_CUSTOM_PROVIDER_PROBE_MAX_AGE_HOURS,
  });
  const [devStatus, setDevStatus] = useState<DevStatus | null>(null);
  const [resultsByJob, setResultsByJob] = useState<
    Record<number, ResultEnvelope>
  >({});
  const [selectedTemplateId, setSelectedTemplateId] = useState<number | null>(
    null,
  );
  const [selectedTemplateVersionId, setSelectedTemplateVersionId] = useState<
    number | null
  >(null);
  const [selectedDocumentId, setSelectedDocumentId] = useState<number | null>(
    null,
  );
  const [selectedJobId, setSelectedJobId] = useState<number | null>(null);
  const [reviewDrafts, setReviewDrafts] = useState<Record<string, string>>({});
  const [focusedFieldName, setFocusedFieldName] = useState<string | null>(null);
  const [draftTemplate, setDraftTemplate] = useState<DraftTemplate>({
    ...buildDraftTemplateFromDefinition(starterTemplateDefinition),
    template_name: starterTemplateDefinition.template_name,
  });
  const [langextractFeedbackSuggestions, setLangextractFeedbackSuggestions] =
    useState<LangExtractFeedbackSuggestion[]>([]);
  const [langextractFeedbackDiagnostics, setLangextractFeedbackDiagnostics] =
    useState<LangExtractFeedbackDiagnostics>(
      EMPTY_LANGEXTRACT_FEEDBACK_DIAGNOSTICS,
    );
  const [langextractFeedbackStatus, setLangextractFeedbackStatus] = useState<
    "idle" | "loading" | "ready" | "error"
  >("idle");
  const [
    sessionAppliedLangExtractSuggestionKeys,
    setSessionAppliedLangExtractSuggestionKeys,
  ] = useState<string[]>([]);
  const [
    dismissedLangExtractSuggestionKeys,
    setDismissedLangExtractSuggestionKeys,
  ] = useState<string[]>([]);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [banner, setBanner] = useState<{
    tone: "success" | "error";
    message: string;
    actionLabel?: string;
    onAction?: () => void;
  } | null>(null);
  const [apiUnavailable, setApiUnavailable] = useState(false);
  const [desktopStatus, setDesktopStatus] = useState<DesktopStatus | null>(
    null,
  );
  const [desktopLogs, setDesktopLogs] = useState<DesktopLogs | null>(null);
  const [desktopOnboardingDismissed, setDesktopOnboardingDismissed] =
    useState(false);
  const [workspaceSeeded, setWorkspaceSeeded] = useState(false);

  async function refreshDesktopStatus() {
    if (!isTauriRuntime()) {
      setDesktopStatus(null);
      return;
    }
    try {
      const result = await invoke<DesktopStatus>("get_desktop_status");
      setDesktopStatus(result);
    } catch {
      setDesktopStatus(null);
    }
  }

  async function refreshCoreData() {
    let healthOk = false;
    try {
      await readJson<{ status: string }>("/health");
      healthOk = true;
    } catch {
      healthOk = false;
    }
    setApiUnavailable(!healthOk);
    if (!healthOk) {
      setTemplates([]);
      setTemplateVersions([]);
      setDocuments([]);
      setJobs([]);
      setExportsList([]);
      setProvider(null);
      setProviderCatalog([]);
      setProviderHealth({});
      setProbeResults({});
      setCustomProfiles([]);
      setProviderControls({
        custom_provider_probe_max_age_hours:
          DEFAULT_CUSTOM_PROVIDER_PROBE_MAX_AGE_HOURS,
      });
      setSelectedCustomProfileId(null);
      setDevStatus(null);
      setResultsByJob({});
      return;
    }

    const [
      templateData,
      documentData,
      jobData,
      exportData,
      providerData,
      providerCatalogData,
      providerHealthData,
      providerControlsData,
      customProfilesData,
      statusData,
    ] = await Promise.allSettled([
      readJson<TemplateSummary[]>("/templates"),
      readJson<DocumentRecord[]>("/documents"),
      readJson<JobRecord[]>("/jobs"),
      readJson<ExportRecord[]>("/exports"),
      readJson<ProviderSettings | null>("/settings/provider"),
      readJson<{ providers: ProviderCatalogEntry[] }>("/settings/providers"),
      readJson<ProviderHealth[]>("/settings/providers/health"),
      readJson<ProviderControls>("/settings/providers/controls"),
      readJson<{ profiles: CustomProviderProfile[] }>(
        "/settings/providers/custom",
      ),
      readJson<DevStatus>("/dev/status"),
    ]);

    const liveTemplates =
      templateData.status === "fulfilled" ? templateData.value : [];
    const liveDocuments =
      documentData.status === "fulfilled" ? documentData.value : [];
    const liveJobs = jobData.status === "fulfilled" ? jobData.value : [];

    setTemplates(liveTemplates);
    setDocuments(liveDocuments);
    setJobs(liveJobs);
    setExportsList(exportData.status === "fulfilled" ? exportData.value : []);
    setProvider(
      providerData.status === "fulfilled" ? providerData.value : null,
    );
    setProviderCatalog(
      providerCatalogData.status === "fulfilled"
        ? providerCatalogData.value.providers
        : [],
    );
    setProviderHealth(
      providerHealthData.status === "fulfilled" &&
        Array.isArray(providerHealthData.value)
        ? Object.fromEntries(
            providerHealthData.value.map((item) => [item.provider_key, item]),
          )
        : {},
    );
    setProviderControls(
      providerControlsData.status === "fulfilled"
        ? providerControlsData.value
        : {
            custom_provider_probe_max_age_hours:
              DEFAULT_CUSTOM_PROVIDER_PROBE_MAX_AGE_HOURS,
          },
    );
    setCustomProfiles(
      customProfilesData.status === "fulfilled" &&
        Array.isArray(customProfilesData.value.profiles)
        ? customProfilesData.value.profiles
        : [],
    );
    setDevStatus(statusData.status === "fulfilled" ? statusData.value : null);

    if (liveTemplates.length) {
      const versionLists = await Promise.all(
        liveTemplates.map(async (template) => {
          try {
            return await readJson<TemplateVersionRecord[]>(
              `/templates/${template.id}/versions`,
            );
          } catch {
            return [];
          }
        }),
      );
      const flatVersions = versionLists.flat();
      setTemplateVersions(flatVersions);
      if (!selectedTemplateId) {
        setSelectedTemplateId(liveTemplates[0].id);
      }
    } else {
      setTemplateVersions([]);
    }

    const completedJobs = liveJobs.filter((job) => job.status === "completed");
    const resultPairs = await Promise.all(
      completedJobs.map(async (job) => {
        try {
          const result = await readJson<ResultEnvelope>(
            `/jobs/${job.id}/result`,
          );
          return [job.id, result] as const;
        } catch {
          return null;
        }
      }),
    );
    const nextResults = Object.fromEntries(
      resultPairs.filter(Boolean) as Array<readonly [number, ResultEnvelope]>,
    );
    setResultsByJob(nextResults);

    if (selectedJobId && !liveJobs.some((job) => job.id === selectedJobId)) {
      setSelectedJobId(null);
      setFocusedFieldName(null);
    }
  }

  useEffect(() => {
    void refreshCoreData();
    void refreshDesktopStatus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    setDesktopOnboardingDismissed(
      window.localStorage.getItem(DESKTOP_ONBOARDING_KEY) === "true",
    );
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    window.localStorage.setItem(
      CUSTOM_PROVIDER_KEY,
      JSON.stringify(customProviderDraft),
    );
  }, [customProviderDraft]);

  useEffect(() => {
    const interval = window.setInterval(() => {
      void refreshCoreData();
      if (isTauriRuntime()) {
        void refreshDesktopStatus();
      }
    }, 7000);
    return () => window.clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!selectedTemplateId || !templateVersions.length) {
      return;
    }
    const matching = templateVersions.filter(
      (item) => item.template_id === selectedTemplateId,
    );
    if (!matching.length) {
      return;
    }
    if (
      !selectedTemplateVersionId ||
      !matching.some((item) => item.id === selectedTemplateVersionId)
    ) {
      setSelectedTemplateVersionId(matching[0].id);
    }
  }, [selectedTemplateId, selectedTemplateVersionId, templateVersions]);

  useEffect(() => {
    if (!documents.length || selectedDocumentId) {
      return;
    }
    setSelectedDocumentId(documents[0].id);
  }, [documents, selectedDocumentId]);

  const currentTemplateDefinition =
    templateVersions.find((item) => item.id === selectedTemplateVersionId)
      ?.definition ?? null;
  const draftMatchedLangExtractSuggestionKeys =
    getAppliedLangExtractSuggestionKeys(
      draftTemplate.langextract_examples,
      langextractFeedbackSuggestions,
    );
  const appliedLangExtractSuggestionKeys = [
    ...new Set([
      ...sessionAppliedLangExtractSuggestionKeys,
      ...draftMatchedLangExtractSuggestionKeys,
    ]),
  ];
  const reviewableResults = Object.values(resultsByJob).filter(
    (result) => result.result.fields_requiring_review.length > 0,
  );
  const reviewCount = reviewableResults.reduce(
    (sum, result) => sum + result.result.fields_requiring_review.length,
    0,
  );
  const showDesktopOnboarding =
    Boolean(desktopStatus?.tauriMode) &&
    (!desktopOnboardingDismissed || apiUnavailable || !provider);

  function applyLangExtractFeedback(
    feedback: LangExtractFeedbackSuggestionListResponse,
  ) {
    setLangextractFeedbackSuggestions(
      Array.isArray(feedback?.suggestions) ? feedback.suggestions : [],
    );
    setLangextractFeedbackDiagnostics(
      feedback?.diagnostics ?? EMPTY_LANGEXTRACT_FEEDBACK_DIAGNOSTICS,
    );
    setLangextractFeedbackStatus("ready");
  }

  async function fetchLangExtractFeedbackSuggestions(
    templateVersionId: number,
  ) {
    return readJson<LangExtractFeedbackSuggestionListResponse>(
      `/template-versions/${templateVersionId}/langextract-feedback-suggestions`,
    );
  }

  function openSchemaDraft(templateVersionId: number) {
    const templateVersion =
      templateVersions.find((item) => item.id === templateVersionId) ?? null;
    if (templateVersion) {
      setSelectedTemplateId(templateVersion.template_id);
      setSelectedTemplateVersionId(templateVersion.id);
    } else {
      setSelectedTemplateVersionId(templateVersionId);
    }
    setActivePage("templates");
    setBanner(null);
  }

  useEffect(() => {
    if (!currentTemplateDefinition) {
      return;
    }
    setDraftTemplate(
      buildDraftTemplateFromDefinition(currentTemplateDefinition),
    );
    setSessionAppliedLangExtractSuggestionKeys([]);
    setDismissedLangExtractSuggestionKeys([]);
  }, [currentTemplateDefinition]);

  useEffect(() => {
    if (
      !selectedTemplateVersionId ||
      !currentTemplateDefinition ||
      !isLangExtractProvider(currentTemplateDefinition.llm_provider_settings)
    ) {
      setLangextractFeedbackSuggestions([]);
      setLangextractFeedbackDiagnostics(EMPTY_LANGEXTRACT_FEEDBACK_DIAGNOSTICS);
      setLangextractFeedbackStatus("idle");
      return;
    }

    let cancelled = false;
    setLangextractFeedbackStatus("loading");
    void fetchLangExtractFeedbackSuggestions(selectedTemplateVersionId)
      .then((feedback) => {
        if (cancelled) {
          return;
        }
        applyLangExtractFeedback(feedback);
      })
      .catch(() => {
        if (cancelled) {
          return;
        }
        setLangextractFeedbackSuggestions([]);
        setLangextractFeedbackDiagnostics(
          EMPTY_LANGEXTRACT_FEEDBACK_DIAGNOSTICS,
        );
        setLangextractFeedbackStatus("error");
      });

    return () => {
      cancelled = true;
    };
  }, [currentTemplateDefinition, selectedTemplateVersionId]);

  async function handleUpload(file: File) {
    try {
      setBusyAction("upload");
      const created = await uploadDocument(file);
      await refreshCoreData();
      setSelectedDocumentId(created.id);
      setSelectedJobId(null);
      setFocusedFieldName(null);
      setActivePage("extractions");
      setBanner({
        tone: "success",
        message: `Uploaded ${created.original_filename}.`,
      });
    } catch (error) {
      setBanner({
        tone: "error",
        message: error instanceof Error ? error.message : "Upload failed.",
      });
    } finally {
      setBusyAction(null);
    }
  }

  function handleApplyLangExtractSuggestion(
    suggestion: LangExtractFeedbackSuggestion,
  ) {
    setDraftTemplate((current) => ({
      ...current,
      langextract_examples: [
        ...current.langextract_examples,
        buildDraftLangExtractExampleFromSuggestion(suggestion),
      ],
    }));
    setSessionAppliedLangExtractSuggestionKeys((current) =>
      current.includes(suggestion.key) ? current : [...current, suggestion.key],
    );
    setBanner({
      tone: "success",
      message:
        "Added reviewed LangExtract example to the draft schema. Save a new schema version before future runs use it.",
    });
  }

  async function handleDismissLangExtractSuggestion(suggestionKey: string) {
    if (!selectedTemplateVersionId) {
      return;
    }
    try {
      await readJson<LangExtractFeedbackSuggestionDismissal>(
        `/template-versions/${selectedTemplateVersionId}/langextract-feedback-suggestions/${suggestionKey}/dismissal`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ dismissed: true }),
        },
      );
      setDismissedLangExtractSuggestionKeys((current) =>
        current.includes(suggestionKey) ? current : [...current, suggestionKey],
      );
      const feedback = await fetchLangExtractFeedbackSuggestions(
        selectedTemplateVersionId,
      );
      applyLangExtractFeedback(feedback);
      setBanner({
        tone: "success",
        message: "Dismissed reviewed LangExtract suggestion.",
      });
    } catch (error) {
      setBanner({
        tone: "error",
        message:
          error instanceof Error
            ? error.message
            : "Could not dismiss LangExtract suggestion.",
      });
    }
  }

  async function handleRunExtraction() {
    if (!selectedDocumentId || !selectedTemplateVersionId) {
      setBanner({
        tone: "error",
        message:
          "Select a document and schema version before running extraction.",
      });
      return;
    }
    try {
      setBusyAction("run");
      const providerOverride = provider?.is_persisted_default
        ? provider
        : undefined;
      const created = await readJson<JobRecord>("/jobs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          document_id: selectedDocumentId,
          template_version_id: selectedTemplateVersionId,
          provider_override: providerOverride,
        }),
      });
      await refreshCoreData();
      setSelectedJobId(created.id);
      setFocusedFieldName(null);
      setActivePage("extractions");
      setBanner({
        tone: "success",
        message: "Extraction job queued in the active workspace.",
      });
    } catch (error) {
      setBanner({
        tone: "error",
        message:
          error instanceof Error
            ? error.message
            : "Could not queue extraction.",
      });
    } finally {
      setBusyAction(null);
    }
  }

  async function handleCreateTemplate() {
    try {
      setBusyAction("save-template");
      const definition = buildTemplatePayload(
        draftTemplate,
        provider,
        currentTemplateDefinition ?? starterTemplateDefinition,
      );
      await readJson<TemplateSummary>("/templates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: draftTemplate.template_name,
          description: draftTemplate.description,
          document_type: draftTemplate.document_type,
          definition,
        }),
      });
      await refreshCoreData();
      setBanner({
        tone: "success",
        message: `Saved schema "${draftTemplate.template_name}".`,
      });
    } catch (error) {
      setBanner({
        tone: "error",
        message:
          error instanceof Error ? error.message : "Could not save schema.",
      });
    } finally {
      setBusyAction(null);
    }
  }

  const syncJobSelection = useCallback(
    (jobId: number) => {
      const job = jobs.find((item) => item.id === jobId) ?? null;
      const definition =
        templateVersions.find((item) => item.id === job?.template_version_id)
          ?.definition ?? null;
      const result = resultsByJob[jobId];

      setSelectedJobId(jobId);
      if (job) {
        setSelectedDocumentId(job.document_id);
        const version = templateVersions.find(
          (item) => item.id === job.template_version_id,
        );
        if (version) {
          setSelectedTemplateId(version.template_id);
          setSelectedTemplateVersionId(version.id);
        }
      }

      if (result) {
        setReviewDrafts(
          Object.fromEntries(
            result.result.extracted_fields.map((field) => [
              field.field_name,
              getInitialReviewDraft(
                field,
                getFieldDefinition(definition, field.field_name),
              ),
            ]),
          ),
        );
        setFocusedFieldName(
          result.result.fields_requiring_review[0] ??
            result.result.extracted_fields[0]?.field_name ??
            null,
        );
      } else {
        setReviewDrafts({});
        setFocusedFieldName(null);
      }
    },
    [jobs, resultsByJob, templateVersions],
  );

  useEffect(() => {
    if (workspaceSeeded || !jobs.length) {
      return;
    }

    const prioritizedJob =
      jobs.find(
        (job) =>
          (resultsByJob[job.id]?.result.fields_requiring_review.length ?? 0) >
          0,
      ) ??
      jobs.find((job) => job.status === "queued" || job.status === "running") ??
      jobs[0];

    if (prioritizedJob) {
      syncJobSelection(prioritizedJob.id);
    }
    setWorkspaceSeeded(true);
  }, [jobs, resultsByJob, syncJobSelection, workspaceSeeded]);

  function handleSelectJob(jobId: number) {
    setWorkspaceSeeded(true);
    syncJobSelection(jobId);
    setActivePage("extractions");
  }

  function handleStartNewExtraction() {
    setWorkspaceSeeded(true);
    setSelectedJobId(null);
    setFocusedFieldName(null);
    setReviewDrafts({});
    setActivePage("extractions");
  }

  async function handleSaveReview() {
    if (!selectedJobId) {
      return;
    }

    const selectedResult = resultsByJob[selectedJobId];
    const selectedJob = jobs.find((item) => item.id === selectedJobId) ?? null;
    const definition =
      templateVersions.find(
        (item) => item.id === selectedJob?.template_version_id,
      )?.definition ?? null;

    if (!selectedResult) {
      return;
    }

    try {
      setBusyAction("save-review");
      const edits = selectedResult.result.extracted_fields
        .map((field) => {
          const draft =
            reviewDrafts[field.field_name] ??
            getInitialReviewDraft(
              field,
              getFieldDefinition(definition, field.field_name),
            );
          const parsed = parseReviewDraft(
            field,
            draft,
            getFieldDefinition(definition, field.field_name),
          );
          const original =
            field.normalized_value ?? field.extracted_value ?? null;
          if (JSON.stringify(parsed) === JSON.stringify(original)) {
            return null;
          }
          return {
            field_name: field.field_name,
            normalized_value: parsed,
            reason: "Updated from extraction workspace",
          };
        })
        .filter(Boolean);

      if (!edits.length) {
        setBanner({ tone: "success", message: "No review changes to save." });
        return;
      }

      const updatedResult = await readJson<ResultPayload>(
        `/results/${selectedResult.result_id}/review`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            reviewer: "local-ui",
            edits,
            recalculate: true,
          }),
        },
      );
      setResultsByJob((current) => ({
        ...current,
        [selectedJobId]: {
          result_id: selectedResult.result_id,
          job_id: selectedJobId,
          result: updatedResult,
        },
      }));
      setReviewDrafts(
        Object.fromEntries(
          updatedResult.extracted_fields.map((field) => [
            field.field_name,
            getInitialReviewDraft(
              field,
              getFieldDefinition(definition, field.field_name),
            ),
          ]),
        ),
      );
      setFocusedFieldName(
        updatedResult.fields_requiring_review[0] ??
          updatedResult.extracted_fields[0]?.field_name ??
          null,
      );
      await refreshCoreData();
      const reviewedTemplateVersionId =
        selectedJob?.template_version_id ?? null;
      if (reviewedTemplateVersionId && definition) {
        const templateVersionRecord =
          templateVersions.find(
            (item) => item.id === reviewedTemplateVersionId,
          ) ?? null;
        if (
          templateVersionRecord &&
          isLangExtractProvider(
            templateVersionRecord.definition.llm_provider_settings,
          )
        ) {
          const feedback = await fetchLangExtractFeedbackSuggestions(
            reviewedTemplateVersionId,
          );
          if (selectedTemplateVersionId === reviewedTemplateVersionId) {
            applyLangExtractFeedback(feedback);
          }
          if (feedback.suggestions.length) {
            setBanner({
              tone: "success",
              message:
                feedback.suggestions.length === 1
                  ? "Review edits saved and formulas recalculated. 1 reusable grounded example is ready for this schema."
                  : `Review edits saved and formulas recalculated. ${feedback.suggestions.length} reusable grounded examples are ready for this schema.`,
              actionLabel: "Open schema draft",
              onAction: () => openSchemaDraft(reviewedTemplateVersionId),
            });
            return;
          }
        }
      }
      setBanner({
        tone: "success",
        message: "Review edits saved and formulas recalculated.",
      });
    } catch (error) {
      setBanner({
        tone: "error",
        message:
          error instanceof Error ? error.message : "Could not save review.",
      });
    } finally {
      setBusyAction(null);
    }
  }

  async function handleExport(format: "json" | "csv" | "excel") {
    if (!selectedJobId) {
      return;
    }
    const selectedResult = resultsByJob[selectedJobId];
    if (!selectedResult) {
      return;
    }

    try {
      setBusyAction(`export-${format}`);
      const payload = await readJson<{ export_id: number }>(
        `/results/${selectedResult.result_id}/exports/${format}`,
        {
          method: "POST",
        },
      );
      window.open(
        `${API_BASE}/exports/${payload.export_id}/download`,
        "_blank",
        "noopener,noreferrer",
      );
      await refreshCoreData();
      setBanner({
        tone: "success",
        message: `Generated ${format.toUpperCase()} export.`,
      });
    } catch (error) {
      setBanner({
        tone: "error",
        message:
          error instanceof Error ? error.message : "Could not generate export.",
      });
    } finally {
      setBusyAction(null);
    }
  }

  async function handleSetProvider(nextProvider: ProviderSettings) {
    try {
      setBusyAction("save-provider");
      await readJson<ProviderSettings>("/settings/provider", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ settings: nextProvider }),
      });
      setProvider(nextProvider);
      setBanner({
        tone: "success",
        message: `Default provider set to ${nextProvider.provider_type} (${nextProvider.model}).`,
      });
    } catch (error) {
      setBanner({
        tone: "error",
        message:
          error instanceof Error
            ? error.message
            : "Could not save provider settings.",
      });
    } finally {
      setBusyAction(null);
    }
  }

  async function runProviderProbe(
    probeKey: string,
    label: string,
    settings: ProviderSettings,
  ): Promise<ProviderProbe | null> {
    try {
      setBusyAction(`probe-${probeKey}`);
      const result = await readJson<ProviderProbe>(
        "/settings/providers/probe",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ settings }),
        },
      );
      setProbeResults((current) => ({
        ...current,
        [probeKey]: result,
      }));
      setBanner({
        tone: result.reachable ? "success" : "error",
        message: `${label}: ${result.detail}`,
      });
      return result;
    } catch (error) {
      setBanner({
        tone: "error",
        message:
          error instanceof Error ? error.message : "Could not probe provider.",
      });
      return null;
    } finally {
      setBusyAction(null);
    }
  }

  async function ensureProviderProbeReachable(
    probeKey: string,
    label: string,
    settings: ProviderSettings,
    blockedAction: string,
  ): Promise<boolean> {
    const result = await runProviderProbe(probeKey, label, settings);
    if (result?.reachable) {
      return true;
    }
    setBanner({
      tone: "error",
      message: `${blockedAction} blocked until provider probe succeeds.${result ? ` ${result.detail}` : ""}`,
    });
    return false;
  }

  async function handleProbeProvider(nextProvider: ProviderCatalogEntry) {
    await runProviderProbe(
      nextProvider.key,
      nextProvider.label,
      nextProvider.settings,
    );
  }

  async function handleSetCustomProvider() {
    const validationError = validateCustomProviderDraft(customProviderDraft);
    if (validationError) {
      setBanner({ tone: "error", message: validationError });
      return;
    }
    await handleSetProvider(buildCustomProviderSettings(customProviderDraft));
  }

  async function handleProbeCustomProvider() {
    const validationError = validateCustomProviderDraft(customProviderDraft);
    if (validationError) {
      setBanner({ tone: "error", message: validationError });
      return;
    }
    const settings = buildCustomProviderSettings(customProviderDraft);
    await runProviderProbe(
      CUSTOM_PROVIDER_KEY,
      customProviderDraft.label || "Custom provider",
      settings,
    );
  }

  async function handleSaveCustomProfile() {
    const validationError = validateCustomProviderDraft(customProviderDraft);
    if (validationError) {
      setBanner({ tone: "error", message: validationError });
      return;
    }

    const settings = buildCustomProviderSettings(customProviderDraft);
    const payload = {
      name: customProviderDraft.label.trim(),
      settings,
    };

    const probePassed = await ensureProviderProbeReachable(
      selectedCustomProfileId ?? CUSTOM_PROVIDER_KEY,
      payload.name || "Custom provider",
      settings,
      "Custom provider save",
    );
    if (!probePassed) {
      return;
    }

    try {
      setBusyAction("save-custom-profile");
      if (selectedCustomProfileId) {
        await readJson<CustomProviderProfile>(
          `/settings/providers/custom/${selectedCustomProfileId}`,
          {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
          },
        );
      } else {
        const created = await readJson<CustomProviderProfile>(
          "/settings/providers/custom",
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload),
          },
        );
        setSelectedCustomProfileId(created.id);
      }
      await refreshCoreData();
      setBanner({
        tone: "success",
        message: `Saved custom provider profile "${payload.name}".`,
      });
    } catch (error) {
      setBanner({
        tone: "error",
        message:
          error instanceof Error
            ? error.message
            : "Could not save custom provider profile.",
      });
    } finally {
      setBusyAction(null);
    }
  }

  function handleLoadCustomProfile(profile: CustomProviderProfile) {
    setCustomProviderDraft(
      buildCustomProviderDraftFromSettings(profile.settings),
    );
    setSelectedCustomProfileId(profile.id);
    setBanner({
      tone: "success",
      message: `Loaded custom provider profile "${profile.name}" into the form.`,
    });
  }

  async function handleReverifyCustomProfile(profile: CustomProviderProfile) {
    try {
      setBusyAction(`reverify-${profile.id}`);
      const updated = await readJson<CustomProviderProfile>(
        `/settings/providers/custom/${profile.id}/reverify`,
        {
          method: "POST",
        },
      );
      setProbeResults((current) => ({
        ...current,
        [`profile-${profile.id}`]: {
          provider_type: updated.settings.provider_type,
          reachable: true,
          status: updated.last_probe_status ?? "reachable",
          detail:
            updated.last_probe_detail ?? "Endpoint responded with HTTP 200.",
          endpoint: null,
          status_code: null,
        },
      }));
      await refreshCoreData();
      setBanner({
        tone: "success",
        message: `Reverified custom provider profile "${profile.name}".`,
      });
    } catch (error) {
      setBanner({
        tone: "error",
        message:
          error instanceof Error
            ? error.message
            : "Could not reverify custom provider profile.",
      });
    } finally {
      setBusyAction(null);
    }
  }

  async function handleActivateCustomProfile(profile: CustomProviderProfile) {
    const probeMaxAgeHours =
      providerControls.custom_provider_probe_max_age_hours ||
      DEFAULT_CUSTOM_PROVIDER_PROBE_MAX_AGE_HOURS;
    if (customProviderProfileProbeIsStale(profile, probeMaxAgeHours)) {
      setBanner({
        tone: "error",
        message: `Custom provider activation blocked until "${profile.name}" is reverified. The last successful probe is missing or older than ${probeMaxAgeHours} hours.`,
      });
      return;
    }

    const probePassed = await ensureProviderProbeReachable(
      `profile-${profile.id}`,
      profile.name,
      profile.settings,
      "Custom provider activation",
    );
    if (!probePassed) {
      return;
    }

    try {
      setBusyAction(`activate-${profile.id}`);
      const activated = await readJson<ProviderSettings>(
        `/settings/providers/custom/${profile.id}/activate`,
        {
          method: "POST",
        },
      );
      setProvider(activated);
      await refreshCoreData();
      setBanner({
        tone: "success",
        message: `Activated custom provider profile "${profile.name}" as default.`,
      });
    } catch (error) {
      setBanner({
        tone: "error",
        message:
          error instanceof Error
            ? error.message
            : "Could not activate custom provider profile.",
      });
    } finally {
      setBusyAction(null);
    }
  }

  async function handleDeleteCustomProfile(profile: CustomProviderProfile) {
    try {
      setBusyAction(`delete-${profile.id}`);
      await readJson<{ deleted: boolean }>(
        `/settings/providers/custom/${profile.id}`,
        {
          method: "DELETE",
        },
      );
      if (selectedCustomProfileId === profile.id) {
        setSelectedCustomProfileId(null);
      }
      await refreshCoreData();
      setBanner({
        tone: "success",
        message: `Deleted custom provider profile "${profile.name}".`,
      });
    } catch (error) {
      setBanner({
        tone: "error",
        message:
          error instanceof Error
            ? error.message
            : "Could not delete custom provider profile.",
      });
    } finally {
      setBusyAction(null);
    }
  }

  async function handleDesktopStart() {
    if (!isTauriRuntime()) {
      return;
    }
    try {
      setBusyAction("desktop-start");
      const result = await invoke<DesktopStatus>("start_local_stack");
      setDesktopStatus(result);
      await refreshCoreData();
      setBanner({
        tone: "success",
        message: "Local backend stack started from the desktop shell.",
      });
    } catch (error) {
      setBanner({
        tone: "error",
        message:
          error instanceof Error
            ? error.message
            : "Could not start local stack.",
      });
    } finally {
      setBusyAction(null);
    }
  }

  async function handleDesktopStop() {
    if (!isTauriRuntime()) {
      return;
    }
    try {
      setBusyAction("desktop-stop");
      const result = await invoke<DesktopStatus>("stop_local_stack");
      setDesktopStatus(result);
      await refreshCoreData();
      setBanner({
        tone: "success",
        message: "Local backend stack stopped from the desktop shell.",
      });
    } catch (error) {
      setBanner({
        tone: "error",
        message:
          error instanceof Error
            ? error.message
            : "Could not stop local stack.",
      });
    } finally {
      setBusyAction(null);
    }
  }

  async function handleDesktopRestart() {
    if (!isTauriRuntime()) {
      return;
    }
    try {
      setBusyAction("desktop-restart");
      const result = await invoke<DesktopStatus>("restart_local_stack");
      setDesktopStatus(result);
      await refreshCoreData();
      setBanner({
        tone: "success",
        message: "Local backend stack restarted from the desktop shell.",
      });
    } catch (error) {
      setBanner({
        tone: "error",
        message:
          error instanceof Error
            ? error.message
            : "Could not restart local stack.",
      });
    } finally {
      setBusyAction(null);
    }
  }

  async function handleDesktopOpenProjectRoot() {
    if (!isTauriRuntime()) {
      return;
    }
    try {
      setBusyAction("desktop-open-root");
      await invoke("open_project_root");
      setBanner({
        tone: "success",
        message: "Opened the ExtractFlow project root from the desktop shell.",
      });
    } catch (error) {
      setBanner({
        tone: "error",
        message:
          error instanceof Error
            ? error.message
            : "Could not open the project root.",
      });
    } finally {
      setBusyAction(null);
    }
  }

  async function handleDesktopOpenAppDataDir() {
    if (!isTauriRuntime()) {
      return;
    }
    try {
      setBusyAction("desktop-open-data");
      await invoke("open_app_data_dir");
      setBanner({
        tone: "success",
        message: "Opened the ExtractFlow desktop data directory.",
      });
    } catch (error) {
      setBanner({
        tone: "error",
        message:
          error instanceof Error
            ? error.message
            : "Could not open the app data directory.",
      });
    } finally {
      setBusyAction(null);
    }
  }

  async function handleDesktopLoadLogs() {
    if (!isTauriRuntime()) {
      return;
    }
    try {
      setBusyAction("desktop-logs");
      const result = await invoke<DesktopLogs>("get_backend_logs");
      setDesktopLogs(result);
      setBanner({
        tone: "success",
        message: "Loaded backend logs from the desktop shell.",
      });
    } catch (error) {
      setBanner({
        tone: "error",
        message:
          error instanceof Error
            ? error.message
            : "Could not load backend logs.",
      });
    } finally {
      setBusyAction(null);
    }
  }

  function dismissDesktopOnboarding() {
    if (typeof window !== "undefined") {
      window.localStorage.setItem(DESKTOP_ONBOARDING_KEY, "true");
    }
    setDesktopOnboardingDismissed(true);
  }

  return (
    <div className="app-frame">
      <AppSidebar
        activePage={activePage}
        onSelectPage={setActivePage}
        provider={provider}
        reviewCount={reviewCount}
      />
      <div className="main-shell">
        <TopBar activePage={activePage} />
        <main className="workspace">
          {showDesktopOnboarding ? (
            <DesktopOnboardingOverlay
              desktopStatus={desktopStatus}
              provider={provider}
              apiUnavailable={apiUnavailable}
              busyAction={busyAction}
              onStartDesktopStack={handleDesktopStart}
              onOpenSettings={() => setActivePage("settings")}
              onDismiss={dismissDesktopOnboarding}
            />
          ) : null}

          {apiUnavailable ? (
            <div className="banner banner-error">
              <span>
                Backend unavailable. The extraction workspace is open, but the
                local API is not reachable at {API_BASE}. Start the backend
                stack or use
                <code> npm run tauri:dev</code> for the managed desktop flow.
              </span>
              {desktopStatus?.tauriMode ? (
                <div className="inline-actions">
                  <button
                    type="button"
                    className="secondary-button small"
                    onClick={() => void refreshDesktopStatus()}
                    disabled={busyAction === "desktop-refresh"}
                  >
                    Refresh
                  </button>
                  <button
                    type="button"
                    className="primary-button small"
                    onClick={() => void handleDesktopStart()}
                    disabled={busyAction === "desktop-start"}
                  >
                    {busyAction === "desktop-start"
                      ? "Starting..."
                      : "Start stack"}
                  </button>
                </div>
              ) : null}
            </div>
          ) : null}

          {banner ? (
            <div
              className={classNames(
                "banner",
                banner.tone === "error" ? "banner-error" : "banner-success",
              )}
            >
              <span>{banner.message}</span>
              {banner.actionLabel && banner.onAction ? (
                <button
                  type="button"
                  className="secondary-button"
                  onClick={banner.onAction}
                >
                  {banner.actionLabel}
                </button>
              ) : null}
              <button
                type="button"
                className="text-link"
                onClick={() => setBanner(null)}
              >
                Dismiss
              </button>
            </div>
          ) : null}

          {activePage === "extractions" ? (
            <ExtractionWorkspacePage
              documents={documents}
              jobs={jobs}
              templateVersions={templateVersions}
              templates={templates}
              resultsByJob={resultsByJob}
              exportsList={exportsList}
              selectedJobId={selectedJobId}
              selectedDocumentId={selectedDocumentId}
              selectedTemplateId={selectedTemplateId}
              selectedTemplateVersionId={selectedTemplateVersionId}
              reviewDrafts={reviewDrafts}
              focusedFieldName={focusedFieldName}
              busyAction={busyAction}
              onSelectJob={handleSelectJob}
              onStartNew={handleStartNewExtraction}
              onUpload={handleUpload}
              onSelectDocument={setSelectedDocumentId}
              onSelectTemplate={setSelectedTemplateId}
              onSelectTemplateVersion={setSelectedTemplateVersionId}
              onSetReviewDraft={(fieldName, value) =>
                setReviewDrafts((current) => ({
                  ...current,
                  [fieldName]: value,
                }))
              }
              onSetFocusedField={setFocusedFieldName}
              onRunExtraction={handleRunExtraction}
              onSaveReview={handleSaveReview}
              onExport={handleExport}
              onOpenSchemas={() => setActivePage("templates")}
            />
          ) : null}

          {activePage === "templates" ? (
            <SchemaPage
              templates={templates}
              templateVersions={templateVersions}
              selectedTemplateId={selectedTemplateId}
              setSelectedTemplateId={setSelectedTemplateId}
              selectedTemplateVersionId={selectedTemplateVersionId}
              setSelectedTemplateVersionId={setSelectedTemplateVersionId}
              currentTemplateDefinition={currentTemplateDefinition}
              provider={provider}
              draft={draftTemplate}
              setDraft={setDraftTemplate}
              langextractFeedbackSuggestions={langextractFeedbackSuggestions}
              langextractFeedbackDiagnostics={langextractFeedbackDiagnostics}
              langextractFeedbackStatus={langextractFeedbackStatus}
              appliedLangExtractSuggestionKeys={
                appliedLangExtractSuggestionKeys
              }
              dismissedLangExtractSuggestionKeys={
                dismissedLangExtractSuggestionKeys
              }
              onApplyLangExtractSuggestion={handleApplyLangExtractSuggestion}
              onDismissLangExtractSuggestion={
                handleDismissLangExtractSuggestion
              }
              onCreateTemplate={handleCreateTemplate}
              busyAction={busyAction}
            />
          ) : null}

          {activePage === "settings" ? (
            <SettingsPage
              provider={provider}
              providerCatalog={providerCatalog}
              providerHealth={providerHealth}
              customProviderDraft={customProviderDraft}
              selectedCustomProfileId={selectedCustomProfileId}
              customProfiles={customProfiles}
              providerControls={providerControls}
              onCustomProviderDraftChange={setCustomProviderDraft}
              onSetProvider={handleSetProvider}
              onProbeProvider={handleProbeProvider}
              onSetCustomProvider={handleSetCustomProvider}
              onProbeCustomProvider={handleProbeCustomProvider}
              onSaveCustomProfile={handleSaveCustomProfile}
              onLoadCustomProfile={handleLoadCustomProfile}
              onReverifyCustomProfile={handleReverifyCustomProfile}
              onActivateCustomProfile={handleActivateCustomProfile}
              onDeleteCustomProfile={handleDeleteCustomProfile}
              probeResults={probeResults}
              busyAction={busyAction}
              desktopStatus={desktopStatus}
              onRefreshDesktopStatus={refreshDesktopStatus}
              onStartDesktopStack={handleDesktopStart}
              onRestartDesktopStack={handleDesktopRestart}
              onStopDesktopStack={handleDesktopStop}
              onOpenDesktopProjectRoot={handleDesktopOpenProjectRoot}
              onOpenDesktopAppDataDir={handleDesktopOpenAppDataDir}
              onLoadDesktopLogs={handleDesktopLoadLogs}
              desktopLogs={desktopLogs}
            />
          ) : null}

          {activePage === "audit" ? <AuditPage /> : null}
          {activePage === "help" ? <HelpPage /> : null}

          {devStatus && activePage !== "extractions" ? (
            <div className="runtime-message">
              Live state: {devStatus.documents} documents, {devStatus.jobs}{" "}
              jobs, {devStatus.results} results.
            </div>
          ) : null}
        </main>
      </div>
    </div>
  );
}
