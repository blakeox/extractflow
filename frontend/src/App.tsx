import { invoke } from "@tauri-apps/api/core";
import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type ReactNode,
  type SetStateAction,
} from "react";

import { MockProviderProductionNotice } from "./components/MockProviderProductionNotice";
import { ReviewFieldEditor } from "./components/review/ReviewFieldEditor";
import { ParsedTextPanel } from "./components/review/ParsedTextPanel";
import { reviewFieldHint } from "./components/review/review-field-hint";
import { SourceEvidencePanel } from "./components/review/SourceEvidencePanel";
import { API_BASE } from "./lib/config";
import { clampProgressPct, getJobStageLabel } from "./lib/job-progress";
import {
  CUSTOM_PROVIDER_DRAFT_STORAGE_KEY,
  readPersistedCustomProviderDraft,
  writePersistedCustomProviderDraft,
  type CustomProviderDraftWithEnvVar,
} from "./lib/custom-provider-draft-storage";
import {
  dismissMockProviderWarning,
  isBootstrapMockProvider,
  readMockProviderWarningDismissed,
} from "./lib/mock-provider";
import {
  isHighConfidenceField,
  REVIEW_HIGH_CONFIDENCE_MIN,
} from "./lib/review-helpers";
import {
  getInitialReviewDraft,
  getReviewFieldType,
  parseReviewDraft,
} from "./lib/review-draft";
import { parseWorkspaceSearch, replaceWorkspaceUrl } from "./lib/workspace-url";
import {
  LangExtractEditor,
  type LangExtractFeedbackDiagnostics,
  type LangExtractFeedbackSuggestion,
} from "./LangExtractEditor";
import { Badge } from "./components/ui/Badge";
import { Button } from "./components/ui/Button";
import { DetailPair } from "./components/ui/DetailPair";
import { DetailTile } from "./components/ui/DetailTile";
import { FormGrid } from "./components/ui/FormGrid";
import { InlineGroup } from "./components/ui/InlineGroup";
import { MetricLabel } from "./components/ui/MetricLabel";
import { NoteCard } from "./components/ui/NoteCard";
import { PageIntro, PageStack } from "./components/ui/PageLayout";
import { PanelCard } from "./components/ui/PanelCard";
import { ProgressList } from "./components/ui/ProgressList";
import { ProviderModeBadge } from "./components/ui/ProviderModeBadge";
import { SectionHeader } from "./components/ui/SectionLayout";
import { StatusRow } from "./components/ui/StatusRow";
import { StepCard } from "./components/ui/StepCard";
import { StepMarker } from "./components/ui/StepMarker";
import { SupportingText } from "./components/ui/SupportingText";
import { SummaryGrid } from "./components/ui/SummaryGrid";
import { Surface } from "./components/ui/Surface";
import { TableDataCell, TableHeaderCell } from "./components/ui/TableCell";
import { TitledSurface } from "./components/ui/TitledSurface";
import {
  buildDraftLangExtractExampleFromSuggestion,
  buildDraftLangExtractExamples,
  getAppliedLangExtractSuggestionKeys,
  buildLangExtractExamples,
  getLangExtractExtractionReadiness,
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

type SchemaDryRunFieldResult = {
  field_name: string;
  label: string;
  data_type: string;
  validation_status: string;
  validation_errors: string[];
  requires_review: boolean;
  confidence_score: number;
  extracted_value: string | null;
  normalized_value: unknown;
  source_text: string;
  extraction_notes: string;
};

type SchemaDryRunResponse = {
  ok: boolean;
  schema_errors: string[];
  document_level_notes: string[];
  extracted_fields: SchemaDryRunFieldResult[];
  fields_requiring_review: string[];
};

type TemplateFieldChange = {
  name: string;
  change: string;
  details: string[];
};

type TemplateVersionDiff = {
  before_version: string;
  after_version: string;
  extracted_added: string[];
  extracted_removed: string[];
  extracted_changed: TemplateFieldChange[];
  calculated_added: string[];
  calculated_removed: string[];
  calculated_changed: TemplateFieldChange[];
  langextract_changed: boolean;
};

type TemplateDefinitionField = {
  name: string;
  label: string;
  type: string;
  required?: boolean;
  citation_required?: boolean;
  description?: string;
  instructions?: string;
  schema?: Record<string, unknown> | null;
  field_schema?: Record<string, unknown> | null;
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

type ParserStatus = {
  state: string;
  timestamp?: string | null;
  docling_enabled: boolean;
  docling_prewarm: boolean;
  docling_pdf_ocr_retry: boolean;
  docling_image_ocr: boolean;
  prewarm_status?: string | null;
  prewarm_attempted: boolean;
  prewarm_error?: string | null;
  supported_extensions: string[];
  supported_classes: string[];
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

type CustomProviderDraft = CustomProviderDraftWithEnvVar;

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
  progress_stage?: string | null;
  progress_pct?: number;
  attempt_count?: number;
  created_at: string;
  updated_at: string;
};

type ParserFailureGuidance = {
  title: string;
  detail: string;
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
  content_sha256?: string | null;
  exported_at?: string | null;
  reviewer?: string | null;
  template_version_id?: number | null;
  manifest_json?: Record<string, unknown> | null;
  created_at: string;
};

type AuditEventRecord = {
  id: number;
  actor: string;
  action: string;
  object_type: string;
  object_id: string;
  metadata: Record<string, unknown>;
  created_at: string;
};

type ExportPolicy = {
  require_review_cleared: boolean;
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
  { id: "audit", label: "Audit", icon: "audit" },
  { id: "settings", label: "Settings", icon: "settings" },
  { id: "help", label: "Help", icon: "help" },
];

const pageLabels: Record<PageId, string> = {
  extractions: "Extractions",
  templates: "Schemas",
  settings: "Settings",
  audit: "Audit",
  help: "Help",
};

const CUSTOM_PROVIDER_KEY = CUSTOM_PROVIDER_DRAFT_STORAGE_KEY;
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
  return readPersistedCustomProviderDraft(DEFAULT_CUSTOM_PROVIDER_DRAFT);
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

function getParserFailureGuidance(
  errorMessage?: string | null,
): ParserFailureGuidance | null {
  if (!errorMessage) {
    return null;
  }
  if (errorMessage.includes("Docling parsing is disabled")) {
    return {
      title: "Document parser disabled",
      detail:
        "This file type depends on the Docling parser path, but the worker runtime has it disabled. Re-enable the parser runtime before retrying this job.",
    };
  }
  if (errorMessage.includes("Docling PDF parsing produced no usable text")) {
    return {
      title: "PDF parse produced no usable text",
      detail:
        "The worker could not recover meaningful PDF text, even after its OCR retry path. Check scan quality, image contrast, or whether this document should be re-run with a cleaner source file.",
    };
  }
  if (errorMessage.includes("Docling image parsing produced no usable text")) {
    return {
      title: "Image OCR produced no usable text",
      detail:
        "The worker reached the image OCR path but still did not extract enough text to continue. Check image quality, resolution, or whether the content is text-dense enough for extraction.",
    };
  }
  if (
    errorMessage.includes("Docling DOCX parsing produced no usable text") ||
    errorMessage.includes("Docling PPTX parsing produced no usable text") ||
    errorMessage.includes("Docling HTML parsing produced no usable text")
  ) {
    return {
      title: "Document parse returned no usable content",
      detail:
        "The parser opened the file but did not recover enough content to proceed. Check whether the file is mostly empty, image-only, or malformed.",
    };
  }
  if (errorMessage.includes("Docling failed to parse")) {
    return {
      title: "Parser runtime failed",
      detail:
        "The parser runtime raised an internal error while opening this file. Check parser readiness in Settings and inspect worker logs before retrying.",
    };
  }
  return null;
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
  return getReviewFieldType(field, definition);
}

function getFieldDefinition(
  definition: TemplateDefinition | null,
  fieldName: string,
) {
  return (
    definition?.extracted_fields.find((item) => item.name === fieldName) ?? null
  );
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

function buildDraftTemplateDefinitionSafe(
  draft: DraftTemplate,
  provider: ProviderSettings | null,
  base: TemplateDefinition,
): TemplateDefinition {
  try {
    return buildTemplatePayload(draft, provider, base);
  } catch {
    return base;
  }
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
    <aside className="sticky top-0 flex min-h-screen flex-col gap-5 border-r border-line bg-[linear-gradient(180deg,rgba(255,255,255,0.94),rgba(248,250,255,0.88))] px-4 py-6">
      <div className="flex items-center gap-[0.9rem] px-2 py-[0.25rem] pb-[0.9rem]">
        <div className="grid h-11 w-11 place-items-center rounded-[14px] bg-[linear-gradient(135deg,#5d6eff,#7b5cff)] text-[1.2rem] font-bold text-white shadow-[0_10px_24px_rgba(77,96,255,0.22)]">
          E
        </div>
        <div>
          <h1 className="m-0 text-[1.45rem] tracking-[-0.03em]">ExtractFlow</h1>
          <p className="m-[0.2rem_0_0] text-[0.95rem] text-muted">
            One workspace from PDF to trusted export.
          </p>
        </div>
      </div>

      <div className="grid gap-[0.55rem]">
        <MetricLabel className="text-[0.76rem] tracking-[0.08em] text-faint">
          Primary
        </MetricLabel>
        <nav className="grid gap-[0.28rem]" aria-label="Primary">
          {primaryNavigation.map((item) => (
            <button
              key={item.id}
              type="button"
              className={classNames(
                "group flex w-full items-center gap-[0.9rem] rounded-[14px] px-[0.95rem] py-[0.85rem] text-left transition-[background,color,transform,box-shadow] duration-150",
                activePage === item.id
                  ? "bg-[linear-gradient(180deg,rgba(77,96,255,0.12),rgba(77,96,255,0.06))] text-brand-strong shadow-[inset_0_0_0_1px_rgba(77,96,255,0.12),0_8px_18px_rgba(77,96,255,0.08)]"
                  : "text-muted hover:bg-[linear-gradient(180deg,rgba(77,96,255,0.12),rgba(77,96,255,0.06))] hover:text-brand-strong",
              )}
              onClick={() => onSelectPage(item.id)}
            >
              <span
                className={classNames(
                  "grid h-8 w-8 flex-none place-items-center rounded-[11px] transition-[background,color,transform] duration-150 [&_svg]:block [&_svg]:h-[17px] [&_svg]:w-[17px]",
                  activePage === item.id
                    ? "scale-[1.02] bg-[rgba(77,96,255,0.12)] text-brand-strong"
                    : "bg-[rgba(122,138,179,0.08)] text-[#7280a2] group-hover:bg-[rgba(77,96,255,0.12)] group-hover:text-brand-strong",
                )}
                aria-hidden="true"
              >
                <NavGlyph icon={item.icon} />
              </span>
              <span>{item.label}</span>
              {item.id === "extractions" && reviewCount > 0 ? (
                <span className="ml-auto rounded-full bg-[rgba(77,96,255,0.12)] px-[0.5rem] py-[0.18rem] text-[0.78rem] font-bold text-brand-strong">
                  {reviewCount}
                </span>
              ) : null}
            </button>
          ))}
        </nav>
      </div>

      <div className="grid gap-[0.55rem]">
        <MetricLabel className="text-[0.76rem] tracking-[0.08em] text-faint">
          Setup
        </MetricLabel>
        <nav className="grid gap-[0.28rem]" aria-label="Setup">
          {secondaryNavigation.map((item) => (
            <button
              key={item.id}
              type="button"
              className={classNames(
                "group flex w-full items-center gap-[0.9rem] rounded-[14px] px-[0.95rem] py-[0.85rem] text-left transition-[background,color,transform,box-shadow] duration-150",
                activePage === item.id
                  ? "bg-[linear-gradient(180deg,rgba(77,96,255,0.12),rgba(77,96,255,0.06))] text-brand-strong shadow-[inset_0_0_0_1px_rgba(77,96,255,0.12),0_8px_18px_rgba(77,96,255,0.08)]"
                  : "text-muted hover:bg-[linear-gradient(180deg,rgba(77,96,255,0.12),rgba(77,96,255,0.06))] hover:text-brand-strong",
              )}
              onClick={() => onSelectPage(item.id)}
            >
              <span
                className={classNames(
                  "grid h-8 w-8 flex-none place-items-center rounded-[11px] transition-[background,color,transform] duration-150 [&_svg]:block [&_svg]:h-[17px] [&_svg]:w-[17px]",
                  activePage === item.id
                    ? "scale-[1.02] bg-[rgba(77,96,255,0.12)] text-brand-strong"
                    : "bg-[rgba(122,138,179,0.08)] text-[#7280a2] group-hover:bg-[rgba(77,96,255,0.12)] group-hover:text-brand-strong",
                )}
                aria-hidden="true"
              >
                <NavGlyph icon={item.icon} />
              </span>
              <span>{item.label}</span>
            </button>
          ))}
        </nav>
      </div>

      <div className="mt-auto grid grid-cols-[auto_1fr] gap-[0.85rem] rounded-[18px] border border-border bg-[rgba(255,255,255,0.72)] p-[0.9rem] shadow-none">
        <div className="mt-[0.35rem] h-[9px] w-[9px] rounded-full bg-success shadow-[0_0_0_3px_rgba(31,159,103,0.1)]" />
        <div>
          <strong className="mb-[0.25rem] block">
            {provider?.mode === "cloud" ? "Cloud Mode" : "Local Mode"}
          </strong>
          <p className="m-0 block text-[0.88rem] text-muted">
            {provider?.provider_type ?? "mock"} (
            {provider?.model ?? "qwen3.5:27b"})
          </p>
          <span className="block text-[0.88rem] text-muted">
            {reviewCount
              ? `${reviewCount} fields waiting on review`
              : "No review backlog right now"}
          </span>
        </div>
        <Button variant="tertiary" onClick={() => onSelectPage("settings")}>
          Open settings
        </Button>
      </div>
    </aside>
  );
}

function TopBar({ activePage }: { activePage: PageId }) {
  const activeLabel = pageLabels[activePage] ?? "Workspace";

  const subtitles: Record<PageId, string> = {
    extractions:
      "Upload a document, run extraction, review only exceptions, and export from one place.",
    templates:
      "Schemas stay reusable, but they should not interrupt the extraction job.",
    settings:
      "Choose the provider and runtime defaults without polluting the extraction path.",
    audit:
      "Check history when you need it, not when you are trying to extract.",
    help: "Use setup and workflow guidance only when the next step is unclear.",
  };

  return (
    <header className="sticky top-0 z-10 flex items-center justify-start gap-4 border-b border-line bg-[rgba(245,247,252,0.78)] px-[1.8rem] py-[1.4rem] backdrop-blur-[18px]">
      <div className="grid gap-[0.18rem]">
        <strong className="text-base tracking-[-0.02em]">{activeLabel}</strong>
        <span className="text-[0.88rem] text-muted">
          {subtitles[activePage]}
        </span>
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
  return <Badge tone={tone}>{children}</Badge>;
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
        "grid min-w-0 gap-1 rounded-[var(--ds-radius-lg)] border border-[rgba(122,138,179,0.16)] bg-card p-4 shadow-sm",
        tone === "accent" &&
          "border-[rgba(var(--accent-rgb),0.16)] bg-[linear-gradient(180deg,rgba(var(--accent-rgb),0.05),var(--surface-card))]",
        tone === "success" &&
          "border-[rgba(var(--success-rgb),0.2)] bg-[rgba(var(--success-rgb),0.08)]",
        tone === "warning" &&
          "border-[rgba(var(--warning-rgb),0.2)] bg-[rgba(var(--warning-rgb),0.08)]",
        tone === "danger" &&
          "border-[rgba(var(--danger-rgb),0.2)] bg-[rgba(var(--danger-rgb),0.08)]",
      )}
    >
      <span className="text-xs font-bold tracking-[0.05em] text-muted uppercase">
        {label}
      </span>
      <strong className="block text-lg tracking-[-0.03em] text-ink">
        {value}
      </strong>
      {support ? <p className="m-0 text-xs text-muted">{support}</p> : null}
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
  const labelId = useId();
  const hintId = useId();

  return (
    <div className="flex items-center justify-between gap-4 rounded-[16px] border border-[rgba(122,138,179,0.16)] bg-[rgba(255,255,255,0.92)] px-4 py-[0.95rem]">
      <div className="grid gap-[0.3rem]">
        <span id={labelId} className="text-[0.88rem] font-semibold text-ink">
          {label}
        </span>
        {hint ? (
          <SupportingText id={hintId} className="m-0" size="sm">
            {hint}
          </SupportingText>
        ) : null}
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-labelledby={labelId}
        aria-describedby={hint ? hintId : undefined}
        className={classNames(
          "inline-flex min-h-[var(--control-height-sm)] items-center gap-2 rounded-full border px-[0.4rem] py-[0.3rem] pl-[0.3rem] shadow-sm transition-colors",
          checked
            ? "border-[rgba(var(--accent-rgb),0.22)] bg-[rgba(var(--accent-rgb),0.12)]"
            : "border-border bg-panel",
        )}
        onClick={onToggle}
      >
        <span
          aria-hidden="true"
          className={classNames(
            "h-[1.2rem] w-[1.2rem] rounded-full transition-all",
            checked
              ? "translate-x-[0.2rem] bg-brand"
              : "bg-[rgba(122,138,179,0.56)]",
          )}
        />
        <span
          className={classNames(
            "min-w-[1.5rem] text-center text-xs font-bold",
            checked ? "text-brand-strong" : "text-muted",
          )}
        >
          {checked ? "On" : "Off"}
        </span>
      </button>
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
    <label className="grid gap-2">
      <span className="text-sm font-semibold text-muted">{label}</span>
      {children}
      {hint ? <span className="text-xs text-muted">{hint}</span> : null}
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
    <div className="flex flex-col items-start justify-between gap-5 md:flex-row">
      <div className="grid min-w-0 gap-2">
        <span className="inline-flex items-center gap-2 text-[0.82rem] font-bold tracking-[0.11em] text-brand-strong uppercase">
          {eyebrow}
        </span>
        <h2 className="m-0 max-w-[17ch] text-[var(--text-display)] leading-[1.02] tracking-[-0.05em]">
          {title}
        </h2>
        {description ? (
          <p className="m-0 max-w-[64ch] text-[0.98rem] text-muted">
            {description}
          </p>
        ) : null}
      </div>
      {actions ? (
        <div className="flex flex-wrap items-center justify-end gap-2">
          {actions}
        </div>
      ) : null}
    </div>
  );
}

function PreviewList({ children }: { children: ReactNode }) {
  return <div className="grid gap-[0.8rem]">{children}</div>;
}

function PreviewRow({
  token,
  title,
  subtitle,
  meta,
}: {
  token: ReactNode;
  title: ReactNode;
  subtitle: ReactNode;
  meta?: ReactNode;
}) {
  return (
    <div className="flex items-center gap-[0.9rem] rounded-[var(--ds-radius-lg)] border border-border bg-panel px-4 py-[0.85rem] shadow-sm">
      <div className="grid h-[34px] w-[34px] flex-none place-items-center rounded-[12px] bg-[rgba(77,96,255,0.1)] font-bold text-brand-strong">
        {token}
      </div>
      <div className="grid min-w-0 flex-1 gap-[0.25rem]">
        <strong>{title}</strong>
        <SupportingText as="span" size="sm">
          {subtitle}
        </SupportingText>
      </div>
      {meta ? (
        <div className="flex flex-wrap items-center gap-[0.55rem]">{meta}</div>
      ) : null}
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
    <TitledSurface
      as="section"
      className="border-[rgba(77,96,255,0.16)] bg-[linear-gradient(135deg,rgba(248,250,255,0.96),rgba(255,255,255,0.96))]"
      title="Desktop runtime"
      subtitle="Use this recovery path when the desktop shell is open but the local extraction stack is not ready."
    >
      <div className="grid items-start gap-4 [grid-template-columns:minmax(0,1.45fr)_minmax(280px,0.75fr)] max-[1280px]:grid-cols-1">
        <div className="grid gap-4">
          <PanelCard tone="plain" className="px-[1.1rem]">
            <strong className="block text-base">{desktopStatus.message}</strong>
            <p className="mt-[0.55rem] text-[0.92rem] text-muted">
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
          </PanelCard>

          <div className="grid gap-3">
            {checklist.map((item) => (
              <StatusRow
                key={item.label}
                complete={item.complete}
                title={item.label}
                description={item.detail}
              />
            ))}
          </div>

          <div className="grid gap-[0.7rem]">
            <InlineGroup spacing="roomy">
              <Button
                variant="primary"
                onClick={() => void onStart()}
                disabled={busyAction === "desktop-start"}
              >
                {busyAction === "desktop-start"
                  ? "Starting..."
                  : "Start local stack"}
              </Button>
              <Button
                variant="secondary"
                onClick={() => void onRestart()}
                disabled={busyAction === "desktop-restart"}
              >
                {busyAction === "desktop-restart"
                  ? "Restarting..."
                  : "Restart stack"}
              </Button>
              <Button
                variant="secondary"
                onClick={() => void onStop()}
                disabled={busyAction === "desktop-stop"}
              >
                {busyAction === "desktop-stop" ? "Stopping..." : "Stop stack"}
              </Button>
            </InlineGroup>
            <InlineGroup spacing="roomy">
              <Button
                variant="secondary"
                onClick={() => void onRefresh()}
                disabled={busyAction === "desktop-refresh"}
              >
                Refresh status
              </Button>
              <Button
                variant="secondary"
                onClick={() => void onLoadLogs()}
                disabled={busyAction === "desktop-logs"}
              >
                {busyAction === "desktop-logs"
                  ? "Loading logs..."
                  : "Load backend logs"}
              </Button>
              <Button
                variant="secondary"
                onClick={() => void onOpenProjectRoot()}
                disabled={busyAction === "desktop-open-root"}
              >
                Open runtime root
              </Button>
              <Button
                variant="secondary"
                onClick={() => void onOpenAppDataDir()}
                disabled={busyAction === "desktop-open-data"}
              >
                Open app data
              </Button>
            </InlineGroup>
          </div>
        </div>

        <div className="grid gap-4">
          <PanelCard tone="plain" className="px-[1.1rem]">
            <MetricLabel className="inline-block text-brand-strong">
              Recommended sequence
            </MetricLabel>
            <ol className="mt-[0.8rem] pl-[1.05rem] text-ink">
              <li>Confirm Docker Desktop is running.</li>
              <li>Start the local stack from this shell.</li>
              <li>Refresh status after the backend becomes reachable.</li>
              <li>Load logs only if the backend still fails to respond.</li>
            </ol>
          </PanelCard>
          <PanelCard tone="plain" className="px-[1.1rem]">
            <MetricLabel className="inline-block text-brand-strong">
              Why this is secondary
            </MetricLabel>
            <p className="mt-[0.55rem] text-[0.92rem] text-muted">
              Runtime setup belongs behind the extraction flow, not in front of
              it.
            </p>
          </PanelCard>
        </div>
      </div>

      {logs ? (
        <div className="mt-4 overflow-hidden rounded-[18px] border border-[rgba(122,138,179,0.16)] bg-[rgba(255,255,255,0.9)] shadow-sm">
          <div className="flex items-center justify-between gap-4 px-4 pb-0 pt-[0.95rem]">
            <strong>Backend logs</strong>
            <span className="text-[0.82rem] text-muted">{logs.source}</span>
          </div>
          <pre className="m-0 max-h-[360px] overflow-auto bg-[rgba(246,248,253,0.95)] p-4 font-mono text-[0.84rem] leading-[1.5] text-ink">
            {logs.content || "No log output returned."}
          </pre>
        </div>
      ) : null}
    </TitledSurface>
  );
}

function DesktopSetupNotice({
  desktopStatus,
  provider,
  apiUnavailable,
  busyAction,
  desktopOnboardingDismissed,
  onRefresh,
  onStartDesktopStack,
  onOpenSettings,
  onDismiss,
}: {
  desktopStatus: DesktopStatus | null;
  provider: ProviderSettings | null;
  apiUnavailable: boolean;
  busyAction: string | null;
  desktopOnboardingDismissed: boolean;
  onRefresh: () => Promise<void>;
  onStartDesktopStack: () => Promise<void>;
  onOpenSettings: () => void;
  onDismiss: () => void;
}) {
  if (!desktopStatus?.tauriMode) {
    return null;
  }

  const needsAttention = apiUnavailable || !provider;
  if (!needsAttention && desktopOnboardingDismissed) {
    return null;
  }

  const checklist = [
    {
      label: "Desktop runtime bundle",
      complete:
        desktopStatus.runtimeSource === "bundled_resources" ||
        desktopStatus.runtimeSource === "repo_checkout",
      detail:
        desktopStatus.runtimeSource === "bundled_resources"
          ? "Bundled runtime is available."
          : "Repo-backed desktop runtime is connected.",
    },
    {
      label: "Docker Desktop",
      complete: desktopStatus.dockerAvailable,
      detail: desktopStatus.dockerAvailable
        ? "Container runtime is ready."
        : "Start Docker Desktop before running the local stack.",
    },
    {
      label: "Local backend",
      complete: desktopStatus.backendReachable && !apiUnavailable,
      detail:
        desktopStatus.backendReachable && !apiUnavailable
          ? `Frontend can reach ${desktopStatus.backendHost}:${desktopStatus.backendPort}.`
          : `Backend is not yet reachable on ${desktopStatus.backendHost}:${desktopStatus.backendPort}.`,
    },
    {
      label: "Default provider",
      complete: Boolean(provider),
      detail: provider
        ? `${provider.provider_type} (${provider.model}) is ready for extraction.`
        : "Pick a default provider before you run a real extraction job.",
    },
  ];

  return (
    <Surface
      as="section"
      className="border-[rgba(77,96,255,0.16)] bg-[linear-gradient(135deg,rgba(248,250,255,0.96),rgba(255,255,255,0.94))]"
      role={needsAttention ? "alert" : "status"}
      aria-live={needsAttention ? "assertive" : "polite"}
    >
      <div className="grid items-center gap-4 [grid-template-columns:minmax(0,1.1fr)_minmax(260px,0.9fr)_auto] max-[1280px]:grid-cols-1">
        <div>
          <strong className="block text-base">
            {needsAttention
              ? "Desktop setup needs attention, but it no longer blocks the workspace."
              : "Desktop runtime is ready. Confirm the defaults once, then get back to extraction."}
          </strong>
          <p className="mt-[0.55rem] text-[0.9rem] text-muted">
            {needsAttention
              ? "Use these recovery controls when the local stack is down or the default provider is still missing."
              : "This reminder is only here for first-run orientation. Dismiss it once the path is obvious."}
          </p>
        </div>
        <div className="grid grid-cols-3 gap-3 max-[1280px]:grid-cols-1">
          <DetailTile
            label="Backend"
            tone="plain"
            value={apiUnavailable ? "Needs recovery" : "Ready"}
            valueClassName="mt-[0.25rem]"
          />
          <DetailTile
            label="Provider"
            tone="plain"
            value={provider ? provider.provider_type : "Not set"}
            valueClassName="mt-[0.25rem]"
          />
          <DetailTile
            label="Runtime root"
            tone="plain"
            value={desktopStatus.projectRoot ? "Connected" : "Missing"}
            valueClassName="mt-[0.25rem]"
          />
        </div>
        <div className="flex flex-wrap items-center justify-end gap-[0.6rem]">
          <Button
            variant="secondary"
            onClick={() => void onRefresh()}
            disabled={busyAction === "desktop-refresh"}
          >
            Refresh status
          </Button>
          {(apiUnavailable || !desktopStatus.backendReachable) && (
            <Button
              variant="primary"
              onClick={() => void onStartDesktopStack()}
              disabled={busyAction === "desktop-start"}
            >
              {busyAction === "desktop-start"
                ? "Starting..."
                : "Start local stack"}
            </Button>
          )}
          {!provider ? (
            <Button variant="secondary" onClick={onOpenSettings}>
              Open settings
            </Button>
          ) : null}
          {!needsAttention ? (
            <Button variant="tertiary" onClick={onDismiss}>
              Dismiss reminder
            </Button>
          ) : null}
        </div>
      </div>
      <div className="mt-4 grid gap-3">
        {checklist.map((item) => (
          <StatusRow
            key={item.label}
            complete={item.complete}
            title={item.label}
            description={item.detail}
          />
        ))}
      </div>
    </Surface>
  );
}

function templateVersionDiffHasChanges(diff: TemplateVersionDiff): boolean {
  return (
    (diff.extracted_added?.length ?? 0) > 0 ||
    (diff.extracted_removed?.length ?? 0) > 0 ||
    (diff.extracted_changed?.length ?? 0) > 0 ||
    (diff.calculated_added?.length ?? 0) > 0 ||
    (diff.calculated_removed?.length ?? 0) > 0 ||
    (diff.calculated_changed?.length ?? 0) > 0 ||
    Boolean(diff.langextract_changed)
  );
}

function isTemplateVersionDiff(value: unknown): value is TemplateVersionDiff {
  return (
    typeof value === "object" &&
    value !== null &&
    Array.isArray((value as TemplateVersionDiff).extracted_added) &&
    Array.isArray((value as TemplateVersionDiff).extracted_removed)
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
  draftTemplateDefinition,
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
  draftTemplateDefinition: TemplateDefinition;
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
  const [dryRunSampleText, setDryRunSampleText] = useState(
    "Vendor Name: Acme Corp\nTotal Due: $1,200.00",
  );
  const [dryRunResult, setDryRunResult] = useState<SchemaDryRunResponse | null>(
    null,
  );
  const [dryRunBusy, setDryRunBusy] = useState(false);
  const [versionDiff, setVersionDiff] = useState<TemplateVersionDiff | null>(
    null,
  );
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
  const dryRunStepNumber = outputRulesStepNumber + 1;
  const selectedSavedVersion =
    selectedVersions.find((item) => item.id === selectedTemplateVersionId) ??
    null;

  useEffect(() => {
    if (!selectedSavedVersion) {
      setVersionDiff(null);
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const diff = await readJson<TemplateVersionDiff>(
          "/templates/version-diff",
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              before_definition: selectedSavedVersion.definition,
              after_definition: draftTemplateDefinition,
            }),
          },
        );
        if (!cancelled && isTemplateVersionDiff(diff)) {
          setVersionDiff(diff);
        }
      } catch {
        if (!cancelled) {
          setVersionDiff(null);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [draftTemplateDefinition, selectedSavedVersion]);

  async function handleSchemaDryRun() {
    setDryRunBusy(true);
    try {
      const result = await readJson<SchemaDryRunResponse>(
        "/templates/dry-run",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            definition: draftTemplateDefinition,
            sample_text: dryRunSampleText,
          }),
        },
      );
      setDryRunResult(result);
    } catch (error) {
      setDryRunResult({
        ok: false,
        schema_errors: [
          error instanceof Error ? error.message : "Dry run request failed.",
        ],
        document_level_notes: [],
        extracted_fields: [],
        fields_requiring_review: [],
      });
    } finally {
      setDryRunBusy(false);
    }
  }

  return (
    <PageStack>
      <PageIntro>
        <PageHeader
          eyebrow="Schemas"
          title="Define what the model should look for before the document run starts."
          description="Keep the setup sequence obvious: choose a reusable schema, describe the extraction job, review the search parameters, then confirm evidence and export rules."
          actions={
            <Button
              variant="secondary"
              onClick={() => void onCreateTemplate()}
              disabled={busyAction === "save-template"}
            >
              {busyAction === "save-template" ? "Saving..." : "Save schema"}
            </Button>
          }
        />
      </PageIntro>

      <div className="grid grid-cols-12 gap-5">
        <TitledSurface
          as="section"
          className="col-span-12"
          aria-labelledby="schema-base-step-title"
          titleId="schema-base-step-title"
          title="1. Start from the closest existing schema"
          subtitle="Most operators should begin from a reusable schema and only change the brief when the job truly differs."
        >
          <div className="grid gap-4 [grid-template-columns:minmax(0,1fr)_minmax(260px,0.9fr)_minmax(260px,0.95fr)] max-[1280px]:grid-cols-1">
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
            <PanelCard tone="subtle" spacing="compact">
              <MetricLabel>Active setup</MetricLabel>
              <strong className="block">
                {selectedSchema?.name ?? definition.template_name}
              </strong>
              <SupportingText className="mt-[0.45rem]">
                {selectedSchema?.description ||
                  definition.description ||
                  "Use this starter schema as the base contract for the extraction job below."}
              </SupportingText>
              <div className="flex flex-wrap items-center gap-[0.55rem]">
                <StatusBadge tone="indigo">
                  {selectedTemplateVersionId
                    ? "Version selected"
                    : "Starter template"}
                </StatusBadge>
                <Badge tone="neutral">
                  {selectedVersions.length
                    ? `${selectedVersions.length} saved versions`
                    : "No saved versions yet"}
                </Badge>
              </div>
            </PanelCard>
            {selectedSavedVersion && versionDiff ? (
              <PanelCard
                tone="subtle"
                spacing="compact"
                className="col-span-full"
              >
                <MetricLabel>Version diff</MetricLabel>
                <SupportingText className="mt-[0.45rem]">
                  {versionDiff.before_version} → {versionDiff.after_version}
                </SupportingText>
                {templateVersionDiffHasChanges(versionDiff) ? (
                  <ul className="mt-[0.65rem] pl-[1.1rem] text-[0.92rem] text-default">
                    {versionDiff.extracted_added.length ? (
                      <li>
                        Added fields: {versionDiff.extracted_added.join(", ")}
                      </li>
                    ) : null}
                    {versionDiff.extracted_removed.length ? (
                      <li>
                        Removed fields:{" "}
                        {versionDiff.extracted_removed.join(", ")}
                      </li>
                    ) : null}
                    {versionDiff.extracted_changed.map((change) => (
                      <li key={change.name}>
                        Modified {change.name}: {change.details.join("; ")}
                      </li>
                    ))}
                    {versionDiff.calculated_added.length ? (
                      <li>
                        Added formulas:{" "}
                        {versionDiff.calculated_added.join(", ")}
                      </li>
                    ) : null}
                    {versionDiff.calculated_removed.length ? (
                      <li>
                        Removed formulas:{" "}
                        {versionDiff.calculated_removed.join(", ")}
                      </li>
                    ) : null}
                    {versionDiff.calculated_changed.map((change) => (
                      <li key={change.name}>
                        Modified formula {change.name}:{" "}
                        {change.details.join("; ")}
                      </li>
                    ))}
                    {versionDiff.langextract_changed ? (
                      <li>LangExtract prompt or examples changed</li>
                    ) : null}
                  </ul>
                ) : (
                  <SupportingText className="mt-[0.45rem]">
                    Current draft matches the selected saved version.
                  </SupportingText>
                )}
              </PanelCard>
            ) : null}
          </div>
        </TitledSurface>

        <TitledSurface
          as="section"
          className="col-span-7 max-[1280px]:col-span-12"
          aria-labelledby="schema-brief-step-title"
          titleId="schema-brief-step-title"
          title="2. Describe the extraction brief"
          subtitle="Tell the system what class of document this is and what information the run is meant to find."
        >
          <div className="grid gap-4 [grid-template-columns:minmax(0,1.35fr)_minmax(280px,0.95fr)] max-[1280px]:grid-cols-1">
            <FormGrid>
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
              <label className="col-span-full">
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
            </FormGrid>
            <div className="grid gap-[0.85rem]">
              <PanelCard tone="subtle" spacing="compact">
                <MetricLabel>Best practice</MetricLabel>
                <strong className="block">
                  Describe the extraction goal, not the model.
                </strong>
                <SupportingText className="mt-[0.45rem]">
                  Write the task the operator cares about: what values must be
                  found, what evidence matters, and what should happen when the
                  value is missing or ambiguous.
                </SupportingText>
              </PanelCard>
              <div className="rounded-[18px] border border-subtle bg-[rgba(248,250,255,0.88)] px-[1.05rem] py-4">
                <MetricLabel>Current search surface</MetricLabel>
                <ul className="mt-[0.65rem] pl-[1.1rem] text-[0.95rem] text-default">
                  <li>
                    {definition.extracted_fields.length} extraction targets
                    defined
                  </li>
                  <li className="mt-[0.4rem]">
                    {requiredFieldCount} required values must be found
                  </li>
                  <li className="mt-[0.4rem]">
                    {citationFieldCount} fields expect source evidence
                  </li>
                </ul>
              </div>
            </div>
          </div>
        </TitledSurface>

        {showLangExtractEditor ? (
          <TitledSurface
            as="section"
            className="col-span-12"
            aria-labelledby="langextract-step-title"
            titleId="langextract-step-title"
            title="3. Teach the schema with grounded examples"
            subtitle="Start with the smallest grounded example set that proves the behavior you want, then promote reviewed suggestions only when they deserve the next saved version."
          >
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
          </TitledSurface>
        ) : null}

        <TitledSurface
          as="section"
          className="col-span-5 max-[1280px]:col-span-12"
          aria-labelledby="setup-map-title"
          titleId="setup-map-title"
          title="Setup map"
          subtitle="Keep the configuration sequence obvious so the user always knows what comes next."
        >
          <ol className="grid list-none gap-[0.85rem] p-0">
            <StepCard
              as="li"
              tone="accent"
              step={1}
              title="Choose a schema base"
              description="Reuse the closest existing definition before creating a new one."
            />
            <StepCard
              as="li"
              tone="accent"
              step={2}
              title="Describe the extraction goal"
              description="State what the run should search for in plain operational terms."
            />
            {showLangExtractEditor ? (
              <StepCard
                as="li"
                tone="accent"
                step={3}
                title="Teach the schema with examples"
                description="Ground the schema with reliable spans before promoting reviewed suggestions."
              />
            ) : null}
            <StepCard
              as="li"
              step={searchParametersStepNumber}
              title="Review search parameters"
              description="Confirm the exact fields, evidence requirements, and output types."
            />
            <StepCard
              as="li"
              step={outputRulesStepNumber}
              title="Confirm review and export rules"
              description="Make sure the output and human-review burden match the workflow."
            />
          </ol>

          <SummaryGrid className="mt-4">
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
          </SummaryGrid>
        </TitledSurface>

        <TitledSurface
          as="section"
          className="col-span-7 max-[1280px]:col-span-12"
          aria-labelledby="search-parameters-step-title"
          titleId="search-parameters-step-title"
          title={`${searchParametersStepNumber}. Review the search parameters`}
          subtitle="This is the actual search contract the extraction run will follow."
        >
          <div className="grid gap-4">
            {definition.extracted_fields.map((field, index) => (
              <div
                key={field.name}
                className="rounded-[var(--ds-radius-lg)] border border-border bg-panel p-[1.05rem] shadow-sm"
              >
                <div className="grid items-start gap-[0.9rem] [grid-template-columns:auto_minmax(0,1fr)]">
                  <StepMarker>{index + 1}</StepMarker>
                  <div className="grid gap-[0.45rem]">
                    <div className="flex flex-wrap items-center justify-between gap-4 max-[820px]:items-stretch">
                      <strong>{field.label}</strong>
                      <div className="flex flex-wrap items-center gap-[0.55rem]">
                        <Badge tone="neutral">{field.type}</Badge>
                        <StatusBadge tone={field.required ? "info" : "warning"}>
                          {field.required ? "Required" : "Optional"}
                        </StatusBadge>
                        {field.citation_required ? (
                          <Badge tone="neutral">Evidence required</Badge>
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
                <div className="mt-[0.9rem] grid gap-3 sm:grid-cols-2">
                  <DetailTile label="Field key" value={field.name} />
                  <DetailTile label="Output type" value={field.type} />
                  <DetailTile
                    label="Null handling"
                    value={
                      field.required
                        ? "Do not allow missing values"
                        : "Allow null when absent"
                    }
                  />
                  <DetailTile
                    label="Review posture"
                    value={
                      field.citation_required
                        ? "Operator should confirm source evidence"
                        : "Evidence optional for this field"
                    }
                  />
                </div>
              </div>
            ))}
          </div>
        </TitledSurface>

        <TitledSurface
          as="section"
          className="col-span-5 max-[1280px]:col-span-12"
          aria-labelledby="output-rules-step-title"
          titleId="output-rules-step-title"
          title={`${outputRulesStepNumber}. Review output and trust rules`}
          subtitle="Keep deterministic logic and export behavior visible before the schema is saved."
        >
          <div className="grid gap-[0.85rem]">
            <PanelCard tone="subtle" spacing="compact">
              <MetricLabel>Provider</MetricLabel>
              <strong className="block">
                {definition.llm_provider_settings.provider_type}
              </strong>
              <SupportingText className="mt-[0.45rem]">
                Chunk size{" "}
                {definition.llm_provider_settings.chunk_size ?? 16000}{" "}
                characters ·{" "}
                {draft.local_only
                  ? "local-first boundary"
                  : "external processing allowed"}
              </SupportingText>
              {definition.langextract_config?.examples?.length ? (
                <SupportingText className="mt-[0.45rem]">
                  LangExtract examples{" "}
                  {definition.langextract_config.examples.length}
                </SupportingText>
              ) : null}
            </PanelCard>
            <PanelCard tone="subtle" spacing="compact">
              <MetricLabel>Review threshold</MetricLabel>
              <strong className="block">
                {citationFieldCount
                  ? "Evidence-backed review expected"
                  : "Light review posture"}
              </strong>
              <SupportingText className="mt-[0.45rem]">
                Required fields and low-confidence values should be reviewed
                before the export is treated as final.
              </SupportingText>
            </PanelCard>
          </div>

          <div className="mt-4 grid gap-[0.9rem]">
            <NoteCard tone="info" density="compact">
              <strong className="mb-[0.35rem] block">
                Calculated outputs stay deterministic.
              </strong>
              <SupportingText className="mt-0">
                Keep formulas in the product so the model only extracts source
                values and the application owns the final math.
              </SupportingText>
            </NoteCard>
            {definition.calculated_fields.length ? (
              definition.calculated_fields.map((field) => (
                <div
                  key={field.name}
                  className="rounded-[16px] border border-[rgba(var(--accent-rgb),0.12)] bg-[rgba(var(--accent-rgb),0.06)] px-4 py-[0.9rem] font-mono text-[0.9rem] text-brand-strong"
                >
                  {field.label} = {field.formula}
                </div>
              ))
            ) : (
              <NoteCard tone="info" density="compact">
                <strong className="mb-[0.35rem] block">
                  No calculated outputs yet.
                </strong>
                <SupportingText className="mt-0">
                  Add formulas only when the workflow needs deterministic values
                  after extraction.
                </SupportingText>
              </NoteCard>
            )}
            <NoteCard tone="info" density="compact">
              <strong className="mb-[0.35rem] block">Export formats</strong>
              <SupportingText className="mt-0">
                {exportFormatsLabel}
              </SupportingText>
            </NoteCard>
          </div>
        </TitledSurface>

        <TitledSurface
          as="section"
          className="col-span-12"
          aria-labelledby="schema-dry-run-title"
          titleId="schema-dry-run-title"
          title={`${dryRunStepNumber}. Validate with sample text`}
          subtitle="Run mock extraction and field validation without queueing a document job."
        >
          <div className="grid gap-4">
            <label className="col-span-full">
              <span>Sample document text</span>
              <textarea
                rows={5}
                aria-label="Sample document text"
                value={dryRunSampleText}
                onChange={(event) => setDryRunSampleText(event.target.value)}
              />
            </label>
            <div>
              <Button
                variant="secondary"
                onClick={() => void handleSchemaDryRun()}
                disabled={dryRunBusy}
              >
                {dryRunBusy ? "Running dry run..." : "Run dry run"}
              </Button>
            </div>
            {dryRunResult?.schema_errors.length ? (
              <NoteCard tone="info" density="compact">
                <strong className="block">Schema errors</strong>
                <ul className="mt-[0.45rem] pl-[1.1rem]">
                  {dryRunResult.schema_errors.map((error) => (
                    <li key={error}>{error}</li>
                  ))}
                </ul>
              </NoteCard>
            ) : null}
            {dryRunResult?.extracted_fields.length ? (
              <div className="overflow-x-auto rounded-[var(--ds-radius-lg)] border border-border">
                <table className="w-full min-w-[640px] border-collapse text-left text-[0.92rem]">
                  <thead>
                    <tr className="border-b border-border bg-panel">
                      <TableHeaderCell>Field</TableHeaderCell>
                      <TableHeaderCell>Status</TableHeaderCell>
                      <TableHeaderCell>Value</TableHeaderCell>
                      <TableHeaderCell>Notes</TableHeaderCell>
                    </tr>
                  </thead>
                  <tbody>
                    {dryRunResult.extracted_fields.map((field) => (
                      <tr
                        key={field.field_name}
                        className="border-b border-subtle last:border-b-0"
                      >
                        <TableDataCell>
                          <strong>{field.label}</strong>
                          <SupportingText className="mt-1 block">
                            {field.field_name}
                          </SupportingText>
                        </TableDataCell>
                        <TableDataCell>
                          <StatusBadge
                            tone={
                              field.validation_status === "valid"
                                ? "success"
                                : "warning"
                            }
                          >
                            {field.validation_status}
                          </StatusBadge>
                          {field.validation_errors.length ? (
                            <SupportingText className="mt-1 block">
                              {field.validation_errors.join(" ")}
                            </SupportingText>
                          ) : null}
                        </TableDataCell>
                        <TableDataCell>
                          {field.extracted_value ?? "—"}
                        </TableDataCell>
                        <TableDataCell>
                          {field.extraction_notes || "—"}
                        </TableDataCell>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : null}
            {dryRunResult && dryRunResult.ok ? (
              <SupportingText>
                Dry run passed validation for all extracted fields.
              </SupportingText>
            ) : null}
          </div>
        </TitledSurface>
      </div>
    </PageStack>
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
  parserStatus,
  busyAction,
  coreDataState,
  onSelectJob,
  onStartNew,
  onUpload,
  onSelectDocument,
  onSelectTemplate,
  onSelectTemplateVersion,
  onSetReviewDraft,
  onSetFocusedField,
  onRunExtraction,
  onRetryJob,
  onCancelJob,
  onSaveReview,
  onApproveAllReview,
  onApproveHighConfidenceReview,
  onExport,
  exportBlocked,
  jobStatusFilter,
  onJobStatusFilterChange,
  onOpenSchemas,
  onOpenHelp,
  onRetryConnection,
  provider,
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
  parserStatus: ParserStatus | null;
  busyAction: string | null;
  coreDataState: "loading" | "ready" | "unavailable";
  onSelectJob: (jobId: number) => void;
  onStartNew: () => void;
  onUpload: (file: File) => Promise<void>;
  onSelectDocument: (id: number | null) => void;
  onSelectTemplate: (id: number | null) => void;
  onSelectTemplateVersion: (id: number | null) => void;
  onSetReviewDraft: (fieldName: string, value: string) => void;
  onSetFocusedField: (fieldName: string) => void;
  onRunExtraction: () => Promise<void>;
  onRetryJob: () => Promise<void>;
  onCancelJob: () => Promise<void>;
  onSaveReview: () => Promise<void>;
  onApproveAllReview: () => Promise<void>;
  onApproveHighConfidenceReview: () => Promise<void>;
  onExport: (format: "json" | "csv" | "excel") => Promise<void>;
  exportBlocked: boolean;
  jobStatusFilter: string | null;
  onJobStatusFilterChange: (status: string | null) => void;
  onOpenSchemas: () => void;
  onOpenHelp: () => void;
  onRetryConnection: () => Promise<void>;
  provider: ProviderSettings | null;
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
  const parserFailureGuidance = getParserFailureGuidance(
    selectedJob?.error_message,
  );
  const selectedTemplate =
    templates.find(
      (item) => item.id === selectedTemplateVersion?.template_id,
    ) ??
    templates.find((item) => item.id === selectedTemplateId) ??
    null;
  const selectedSchemaVersions = templateVersions.filter(
    (item) => item.template_id === (selectedTemplate?.id ?? selectedTemplateId),
  );
  const langExtractRunReadiness = selectedTemplateVersion?.definition
    ? getLangExtractExtractionReadiness(
        selectedTemplateVersion.definition,
        provider?.is_persisted_default && isLangExtractProvider(provider)
          ? provider
          : null,
      )
    : { ready: true, message: null };
  const [showVersionSelector, setShowVersionSelector] = useState(false);
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
  const highConfidenceReviewCount = fieldsNeedingReview.filter((field) =>
    isHighConfidenceField(field),
  ).length;
  const jobProgressPct = clampProgressPct(selectedJob?.progress_pct);
  const jobProgressLabel = getJobStageLabel(
    selectedJob?.progress_stage ??
      (selectedJob?.status === "queued" ? "queued" : null),
  );
  const workspaceInteractive = coreDataState === "ready";
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
  const recommendedTemplateVersion = selectedSchemaVersions[0] ?? null;
  const hasMultipleSchemaVersions = selectedSchemaVersions.length > 1;

  useEffect(() => {
    if (!hasMultipleSchemaVersions) {
      setShowVersionSelector(false);
      return;
    }
    if (
      selectedTemplateVersion &&
      recommendedTemplateVersion &&
      selectedTemplateVersion.id !== recommendedTemplateVersion.id
    ) {
      setShowVersionSelector(true);
    }
  }, [
    hasMultipleSchemaVersions,
    recommendedTemplateVersion,
    selectedTemplateVersion,
  ]);

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
      label: "Cancelled",
      items: jobs.filter((job) => job.status === "cancelled"),
    },
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

  const visibleJobGroups = jobStatusFilter
    ? jobGroups.filter((group) =>
        group.label.toLowerCase().includes(jobStatusFilter.toLowerCase()),
      )
    : jobGroups;

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
    <PageStack>
      <div className="grid items-start gap-5 [grid-template-columns:280px_minmax(0,1fr)] max-[1280px]:grid-cols-1">
        <TitledSurface
          as="aside"
          className="sticky top-[6.4rem] grid min-w-0 gap-4 bg-[rgba(255,255,255,0.62)] p-4 shadow-none"
          title="Jobs"
          subtitle="Switch runs without leaving the workspace."
        >
          <Button variant="primary" fullWidth onClick={onStartNew}>
            New extraction
          </Button>
          <InlineGroup>
            {[
              { label: "All", value: null },
              { label: "Processing", value: "processing" },
              { label: "Review", value: "review" },
              { label: "Failed", value: "failed" },
            ].map((filter) => (
              <Button
                key={filter.label}
                variant={
                  jobStatusFilter === filter.value ? "primary" : "secondary"
                }
                size="sm"
                onClick={() => onJobStatusFilterChange(filter.value)}
              >
                {filter.label}
              </Button>
            ))}
          </InlineGroup>
          <div className="grid gap-[0.9rem]">
            {visibleJobGroups.length ? (
              visibleJobGroups.map((group) => (
                <div key={group.label} className="grid gap-[0.9rem]">
                  <MetricLabel className="text-[0.76rem] tracking-[0.08em] text-faint">
                    {group.label}
                  </MetricLabel>
                  <div className="grid gap-[0.7rem]">
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
                            "grid gap-[0.25rem] rounded-[var(--ds-radius-lg)] border px-4 py-[0.9rem] text-left transition-transform",
                            selectedJobId === job.id
                              ? "border-[rgba(77,96,255,0.22)] bg-[rgba(247,248,255,0.98)]"
                              : "border-border bg-[rgba(255,255,255,0.78)] shadow-none hover:-translate-y-px",
                          )}
                          aria-current={
                            selectedJobId === job.id ? "true" : undefined
                          }
                          onClick={() => onSelectJob(job.id)}
                        >
                          <strong>
                            {document?.original_filename ??
                              `Document ${job.document_id}`}
                          </strong>
                          <SupportingText as="span" size="sm">
                            {formatTimestamp(job.updated_at)}
                          </SupportingText>
                          <em className="text-[0.86rem] not-italic text-brand-strong">
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
              <div className="grid gap-[0.45rem] px-[0.1rem] pt-[0.95rem]">
                <strong>
                  {coreDataState === "loading"
                    ? "Loading jobs..."
                    : coreDataState === "unavailable"
                      ? "Job history unavailable"
                      : "No extraction history yet"}
                </strong>
                <p>
                  {coreDataState === "loading"
                    ? "Hold this spot while the workspace loads the latest jobs and schemas."
                    : coreDataState === "unavailable"
                      ? "Reconnect the local API before job history and saved setup can load here."
                      : "Your first upload should not require a tour of the product."}
                </p>
              </div>
            )}
          </div>
        </TitledSurface>

        <div className="min-w-0">
          <Surface as="section">
            <PageHeader
              eyebrow="Extraction workspace"
              title={headerTitle}
              description={headerCopy}
              actions={
                <>
                  {stage === "review" ? (
                    <>
                      {highConfidenceReviewCount > 0 ? (
                        <Button
                          variant="secondary"
                          onClick={() => void onApproveHighConfidenceReview()}
                          disabled={
                            !workspaceInteractive ||
                            busyAction === "save-review"
                          }
                        >
                          {busyAction === "save-review"
                            ? "Saving..."
                            : `Approve ${highConfidenceReviewCount} high-confidence`}
                        </Button>
                      ) : null}
                      <Button
                        variant="secondary"
                        onClick={() => void onApproveAllReview()}
                        disabled={
                          !workspaceInteractive ||
                          busyAction === "save-review" ||
                          fieldsNeedingReview.length === 0
                        }
                      >
                        Approve all flagged
                      </Button>
                      <Button
                        variant="primary"
                        onClick={() => void onSaveReview()}
                        disabled={
                          !workspaceInteractive || busyAction === "save-review"
                        }
                      >
                        {busyAction === "save-review"
                          ? "Saving review..."
                          : "Save review"}
                      </Button>
                    </>
                  ) : null}
                  {stage === "failed" && selectedJob ? (
                    <Button
                      variant="primary"
                      onClick={() => void onRetryJob()}
                      disabled={
                        !workspaceInteractive || busyAction === "retry-job"
                      }
                    >
                      {busyAction === "retry-job"
                        ? "Retrying..."
                        : "Retry extraction"}
                    </Button>
                  ) : null}
                  {selectedJob &&
                  (selectedJob.status === "queued" ||
                    selectedJob.status === "running") ? (
                    <Button
                      variant="secondary"
                      onClick={() => void onCancelJob()}
                      disabled={
                        !workspaceInteractive || busyAction === "cancel-job"
                      }
                    >
                      {busyAction === "cancel-job"
                        ? "Cancelling..."
                        : "Cancel job"}
                    </Button>
                  ) : null}
                  {stage === "ready" || stage === "review" ? (
                    <>
                      {exportBlocked ? (
                        <SupportingText as="span" size="sm">
                          Export blocked until review is cleared.
                        </SupportingText>
                      ) : null}
                      <Button
                        variant="secondary"
                        onClick={() => void onExport("json")}
                        disabled={
                          !workspaceInteractive ||
                          exportBlocked ||
                          busyAction === "export-json"
                        }
                      >
                        {busyAction === "export-json"
                          ? "Exporting JSON..."
                          : "Export JSON"}
                      </Button>
                      <Button
                        variant="secondary"
                        onClick={() => void onExport("csv")}
                        disabled={
                          !workspaceInteractive ||
                          exportBlocked ||
                          busyAction === "export-csv"
                        }
                      >
                        {busyAction === "export-csv"
                          ? "Exporting CSV..."
                          : "Export CSV"}
                      </Button>
                      <Button
                        variant="secondary"
                        onClick={() => void onExport("excel")}
                        disabled={
                          !workspaceInteractive ||
                          exportBlocked ||
                          busyAction === "export-excel"
                        }
                      >
                        {busyAction === "export-excel"
                          ? "Exporting Excel..."
                          : "Export Excel"}
                      </Button>
                    </>
                  ) : null}
                  {(stage === "draft" || stage === "failed") &&
                  templates.length ? (
                    <Button
                      variant="primary"
                      onClick={() => void onRunExtraction()}
                      disabled={
                        !selectedDocument ||
                        !selectedTemplateVersion ||
                        !workspaceInteractive ||
                        !langExtractRunReadiness.ready ||
                        busyAction === "run"
                      }
                    >
                      {busyAction === "run" ? "Queueing..." : "Run extraction"}
                    </Button>
                  ) : null}
                </>
              }
            />

            {stage === "draft" ? (
              <div className="mt-4 grid grid-cols-3 gap-[0.85rem] max-[1280px]:grid-cols-1">
                <DetailTile
                  label="Document"
                  tone="subtle"
                  value={selectedDocument?.original_filename ?? "Choose a file"}
                  valueClassName="text-[0.95rem] tracking-[-0.02em]"
                />
                <DetailTile
                  label="Schema"
                  tone="subtle"
                  value={
                    selectedTemplateVersion?.version
                      ? `${selectedTemplate?.name ?? "Schema"} · ${selectedTemplateVersion.version}`
                      : templates.length
                        ? "Choose one schema"
                        : "Create a schema first"
                  }
                  valueClassName="text-[0.95rem] tracking-[-0.02em]"
                />
                <DetailTile
                  label="Next step"
                  tone="accent"
                  value={
                    !selectedDocument
                      ? "Upload a file"
                      : !langExtractRunReadiness.ready
                        ? "Complete LangExtract examples"
                        : selectedTemplateVersion
                          ? "Run extraction"
                          : templates.length
                            ? "Choose a schema"
                            : "Open schema builder"
                  }
                  valueClassName="text-[0.95rem] tracking-[-0.02em]"
                />
              </div>
            ) : null}

            {stage === "draft" && !langExtractRunReadiness.ready ? (
              <NoteCard className="mt-4 border-[rgba(208,70,86,0.2)] bg-[rgba(255,244,246,0.96)]">
                {langExtractRunReadiness.message}
              </NoteCard>
            ) : null}

            <div className="mt-4 grid items-start gap-4 [grid-template-columns:minmax(320px,0.95fr)_minmax(0,1.25fr)] max-[1280px]:grid-cols-1">
              <TitledSurface
                as="section"
                className="grid gap-4 p-[1.1rem]"
                tone="translucent"
                title="Source"
                subtitle="Keep the document, schema, and evidence together so the next action stays obvious."
              >
                {stage === "draft" ? (
                  <div className="grid gap-[0.9rem]">
                    <div className="grid min-h-[290px] place-items-center gap-[0.7rem] rounded-[var(--ds-radius-lg)] border border-dashed border-[rgba(var(--accent-rgb),0.36)] bg-[linear-gradient(180deg,rgba(247,249,255,0.95),rgba(255,255,255,0.95))] p-[1.3rem] text-center">
                      <div className="grid h-[58px] w-[58px] place-items-center rounded-[18px] bg-brand-soft text-[1.45rem] font-bold text-brand-strong">
                        ↑
                      </div>
                      <strong className="text-[1.08rem]">
                        Upload PDF or source file
                      </strong>
                      <p className="text-muted">
                        PDF, DOCX, JPG, PNG, TIFF, TXT
                      </p>
                      <Button
                        variant="primary"
                        onClick={() => uploadInputRef.current?.click()}
                        disabled={!workspaceInteractive}
                      >
                        {coreDataState === "loading"
                          ? "Loading workspace..."
                          : coreDataState === "unavailable"
                            ? "Reconnect backend to upload"
                            : "Choose file"}
                      </Button>
                      <span className="text-muted">
                        Stay in this workspace after upload. Do not get kicked
                        to another destination.
                      </span>
                      <input
                        ref={uploadInputRef}
                        type="file"
                        aria-label="Choose document file"
                        className="hidden"
                        disabled={!workspaceInteractive}
                        onChange={(event) => {
                          const file = event.target.files?.[0];
                          if (file) {
                            void onUpload(file);
                          }
                          event.currentTarget.value = "";
                        }}
                      />
                    </div>

                    <SummaryGrid gap="lg">
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
                    </SummaryGrid>

                    {documents.length > 1 ? (
                      <label>
                        <span>Recent sources</span>
                        <select
                          value={selectedDocumentId ?? ""}
                          disabled={!workspaceInteractive}
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
                      <FormGrid>
                        <label>
                          <span>Schema</span>
                          <select
                            value={selectedTemplate?.id ?? ""}
                            disabled={!workspaceInteractive}
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
                        <NoteCard density="compact" className="col-span-full">
                          <strong>Schema version</strong>
                          <p>
                            {selectedTemplateVersion
                              ? `Using ${selectedTemplateVersion.version}.`
                              : "The latest saved version will be used by default."}
                          </p>
                          {hasMultipleSchemaVersions ? (
                            <>
                              <InlineGroup className="mt-4">
                                <Badge tone="indigo">
                                  {selectedSchemaVersions.length} saved versions
                                </Badge>
                                <Button
                                  variant="text"
                                  disabled={!workspaceInteractive}
                                  aria-expanded={showVersionSelector}
                                  aria-controls="schema-version-panel"
                                  onClick={() =>
                                    setShowVersionSelector(
                                      (current) => !current,
                                    )
                                  }
                                >
                                  {showVersionSelector
                                    ? "Hide versions"
                                    : "Change version"}
                                </Button>
                              </InlineGroup>
                              {showVersionSelector ? (
                                <div id="schema-version-panel" className="mt-4">
                                  <label>
                                    <span>Schema version</span>
                                    <select
                                      aria-label="Schema version"
                                      value={selectedTemplateVersion?.id ?? ""}
                                      disabled={!workspaceInteractive}
                                      onChange={(event) =>
                                        onSelectTemplateVersion(
                                          parseOptionalId(event.target.value),
                                        )
                                      }
                                    >
                                      <option value="">Select version</option>
                                      {selectedSchemaVersions.map((version) => (
                                        <option
                                          key={version.id}
                                          value={version.id}
                                        >
                                          {version.version}
                                        </option>
                                      ))}
                                    </select>
                                  </label>
                                </div>
                              ) : null}
                            </>
                          ) : null}
                        </NoteCard>
                      </FormGrid>
                    ) : coreDataState === "loading" ? (
                      <NoteCard>
                        <strong>Loading workspace data...</strong>
                        <p>
                          Pulling schemas, documents, and job history into the
                          extraction workspace now.
                        </p>
                      </NoteCard>
                    ) : coreDataState === "unavailable" ? (
                      <NoteCard>
                        <strong>Workspace data unavailable</strong>
                        <p>
                          The local API is down, so schemas and saved document
                          history cannot load yet.
                        </p>
                        <InlineGroup className="mt-4">
                          <Button
                            variant="secondary"
                            onClick={() => void onRetryConnection()}
                          >
                            Retry connection
                          </Button>
                          <Button
                            variant="secondary"
                            size="sm"
                            onClick={onOpenHelp}
                          >
                            Open help
                          </Button>
                        </InlineGroup>
                      </NoteCard>
                    ) : (
                      <NoteCard>
                        <strong>No schemas yet</strong>
                        <p>
                          Create one reusable schema, then come straight back
                          here to run extraction on this document.
                        </p>
                        <InlineGroup className="mt-4">
                          <Button variant="secondary" onClick={onOpenSchemas}>
                            Open schema builder
                          </Button>
                          <Button
                            variant="secondary"
                            size="sm"
                            onClick={onOpenHelp}
                          >
                            Open help
                          </Button>
                        </InlineGroup>
                      </NoteCard>
                    )}
                  </div>
                ) : selectedResult ? (
                  <div className="grid gap-[0.9rem]">
                    <PanelCard tone="gradient">
                      <strong className="block">
                        {selectedDocument?.original_filename ??
                          "Selected document"}
                      </strong>
                      <p className="mt-[0.45rem] text-[0.92rem] text-muted">
                        {focusedField
                          ? "Source evidence should justify the field the user is editing."
                          : "No field is currently selected."}
                      </p>
                    </PanelCard>
                    {focusedField ? (
                      <SourceEvidencePanel field={focusedField} />
                    ) : null}
                    <ParsedTextPanel
                      documentId={selectedDocument?.id ?? null}
                      focusedField={focusedField}
                    />
                    <div className="grid gap-[0.7rem]">
                      {extractedFields.map((field) => (
                        <button
                          key={field.field_name}
                          type="button"
                          className={classNames(
                            "flex w-full items-start justify-between gap-4 rounded-[18px] border px-4 py-[0.95rem] text-left shadow-sm transition-colors",
                            focusedField?.field_name === field.field_name &&
                              "border-[rgba(77,96,255,0.28)] bg-[rgba(247,248,255,0.98)]",
                            focusedField?.field_name !== field.field_name &&
                              "border-[rgba(122,138,179,0.16)] bg-[rgba(255,255,255,0.92)]",
                          )}
                          aria-current={
                            focusedField?.field_name === field.field_name
                              ? "true"
                              : undefined
                          }
                          onClick={() => onSetFocusedField(field.field_name)}
                        >
                          <div>
                            <strong>{field.label}</strong>
                            <p className="mt-[0.35rem] text-[0.88rem] text-muted">
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
                  <div className="grid gap-[0.9rem]">
                    <PanelCard tone="gradient">
                      <strong className="block">
                        {selectedDocument?.original_filename ??
                          "Selected document"}
                      </strong>
                      <p className="mt-[0.45rem] text-[0.92rem] text-muted">
                        {selectedDocument
                          ? `${getDocumentTypeLabel(selectedDocument.content_type)} · uploaded ${formatTimestamp(selectedDocument.created_at)}`
                          : "Choose a document to begin."}
                      </p>
                    </PanelCard>
                    <ProgressList steps={progressSteps} />
                    {selectedJob?.error_message ? (
                      <NoteCard>
                        <strong>
                          {parserFailureGuidance?.title ?? "Failure detail"}
                        </strong>
                        <p>{selectedJob.error_message}</p>
                        {parserFailureGuidance ? (
                          <p>{parserFailureGuidance.detail}</p>
                        ) : null}
                        {parserStatus && parserFailureGuidance ? (
                          <p>
                            Parser runtime:{" "}
                            {parserStatus.docling_enabled
                              ? "Docling enabled"
                              : "Docling disabled"}
                            {parserStatus.prewarm_status
                              ? ` · prewarm ${parserStatus.prewarm_status}`
                              : ""}
                            .
                          </p>
                        ) : null}
                      </NoteCard>
                    ) : null}
                  </div>
                )}
              </TitledSurface>

              <TitledSurface
                as="section"
                className="grid gap-4 p-[1.1rem]"
                tone="translucent"
                title={
                  stage === "draft"
                    ? "Outcome preview"
                    : stage === "processing" || stage === "failed"
                      ? "Progress"
                      : stage === "review"
                        ? "Review only the exceptions"
                        : "Trusted result"
                }
                subtitle={
                  stage === "draft"
                    ? "The user should know what progress looks like before they press run."
                    : stage === "processing" || stage === "failed"
                      ? "This replaces the old Runs page. Status belongs inside the active job."
                      : stage === "review"
                        ? `${fieldsNeedingReview.length} fields need a human decision before export.`
                        : "The extraction finished cleanly. Export directly from the trusted result."
                }
              >
                {stage === "draft" ? (
                  <>
                    <SummaryGrid>
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
                    </SummaryGrid>
                    <NoteCard>
                      <strong>What happens next</strong>
                      <p>
                        Upload a PDF, keep the recommended schema unless it is
                        wrong, run extraction, then review only the uncertain
                        fields.
                      </p>
                    </NoteCard>
                    {selectedTemplateVersion ? (
                      <PreviewList>
                        {selectedTemplateVersion.definition.extracted_fields.map(
                          (field) => (
                            <PreviewRow
                              key={field.name}
                              token={field.label.charAt(0).toUpperCase()}
                              title={field.label}
                              subtitle={field.type}
                              meta={
                                <>
                                  <StatusBadge
                                    tone={field.required ? "info" : "warning"}
                                  >
                                    {field.required ? "Required" : "Optional"}
                                  </StatusBadge>
                                  {field.citation_required ? (
                                    <Badge tone="indigo">Citation</Badge>
                                  ) : null}
                                </>
                              }
                            />
                          ),
                        )}
                      </PreviewList>
                    ) : null}
                  </>
                ) : stage === "processing" || stage === "failed" ? (
                  <div
                    className="grid gap-[0.9rem]"
                    role={stage === "failed" ? "alert" : "status"}
                    aria-live={stage === "failed" ? "assertive" : "polite"}
                  >
                    <SummaryGrid>
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
                      {stage === "processing" ? (
                        <SummaryStat
                          label="Pipeline stage"
                          value={jobProgressLabel}
                          tone="warning"
                        />
                      ) : null}
                    </SummaryGrid>
                    {stage === "processing" ? (
                      <div className="grid gap-2">
                        <div className="flex items-center justify-between gap-3 text-[0.88rem] text-muted">
                          <span>{jobProgressLabel}</span>
                          <span>{jobProgressPct}%</span>
                        </div>
                        <div
                          className="h-2 overflow-hidden rounded-full bg-[rgba(122,138,179,0.18)]"
                          role="progressbar"
                          aria-valuenow={jobProgressPct}
                          aria-valuemin={0}
                          aria-valuemax={100}
                          aria-label="Extraction progress"
                        >
                          <div
                            className="h-full rounded-full bg-[linear-gradient(90deg,rgba(77,96,255,0.92),rgba(99,130,255,0.92))] transition-[width] duration-500"
                            style={{ width: `${jobProgressPct}%` }}
                          />
                        </div>
                      </div>
                    ) : null}
                    <ProgressList steps={progressSteps} />
                    <NoteCard>
                      <strong>
                        {stage === "failed"
                          ? "Recovery path"
                          : "Why this stays here"}
                      </strong>
                      <p>
                        {stage === "failed"
                          ? "Use Retry extraction to re-queue this job with the same document and schema."
                          : "Progress updates every few seconds while the worker parses, extracts, validates, and calculates."}
                      </p>
                    </NoteCard>
                  </div>
                ) : (
                  <>
                    <SummaryGrid>
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
                    </SummaryGrid>

                    {fieldsNeedingReview.length ? (
                      <div className="grid gap-4">
                        <div className="grid gap-[0.7rem]">
                          <div className="flex items-center justify-between gap-3">
                            <strong className="block">Needs review</strong>
                            <SupportingText as="span" size="sm">
                              {fieldsNeedingReview.length} fields
                            </SupportingText>
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
                            const highConfidence = isHighConfidenceField(field);
                            return (
                              <div
                                key={field.field_name}
                                className={classNames(
                                  "rounded-[var(--ds-radius-lg)] border px-4 py-[0.95rem] shadow-sm",
                                  focusedField?.field_name === field.field_name
                                    ? "border-[rgba(77,96,255,0.22)] bg-[rgba(247,248,255,0.98)]"
                                    : "border-border bg-[rgba(255,255,255,0.92)]",
                                )}
                              >
                                <SectionHeader className="gap-4">
                                  <div>
                                    <strong>{field.label}</strong>
                                    <SupportingText>
                                      {reviewSignals[0] ??
                                        "This field needs confirmation."}
                                    </SupportingText>
                                  </div>
                                  <InlineGroup>
                                    {highConfidence ? (
                                      <Badge tone="success">
                                        High confidence
                                      </Badge>
                                    ) : null}
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
                                  </InlineGroup>
                                </SectionHeader>
                                {reviewSignals.length ? (
                                  <div className="mt-[0.8rem]">
                                    <MetricLabel>Review signals</MetricLabel>
                                    <ul className="mt-[0.4rem] pl-[1.1rem] text-[0.88rem] text-muted">
                                      {reviewSignals.map((signal, index) => (
                                        <li
                                          key={signal}
                                          className={
                                            index > 0
                                              ? "mt-[0.32rem]"
                                              : undefined
                                          }
                                        >
                                          {signal}
                                        </li>
                                      ))}
                                    </ul>
                                  </div>
                                ) : null}
                                <FieldShell
                                  label="Review value"
                                  hint={reviewFieldHint(fieldType, definition)}
                                >
                                  <ReviewFieldEditor
                                    fieldLabel={field.label}
                                    fieldType={fieldType}
                                    draftValue={draftValue}
                                    definition={definition}
                                    onChange={(value) =>
                                      onSetReviewDraft(field.field_name, value)
                                    }
                                  />
                                </FieldShell>
                                <div className="mt-[0.55rem] grid gap-[0.18rem]">
                                  <SupportingText as="span" size="sm">
                                    Current value:{" "}
                                    {formatValue(
                                      field.normalized_value ??
                                        field.extracted_value,
                                    )}
                                  </SupportingText>
                                  <SupportingText as="span" size="sm">
                                    {field.page_number
                                      ? `Page ${field.page_number}`
                                      : "Page —"}{" "}
                                    ·{" "}
                                    {field.location_reference ||
                                      "Unknown location"}
                                  </SupportingText>
                                  <SupportingText as="span" size="sm">
                                    {formatCharInterval(field)}
                                  </SupportingText>
                                  <SupportingText as="span" size="sm">
                                    Confidence{" "}
                                    {formatConfidence(field.confidence_score)}
                                  </SupportingText>
                                </div>
                                <InlineGroup className="mt-4">
                                  <Button
                                    variant="text"
                                    onClick={() =>
                                      onSetFocusedField(field.field_name)
                                    }
                                  >
                                    Show source
                                  </Button>
                                  <Badge tone="neutral">{fieldType}</Badge>
                                </InlineGroup>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    ) : (
                      <NoteCard>
                        <strong>No manual review required</strong>
                        <p>
                          The result is already ready for export. Do not make
                          the user visit another page just to download it.
                        </p>
                      </NoteCard>
                    )}

                    {validatedFields.length ? (
                      <div className="grid gap-[0.7rem]">
                        <div className="flex items-center justify-between gap-3">
                          <strong className="block">Looks good</strong>
                          <SupportingText as="span" size="sm">
                            {validatedFields.length} fields
                          </SupportingText>
                        </div>
                        <PreviewList>
                          {validatedFields.slice(0, 6).map((field) => (
                            <PreviewRow
                              key={field.field_name}
                              token={field.label.charAt(0).toUpperCase()}
                              title={field.label}
                              subtitle={formatValue(
                                field.normalized_value ?? field.extracted_value,
                              )}
                              meta={
                                <StatusBadge tone="success">Valid</StatusBadge>
                              }
                            />
                          ))}
                        </PreviewList>
                      </div>
                    ) : null}

                    {calculatedFields.length ? (
                      <div className="grid gap-[0.7rem]">
                        <div className="flex items-center justify-between gap-3">
                          <strong className="block">Calculated fields</strong>
                          <SupportingText as="span" size="sm">
                            {calculatedFields.length}
                          </SupportingText>
                        </div>
                        <PreviewList>
                          {calculatedFields.map((field) => (
                            <PreviewRow
                              key={field.field_name}
                              token={field.label.charAt(0).toUpperCase()}
                              title={field.label}
                              subtitle={formatValue(field.calculated_value)}
                              meta={
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
                              }
                            />
                          ))}
                        </PreviewList>
                      </div>
                    ) : null}

                    <div className="grid gap-[0.7rem]">
                      <div className="flex items-center justify-between gap-3">
                        <strong className="block">Export history</strong>
                        <SupportingText as="span" size="sm">
                          {exportHistory.length}
                        </SupportingText>
                      </div>
                      {exportHistory.length ? (
                        <PreviewList>
                          {exportHistory.map((record) => (
                            <PreviewRow
                              key={record.id}
                              token={record.export_format
                                .charAt(0)
                                .toUpperCase()}
                              title={basename(record.file_path)}
                              subtitle={
                                record.content_sha256
                                  ? `${formatTimestamp(record.created_at)} · SHA-256 ${record.content_sha256.slice(0, 12)}…`
                                  : formatTimestamp(record.created_at)
                              }
                              meta={
                                <a
                                  className="font-semibold text-brand-strong"
                                  href={`${API_BASE}/exports/${record.id}/download`}
                                  target="_blank"
                                  rel="noreferrer"
                                >
                                  Download
                                </a>
                              }
                            />
                          ))}
                        </PreviewList>
                      ) : (
                        <NoteCard density="compact">
                          <strong>No exports yet</strong>
                          <p>
                            Exports should be available from this result, not
                            hidden behind another destination.
                          </p>
                        </NoteCard>
                      )}
                    </div>
                  </>
                )}
              </TitledSurface>
            </div>
          </Surface>
        </div>
      </div>
    </PageStack>
  );
}

function SettingsPage({
  provider,
  parserStatus,
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
  onOpenAudit,
  onOpenHelp,
  exportPolicy,
  onSetExportPolicy,
}: {
  provider: ProviderSettings | null;
  parserStatus: ParserStatus | null;
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
  onOpenAudit: () => void;
  onOpenHelp: () => void;
  exportPolicy: ExportPolicy;
  onSetExportPolicy: (requireReviewCleared: boolean) => Promise<void>;
}) {
  const savedCustomProfiles = customProfiles ?? [];
  const probeMaxAgeHours =
    providerControls.custom_provider_probe_max_age_hours ||
    DEFAULT_CUSTOM_PROVIDER_PROBE_MAX_AGE_HOURS;
  const customProviderIsActive = Boolean(
    provider &&
    !providerCatalog.some(
      (item) =>
        item.settings.provider_type === provider.provider_type &&
        item.settings.model === provider.model,
    ),
  );
  const customDraftChanged =
    JSON.stringify(customProviderDraft) !==
    JSON.stringify(DEFAULT_CUSTOM_PROVIDER_DRAFT);
  const [showCustomProviderDetails, setShowCustomProviderDetails] = useState(
    () =>
      customProviderIsActive ||
      customDraftChanged ||
      Boolean(selectedCustomProfileId) ||
      Boolean(probeResults[CUSTOM_PROVIDER_KEY]),
  );
  const [expandedProviderKey, setExpandedProviderKey] = useState<string | null>(
    null,
  );

  useEffect(() => {
    if (
      customProviderIsActive ||
      customDraftChanged ||
      Boolean(selectedCustomProfileId) ||
      Boolean(probeResults[CUSTOM_PROVIDER_KEY])
    ) {
      setShowCustomProviderDetails(true);
    }
  }, [
    customDraftChanged,
    customProviderIsActive,
    probeResults,
    selectedCustomProfileId,
  ]);

  return (
    <PageStack>
      <PageIntro>
        <PageHeader
          eyebrow="Settings"
          title="Confirm the current runtime, change it only if this workflow needs something else."
          description="This page should answer one question fast: keep the default provider, or switch to a different runtime or private endpoint."
        />
      </PageIntro>

      {isBootstrapMockProvider(provider) ? (
        <NoteCard className="border-[rgba(214,158,0,0.28)] bg-[rgba(255,249,235,0.98)]">
          <strong>Mock extractor is not for production</strong>
          <p>
            The bootstrap mock provider validates the upload → review → export
            workflow without a live model. Company deployments should activate
            Ollama, LangExtract, or another catalog provider below.
          </p>
        </NoteCard>
      ) : null}

      <TitledSurface
        as="section"
        title="Export policy"
        subtitle="Optional guardrail for operators who must clear review before exporting."
      >
        <label className="flex items-start gap-3 text-[0.95rem]">
          <input
            type="checkbox"
            checked={exportPolicy.require_review_cleared}
            onChange={(event) => void onSetExportPolicy(event.target.checked)}
          />
          <span>
            Block exports while fields still require review. The server rejects
            export requests until review is saved.
          </span>
        </label>
      </TitledSurface>

      <TitledSurface
        as="section"
        title="Current defaults"
        subtitle="Start here. If these match the job, leave this page."
      >
        <SummaryGrid columns="four" gap="lg">
          {[
            [
              "Provider mode",
              provider?.mode === "cloud" ? "Cloud-assisted" : "Local",
            ],
            [
              "Default provider",
              provider?.provider_label ??
                provider?.provider_type ??
                "Not configured",
            ],
            ["Default model", provider?.model ?? "Not configured"],
            ["Profile reverify threshold", `${probeMaxAgeHours} hours`],
            [
              "Privacy mode",
              provider?.allow_external_processing
                ? "Cloud allowed"
                : "Local-only by default",
            ],
          ].map(([label, value]) => (
            <SummaryStat key={label} label={label} value={value} />
          ))}
        </SummaryGrid>
      </TitledSurface>

      <TitledSurface
        as="section"
        title="Document parser runtime"
        subtitle="This controls whether PDF, DOCX, PPTX, HTML, and image files can be parsed before extraction starts."
      >
        <SummaryGrid columns="four" gap="lg">
          <SummaryStat
            label="Parser runtime"
            value={
              parserStatus?.docling_enabled ? "Docling enabled" : "Disabled"
            }
            tone={parserStatus?.docling_enabled ? "success" : "danger"}
          />
          <SummaryStat
            label="Worker state"
            value={parserStatus?.state ?? "Unknown"}
            tone={
              parserStatus?.state === "failed"
                ? "danger"
                : parserStatus?.state === "running"
                  ? "warning"
                  : "default"
            }
          />
          <SummaryStat
            label="PDF OCR retry"
            value={parserStatus?.docling_pdf_ocr_retry ? "Enabled" : "Disabled"}
          />
          <SummaryStat
            label="Image OCR"
            value={parserStatus?.docling_image_ocr ? "Enabled" : "Disabled"}
          />
          <SummaryStat
            label="Prewarm"
            value={
              parserStatus?.prewarm_status
                ? parserStatus.prewarm_status
                : parserStatus?.docling_prewarm
                  ? "Configured"
                  : "Disabled"
            }
          />
          <SummaryStat
            label="Last worker update"
            value={formatTimestamp(parserStatus?.timestamp)}
          />
        </SummaryGrid>
        <DetailPair
          className="mt-4 gap-[0.28rem]"
          label="Supported document classes"
          value={
            parserStatus?.supported_classes?.join(" • ") ||
            "PDF • DOCX • PPTX • HTML • Images • CSV • Excel • Plain text • Markdown"
          }
          labelTone="muted"
        />
        <DetailPair
          className="gap-[0.28rem]"
          label="Docling-backed file extensions"
          value={
            parserStatus?.supported_extensions?.join(" ") ||
            ".pdf .docx .pptx .html .htm .png .jpg .jpeg .tiff"
          }
          labelTone="muted"
        />
        {parserStatus?.prewarm_error ? (
          <NoteCard className="mt-4">
            <strong>Parser prewarm warning</strong>
            <p>{parserStatus.prewarm_error}</p>
          </NoteCard>
        ) : null}
      </TitledSurface>

      <TitledSurface
        as="section"
        title="Provider presets"
        subtitle="Only switch providers when the current defaults are wrong for this document policy or runtime."
      >
        {providerCatalog.length ? (
          <div className="grid gap-5 [grid-template-columns:repeat(2,minmax(0,1fr))] max-[1280px]:grid-cols-1">
            {providerCatalog.map((item) => {
              const selected =
                provider?.provider_type === item.settings.provider_type &&
                provider?.model === item.settings.model;
              const health = providerHealth[item.key];
              const probe = probeResults[item.key];
              const statusLabel = selected
                ? "Default"
                : health?.ready
                  ? "Ready"
                  : health?.status === "probe_required"
                    ? "Probe required"
                    : item.recommended
                      ? "Recommended"
                      : item.enabled
                        ? "Available"
                        : "Disabled";
              const statusTone = selected
                ? "info"
                : health?.ready
                  ? "success"
                  : health?.status === "probe_required"
                    ? "warning"
                    : item.recommended
                      ? "indigo"
                      : item.enabled
                        ? "neutral"
                        : "danger";
              const detailsVisible = expandedProviderKey === item.key;
              return (
                <PanelCard
                  as="section"
                  key={item.key}
                  tone="panel"
                  spacing="spacious"
                  className="rounded-[var(--ds-radius-lg)]"
                >
                  <SectionHeader className="gap-4">
                    <div>
                      <ProviderModeBadge
                        className="mb-[0.55rem]"
                        mode={item.mode}
                      />
                      <h3 className="block">{item.label}</h3>
                    </div>
                    <StatusBadge tone={statusTone}>{statusLabel}</StatusBadge>
                  </SectionHeader>
                  <div className="grid gap-[0.85rem]">
                    <p className="text-[0.92rem] text-muted">
                      {item.description}
                    </p>
                    <DetailPair label="Model" value={item.model} />
                    <DetailPair
                      label="Document handling"
                      value={
                        item.settings.allow_external_processing
                          ? "Cloud processing allowed"
                          : "Local-only processing"
                      }
                    />
                    <DetailPair
                      label="Runtime"
                      value={
                        item.mode === "local"
                          ? "Runs against a local endpoint"
                          : "Runs against a remote endpoint"
                      }
                    />
                    {detailsVisible ? (
                      <div
                        id={`provider-details-${item.key}`}
                        className="grid gap-[0.8rem] rounded-[16px] border border-subtle bg-muted p-[0.9rem]"
                      >
                        <DetailPair
                          label="Base URL"
                          value={item.base_url ?? "No network endpoint"}
                        />
                        {item.settings.deployment ? (
                          <DetailPair
                            label="Deployment"
                            value={item.settings.deployment}
                          />
                        ) : null}
                        <DetailPair
                          label="API key"
                          value={
                            item.capabilities.requires_api_key
                              ? `Via ${item.api_key_env_var}`
                              : "Not required"
                          }
                        />
                        <DetailPair
                          label="Readiness"
                          value={
                            health
                              ? health.checks.join(" • ")
                              : "No health data loaded"
                          }
                        />
                        <DetailPair
                          label="Latest probe"
                          value={
                            probe
                              ? `${probe.reachable ? "Reachable" : "Not reachable"}${probe.status_code ? ` (HTTP ${probe.status_code})` : ""}: ${probe.detail}`
                              : "No live probe run"
                          }
                        />
                      </div>
                    ) : null}
                  </div>
                  <div className="flex flex-wrap items-center gap-[0.55rem]">
                    <Button
                      variant="primary"
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
                    </Button>
                    <Button
                      variant="secondary"
                      onClick={() => void onProbeProvider(item)}
                      disabled={busyAction === `probe-${item.key}`}
                    >
                      {busyAction === `probe-${item.key}`
                        ? "Probing..."
                        : "Probe"}
                    </Button>
                    <Button
                      variant="tertiary"
                      size="sm"
                      aria-expanded={detailsVisible}
                      aria-controls={`provider-details-${item.key}`}
                      onClick={() =>
                        setExpandedProviderKey((current) =>
                          current === item.key ? null : item.key,
                        )
                      }
                    >
                      {detailsVisible ? "Hide details" : "Show details"}
                    </Button>
                  </div>
                </PanelCard>
              );
            })}
          </div>
        ) : (
          <NoteCard density="compact">
            <strong>No provider presets available right now</strong>
            <p>
              Provider presets load from the backend. Retry once the local API
              is reachable.
            </p>
          </NoteCard>
        )}
      </TitledSurface>

      <TitledSurface
        as="section"
        title="Advanced provider profiles"
        subtitle="Keep private endpoints and raw provider plumbing out of the everyday settings path."
      >
        <NoteCard density="compact">
          <strong>Private endpoints and saved custom profiles</strong>
          <p>
            Open this only when you need to register a private OpenAI-compatible
            or Azure endpoint.
          </p>
          <InlineGroup className="mt-4">
            <Badge tone="neutral">
              {savedCustomProfiles.length} saved
              {savedCustomProfiles.length === 1 ? " profile" : " profiles"}
            </Badge>
            {customProviderIsActive ? (
              <StatusBadge tone="info">Custom provider active</StatusBadge>
            ) : null}
            {customDraftChanged ? (
              <StatusBadge tone="warning">Draft edited</StatusBadge>
            ) : null}
            <Button
              variant="secondary"
              aria-expanded={showCustomProviderDetails}
              aria-controls="advanced-provider-profiles-panel"
              onClick={() =>
                setShowCustomProviderDetails((current) => !current)
              }
            >
              {showCustomProviderDetails
                ? "Hide advanced provider profiles"
                : "Open advanced provider profiles"}
            </Button>
          </InlineGroup>
        </NoteCard>
        {showCustomProviderDetails ? (
          <div id="advanced-provider-profiles-panel">
            <FormGrid className="mt-4">
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
              <label className="col-span-full">
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
                    allow_external_processing:
                      !current.allow_external_processing,
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
            </FormGrid>
            <DetailPair
              className="mt-4 gap-[0.28rem]"
              label="Current draft probe"
              value={
                probeResults[CUSTOM_PROVIDER_KEY]
                  ? `${probeResults[CUSTOM_PROVIDER_KEY].reachable ? "Reachable" : "Not reachable"}: ${probeResults[CUSTOM_PROVIDER_KEY].detail}`
                  : "No live probe run"
              }
              labelTone="muted"
            />
            <InlineGroup className="mt-4">
              <Button
                variant="secondary"
                onClick={() => void onSaveCustomProfile()}
                disabled={busyAction === "save-custom-profile"}
              >
                {busyAction === "save-custom-profile"
                  ? "Saving profile..."
                  : selectedCustomProfileId
                    ? "Update saved profile"
                    : "Save profile"}
              </Button>
              <Button
                variant="primary"
                onClick={() => void onSetCustomProvider()}
                disabled={busyAction === "save-provider"}
              >
                {busyAction === "save-provider"
                  ? "Saving..."
                  : "Set custom provider as default"}
              </Button>
              <Button
                variant="secondary"
                onClick={() => void onProbeCustomProvider()}
                disabled={busyAction === `probe-${CUSTOM_PROVIDER_KEY}`}
              >
                {busyAction === `probe-${CUSTOM_PROVIDER_KEY}`
                  ? "Probing..."
                  : "Probe custom provider"}
              </Button>
            </InlineGroup>
            {savedCustomProfiles.length ? (
              <div className="mt-4 grid gap-5 [grid-template-columns:repeat(2,minmax(0,1fr))] max-[1280px]:grid-cols-1">
                {savedCustomProfiles.map((profile) => {
                  const profileProbeIsStale = customProviderProfileProbeIsStale(
                    profile,
                    probeMaxAgeHours,
                  );
                  return (
                    <PanelCard
                      as="section"
                      key={profile.id}
                      tone="panel"
                      spacing="spacious"
                      className="rounded-[var(--ds-radius-lg)]"
                    >
                      <SectionHeader className="gap-4">
                        <div>
                          <ProviderModeBadge
                            className="mb-[0.55rem]"
                            mode={profile.settings.mode}
                          />
                          <h3 className="block">{profile.name}</h3>
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
                      </SectionHeader>
                      <div className="grid gap-[0.85rem]">
                        <DetailPair
                          label="Provider type"
                          value={profile.settings.provider_type}
                        />
                        <DetailPair
                          label="Model"
                          value={profile.settings.model}
                        />
                        <DetailPair
                          label="Updated"
                          value={new Date(profile.updated_at).toLocaleString()}
                        />
                        <DetailPair
                          label="Last verified"
                          value={
                            profile.last_probe_at
                              ? `${formatTimestamp(profile.last_probe_at)}${profileProbeIsStale ? ` (${probeMaxAgeHours}h threshold exceeded)` : ""}`
                              : "No successful probe recorded"
                          }
                        />
                        <DetailPair
                          label="Probe status"
                          value={
                            profile.last_probe_status &&
                            profile.last_probe_detail
                              ? `${profile.last_probe_status}: ${profile.last_probe_detail}`
                              : "No successful probe recorded"
                          }
                        />
                      </div>
                      <InlineGroup>
                        <Button
                          variant="secondary"
                          onClick={() => onLoadCustomProfile(profile)}
                        >
                          Load into form
                        </Button>
                        <Button
                          variant="secondary"
                          onClick={() => void onReverifyCustomProfile(profile)}
                          disabled={busyAction === `reverify-${profile.id}`}
                        >
                          {busyAction === `reverify-${profile.id}`
                            ? "Reverifying..."
                            : "Reverify"}
                        </Button>
                        <Button
                          variant="primary"
                          onClick={() => void onActivateCustomProfile(profile)}
                          disabled={busyAction === `activate-${profile.id}`}
                        >
                          {busyAction === `activate-${profile.id}`
                            ? "Activating..."
                            : "Activate default"}
                        </Button>
                        <Button
                          variant="secondary"
                          onClick={() => void onDeleteCustomProfile(profile)}
                          disabled={busyAction === `delete-${profile.id}`}
                        >
                          {busyAction === `delete-${profile.id}`
                            ? "Deleting..."
                            : "Delete"}
                        </Button>
                      </InlineGroup>
                    </PanelCard>
                  );
                })}
              </div>
            ) : null}
          </div>
        ) : null}
      </TitledSurface>

      <TitledSurface
        as="section"
        title="Support and history"
        subtitle="Use these only when you need to investigate or get unstuck."
      >
        <InlineGroup>
          <Button variant="secondary" onClick={onOpenAudit}>
            Open audit history
          </Button>
          <Button variant="secondary" onClick={onOpenHelp}>
            Open help
          </Button>
        </InlineGroup>
      </TitledSurface>

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
    </PageStack>
  );
}

function formatAuditTimestamp(value: string) {
  return new Date(value).toLocaleString();
}

function formatAuditAction(action: string) {
  return action.replace(/\./g, " · ");
}

function AuditPage({ onOpenJob }: { onOpenJob: (jobId: number) => void }) {
  const [events, setEvents] = useState<AuditEventRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function loadEvents() {
      setLoading(true);
      setError(null);
      try {
        const payload = await readJson<{ events: AuditEventRecord[] }>(
          "/audit/events?limit=100",
        );
        if (!cancelled) {
          setEvents(payload.events);
        }
      } catch (loadError) {
        if (!cancelled) {
          setError(
            loadError instanceof Error
              ? loadError.message
              : "Could not load audit events.",
          );
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }
    void loadEvents();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <PageStack>
      <PageIntro>
        <PageHeader
          eyebrow="Audit"
          title="See what happened to a document after upload, review, recalculation, and export."
        />
      </PageIntro>
      <TitledSurface
        as="section"
        title="Recent activity"
        subtitle="Live audit trail backed by the API — uploads, review edits, job transitions, and exports."
      >
        <div className="mb-4 grid items-center gap-4 [grid-template-columns:minmax(180px,240px)_minmax(0,1fr)] max-[1080px]:grid-cols-1">
          <SummaryStat
            label="Recorded events"
            value={loading ? "…" : events.length}
            tone="accent"
          />
          <p className="m-0 text-sm text-muted">
            Uploads, review edits, recalculations, and exports should read like
            one coherent timeline.
          </p>
        </div>
        {loading ? (
          <SupportingText as="p" size="sm">
            Loading audit events…
          </SupportingText>
        ) : null}
        {error ? (
          <SupportingText as="p" size="sm" className="text-[#b42318]">
            {error}
          </SupportingText>
        ) : null}
        {!loading && !error && events.length === 0 ? (
          <SupportingText as="p" size="sm">
            No audit events yet. Upload a document and run an extraction to
            start the trail.
          </SupportingText>
        ) : null}
        {events.length ? (
          <div className="overflow-auto rounded-[var(--ds-radius-lg)] border border-subtle bg-panel shadow-sm">
            <table className="min-w-[760px] w-full border-collapse">
              <thead>
                <tr>
                  <TableHeaderCell>Timestamp</TableHeaderCell>
                  <TableHeaderCell>User</TableHeaderCell>
                  <TableHeaderCell>Action</TableHeaderCell>
                  <TableHeaderCell>Object</TableHeaderCell>
                  <TableHeaderCell>Details</TableHeaderCell>
                </tr>
              </thead>
              <tbody>
                {events.map((row) => {
                  const jobId =
                    typeof row.metadata.job_id === "number"
                      ? row.metadata.job_id
                      : null;
                  const objectLabel =
                    typeof row.metadata.original_filename === "string"
                      ? row.metadata.original_filename
                      : row.object_type;
                  const details =
                    typeof row.metadata.reason === "string"
                      ? row.metadata.reason
                      : typeof row.metadata.content_sha256 === "string"
                        ? `SHA-256 ${row.metadata.content_sha256.slice(0, 12)}…`
                        : Array.isArray(row.metadata.field_names)
                          ? `Fields: ${row.metadata.field_names.join(", ")}`
                          : row.action;
                  return (
                    <tr
                      key={row.id}
                      className="hover:bg-[rgba(var(--accent-rgb),0.04)]"
                    >
                      <TableDataCell>
                        {formatAuditTimestamp(row.created_at)}
                      </TableDataCell>
                      <TableDataCell>{row.actor}</TableDataCell>
                      <TableDataCell>
                        <span className="inline-flex items-center rounded-full bg-[rgba(var(--accent-rgb),0.08)] px-[0.72rem] py-[0.28rem] text-[var(--text-xs)] font-bold text-brand-strong">
                          {formatAuditAction(row.action)}
                        </span>
                      </TableDataCell>
                      <TableDataCell>
                        {jobId ? (
                          <button
                            type="button"
                            className="underline"
                            onClick={() => onOpenJob(jobId)}
                          >
                            {objectLabel}
                          </button>
                        ) : (
                          objectLabel
                        )}
                      </TableDataCell>
                      <TableDataCell>{details}</TableDataCell>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : null}
      </TitledSurface>
    </PageStack>
  );
}

function HelpPage({
  onOpenExtractions,
  onOpenSchemas,
  onOpenSettings,
}: {
  onOpenExtractions: () => void;
  onOpenSchemas: () => void;
  onOpenSettings: () => void;
}) {
  return (
    <PageStack>
      <PageIntro>
        <PageHeader
          eyebrow="Help"
          title="Get the next step when setup, review, or evidence is unclear."
        />
      </PageIntro>
      <TitledSurface
        as="section"
        title="Jump to the right surface"
        subtitle="Use help to get unstuck, then leave it."
      >
        <InlineGroup>
          <Button variant="primary" onClick={onOpenExtractions}>
            Open extraction workspace
          </Button>
          <Button variant="secondary" onClick={onOpenSchemas}>
            Open schema builder
          </Button>
          <Button variant="secondary" onClick={onOpenSettings}>
            Open settings
          </Button>
        </InlineGroup>
      </TitledSurface>
      <div className="grid grid-cols-12 gap-5">
        <TitledSurface
          as="section"
          className="col-span-6 max-[1280px]:col-span-12"
          title="Getting started"
        >
          <div className="grid gap-[0.8rem]">
            <NoteCard>
              <strong>First schema missing?</strong>
              <p>
                Create one reusable extraction schema, then return to the
                extraction workspace.
              </p>
            </NoteCard>
            <NoteCard>
              <strong>Review is for exceptions</strong>
              <p>
                The app should let the model extract first, then ask a human
                only for the uncertain fields.
              </p>
            </NoteCard>
            <NoteCard>
              <strong>Why source evidence matters</strong>
              <p>
                Users trust extraction when the cited snippet makes the decision
                easy.
              </p>
            </NoteCard>
          </div>
        </TitledSurface>
        <TitledSurface
          as="section"
          className="col-span-6 max-[1280px]:col-span-12"
          title="Supported concepts"
        >
          <div className="grid gap-[0.8rem]">
            {helpTopics.map((item) => (
              <NoteCard key={item} density="compact">
                <strong>{item}</strong>
              </NoteCard>
            ))}
          </div>
        </TitledSurface>
      </div>
    </PageStack>
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
  const [parserStatus, setParserStatus] = useState<ParserStatus | null>(null);
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
  const [coreDataState, setCoreDataState] = useState<
    "loading" | "ready" | "unavailable"
  >("loading");
  const [apiUnavailable, setApiUnavailable] = useState(false);
  const [mockProviderWarningDismissed, setMockProviderWarningDismissed] =
    useState(() => readMockProviderWarningDismissed());
  const [desktopStatus, setDesktopStatus] = useState<DesktopStatus | null>(
    null,
  );
  const [desktopLogs, setDesktopLogs] = useState<DesktopLogs | null>(null);
  const [desktopOnboardingDismissed, setDesktopOnboardingDismissed] =
    useState(false);
  const [workspaceSeeded, setWorkspaceSeeded] = useState(false);
  const [jobStatusFilter, setJobStatusFilter] = useState<string | null>(
    () => parseWorkspaceSearch(window.location.search).status,
  );
  const [exportPolicy, setExportPolicy] = useState<ExportPolicy>({
    require_review_cleared: false,
  });

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
      setDevStatus(null);
      setCoreDataState("unavailable");
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
      parserStatusData,
      customProfilesData,
      statusData,
      exportPolicyData,
    ] = await Promise.allSettled([
      readJson<TemplateSummary[]>("/templates"),
      readJson<DocumentRecord[]>("/documents"),
      readJson<JobRecord[]>("/jobs"),
      readJson<ExportRecord[]>("/exports"),
      readJson<ProviderSettings | null>("/settings/provider"),
      readJson<{ providers: ProviderCatalogEntry[] }>("/settings/providers"),
      readJson<ProviderHealth[]>("/settings/providers/health"),
      readJson<ProviderControls>("/settings/providers/controls"),
      readJson<ParserStatus>("/settings/parser-status"),
      readJson<{ profiles: CustomProviderProfile[] }>(
        "/settings/providers/custom",
      ),
      readJson<DevStatus>("/dev/status"),
      readJson<ExportPolicy>("/settings/export-policy"),
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
    setParserStatus(
      parserStatusData.status === "fulfilled" ? parserStatusData.value : null,
    );
    setCustomProfiles(
      customProfilesData.status === "fulfilled" &&
        Array.isArray(customProfilesData.value.profiles)
        ? customProfilesData.value.profiles
        : [],
    );
    setDevStatus(statusData.status === "fulfilled" ? statusData.value : null);
    if (exportPolicyData.status === "fulfilled") {
      setExportPolicy(exportPolicyData.value);
    }

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
    setCoreDataState("ready");

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
    setMockProviderWarningDismissed(readMockProviderWarningDismissed());
  }, []);

  const showMockProviderWarning =
    !apiUnavailable &&
    isBootstrapMockProvider(provider) &&
    !mockProviderWarningDismissed;

  const selectedResultForExport = selectedJobId
    ? (resultsByJob[selectedJobId] ?? null)
    : null;
  const exportBlocked =
    exportPolicy.require_review_cleared &&
    Boolean(
      selectedResultForExport?.result.fields_requiring_review.length ?? 0,
    );

  function handleJobStatusFilterChange(status: string | null) {
    setJobStatusFilter(status);
    replaceWorkspaceUrl({
      jobId: selectedJobId,
      resultId: selectedResultForExport?.result_id ?? null,
      status,
    });
  }

  async function handleSetExportPolicy(requireReviewCleared: boolean) {
    try {
      setBusyAction("save-export-policy");
      const updated = await readJson<ExportPolicy>("/settings/export-policy", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          require_review_cleared: requireReviewCleared,
        }),
      });
      setExportPolicy(updated);
      setBanner({
        tone: "success",
        message: requireReviewCleared
          ? "Exports now require cleared review."
          : "Export review gate disabled.",
      });
    } catch (error) {
      setBanner({
        tone: "error",
        message:
          error instanceof Error
            ? error.message
            : "Could not save export policy.",
      });
    } finally {
      setBusyAction(null);
    }
  }

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    writePersistedCustomProviderDraft(customProviderDraft);
  }, [customProviderDraft]);

  const hasActiveJobs = jobs.some(
    (job) => job.status === "queued" || job.status === "running",
  );

  useEffect(() => {
    const pollMs = hasActiveJobs ? 2000 : 7000;
    const interval = window.setInterval(() => {
      void refreshCoreData();
      if (isTauriRuntime()) {
        void refreshDesktopStatus();
      }
    }, pollMs);
    return () => window.clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasActiveJobs]);

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
  const draftTemplateDefinition = useMemo(
    () =>
      buildDraftTemplateDefinitionSafe(
        draftTemplate,
        provider,
        currentTemplateDefinition ?? starterTemplateDefinition,
      ),
    [currentTemplateDefinition, draftTemplate, provider],
  );
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
  const workspaceBusy =
    busyAction === "upload" ||
    busyAction === "run" ||
    busyAction === "save-review" ||
    busyAction?.startsWith("export-") === true;

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
    const templateVersion = templateVersions.find(
      (item) => item.id === selectedTemplateVersionId,
    );
    if (templateVersion) {
      const readiness = getLangExtractExtractionReadiness(
        templateVersion.definition,
        provider?.is_persisted_default && isLangExtractProvider(provider)
          ? provider
          : null,
      );
      if (!readiness.ready) {
        setBanner({
          tone: "error",
          message:
            readiness.message ??
            "Complete LangExtract examples in the schema builder before running extraction.",
        });
        return;
      }
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
      replaceWorkspaceUrl({
        jobId,
        resultId: result?.result_id ?? null,
        status: jobStatusFilter,
      });
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
    [jobs, resultsByJob, templateVersions, jobStatusFilter],
  );

  useEffect(() => {
    const urlState = parseWorkspaceSearch(window.location.search);
    if (urlState.status !== jobStatusFilter) {
      setJobStatusFilter(urlState.status);
    }
    if (!jobs.length || workspaceSeeded) {
      return;
    }
    const targetJobId =
      urlState.jobId ??
      (urlState.resultId
        ? (jobs.find(
            (job) => resultsByJob[job.id]?.result_id === urlState.resultId,
          )?.id ?? null)
        : null);
    if (targetJobId && targetJobId !== selectedJobId) {
      syncJobSelection(targetJobId);
      setWorkspaceSeeded(true);
    }
  }, [
    jobs,
    jobStatusFilter,
    resultsByJob,
    selectedJobId,
    syncJobSelection,
    workspaceSeeded,
  ]);

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

  function buildReviewEditsForResult(
    result: ResultPayload,
    templateDefinition: TemplateDefinition | null,
  ) {
    return result.extracted_fields
      .map((field) => {
        const draft =
          reviewDrafts[field.field_name] ??
          getInitialReviewDraft(
            field,
            getFieldDefinition(templateDefinition, field.field_name),
          );
        const parsed = parseReviewDraft(
          field,
          draft,
          getFieldDefinition(templateDefinition, field.field_name),
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
  }

  async function submitReview(
    options: {
      approve_high_confidence_min?: number;
      approveOnly?: boolean;
    } = {},
  ) {
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
      const edits = options.approveOnly
        ? []
        : buildReviewEditsForResult(selectedResult.result, definition);

      const updatedResult = await readJson<ResultPayload>(
        `/results/${selectedResult.result_id}/review`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            reviewer: "local-ui",
            edits,
            recalculate: true,
            approve_high_confidence_min: options.approve_high_confidence_min,
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
                  ? "Review saved and formulas recalculated. 1 reusable grounded example is ready for this schema."
                  : `Review saved and formulas recalculated. ${feedback.suggestions.length} reusable grounded examples are ready for this schema.`,
              actionLabel: "Open schema draft",
              onAction: () => openSchemaDraft(reviewedTemplateVersionId),
            });
            return;
          }
        }
      }
      setBanner({
        tone: "success",
        message: "Review saved and formulas recalculated.",
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

  async function handleSaveReview() {
    await submitReview();
  }

  async function handleApproveAllReview() {
    await submitReview({ approveOnly: true });
  }

  async function handleApproveHighConfidenceReview() {
    await submitReview({
      approveOnly: true,
      approve_high_confidence_min: REVIEW_HIGH_CONFIDENCE_MIN,
    });
  }

  async function handleRetryJob() {
    if (!selectedJobId) {
      return;
    }
    try {
      setBusyAction("retry-job");
      const retried = await readJson<JobRecord>(
        `/jobs/${selectedJobId}/retry`,
        { method: "POST" },
      );
      await refreshCoreData();
      setSelectedJobId(retried.id);
      setFocusedFieldName(null);
      setBanner({
        tone: "success",
        message: "Failed extraction re-queued. Progress will update here.",
      });
    } catch (error) {
      setBanner({
        tone: "error",
        message:
          error instanceof Error
            ? error.message
            : "Could not retry extraction job.",
      });
    } finally {
      setBusyAction(null);
    }
  }

  async function handleCancelJob() {
    if (!selectedJobId) {
      return;
    }
    try {
      setBusyAction("cancel-job");
      await readJson<JobRecord>(`/jobs/${selectedJobId}/cancel`, {
        method: "POST",
      });
      await refreshCoreData();
      setBanner({
        tone: "success",
        message: "Extraction job cancelled.",
      });
    } catch (error) {
      setBanner({
        tone: "error",
        message:
          error instanceof Error ? error.message : "Could not cancel job.",
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
      const payload = await readJson<{
        export_id: number;
        content_sha256?: string;
        exported_at?: string;
        reviewer?: string;
        manifest?: Record<string, unknown>;
      }>(`/results/${selectedResult.result_id}/exports/${format}`, {
        method: "POST",
      });
      window.open(
        `${API_BASE}/exports/${payload.export_id}/download`,
        "_blank",
        "noopener,noreferrer",
      );
      await refreshCoreData();
      setBanner({
        tone: "success",
        message: payload.content_sha256
          ? `Generated ${format.toUpperCase()} export. SHA-256 ${payload.content_sha256.slice(0, 12)}…`
          : `Generated ${format.toUpperCase()} export.`,
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
    <div className="grid min-h-screen [grid-template-columns:260px_minmax(0,1fr)] max-[1080px]:grid-cols-1">
      <AppSidebar
        activePage={activePage}
        onSelectPage={setActivePage}
        provider={provider}
        reviewCount={reviewCount}
      />
      <div className="grid min-w-0 [grid-template-rows:auto_minmax(0,1fr)]">
        <TopBar activePage={activePage} />
        <main
          className="p-[1.5rem_1.8rem_2rem] max-[820px]:p-4"
          aria-busy={workspaceBusy}
        >
          <DesktopSetupNotice
            desktopStatus={desktopStatus}
            provider={provider}
            apiUnavailable={apiUnavailable}
            busyAction={busyAction}
            desktopOnboardingDismissed={desktopOnboardingDismissed}
            onRefresh={refreshDesktopStatus}
            onStartDesktopStack={handleDesktopStart}
            onOpenSettings={() => setActivePage("settings")}
            onDismiss={dismissDesktopOnboarding}
          />

          {apiUnavailable && !desktopStatus?.tauriMode ? (
            <div
              className="mb-4 flex flex-wrap items-center justify-between gap-4 rounded-[16px] border border-[rgba(208,70,86,0.24)] bg-[rgba(255,244,246,0.96)] px-4 py-[0.9rem]"
              role="alert"
              aria-live="assertive"
            >
              <span>
                Backend unavailable. The extraction workspace is open, but the
                local API is not reachable at {API_BASE}. Start the backend
                stack or use
                <code className="rounded-[8px] bg-[rgba(25,35,61,0.08)] px-[0.4rem] py-[0.12rem] font-mono text-[0.86em]">
                  {" "}
                  npm run tauri:dev
                </code>{" "}
                for the managed desktop flow.
              </span>
              <InlineGroup>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => void refreshCoreData()}
                >
                  Retry connection
                </Button>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => setActivePage("settings")}
                >
                  Open settings
                </Button>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => setActivePage("help")}
                >
                  Open help
                </Button>
              </InlineGroup>
            </div>
          ) : null}

          {showMockProviderWarning ? (
            <MockProviderProductionNotice
              onOpenSettings={() => setActivePage("settings")}
              onDismiss={() => {
                dismissMockProviderWarning();
                setMockProviderWarningDismissed(true);
              }}
            />
          ) : null}

          {banner ? (
            <div
              className={classNames(
                "mb-4 flex flex-wrap items-center justify-between gap-4 rounded-[16px] border px-4 py-[0.9rem]",
                banner.tone === "error"
                  ? "border-[rgba(208,70,86,0.24)] bg-[rgba(255,244,246,0.96)]"
                  : "border-[rgba(31,159,103,0.2)] bg-[rgba(241,255,247,0.95)]",
              )}
              role={banner.tone === "error" ? "alert" : "status"}
              aria-live={banner.tone === "error" ? "assertive" : "polite"}
            >
              <span>{banner.message}</span>
              {banner.actionLabel && banner.onAction ? (
                <Button variant="secondary" onClick={banner.onAction}>
                  {banner.actionLabel}
                </Button>
              ) : null}
              <Button variant="text" onClick={() => setBanner(null)}>
                Dismiss
              </Button>
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
              parserStatus={parserStatus}
              busyAction={busyAction}
              coreDataState={coreDataState}
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
              onRetryJob={handleRetryJob}
              onCancelJob={handleCancelJob}
              onSaveReview={handleSaveReview}
              onApproveAllReview={handleApproveAllReview}
              onApproveHighConfidenceReview={handleApproveHighConfidenceReview}
              onExport={handleExport}
              exportBlocked={exportBlocked}
              jobStatusFilter={jobStatusFilter}
              onJobStatusFilterChange={handleJobStatusFilterChange}
              onOpenSchemas={() => setActivePage("templates")}
              onOpenHelp={() => setActivePage("help")}
              onRetryConnection={refreshCoreData}
              provider={provider}
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
              draftTemplateDefinition={draftTemplateDefinition}
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
              parserStatus={parserStatus}
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
              onOpenAudit={() => setActivePage("audit")}
              onOpenHelp={() => setActivePage("help")}
              exportPolicy={exportPolicy}
              onSetExportPolicy={handleSetExportPolicy}
            />
          ) : null}

          {activePage === "audit" ? (
            <AuditPage
              onOpenJob={(jobId) => {
                handleSelectJob(jobId);
                replaceWorkspaceUrl({
                  jobId,
                  resultId: resultsByJob[jobId]?.result_id ?? null,
                  status: jobStatusFilter,
                });
              }}
            />
          ) : null}
          {activePage === "help" ? (
            <HelpPage
              onOpenExtractions={() => setActivePage("extractions")}
              onOpenSchemas={() => setActivePage("templates")}
              onOpenSettings={() => setActivePage("settings")}
            />
          ) : null}

          {devStatus && activePage !== "extractions" ? (
            <div className="mt-[0.9rem] text-[0.92rem] text-muted">
              Live state: {devStatus.documents} documents, {devStatus.jobs}{" "}
              jobs, {devStatus.results} results.
            </div>
          ) : null}
        </main>
      </div>
    </div>
  );
}
