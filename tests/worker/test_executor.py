from __future__ import annotations

import os
from pathlib import Path
from unittest.mock import Mock
from zipfile import ZIP_DEFLATED, ZipFile

import httpx
import pandas as pd
import pytest
from app.services import parser as parser_service
from app.services import provider as provider_service
from app.services.executor import execute_extraction
from app.services.parser import parse_document
from app.services.provider import AzureOpenAIAdapter, ExtractionProvider, OpenAICompatibleAdapter
from app.services.validator import validate_extracted_field
from extraction_core.models import (
    ExtractionFieldDefinition,
    ExtractionFieldResult,
    ExtractionTemplate,
    LLMProviderSettings,
)
from pydantic import ValidationError

from tests.support.sample_data import build_template_definition


def write_minimal_docx(path, *, lines: list[str]) -> None:
    paragraph_xml = "".join(f"<w:p><w:r><w:t>{line}</w:t></w:r></w:p>" for line in lines)
    content_types = """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
  <Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>
  <Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>
</Types>"""
    rels = """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>
  <Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/>
</Relationships>"""
    document = f"""<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
    {paragraph_xml}
    <w:sectPr/>
  </w:body>
</w:document>"""
    core = """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:dcmitype="http://purl.org/dc/dcmitype/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>Invoice</dc:title></cp:coreProperties>"""
    app = """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"><Application>Python</Application></Properties>"""
    with ZipFile(path, "w", ZIP_DEFLATED) as archive:
        archive.writestr("[Content_Types].xml", content_types)
        archive.writestr("_rels/.rels", rels)
        archive.writestr("word/document.xml", document)
        archive.writestr("docProps/core.xml", core)
        archive.writestr("docProps/app.xml", app)


def write_minimal_pdf(path, *, lines: list[str]) -> None:
    text = "\\n".join(lines)
    stream = f"BT /F1 12 Tf 72 720 Td ({text}) Tj ET"
    objects = [
        "1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj\n",
        "2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj\n",
        "3 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >> endobj\n",
        f"4 0 obj << /Length {len(stream)} >> stream\n{stream}\nendstream endobj\n",
        "5 0 obj << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> endobj\n",
    ]
    pdf = "%PDF-1.4\n"
    offsets: list[int] = []
    for obj in objects:
        offsets.append(len(pdf.encode("latin-1")))
        pdf += obj
    xref_offset = len(pdf.encode("latin-1"))
    pdf += f"xref\n0 {len(objects) + 1}\n0000000000 65535 f \n"
    for offset in offsets:
        pdf += f"{offset:010d} 00000 n \n"
    pdf += f"trailer << /Size {len(objects) + 1} /Root 1 0 R >>\nstartxref\n{xref_offset}\n%%EOF\n"
    path.write_bytes(pdf.encode("latin-1"))


def test_execute_extraction_runs_mock_pipeline_and_calculates_fields(tmp_path) -> None:
    document = tmp_path / "invoice.txt"
    document.write_text("Vendor Name: Acme Corp\nInvoice total is $1200.00", encoding="utf-8")

    result = execute_extraction(str(document), 42, build_template_definition())

    assert result["document_id"] == "42"
    assert result["extraction_status"] == "completed"
    assert result["calculated_fields"][0]["calculated_value"] == {"amount": 1320.0, "currency": "USD"}
    assert "vendor_name" in result["fields_requiring_review"]


def test_execute_extraction_rejects_external_processing_when_disabled(monkeypatch, tmp_path) -> None:
    document = tmp_path / "invoice.txt"
    document.write_text("Vendor Name: Acme Corp\nInvoice total is $1200.00", encoding="utf-8")
    template = build_template_definition()
    template["llm_provider_settings"] = {
        "mode": "cloud",
        "provider_type": "openai",
        "provider_label": "OpenAI",
        "api_style": "openai_compatible",
        "base_url": "https://api.openai.com/v1",
        "api_key_env_var": "OPENAI_API_KEY",
        "api_key_required": True,
        "model": "gpt-4.1",
        "temperature": 0.1,
        "max_tokens": 4000,
        "supports_json_mode": True,
        "allow_external_processing": True,
        "timeout_seconds": 120,
        "retry_count": 2,
        "chunk_size": 16000,
    }
    monkeypatch.setattr("app.services.executor.app_settings.allow_external_processing", False)

    with pytest.raises(ValueError, match="This deployment disables external provider processing"):
        execute_extraction(str(document), 42, template)


def test_execute_extraction_redacts_external_provider_text(monkeypatch, tmp_path) -> None:
    document = tmp_path / "invoice.txt"
    document.write_text("Contact jane@example.com or call 212-555-0199", encoding="utf-8")
    template = build_template_definition()
    template["calculated_fields"] = []
    template["llm_provider_settings"] = {
        "mode": "cloud",
        "provider_type": "openai",
        "provider_label": "OpenAI",
        "api_style": "openai_compatible",
        "base_url": "https://api.openai.com/v1",
        "api_key_env_var": "OPENAI_API_KEY",
        "api_key_required": True,
        "model": "gpt-4.1",
        "temperature": 0.1,
        "max_tokens": 4000,
        "supports_json_mode": True,
        "allow_external_processing": True,
        "timeout_seconds": 120,
        "retry_count": 2,
        "chunk_size": 16000,
    }
    monkeypatch.setattr("app.services.executor.app_settings.allow_external_processing", True)
    monkeypatch.setattr("app.services.executor.app_settings.require_redaction_for_external_processing", True)
    monkeypatch.setattr("app.services.executor.app_settings.presidio_redaction_enabled", True)
    monkeypatch.setattr(
        "app.services.executor.app_settings.presidio_redaction_entities",
        "EMAIL_ADDRESS,PHONE_NUMBER",
    )
    captured: dict[str, str] = {}

    def fake_extract(self, text, template, settings):
        captured["text"] = text
        return []

    monkeypatch.setattr(ExtractionProvider, "extract", fake_extract)

    result = execute_extraction(str(document), 42, template)

    assert "jane@example.com" not in captured["text"]
    assert "212-555-0199" not in captured["text"]
    assert "********" in captured["text"]
    assert "External provider text redaction applied" in result["document_level_notes"][0]


def test_execute_extraction_keeps_local_provider_text_unredacted(monkeypatch, tmp_path) -> None:
    document = tmp_path / "invoice.txt"
    document.write_text("Contact jane@example.com", encoding="utf-8")
    template = build_template_definition()
    template["calculated_fields"] = []
    monkeypatch.setattr("app.services.executor.app_settings.require_redaction_for_external_processing", True)
    captured: dict[str, str] = {}

    def fake_extract(self, text, template, settings):
        captured["text"] = text
        return []

    monkeypatch.setattr(ExtractionProvider, "extract", fake_extract)

    execute_extraction(str(document), 42, template)

    assert captured["text"] == "Contact jane@example.com"


def test_execute_extraction_fails_closed_when_redaction_errors(monkeypatch, tmp_path) -> None:
    document = tmp_path / "invoice.txt"
    document.write_text("Contact jane@example.com", encoding="utf-8")
    template = build_template_definition()
    template["llm_provider_settings"] = {
        "mode": "cloud",
        "provider_type": "openai",
        "provider_label": "OpenAI",
        "api_style": "openai_compatible",
        "base_url": "https://api.openai.com/v1",
        "api_key_env_var": "OPENAI_API_KEY",
        "api_key_required": True,
        "model": "gpt-4.1",
        "temperature": 0.1,
        "max_tokens": 4000,
        "supports_json_mode": True,
        "allow_external_processing": True,
        "timeout_seconds": 120,
        "retry_count": 2,
        "chunk_size": 16000,
    }
    monkeypatch.setattr("app.services.executor.app_settings.allow_external_processing", True)
    monkeypatch.setattr("app.services.executor.app_settings.require_redaction_for_external_processing", True)
    monkeypatch.setattr("app.services.executor.app_settings.presidio_redaction_enabled", True)
    monkeypatch.setattr("app.services.executor.redact_text", Mock(side_effect=RuntimeError("redaction unavailable")))

    with pytest.raises(RuntimeError, match="redaction unavailable"):
        execute_extraction(str(document), 42, template)


def test_execute_extraction_blocks_spreadsheet_external_redaction_flow(monkeypatch, tmp_path) -> None:
    document = tmp_path / "statement.csv"
    document.write_text("email\njane@example.com\n", encoding="utf-8")
    template = build_template_definition()
    template["llm_provider_settings"] = {
        "mode": "cloud",
        "provider_type": "openai",
        "provider_label": "OpenAI",
        "api_style": "openai_compatible",
        "base_url": "https://api.openai.com/v1",
        "api_key_env_var": "OPENAI_API_KEY",
        "api_key_required": True,
        "model": "gpt-4.1",
        "temperature": 0.1,
        "max_tokens": 4000,
        "supports_json_mode": True,
        "allow_external_processing": True,
        "timeout_seconds": 120,
        "retry_count": 2,
        "chunk_size": 16000,
    }
    monkeypatch.setattr("app.services.executor.app_settings.allow_external_processing", True)
    monkeypatch.setattr("app.services.executor.app_settings.require_redaction_for_external_processing", True)
    monkeypatch.setattr("app.services.executor.app_settings.presidio_redaction_enabled", True)

    with pytest.raises(ValueError, match="spreadsheet documents are not yet supported"):
        execute_extraction(str(document), 42, template)


def test_execute_extraction_reconciles_fields_by_name_and_marks_missing(monkeypatch, tmp_path) -> None:
    document = tmp_path / "statement.txt"
    document.write_text("Vendor Name: Acme Corp", encoding="utf-8")

    def fake_extract(self, text, template, settings):
        return [
            ExtractionFieldResult(
                field_name="total_amount",
                label="Total Amount",
                data_type="currency",
                extracted_value="$1,200.00",
                normalized_value={"amount": 1200, "currency": "USD", "display_value": "$1,200.00"},
                confidence_score=0.92,
                source_text="$1,200.00",
                page_number=3,
                location_reference="Page 3",
            ),
            ExtractionFieldResult(
                field_name="unexpected_field",
                label="Unexpected",
                data_type="text",
                extracted_value="ignore me",
                normalized_value={"value": "ignore me"},
                confidence_score=0.99,
                source_text="ignore me",
                page_number=1,
                location_reference="Page 1",
            ),
        ]

    monkeypatch.setattr(ExtractionProvider, "extract", fake_extract)

    result = execute_extraction(str(document), 99, build_template_definition())

    extracted_fields = {field["field_name"]: field for field in result["extracted_fields"]}
    assert list(extracted_fields) == ["vendor_name", "total_amount"]
    assert extracted_fields["total_amount"]["page_number"] == 3
    assert extracted_fields["vendor_name"]["normalized_value"] is None
    assert extracted_fields["vendor_name"]["validation_status"] == "invalid"
    assert "Required field is missing." in extracted_fields["vendor_name"]["validation_errors"]
    assert "unexpected_field" in result["document_level_notes"][0]


def test_execute_extraction_marks_multiple_candidates_for_review(monkeypatch, tmp_path) -> None:
    document = tmp_path / "statement.txt"
    document.write_text("Vendor Name: Acme Corp", encoding="utf-8")

    def fake_extract(self, text, template, settings):
        return [
            ExtractionFieldResult(
                field_name="vendor_name",
                label="Vendor Name",
                data_type="text",
                extracted_value="Acme Corp",
                normalized_value={"value": "Acme Corp"},
                confidence_score=0.94,
                source_text="Acme Corp",
                page_number=1,
                location_reference="Page 1",
                extraction_notes="First candidate.",
            ),
            ExtractionFieldResult(
                field_name="vendor_name",
                label="Vendor Name",
                data_type="text",
                extracted_value="Acme Corporation",
                normalized_value={"value": "Acme Corporation"},
                confidence_score=0.82,
                source_text="Acme Corporation",
                page_number=2,
                location_reference="Page 2",
                extraction_notes="Second candidate.",
            ),
            ExtractionFieldResult(
                field_name="total_amount",
                label="Total Amount",
                data_type="currency",
                extracted_value="$1,200.00",
                normalized_value={"amount": 1200, "currency": "USD", "display_value": "$1,200.00"},
                confidence_score=0.92,
                source_text="$1,200.00",
                page_number=3,
                location_reference="Page 3",
            ),
        ]

    monkeypatch.setattr(ExtractionProvider, "extract", fake_extract)

    result = execute_extraction(str(document), 99, build_template_definition())

    extracted_fields = {field["field_name"]: field for field in result["extracted_fields"]}
    vendor = extracted_fields["vendor_name"]

    assert vendor["normalized_value"] == {"value": "Acme Corp"}
    assert vendor["requires_review"] is True
    assert "Selected highest-confidence match from 2 chunk candidates." in vendor["extraction_notes"]
    assert "vendor_name" in result["fields_requiring_review"]


def test_execute_extraction_logs_langextract_review_summary(monkeypatch, tmp_path) -> None:
    document = tmp_path / "statement.txt"
    document.write_text("Vendor Name: Acme Corp", encoding="utf-8")
    template_definition = build_template_definition()
    template_definition["llm_provider_settings"] = {
        **template_definition["llm_provider_settings"],
        "provider_type": "langextract",
        "provider_label": "LangExtract (Ollama)",
        "api_style": "langextract",
        "base_url": "http://host.docker.internal:11434/v1",
        "supports_json_mode": False,
        "allow_external_processing": False,
    }
    logged: list[dict] = []

    def fake_extract(self, text, template, settings):
        return [
            ExtractionFieldResult(
                field_name="vendor_name",
                label="Vendor Name",
                data_type="text",
                extracted_value="Acme Corp",
                normalized_value={"value": "Acme Corp"},
                confidence_score=0.2,
                source_text="Acme Corp",
                page_number=1,
                location_reference="Page 1",
                extraction_notes="Candidate one.",
            ),
            ExtractionFieldResult(
                field_name="vendor_name",
                label="Vendor Name",
                data_type="text",
                extracted_value="Acme Corporation",
                normalized_value={"value": "Acme Corporation"},
                confidence_score=0.1,
                source_text="Acme Corporation",
                page_number=2,
                location_reference="Page 2",
                extraction_notes="Candidate two.",
            ),
            ExtractionFieldResult(
                field_name="total_amount",
                label="Total Amount",
                data_type="currency",
                extracted_value="$1,200.00",
                normalized_value={"amount": 1200, "currency": "USD", "display_value": "$1,200.00"},
                confidence_score=0.95,
                source_text="",
                page_number=None,
                location_reference="",
            ),
        ]

    monkeypatch.setattr(ExtractionProvider, "extract", fake_extract)
    monkeypatch.setattr(
        "app.services.executor.log_event",
        lambda logger, level, event, **fields: logged.append({"event": event, **fields}),
    )

    execute_extraction(str(document), 99, template_definition)

    assert logged == [
        {
            "event": "langextract_extraction_completed",
            "document_id": 99,
            "model": template_definition["llm_provider_settings"]["model"],
            "provider_type": "langextract",
            "extracted_field_count": 2,
            "calculated_field_count": 1,
            "review_required_count": 2,
            "document_note_count": 0,
            "low_confidence_review_count": 1,
            "multi_candidate_review_count": 1,
            "citation_gap_count": 1,
            "validation_error_count": 1,
        }
    ]


def test_validate_extracted_field_applies_required_allowed_and_regex_rules() -> None:
    field = ExtractionFieldDefinition.model_validate(
        {
            "name": "invoice_id",
            "label": "Invoice ID",
            "description": "Invoice identifier.",
            "type": "text",
            "required": True,
            "allowed_values": ["INV-100"],
            "validation": {"allow_null": False, "regex": r"^INV-\d+$", "max_length": 10},
        }
    )
    result = ExtractionFieldResult(
        field_name="invoice_id",
        label="Invoice ID",
        data_type="text",
        extracted_value="BAD-TOO-LONG",
        normalized_value="BAD-TOO-LONG",
    )

    validated = validate_extracted_field(field, result)

    assert validated.validation_status == "invalid"
    assert "Value is outside allowed values." in validated.validation_errors
    assert "Value does not match required pattern." in validated.validation_errors
    assert "Value exceeds maximum length." in validated.validation_errors


def test_parse_document_reads_csv_and_unknown_text_extensions(tmp_path) -> None:
    csv_path = tmp_path / "invoice.csv"
    pd.DataFrame([{"vendor": "Acme", "amount": 1200}]).to_csv(csv_path, index=False)
    note_path = tmp_path / "notes.custom"
    note_path.write_text("custom text input", encoding="utf-8")

    csv_text = parse_document(str(csv_path))
    fallback_text = parse_document(str(note_path))

    assert "vendor,amount" in csv_text
    assert "Acme,1200" in csv_text
    assert fallback_text == "custom text input"


def test_parse_document_reads_xlsx_spreadsheets(tmp_path) -> None:
    xlsx_path = tmp_path / "invoice.xlsx"
    pd.DataFrame([{"vendor": "Acme", "amount": 1200}]).to_excel(xlsx_path, index=False)

    spreadsheet_text = parse_document(str(xlsx_path))

    assert "vendor,amount" in spreadsheet_text
    assert "Acme,1200" in spreadsheet_text


@pytest.mark.parametrize("suffix", [".pdf", ".docx", ".html", ".png"])
def test_parse_document_rejects_docling_backed_types_when_disabled(monkeypatch, tmp_path, suffix: str) -> None:
    document_path = tmp_path / f"blocked{suffix}"
    document_path.write_bytes(b"placeholder")
    monkeypatch.setattr(parser_service.settings, "docling_enabled", False)

    with pytest.raises(parser_service.DocumentParseError, match=f"Docling parsing is disabled for {suffix} documents"):
        parse_document(str(document_path))


def test_parse_pdf_prefers_docling_without_ocr_when_it_returns_meaningful_text(monkeypatch, tmp_path) -> None:
    pdf_path = tmp_path / "invoice.pdf"
    pdf_path.write_bytes(b"%PDF-1.4")
    calls: list[bool] = []

    monkeypatch.setattr(parser_service.settings, "docling_enabled", True)

    def fake_parse(path, *, do_ocr: bool) -> str:
        calls.append(do_ocr)
        return "[Page 1]\nDocling totals table"

    monkeypatch.setattr(parser_service, "_parse_pdf_with_docling_mode", fake_parse)

    parsed = parse_document(str(pdf_path))

    assert parsed == "[Page 1]\nDocling totals table"
    assert calls == [False]


def test_parse_pdf_with_docling_preserves_page_markers(monkeypatch, tmp_path) -> None:
    pdf_path = tmp_path / "invoice.pdf"
    pdf_path.write_bytes(b"%PDF-1.4")
    captured: dict[str, object] = {}

    monkeypatch.setattr(parser_service.settings, "docling_enabled", True)
    parser_service.get_docling_converter.cache_clear()

    class FakeInputFormat:
        PDF = "pdf"
        IMAGE = "image"
        DOCX = "docx"

    class FakePdfPipelineOptions:
        def __init__(self) -> None:
            self.do_ocr = True
            self.ocr_options = None
            self.do_table_structure = False
            self.table_structure_options = None

    class FakeTableStructureOptions:
        def __init__(self, do_cell_matching: bool) -> None:
            self.do_cell_matching = do_cell_matching

    class FakeRapidOcrOptions:
        pass

    class FakePdfFormatOption:
        def __init__(self, pipeline_options) -> None:
            captured["pipeline_options"] = pipeline_options

    class FakeImageFormatOption:
        def __init__(self, pipeline_options) -> None:
            captured["image_pipeline_options"] = pipeline_options

    class FakeDocument:
        def export_to_text(self) -> str:
            return "Fallback text"

    class FakeConversion:
        def __init__(self) -> None:
            self.document = FakeDocument()

    class FakeDocumentConverter:
        def __init__(self, *, format_options) -> None:
            captured["format_options"] = format_options

        def convert(self, path) -> FakeConversion:
            captured["path"] = path
            return FakeConversion()

    def fake_generate_multimodal_pages(_conversion):
        yield ("Vendor Name Acme Corp", "", "", [], [], object())
        yield ("Total Amount $1,200.00", "", "", [], [], object())

    monkeypatch.setattr(
        parser_service,
        "_import_docling_tools",
        lambda: (
            FakeInputFormat,
            FakePdfPipelineOptions,
            FakeTableStructureOptions,
            FakeRapidOcrOptions,
            FakePdfFormatOption,
            FakeImageFormatOption,
            FakeDocumentConverter,
            fake_generate_multimodal_pages,
        ),
    )

    parsed = parser_service._parse_pdf_with_docling_mode(pdf_path, do_ocr=False)

    assert parsed == "[Page 1]\nVendor Name Acme Corp\n\n[Page 2]\nTotal Amount $1,200.00"
    assert captured["path"] == pdf_path
    assert captured["pipeline_options"].do_ocr is False
    assert captured["pipeline_options"].do_table_structure is True
    assert captured["pipeline_options"].table_structure_options.do_cell_matching is True


def test_get_docling_converter_uses_rapidocr_for_ocr_pass(monkeypatch) -> None:
    captured: dict[str, object] = {}

    parser_service.get_docling_converter.cache_clear()

    class FakeInputFormat:
        PDF = "pdf"
        IMAGE = "image"
        DOCX = "docx"

    class FakePdfPipelineOptions:
        def __init__(self) -> None:
            self.do_ocr = False
            self.ocr_options = None
            self.do_table_structure = False
            self.table_structure_options = None

    class FakeTableStructureOptions:
        def __init__(self, do_cell_matching: bool) -> None:
            self.do_cell_matching = do_cell_matching

    class FakeRapidOcrOptions:
        def __init__(self) -> None:
            captured["rapidocr_built"] = True

    class FakePdfFormatOption:
        def __init__(self, pipeline_options) -> None:
            captured["pipeline_options"] = pipeline_options

    class FakeImageFormatOption:
        def __init__(self, pipeline_options) -> None:
            captured["image_pipeline_options"] = pipeline_options

    class FakeDocumentConverter:
        def __init__(self, **kwargs) -> None:
            captured["converter_kwargs"] = kwargs

    monkeypatch.setattr(
        parser_service,
        "_import_docling_tools",
        lambda: (
            FakeInputFormat,
            FakePdfPipelineOptions,
            FakeTableStructureOptions,
            FakeRapidOcrOptions,
            FakePdfFormatOption,
            FakeImageFormatOption,
            FakeDocumentConverter,
            lambda conversion: (),
        ),
    )

    parser_service.get_docling_converter("pdf", True)

    assert captured["rapidocr_built"] is True
    assert captured["pipeline_options"].do_ocr is True
    assert isinstance(captured["pipeline_options"].ocr_options, FakeRapidOcrOptions)
    assert captured["pipeline_options"].do_table_structure is True


def test_parse_pdf_retries_docling_with_ocr_when_initial_pass_is_weak(monkeypatch, tmp_path) -> None:
    pdf_path = tmp_path / "scan.pdf"
    pdf_path.write_bytes(b"%PDF-1.4")
    calls: list[bool] = []
    monkeypatch.setattr(parser_service.settings, "docling_pdf_ocr_retry", True)

    def fake_parse(path, *, do_ocr: bool) -> str:
        calls.append(do_ocr)
        if do_ocr:
            return "[Page 1]\nDetected account number"
        return ""

    monkeypatch.setattr(parser_service, "_parse_pdf_with_docling_mode", fake_parse)

    parsed = parse_document(str(pdf_path))

    assert "Detected account number" in parsed
    assert calls == [False, True]


def test_parse_pdf_skips_docling_ocr_retry_when_disabled(monkeypatch, tmp_path) -> None:
    pdf_path = tmp_path / "scan.pdf"
    pdf_path.write_bytes(b"%PDF-1.4")
    calls: list[bool] = []

    monkeypatch.setattr(parser_service.settings, "docling_pdf_ocr_retry", False)

    def fake_parse(path, *, do_ocr: bool) -> str:
        calls.append(do_ocr)
        return ""

    monkeypatch.setattr(parser_service, "_parse_pdf_with_docling_mode", fake_parse)

    with pytest.raises(parser_service.DocumentParseError, match="Docling PDF parsing produced no usable text"):
        parse_document(str(pdf_path))

    assert calls == [False]


def test_parse_docx_uses_docling(monkeypatch, tmp_path) -> None:
    docx_path = tmp_path / "invoice.docx"
    docx_path.write_bytes(b"PK")

    monkeypatch.setattr(parser_service.settings, "docling_enabled", True)
    monkeypatch.setattr(parser_service, "parse_docx_with_docling", lambda path: "Vendor Name\nAcme Corp")

    parsed = parse_document(str(docx_path))

    assert parsed == "Vendor Name\nAcme Corp"


def test_parse_docx_with_real_docling_dependency(monkeypatch, tmp_path) -> None:
    docx_path = tmp_path / "invoice.docx"
    write_minimal_docx(docx_path, lines=["Invoice", "Vendor Name Acme Corp", "Total 1200"])

    monkeypatch.setattr(parser_service.settings, "docling_enabled", True)

    parsed = parse_document(str(docx_path))

    assert "Invoice" in parsed
    assert "Vendor Name Acme Corp" in parsed
    assert "Total 1200" in parsed


def test_parse_pdf_with_real_docling_dependency(monkeypatch, tmp_path) -> None:
    pdf_path = tmp_path / "invoice.pdf"
    write_minimal_pdf(pdf_path, lines=["Invoice", "Vendor Name Acme Corp", "Total 1200"])

    monkeypatch.setattr(parser_service.settings, "docling_enabled", True)
    monkeypatch.setattr(parser_service.settings, "docling_pdf_ocr_retry", False)

    parsed = parse_document(str(pdf_path))

    assert "[Page 1]" in parsed
    assert "Invoice" in parsed
    assert "Vendor Name Acme Corp" in parsed
    assert "Total 1200" in parsed


def test_parse_html_uses_docling(monkeypatch, tmp_path) -> None:
    html_path = tmp_path / "invoice.html"
    html_path.write_text("<html></html>", encoding="utf-8")

    monkeypatch.setattr(parser_service.settings, "docling_enabled", True)
    monkeypatch.setattr(
        parser_service,
        "parse_html_with_docling",
        lambda path: "Vendor Name\nAcme Corp\nInvoice total",
    )

    parsed = parse_document(str(html_path))

    assert parsed == "Vendor Name\nAcme Corp\nInvoice total"


def test_parse_html_with_real_docling_dependency(monkeypatch, tmp_path) -> None:
    html_path = tmp_path / "invoice.html"
    html_path.write_text(
        "<html><body><h1>Invoice</h1><p>Vendor Name Acme Corp</p><p>Total 1200</p></body></html>",
        encoding="utf-8",
    )

    monkeypatch.setattr(parser_service.settings, "docling_enabled", True)

    parsed = parse_document(str(html_path))

    assert "Invoice" in parsed
    assert "Vendor Name Acme Corp" in parsed
    assert "Total 1200" in parsed


def test_image_ocr_runtime_dependency_is_installed() -> None:
    import onnxruntime

    assert onnxruntime.__version__


def test_parse_image_with_real_docling_ocr_dependency(monkeypatch, tmp_path) -> None:
    from PIL import Image, ImageDraw

    image_path = tmp_path / "invoice.png"
    image = Image.new("RGB", (1200, 400), "white")
    draw = ImageDraw.Draw(image)
    draw.text((40, 60), "Invoice\nVendor Name Acme Corp\nTotal 1200", fill="black")
    image.save(image_path)

    monkeypatch.setattr(parser_service.settings, "docling_enabled", True)
    monkeypatch.setattr(parser_service.settings, "docling_image_ocr", True)

    parsed = parse_document(str(image_path))

    assert "[Page 1]" in parsed
    assert "Invoice" in parsed
    assert "Vendor Name Acme Corp" in parsed
    assert "Total 1200" in parsed


def test_parse_image_uses_docling_image_ocr_setting(monkeypatch, tmp_path) -> None:
    image_path = tmp_path / "invoice.png"
    image_path.write_bytes(b"PNG")
    calls: list[bool] = []

    monkeypatch.setattr(parser_service.settings, "docling_enabled", True)
    monkeypatch.setattr(parser_service.settings, "docling_image_ocr", False)

    def fake_parse(path, *, kind: str, do_ocr: bool = False, add_page_markers: bool = False) -> str:
        calls.append(do_ocr)
        return "[Page 1]\nVisible invoice text with enough characters"

    monkeypatch.setattr(parser_service, "_parse_docling_text", fake_parse)

    parsed = parse_document(str(image_path))

    assert parsed == "[Page 1]\nVisible invoice text with enough characters"
    assert calls == [False]


def test_langextract_adapter_maps_grounded_extractions(monkeypatch) -> None:
    provider = ExtractionProvider()
    template = ExtractionTemplate.model_validate(build_template_definition())
    template.llm_provider_settings = LLMProviderSettings(
        mode="local",
        provider_type="langextract",
        provider_label="LangExtract (Ollama)",
        api_style="langextract",
        base_url="http://host.docker.internal:11434/v1",
        model="qwen3.5:27b",
        supports_json_mode=False,
        allow_external_processing=False,
    )
    settings = template.llm_provider_settings
    source_text = "[Page 1]\nVendor Name: Acme Corp\n\n[Page 2]\nTotal Due: $1,200.00"
    captured: dict[str, object] = {}

    class FakeCharInterval:
        def __init__(self, start_pos: int, end_pos: int):
            self.start_pos = start_pos
            self.end_pos = end_pos

    class FakeExtraction:
        def __init__(self, extraction_class: str, extraction_text: str, start_pos: int, end_pos: int, attributes=None):
            self.extraction_class = extraction_class
            self.extraction_text = extraction_text
            self.char_interval = FakeCharInterval(start_pos, end_pos)
            self.attributes = attributes or {}

    class FakeAnnotatedDocument:
        def __init__(self, extractions):
            self.extractions = extractions

    class FakeLangExtractModule:
        @staticmethod
        def extract(**kwargs):
            captured["text"] = kwargs["text_or_documents"]
            vendor_start = source_text.index("Acme Corp")
            amount_start = source_text.index("$1,200.00")
            return FakeAnnotatedDocument(
                [
                    FakeExtraction("vendor_name", "Acme Corp", vendor_start, vendor_start + len("Acme Corp")),
                    FakeExtraction("total_amount", "$1,200.00", amount_start, amount_start + len("$1,200.00")),
                ]
            )

    class FakeExampleData:
        def __init__(self, text: str, extractions):
            self.text = text
            self.extractions = extractions

    class FakeExampleExtraction:
        def __init__(self, extraction_class: str, extraction_text: str, attributes=None):
            self.extraction_class = extraction_class
            self.extraction_text = extraction_text
            self.attributes = attributes

    class FakeOllamaLanguageModel:
        def __init__(self, **kwargs):
            captured["model_kwargs"] = kwargs

    monkeypatch.setattr(
        "app.services.provider._import_langextract",
        lambda: (
            FakeLangExtractModule,
            FakeExampleData,
            FakeExampleExtraction,
            FakeOllamaLanguageModel,
        ),
    )

    results = provider.extract(source_text, template, settings)

    assert captured["text"] == source_text
    assert captured["model_kwargs"]["model_url"] == "http://host.docker.internal:11434"
    assert {item.field_name for item in results} == {"vendor_name", "total_amount"}
    vendor = next(item for item in results if item.field_name == "vendor_name")
    amount = next(item for item in results if item.field_name == "total_amount")
    assert vendor.source_text == "Acme Corp"
    assert vendor.char_start == source_text.index("Acme Corp")
    assert vendor.char_end == source_text.index("Acme Corp") + len("Acme Corp")
    assert vendor.page_number == 1
    assert amount.page_number == 2


def test_langextract_adapter_logs_oversized_document_rejection(monkeypatch) -> None:
    provider = ExtractionProvider()
    template = ExtractionTemplate.model_validate(build_template_definition())
    template.llm_provider_settings = LLMProviderSettings(
        mode="local",
        provider_type="langextract",
        provider_label="LangExtract (Ollama)",
        api_style="langextract",
        base_url="http://host.docker.internal:11434/v1",
        model="qwen3.5:27b",
        supports_json_mode=False,
        allow_external_processing=False,
        langextract_max_document_chars=10,
    )
    logged: list[dict] = []

    monkeypatch.setattr(
        provider_service,
        "log_event",
        lambda logger, level, event, **fields: logged.append({"event": event, **fields}),
    )

    with pytest.raises(ValueError, match="exceeds langextract_max_document_chars"):
        provider.extract("This input is definitely too large.", template, template.llm_provider_settings)

    assert logged == [
        {
            "event": "langextract_document_rejected",
            "reason": "document_too_large",
            "document_chars": len("This input is definitely too large."),
            "max_document_chars": 10,
            "model": "qwen3.5:27b",
            "provider_type": "langextract",
        }
    ]


def test_langextract_adapter_bypasses_outer_chunking_and_keeps_global_offsets(monkeypatch) -> None:
    provider = ExtractionProvider()
    template = ExtractionTemplate.model_validate(build_template_definition())
    template.llm_provider_settings = LLMProviderSettings(
        mode="local",
        provider_type="langextract",
        provider_label="LangExtract (Ollama)",
        api_style="langextract",
        base_url="http://host.docker.internal:11434/v1",
        model="qwen3.5:27b",
        supports_json_mode=False,
        allow_external_processing=False,
        chunk_size=4,
    )
    settings = template.llm_provider_settings
    source_text = "[Page 1]\nIntro text\n\n[Page 2]\nVendor Name: Acme Corp"
    captured: dict[str, object] = {"calls": 0}

    class FakeCharInterval:
        def __init__(self, start_pos: int, end_pos: int):
            self.start_pos = start_pos
            self.end_pos = end_pos

    class FakeExtraction:
        def __init__(self, extraction_class: str, extraction_text: str, start_pos: int, end_pos: int):
            self.extraction_class = extraction_class
            self.extraction_text = extraction_text
            self.char_interval = FakeCharInterval(start_pos, end_pos)
            self.attributes = {"value": extraction_text}

    class FakeAnnotatedDocument:
        def __init__(self, extractions):
            self.extractions = extractions

    class FakeLangExtractModule:
        @staticmethod
        def extract(**kwargs):
            captured["calls"] = int(captured["calls"]) + 1
            captured["text"] = kwargs["text_or_documents"]
            vendor_start = source_text.index("Acme Corp")
            return FakeAnnotatedDocument(
                [FakeExtraction("vendor_name", "Acme Corp", vendor_start, vendor_start + len("Acme Corp"))]
            )

    class FakeExampleData:
        def __init__(self, text: str, extractions):
            self.text = text
            self.extractions = extractions

    class FakeExampleExtraction:
        def __init__(self, extraction_class: str, extraction_text: str, attributes=None):
            self.extraction_class = extraction_class
            self.extraction_text = extraction_text
            self.attributes = attributes

    class FakeOllamaLanguageModel:
        def __init__(self, **kwargs):
            self.kwargs = kwargs

    monkeypatch.setattr(
        provider_service,
        "split_text_into_chunks",
        lambda *_args, **_kwargs: (_ for _ in ()).throw(AssertionError("LangExtract should not use outer chunking")),
    )
    monkeypatch.setattr(
        "app.services.provider._import_langextract",
        lambda: (
            FakeLangExtractModule,
            FakeExampleData,
            FakeExampleExtraction,
            FakeOllamaLanguageModel,
        ),
    )

    results = provider.extract(source_text, template, settings)

    assert captured["calls"] == 1
    assert captured["text"] == source_text
    vendor = results[0]
    assert vendor.page_number == 2
    assert vendor.char_start == source_text.index("Acme Corp")
    assert vendor.char_end == source_text.index("Acme Corp") + len("Acme Corp")


def test_execute_extraction_marks_ungrounded_langextract_results_for_review(monkeypatch, tmp_path) -> None:
    document = tmp_path / "invoice.txt"
    document.write_text("Vendor Name: Acme Corp", encoding="utf-8")
    definition = build_template_definition()
    definition["llm_provider_settings"] = {
        **definition["llm_provider_settings"],
        "mode": "local",
        "provider_type": "langextract",
        "provider_label": "LangExtract (Ollama)",
        "api_style": "langextract",
        "base_url": "http://host.docker.internal:11434/v1",
        "model": "qwen3.5:27b",
        "supports_json_mode": False,
        "allow_external_processing": False,
    }
    definition["calculated_fields"] = []

    class FakeExtraction:
        def __init__(self, extraction_class: str, extraction_text: str, attributes=None):
            self.extraction_class = extraction_class
            self.extraction_text = extraction_text
            self.attributes = attributes or {"value": extraction_text}

    class FakeAnnotatedDocument:
        def __init__(self, extractions):
            self.extractions = extractions

    class FakeLangExtractModule:
        @staticmethod
        def extract(**kwargs):
            return FakeAnnotatedDocument([FakeExtraction("vendor_name", "Acme Corp")])

    class FakeExampleData:
        def __init__(self, text: str, extractions):
            self.text = text
            self.extractions = extractions

    class FakeExampleExtraction:
        def __init__(self, extraction_class: str, extraction_text: str, attributes=None):
            self.extraction_class = extraction_class
            self.extraction_text = extraction_text
            self.attributes = attributes

    class FakeOllamaLanguageModel:
        def __init__(self, **kwargs):
            self.kwargs = kwargs

    monkeypatch.setattr(
        "app.services.provider._import_langextract",
        lambda: (
            FakeLangExtractModule,
            FakeExampleData,
            FakeExampleExtraction,
            FakeOllamaLanguageModel,
        ),
    )

    result = execute_extraction(str(document), 42, definition)

    vendor = next(field for field in result["extracted_fields"] if field["field_name"] == "vendor_name")
    assert vendor["source_text"] == ""
    assert vendor["confidence_score"] == 0.0
    assert vendor["requires_review"] is True
    assert "Citation evidence is required." in vendor["validation_errors"]
    assert "vendor_name" in result["fields_requiring_review"]


def test_langextract_adapter_requires_template_examples() -> None:
    provider = ExtractionProvider()
    definition = build_template_definition()
    definition["langextract_config"] = None
    template = ExtractionTemplate.model_validate(definition)
    settings = LLMProviderSettings(
        mode="local",
        provider_type="langextract",
        provider_label="LangExtract (Ollama)",
        api_style="langextract",
        base_url="http://host.docker.internal:11434/v1",
        model="qwen3.5:27b",
        supports_json_mode=False,
        allow_external_processing=False,
    )

    with pytest.raises(ValueError, match="langextract_config"):
        provider.extract("Vendor Name: Acme Corp", template, settings)


def test_langextract_adapter_rejects_documents_over_configured_limit() -> None:
    provider = ExtractionProvider()
    template = ExtractionTemplate.model_validate(build_template_definition())
    settings = LLMProviderSettings(
        mode="local",
        provider_type="langextract",
        provider_label="LangExtract (Ollama)",
        api_style="langextract",
        base_url="http://host.docker.internal:11434/v1",
        model="qwen3.5:27b",
        supports_json_mode=False,
        allow_external_processing=False,
        chunk_size=16000,
        langextract_max_document_chars=12,
    )
    source_text = "Vendor Name: Acme Corp"

    with pytest.raises(
        ValueError,
        match=(
            r"LangExtract document length \d+ chars exceeds "
            r"langextract_max_document_chars=12\."
        ),
    ):
        provider.extract(source_text, template, settings)


def test_langextract_provider_settings_require_matching_identity() -> None:
    with pytest.raises(ValidationError, match="provider_type and api_style"):
        LLMProviderSettings(
            mode="local",
            provider_type="langextract",
            provider_label="LangExtract (Ollama)",
            api_style="openai_compatible",
            base_url="http://host.docker.internal:11434/v1",
            model="qwen3.5:27b",
            supports_json_mode=False,
            allow_external_processing=False,
        )


def test_llm_provider_extract_builds_request_and_parses_response(monkeypatch) -> None:
    provider = ExtractionProvider()
    template = ExtractionTemplate.model_validate(build_template_definition())
    settings = LLMProviderSettings(
        provider_type="openai",
        base_url="http://llm.local/v1",
        model="test-model",
        api_style="openai_compatible",
        supports_json_mode=False,
    )

    mock_response = Mock()
    mock_response.raise_for_status.return_value = None
    mock_response.json.return_value = {
        "choices": [
            {
                "message": {
                    "content": '{"extracted_fields":[{"field_name":"vendor_name","label":"Vendor Name","field_kind":"extracted","data_type":"text","extracted_value":"Acme Corp","normalized_value":{"value":"Acme Corp"},"confidence_score":0.9,"source_text":"Acme Corp","page_number":1,"location_reference":"Page 1","validation_status":"valid","validation_errors":[],"extraction_notes":"ok","requires_review":false}]}'
                }
            }
        ]
    }

    captured: dict[str, object] = {}

    class FakeClient:
        def __init__(self, timeout: int):
            captured["timeout"] = timeout

        def __enter__(self):
            return self

        def __exit__(self, exc_type, exc, tb):
            return False

        def post(self, url: str, json: dict, headers: dict):
            captured["url"] = url
            captured["json"] = json
            captured["headers"] = headers
            return mock_response

    monkeypatch.setattr(httpx, "Client", FakeClient)

    results = provider.extract("Vendor Name: Acme Corp", template, settings)

    assert captured["url"] == "http://llm.local/v1/chat/completions"
    assert captured["timeout"] == 120
    assert "response_format" not in captured["json"]
    assert results[0].field_name == "vendor_name"
    assert results[0].normalized_value == {"value": "Acme Corp"}


def test_llm_provider_extract_uses_chunking_for_large_documents(monkeypatch) -> None:
    provider = ExtractionProvider()
    template = ExtractionTemplate.model_validate(build_template_definition())
    settings = LLMProviderSettings(
        provider_type="openai",
        base_url="http://llm.local/v1",
        model="test-model",
        api_style="openai_compatible",
        chunk_size=40,
    )

    captured_payloads: list[dict] = []

    class FakeResponse:
        def __init__(self, payload_index: int):
            self.payload_index = payload_index

        def raise_for_status(self) -> None:
            return None

        def json(self) -> dict:
            if self.payload_index == 0:
                content = '{"extracted_fields":[{"field_name":"vendor_name","label":"Vendor Name","field_kind":"extracted","data_type":"text","extracted_value":"Acme Corp","normalized_value":{"value":"Acme Corp"},"confidence_score":0.9,"source_text":"Acme Corp","page_number":1,"location_reference":"Page 1","validation_status":"valid","validation_errors":[],"extraction_notes":"ok","requires_review":false}]}'
            else:
                content = '{"extracted_fields":[{"field_name":"total_amount","label":"Total Amount","field_kind":"extracted","data_type":"currency","extracted_value":"$1200.00","normalized_value":{"amount":1200,"currency":"USD","display_value":"$1200.00"},"confidence_score":0.88,"source_text":"$1200.00","page_number":2,"location_reference":"Page 2","validation_status":"valid","validation_errors":[],"extraction_notes":"ok","requires_review":false}]}'
            return {"choices": [{"message": {"content": content}}]}

    class FakeClient:
        def __init__(self, timeout: int):
            self.timeout = timeout

        def __enter__(self):
            return self

        def __exit__(self, exc_type, exc, tb):
            return False

        def post(self, url: str, json: dict, headers: dict):
            captured_payloads.append(json)
            return FakeResponse(len(captured_payloads) - 1)

    monkeypatch.setattr(httpx, "Client", FakeClient)

    text = "Vendor Name: Acme Corp\n" + ("x" * 60) + "\nTotal Amount: $1200.00"
    results = provider.extract(text, template, settings)

    assert len(captured_payloads) >= 2
    assert {item.field_name for item in results} == {"vendor_name", "total_amount"}


def test_llm_provider_extract_propagates_invalid_json(monkeypatch) -> None:
    provider = ExtractionProvider()
    template = ExtractionTemplate.model_validate(build_template_definition())
    settings = LLMProviderSettings(
        provider_type="openai",
        base_url="http://llm.local/v1",
        model="test-model",
        api_style="openai_compatible",
    )

    mock_response = Mock()
    mock_response.raise_for_status.return_value = None
    mock_response.json.return_value = {"choices": [{"message": {"content": "not-json"}}]}

    class FakeClient:
        def __init__(self, timeout: int):
            self.timeout = timeout

        def __enter__(self):
            return self

        def __exit__(self, exc_type, exc, tb):
            return False

        def post(self, url: str, json: dict, headers: dict):
            return mock_response

    monkeypatch.setattr(httpx, "Client", FakeClient)

    with pytest.raises(RuntimeError, match="Provider call failed"):
        provider.extract("Vendor Name: Acme Corp", template, settings)


def test_llm_provider_extract_accepts_preparsed_json_content(monkeypatch) -> None:
    provider = ExtractionProvider()
    template = ExtractionTemplate.model_validate(build_template_definition())
    settings = LLMProviderSettings(
        provider_type="openai",
        base_url="http://llm.local/v1",
        model="test-model",
        api_style="openai_compatible",
    )

    mock_response = Mock()
    mock_response.raise_for_status.return_value = None
    mock_response.json.return_value = {
        "choices": [
            {
                "message": {
                    "content": {
                        "extracted_fields": [
                            {
                                "field_name": "vendor_name",
                                "label": "Vendor Name",
                                "field_kind": "extracted",
                                "data_type": "text",
                                "extracted_value": "Acme Corp",
                                "normalized_value": {"value": "Acme Corp"},
                                "confidence_score": 0.9,
                                "source_text": "Acme Corp",
                                "page_number": 1,
                                "location_reference": "Page 1",
                                "validation_status": "valid",
                                "validation_errors": [],
                                "extraction_notes": "ok",
                                "requires_review": False,
                            }
                        ]
                    }
                }
            }
        ]
    }

    class FakeClient:
        def __init__(self, timeout: int):
            self.timeout = timeout

        def __enter__(self):
            return self

        def __exit__(self, exc_type, exc, tb):
            return False

        def post(self, url: str, json: dict, headers: dict):
            return mock_response

    monkeypatch.setattr(httpx, "Client", FakeClient)

    results = provider.extract("Vendor Name: Acme Corp", template, settings)

    assert results[0].field_name == "vendor_name"
    assert results[0].normalized_value == {"value": "Acme Corp"}


def test_llm_provider_extract_requires_extracted_fields_list(monkeypatch) -> None:
    provider = ExtractionProvider()
    template = ExtractionTemplate.model_validate(build_template_definition())
    settings = LLMProviderSettings(
        provider_type="openai",
        base_url="http://llm.local/v1",
        model="test-model",
        api_style="openai_compatible",
    )

    mock_response = Mock()
    mock_response.raise_for_status.return_value = None
    mock_response.json.return_value = {"choices": [{"message": {"content": "{}"}}]}

    class FakeClient:
        def __init__(self, timeout: int):
            self.timeout = timeout

        def __enter__(self):
            return self

        def __exit__(self, exc_type, exc, tb):
            return False

        def post(self, url: str, json: dict, headers: dict):
            return mock_response

    monkeypatch.setattr(httpx, "Client", FakeClient)

    with pytest.raises(RuntimeError, match="Provider response must include an extracted_fields list"):
        provider.extract("Vendor Name: Acme Corp", template, settings)


def test_llm_provider_extract_retries_until_timeout_exhausted(monkeypatch) -> None:
    provider = ExtractionProvider()
    template = ExtractionTemplate.model_validate(build_template_definition())
    settings = LLMProviderSettings(
        provider_type="openai",
        base_url="http://llm.local/v1",
        model="test-model",
        api_style="openai_compatible",
        retry_count=2,
    )

    attempts = {"count": 0}

    class FakeClient:
        def __init__(self, timeout: int):
            self.timeout = timeout

        def __enter__(self):
            return self

        def __exit__(self, exc_type, exc, tb):
            return False

        def post(self, url: str, json: dict, headers: dict):
            attempts["count"] += 1
            raise httpx.ReadTimeout("timed out")

    monkeypatch.setattr(httpx, "Client", FakeClient)

    with pytest.raises(RuntimeError, match="Provider call failed for openai"):
        provider.extract("Vendor Name: Acme Corp", template, settings)

    assert attempts["count"] == 3


def test_openai_compatible_adapter_requires_api_key_when_configured(monkeypatch) -> None:
    template = ExtractionTemplate.model_validate(build_template_definition())
    settings = LLMProviderSettings(
        mode="cloud",
        provider_type="openai",
        provider_label="OpenAI",
        api_style="openai_compatible",
        base_url="https://api.openai.com/v1",
        api_key_env_var="OPENAI_API_KEY",
        api_key_required=True,
        model="gpt-4.1",
    )

    monkeypatch.delenv("OPENAI_API_KEY", raising=False)

    adapter = OpenAICompatibleAdapter()

    with pytest.raises(ValueError, match="OPENAI_API_KEY"):
        adapter.extract("Vendor Name: Acme Corp", template, settings)


def test_openai_compatible_adapter_reads_api_key_from_environment(monkeypatch) -> None:
    template = ExtractionTemplate.model_validate(build_template_definition())
    settings = LLMProviderSettings(
        mode="cloud",
        provider_type="openai",
        provider_label="OpenAI",
        api_style="openai_compatible",
        base_url="https://api.openai.com/v1",
        api_key_env_var="OPENAI_API_KEY",
        api_key_required=True,
        model="gpt-4.1",
    )

    mock_response = Mock()
    mock_response.raise_for_status.return_value = None
    mock_response.json.return_value = {
        "choices": [
            {
                "message": {
                    "content": '{"extracted_fields":[{"field_name":"vendor_name","label":"Vendor Name","field_kind":"extracted","data_type":"text","extracted_value":"Acme Corp","normalized_value":{"value":"Acme Corp"},"confidence_score":0.9,"source_text":"Acme Corp","page_number":1,"location_reference":"Page 1","validation_status":"valid","validation_errors":[],"extraction_notes":"ok","requires_review":false}]}'
                }
            }
        ]
    }

    captured: dict[str, object] = {}

    class FakeClient:
        def __init__(self, timeout: int):
            captured["timeout"] = timeout

        def __enter__(self):
            return self

        def __exit__(self, exc_type, exc, tb):
            return False

        def post(self, url: str, json: dict, headers: dict):
            captured["headers"] = headers
            return mock_response

    monkeypatch.setenv("OPENAI_API_KEY", "test-token")
    monkeypatch.setattr(httpx, "Client", FakeClient)

    adapter = OpenAICompatibleAdapter()
    result = adapter.extract("Vendor Name: Acme Corp", template, settings)

    assert result[0].field_name == "vendor_name"
    assert captured["headers"] == {"Content-Type": "application/json", "Authorization": "Bearer test-token"}


def test_azure_openai_adapter_builds_deployment_scoped_request(monkeypatch) -> None:
    template = ExtractionTemplate.model_validate(build_template_definition())
    settings = LLMProviderSettings(
        mode="cloud",
        provider_type="azure_openai",
        provider_label="Azure OpenAI",
        api_style="azure_openai",
        base_url="https://example.openai.azure.com",
        api_key_env_var="AZURE_OPENAI_API_KEY",
        api_key_required=True,
        deployment="doc-extract-prod",
        api_version="2024-10-21",
        model="gpt-4.1-mini",
    )

    mock_response = Mock()
    mock_response.raise_for_status.return_value = None
    mock_response.json.return_value = {
        "choices": [
            {
                "message": {
                    "content": '{"extracted_fields":[{"field_name":"vendor_name","label":"Vendor Name","field_kind":"extracted","data_type":"text","extracted_value":"Acme Corp","normalized_value":{"value":"Acme Corp"},"confidence_score":0.9,"source_text":"Acme Corp","page_number":1,"location_reference":"Page 1","validation_status":"valid","validation_errors":[],"extraction_notes":"ok","requires_review":false}]}'
                }
            }
        ]
    }

    captured: dict[str, object] = {}

    class FakeClient:
        def __init__(self, timeout: int):
            captured["timeout"] = timeout

        def __enter__(self):
            return self

        def __exit__(self, exc_type, exc, tb):
            return False

        def post(self, url: str, json: dict, headers: dict):
            captured["url"] = url
            captured["headers"] = headers
            captured["json"] = json
            return mock_response

    monkeypatch.setenv("AZURE_OPENAI_API_KEY", "azure-token")
    monkeypatch.setattr(httpx, "Client", FakeClient)

    adapter = AzureOpenAIAdapter()
    result = adapter.extract("Vendor Name: Acme Corp", template, settings)

    assert result[0].field_name == "vendor_name"
    assert (
        captured["url"]
        == "https://example.openai.azure.com/openai/deployments/doc-extract-prod/chat/completions?api-version=2024-10-21"
    )
    assert captured["headers"] == {"Content-Type": "application/json", "api-key": "azure-token"}


def test_process_once_marks_job_failed_when_document_or_template_missing() -> None:
    from app.core.database import SessionLocal
    from app.main import process_once
    from app.models import ExtractionJob

    with SessionLocal() as db:
        job = ExtractionJob(document_id=999, template_version_id=999, status="queued")
        db.add(job)
        db.commit()
        job_id = job.id

    process_once()

    with SessionLocal() as db:
        refreshed = db.get(ExtractionJob, job_id)
        assert refreshed is not None
        assert refreshed.status == "failed"
        assert refreshed.error_message == "Document or template version missing."


def test_process_once_marks_job_and_document_failed_when_extraction_raises(tmp_path, monkeypatch) -> None:
    from app.core.database import SessionLocal
    from app.main import process_once
    from app.models import Document, ExtractionJob, TemplateVersion

    uploads_dir = Path(os.environ["UPLOADS_DIR"])
    document_path = uploads_dir / "invoice-failure.txt"
    document_path.write_text("Vendor Name: Acme Corp", encoding="utf-8")

    with SessionLocal() as db:
        document = Document(
            original_filename="invoice.txt",
            content_type="text/plain",
            stored_path=str(document_path),
            status="uploaded",
        )
        db.add(document)
        db.flush()
        version = TemplateVersion(template_id=1, version="1.0.0", definition=build_template_definition())
        db.add(version)
        db.flush()
        job = ExtractionJob(document_id=document.id, template_version_id=version.id, status="queued")
        db.add(job)
        db.commit()
        document_id = document.id
        job_id = job.id

    def fail_execute_extraction(**kwargs):
        raise RuntimeError("provider timeout")

    monkeypatch.setattr("app.main.execute_extraction", fail_execute_extraction)

    process_once()

    with SessionLocal() as db:
        refreshed_job = db.get(ExtractionJob, job_id)
        refreshed_document = db.get(Document, document_id)
        assert refreshed_job is not None
        assert refreshed_document is not None
        assert refreshed_job.status == "failed"
        assert refreshed_job.error_message == "provider timeout"
        assert refreshed_document.status == "failed"


def test_process_once_marks_langextract_job_failed_when_document_exceeds_limit(tmp_path) -> None:
    from app.core.database import SessionLocal
    from app.main import process_once
    from app.models import Document, ExtractionJob, TemplateVersion

    document_text = "Vendor Name: Acme Corp"
    uploads_dir = Path(os.environ["UPLOADS_DIR"])
    document_path = uploads_dir / "invoice-langextract-limit.txt"
    document_path.write_text(document_text, encoding="utf-8")

    definition = build_template_definition()
    definition["llm_provider_settings"] = {
        **definition["llm_provider_settings"],
        "mode": "local",
        "provider_type": "langextract",
        "provider_label": "LangExtract (Ollama)",
        "api_style": "langextract",
        "base_url": "http://host.docker.internal:11434/v1",
        "model": "qwen3.5:27b",
        "supports_json_mode": False,
        "allow_external_processing": False,
        "langextract_max_document_chars": 12,
    }

    with SessionLocal() as db:
        document = Document(
            original_filename="invoice.txt",
            content_type="text/plain",
            stored_path=str(document_path),
            status="uploaded",
        )
        db.add(document)
        db.flush()
        version = TemplateVersion(template_id=1, version="1.0.0", definition=definition)
        db.add(version)
        db.flush()
        job = ExtractionJob(document_id=document.id, template_version_id=version.id, status="queued")
        db.add(job)
        db.commit()
        document_id = document.id
        job_id = job.id

    process_once()

    expected_error = (
        "LangExtract document length "
        f"{len(document_text)} chars exceeds langextract_max_document_chars=12. "
        "LangExtract keeps grounded global offsets by using internal windowing with chunk_size=16000, "
        "but this project caps total document size to bound runtime and memory. Reduce document size or "
        "increase langextract_max_document_chars."
    )

    with SessionLocal() as db:
        refreshed_job = db.get(ExtractionJob, job_id)
        refreshed_document = db.get(Document, document_id)
        assert refreshed_job is not None
        assert refreshed_document is not None
        assert refreshed_job.status == "failed"
        assert refreshed_job.error_message == expected_error
        assert refreshed_document.status == "failed"


def test_process_once_updates_existing_result_for_same_job(tmp_path, monkeypatch) -> None:
    from app.core.database import SessionLocal
    from app.main import process_once
    from app.models import Document, ExtractionJob, ExtractionResult, TemplateVersion

    uploads_dir = Path(os.environ["UPLOADS_DIR"])
    document_path = uploads_dir / "invoice-existing-result.txt"
    document_path.write_text("Vendor Name: Acme Corp", encoding="utf-8")

    with SessionLocal() as db:
        document = Document(
            original_filename="invoice.txt",
            content_type="text/plain",
            stored_path=str(document_path),
            status="uploaded",
        )
        db.add(document)
        db.flush()
        version = TemplateVersion(template_id=1, version="1.0.0", definition=build_template_definition())
        db.add(version)
        db.flush()
        job = ExtractionJob(document_id=document.id, template_version_id=version.id, status="queued")
        db.add(job)
        db.flush()
        existing_result = ExtractionResult(
            job_id=job.id,
            result_json={"document_id": str(document.id), "extraction_status": "stale"},
            review_status="reviewed",
        )
        db.add(existing_result)
        db.commit()
        result_id = existing_result.id
        job_id = job.id

    monkeypatch.setattr(
        "app.main.execute_extraction",
        lambda **kwargs: {
            "document_id": str(kwargs["document_id"]),
            "document_type": "invoice",
            "template_name": "Invoice Extraction",
            "template_version": "1.0.0",
            "llm_provider": build_template_definition()["llm_provider_settings"],
            "extraction_status": "completed",
            "extracted_fields": [],
            "calculated_fields": [],
            "fields_requiring_review": [],
            "document_level_notes": [],
            "reviewed_at": None,
        },
    )

    process_once()

    with SessionLocal() as db:
        refreshed_job = db.get(ExtractionJob, job_id)
        refreshed_result = db.get(ExtractionResult, result_id)
        assert refreshed_job is not None
        assert refreshed_result is not None
        assert refreshed_job.status == "completed"
        assert refreshed_result.id == result_id
        assert refreshed_result.review_status == "pending"
        assert refreshed_result.result_json["extraction_status"] == "completed"


def test_process_once_resolves_managed_document_reference(monkeypatch) -> None:
    from app.core.database import SessionLocal
    from app.main import process_once
    from app.models import Document, ExtractionJob, TemplateVersion

    uploads_dir = Path(os.environ["UPLOADS_DIR"])
    document_path = uploads_dir / "managed-invoice.txt"
    document_path.write_text("Vendor Name: Acme Corp", encoding="utf-8")

    with SessionLocal() as db:
        document = Document(
            original_filename="managed-invoice.txt",
            content_type="text/plain",
            stored_path="uploads/managed-invoice.txt",
            status="uploaded",
        )
        db.add(document)
        db.flush()
        version = TemplateVersion(template_id=1, version="1.0.0", definition=build_template_definition())
        db.add(version)
        db.flush()
        job = ExtractionJob(document_id=document.id, template_version_id=version.id, status="queued")
        db.add(job)
        db.commit()
        document_id = document.id
        job_id = job.id

    captured: dict[str, str] = {}

    def fake_execute_extraction(**kwargs):
        captured["document_path"] = kwargs["document_path"]
        return {
            "document_id": str(kwargs["document_id"]),
            "document_type": "invoice",
            "template_name": "Invoice Extraction",
            "template_version": "1.0.0",
            "llm_provider": build_template_definition()["llm_provider_settings"],
            "extraction_status": "completed",
            "extracted_fields": [],
            "calculated_fields": [],
            "fields_requiring_review": [],
            "document_level_notes": [],
            "reviewed_at": None,
        }

    monkeypatch.setattr("app.main.execute_extraction", fake_execute_extraction)

    process_once()

    with SessionLocal() as db:
        refreshed_job = db.get(ExtractionJob, job_id)
        refreshed_document = db.get(Document, document_id)
        assert refreshed_job is not None
        assert refreshed_document is not None
        assert refreshed_job.status == "completed"
        assert refreshed_document.status == "completed"
    assert captured["document_path"] == str(document_path.resolve())
