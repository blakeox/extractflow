from __future__ import annotations

from datetime import datetime
from enum import StrEnum
from typing import Any, Literal

from jsonschema import Draft202012Validator, SchemaError
from pydantic import BaseModel, ConfigDict, Field, model_validator

from .formulas import (
    FormulaEngine,
    FormulaValidationError,
    collect_formula_references,
    topologically_sort_calculated_fields,
)
from .langextract import (
    LANGEXTRACT_API_STYLE,
    LANGEXTRACT_PROVIDER_TYPE,
    uses_langextract_provider,
)


class DataType(StrEnum):
    TEXT = "text"
    PARAGRAPH = "paragraph"
    NUMBER = "number"
    CURRENCY = "currency"
    PERCENTAGE = "percentage"
    DATE = "date"
    BOOLEAN = "boolean"
    CATEGORY = "category"
    MULTI_SELECT = "multi_select"
    UNIT_VALUE = "unit_value"
    STRUCTURED_OBJECT = "structured_object"
    TABLE = "table"
    LIST = "list"
    JSON_OBJECT = "json_object"
    CITATION_BACKED = "citation_backed_answer"
    CALCULATED = "calculated"


class ValidationRule(BaseModel):
    allow_null: bool = True
    min: float | None = None
    max: float | None = None
    regex: str | None = None
    currency: str | None = None
    format: str | None = None
    max_length: int | None = None
    allowed_values: list[str] = Field(default_factory=list)


class FormatRule(BaseModel):
    currency: str | None = None
    decimal_places: int | None = None
    date_format: str | None = None
    unit: str | None = None


class ErrorHandlingRule(BaseModel):
    on_divide_by_zero: Literal["return_null_and_flag_review", "return_null"] = "return_null_and_flag_review"
    on_missing_input: Literal["return_null_and_flag_review", "return_null"] = "return_null_and_flag_review"


class ExtractionFieldDefinition(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    name: str
    label: str
    description: str
    type: DataType
    required: bool = False
    instructions: str = ""
    citation_required: bool = True
    usable_in_formulas: bool = True
    extract_mode: Literal["exact", "summary"] = "exact"
    allow_null: bool = True
    example_values: list[str] = Field(default_factory=list)
    allowed_values: list[str] = Field(default_factory=list)
    output_format: FormatRule | None = None
    validation: ValidationRule = Field(default_factory=ValidationRule)
    field_schema: dict[str, Any] | None = Field(default=None, alias="schema", serialization_alias="schema")

    @model_validator(mode="after")
    def validate_field_schema_definition(self) -> ExtractionFieldDefinition:
        if self.field_schema is None:
            return self
        try:
            Draft202012Validator.check_schema(self.field_schema)
        except SchemaError as exc:
            raise ValueError(f"Field schema is not a valid JSON Schema: {exc.message}") from exc
        return self


class CalculatedFieldDefinition(BaseModel):
    name: str
    label: str
    description: str
    type: Literal["calculated"] = "calculated"
    output_type: DataType
    formula: str
    depends_on: list[str] = Field(default_factory=list)
    format: FormatRule | None = None
    validation: ValidationRule = Field(default_factory=ValidationRule)
    error_handling: ErrorHandlingRule = Field(default_factory=ErrorHandlingRule)
    requires_review: bool = False


class OutputSettings(BaseModel):
    include_source_citations: bool = True
    include_confidence_scores: bool = True
    include_calculated_fields: bool = True
    include_formula_definitions: bool = True
    export_formats: list[str] = Field(default_factory=lambda: ["json", "csv", "excel"])


class LLMProviderSettings(BaseModel):
    mode: Literal["local", "cloud"] = "local"
    provider_type: str = "mock"
    provider_label: str | None = None
    api_style: Literal["mock", "openai_compatible", "azure_openai", "langextract"] = "mock"
    base_url: str | None = None
    api_key_env_var: str | None = None
    api_key_required: bool = False
    deployment: str | None = None
    api_version: str | None = None
    model: str = "mock-extractor"
    temperature: float = 0.1
    max_tokens: int = 4000
    supports_json_mode: bool = True
    allow_external_processing: bool = False
    timeout_seconds: int = 120
    retry_count: int = 2
    chunk_size: int = 16000
    langextract_max_document_chars: int | None = 160000

    @model_validator(mode="after")
    def validate_langextract_constraints(self) -> LLMProviderSettings:
        if not uses_langextract_provider(self.provider_type, self.api_style):
            return self
        if self.provider_type != LANGEXTRACT_PROVIDER_TYPE or self.api_style != LANGEXTRACT_API_STYLE:
            raise ValueError("LangExtract requires provider_type and api_style to both be set to 'langextract'.")
        if self.mode != "local":
            raise ValueError("LangExtract only supports local mode.")
        if self.allow_external_processing:
            raise ValueError("LangExtract must keep allow_external_processing disabled.")
        return self


class LLMProviderCapabilities(BaseModel):
    supports_chat_completions: bool = True
    supports_json_mode: bool = True
    supports_streaming: bool = False
    supports_remote_processing: bool = False
    requires_api_key: bool = False
    supports_local_runtime: bool = False


class LLMProviderCatalogEntry(BaseModel):
    key: str
    label: str
    description: str
    mode: Literal["local", "cloud"]
    provider_type: str
    api_style: Literal["mock", "openai_compatible", "azure_openai", "langextract"] = "openai_compatible"
    base_url: str | None = None
    model: str
    enabled: bool = True
    recommended: bool = False
    api_key_env_var: str | None = None
    deployment: str | None = None
    tags: list[str] = Field(default_factory=list)
    capabilities: LLMProviderCapabilities = Field(default_factory=LLMProviderCapabilities)
    settings: LLMProviderSettings


class ExtractionTemplate(BaseModel):
    template_name: str
    template_version: str = "1.0.0"
    document_type: str
    description: str = ""
    llm_provider_settings: LLMProviderSettings = Field(default_factory=LLMProviderSettings)
    langextract_config: LangExtractConfig | None = None
    extracted_fields: list[ExtractionFieldDefinition] = Field(default_factory=list)
    calculated_fields: list[CalculatedFieldDefinition] = Field(default_factory=list)
    output_settings: OutputSettings = Field(default_factory=OutputSettings)
    review_required_on_low_confidence: bool = True
    minimum_confidence_threshold: float = 0.75
    local_only_mode: bool = True

    @model_validator(mode="after")
    def validate_unique_names(self) -> ExtractionTemplate:
        names = [field.name for field in self.extracted_fields] + [field.name for field in self.calculated_fields]
        if len(names) != len(set(names)):
            raise ValueError("Field names must be unique across extracted and calculated fields.")
        return self

    @model_validator(mode="after")
    def validate_calculated_field_contract(self) -> ExtractionTemplate:
        engine = FormulaEngine()
        formula_usable_field_names = {field.name for field in self.extracted_fields if field.usable_in_formulas}
        formula_blocked_field_names = {field.name for field in self.extracted_fields if not field.usable_in_formulas}
        calculated_field_names = {field.name for field in self.calculated_fields}
        all_field_names = {field.name for field in self.extracted_fields} | calculated_field_names
        available_field_names = formula_usable_field_names | calculated_field_names

        for definition in self.calculated_fields:
            try:
                engine.validate_formula(definition.formula, all_field_names)
            except FormulaValidationError as exc:
                raise ValueError(f"Calculated field '{definition.name}' formula is invalid: {exc}") from exc

            blocked_references = sorted(
                collect_formula_references(definition.formula, all_field_names) & formula_blocked_field_names
            )
            if blocked_references:
                raise ValueError(
                    f"Calculated field '{definition.name}' references extracted fields that are not usable in formulas: "
                    + ", ".join(blocked_references)
                    + "."
                )

            try:
                engine.validate_formula(definition.formula, available_field_names)
            except FormulaValidationError as exc:
                raise ValueError(f"Calculated field '{definition.name}' formula is invalid: {exc}") from exc

            referenced_fields = sorted(collect_formula_references(definition.formula, available_field_names))
            if sorted(definition.depends_on) != referenced_fields:
                raise ValueError(
                    f"Calculated field '{definition.name}' depends_on must match referenced fields. "
                    f"Declared: {sorted(definition.depends_on)}. Referenced: {referenced_fields}."
                )

        try:
            topologically_sort_calculated_fields(self.calculated_fields)
        except FormulaValidationError as exc:
            raise ValueError(f"Calculated field dependency graph is invalid: {exc}") from exc

        return self

    @model_validator(mode="after")
    def validate_langextract_contract(self) -> ExtractionTemplate:
        if not uses_langextract_provider(
            self.llm_provider_settings.provider_type,
            self.llm_provider_settings.api_style,
        ):
            return self
        if self.langextract_config is None:
            raise ValueError("LangExtract templates require langextract_config.")
        if not self.langextract_config.prompt_description.strip():
            raise ValueError("LangExtract templates require a non-empty prompt_description.")
        if not self.langextract_config.examples:
            raise ValueError("LangExtract templates require at least one example.")
        extracted_field_names = {field.name for field in self.extracted_fields}
        required_field_names = {field.name for field in self.extracted_fields if field.required}
        covered_field_names: set[str] = set()
        for example_index, example in enumerate(self.langextract_config.examples, start=1):
            for extraction_index, extraction in enumerate(example.extractions, start=1):
                if extraction.extraction_class not in extracted_field_names:
                    available = ", ".join(sorted(extracted_field_names)) or "(no extracted fields defined)"
                    raise ValueError(
                        "LangExtract example "
                        f"{example_index} extraction {extraction_index} references unknown field "
                        f"'{extraction.extraction_class}'. Available extracted fields: {available}."
                    )
                covered_field_names.add(extraction.extraction_class)
        missing_required_fields = sorted(required_field_names - covered_field_names)
        if missing_required_fields:
            raise ValueError(
                "LangExtract examples must cover every required extracted field. Missing example coverage for: "
                + ", ".join(missing_required_fields)
                + "."
            )
        return self


class ExtractionFieldResult(BaseModel):
    field_name: str
    label: str
    field_kind: Literal["extracted"] = "extracted"
    data_type: DataType
    extracted_value: Any = None
    normalized_value: Any = None
    confidence_score: float = 0.0
    source_text: str = ""
    char_start: int | None = None
    char_end: int | None = None
    page_number: int | None = None
    location_reference: str = ""
    validation_status: str = "pending"
    validation_errors: list[str] = Field(default_factory=list)
    extraction_notes: str = ""
    requires_review: bool = False


class CalculatedFieldResult(BaseModel):
    field_name: str
    label: str
    field_kind: Literal["calculated"] = "calculated"
    output_type: DataType
    formula: str
    depends_on: list[str]
    calculated_value: Any = None
    display_value: str = ""
    validation_status: str = "pending"
    validation_errors: list[str] = Field(default_factory=list)
    calculation_notes: str = ""
    requires_review: bool = False


class ExtractionValidationSummary(BaseModel):
    document_id: str
    document_type: str
    template_name: str
    template_version: str
    llm_provider: dict[str, Any]
    extraction_status: str
    extracted_fields: list[ExtractionFieldResult]
    calculated_fields: list[CalculatedFieldResult] = Field(default_factory=list)
    document_level_notes: list[str] = Field(default_factory=list)
    fields_requiring_review: list[str] = Field(default_factory=list)
    reviewed_at: datetime | None = None


class LangExtractExampleExtraction(BaseModel):
    extraction_class: str
    extraction_text: str
    attributes: dict[str, str | list[str]] = Field(default_factory=dict)


class LangExtractExample(BaseModel):
    text: str
    extractions: list[LangExtractExampleExtraction] = Field(default_factory=list)


class LangExtractConfig(BaseModel):
    prompt_description: str
    examples: list[LangExtractExample] = Field(default_factory=list)


class JobRequest(BaseModel):
    document_id: int
    template_version_id: int
    provider_override: LLMProviderSettings | None = None


class ReviewFieldEdit(BaseModel):
    field_name: str
    normalized_value: Any
    extracted_value: Any = None
    reason: str = ""


class ReviewEditPayload(BaseModel):
    reviewer: str = "local-user"
    edits: list[ReviewFieldEdit] = Field(default_factory=list)
    recalculate: bool = True
    approve_high_confidence_min: float | None = Field(
        default=None,
        ge=0.0,
        le=1.0,
        description="When set, auto-approve flagged fields at or above this confidence that are not invalid.",
    )
