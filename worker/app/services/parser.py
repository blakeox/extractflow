from __future__ import annotations

import logging
from functools import lru_cache
from pathlib import Path
from time import perf_counter

import pandas as pd
from extraction_core.observability import configure_logger, log_event

from app.core.config import settings

logger = configure_logger("extractflow.worker.parser")
TEXT_SUFFIXES = {".txt", ".md"}
HTML_SUFFIXES = {".html", ".htm"}
IMAGE_SUFFIXES = {".png", ".jpg", ".jpeg", ".tiff"}
SPREADSHEET_SUFFIXES = {".csv", ".xlsx", ".xls"}
DOCLING_SUFFIXES = {".pdf", ".docx", ".pptx", *HTML_SUFFIXES, *IMAGE_SUFFIXES}


class DocumentParseError(RuntimeError):
    pass


def parse_document(path: str) -> str:
    file_path = Path(path)
    suffix = file_path.suffix.lower()
    if suffix in TEXT_SUFFIXES:
        return file_path.read_text(encoding="utf-8", errors="ignore")
    if suffix in SPREADSHEET_SUFFIXES:
        return parse_spreadsheet(file_path)
    if suffix in DOCLING_SUFFIXES:
        if not docling_enabled():
            raise DocumentParseError(f"Docling parsing is disabled for {suffix} documents.")
        return parse_with_docling(file_path)
    return file_path.read_text(encoding="utf-8", errors="ignore")


def parse_with_docling(path: Path) -> str:
    suffix = path.suffix.lower()
    if suffix == ".pdf":
        return parse_pdf_with_docling(path)
    if suffix == ".docx":
        return parse_docx_with_docling(path)
    if suffix == ".pptx":
        return parse_pptx_with_docling(path)
    if suffix in HTML_SUFFIXES:
        return parse_html_with_docling(path)
    if suffix in IMAGE_SUFFIXES:
        return parse_image_with_docling(path)
    raise DocumentParseError(f"Docling does not handle {suffix} in this worker parser.")


def parse_spreadsheet(path: Path) -> str:
    if path.suffix.lower() == ".csv":
        data = pd.read_csv(path)
    else:
        data = pd.read_excel(path)
    return data.to_csv(index=False)


def has_meaningful_text(text: str, threshold: int = 24) -> bool:
    return len("".join(text.split())) >= threshold


def normalize_text(text: str) -> str:
    return "\n".join(line.rstrip() for line in text.splitlines()).strip()


def parse_pdf_with_docling(path: Path) -> str:
    parsed_text = _parse_pdf_with_docling_mode(path, do_ocr=False)
    if has_meaningful_text(parsed_text):
        log_parser_selected(path, parser_name="docling", ocr_enabled=False)
        return parsed_text

    if settings.docling_pdf_ocr_retry:
        parsed_text = _parse_pdf_with_docling_mode(path, do_ocr=True)
        if has_meaningful_text(parsed_text):
            log_parser_selected(path, parser_name="docling", ocr_enabled=True)
            return parsed_text

    raise DocumentParseError("Docling PDF parsing produced no usable text, including OCR retry.")


def parse_docx_with_docling(path: Path) -> str:
    parsed_text = _parse_docling_text(path, kind="docx")
    if has_meaningful_text(parsed_text):
        log_parser_selected(path, parser_name="docling", ocr_enabled=False)
        return parsed_text
    raise DocumentParseError("Docling DOCX parsing produced no usable text.")


def parse_html_with_docling(path: Path) -> str:
    parsed_text = _parse_docling_text(path, kind="html")
    if has_meaningful_text(parsed_text):
        log_parser_selected(path, parser_name="docling", ocr_enabled=False)
        return parsed_text
    raise DocumentParseError("Docling HTML parsing produced no usable text.")


def parse_pptx_with_docling(path: Path) -> str:
    parsed_text = _parse_docling_text(path, kind="pptx")
    if has_meaningful_text(parsed_text):
        log_parser_selected(path, parser_name="docling", ocr_enabled=False)
        return parsed_text
    raise DocumentParseError("Docling PPTX parsing produced no usable text.")


def parse_image_with_docling(path: Path) -> str:
    parsed_text = _parse_docling_text(
        path,
        kind="image",
        do_ocr=settings.docling_image_ocr,
        add_page_markers=True,
    )
    if has_meaningful_text(parsed_text):
        log_parser_selected(path, parser_name="docling", ocr_enabled=settings.docling_image_ocr)
        return parsed_text
    raise DocumentParseError("Docling image parsing produced no usable text.")


def _parse_pdf_with_docling_mode(path: Path, *, do_ocr: bool) -> str:
    conversion = _convert_with_docling(path, kind="pdf", do_ocr=do_ocr)
    generate_multimodal_pages = _import_docling_tools()[-1]
    chunks: list[str] = []
    for index, page_data in enumerate(generate_multimodal_pages(conversion), start=1):
        page_text = normalize_text(page_data[0])
        if page_text:
            chunks.append(f"[Page {index}]\n{page_text}")

    if not chunks:
        fallback_text = normalize_text(conversion.document.export_to_text())
        if fallback_text:
            chunks.append(f"[Page 1]\n{fallback_text}")

    return "\n\n".join(chunks).strip()


def _parse_docling_text(path: Path, *, kind: str, do_ocr: bool = False, add_page_markers: bool = False) -> str:
    conversion = _convert_with_docling(path, kind=kind, do_ocr=do_ocr)
    parsed_text = normalize_text(conversion.document.export_to_text())
    if parsed_text and add_page_markers:
        return f"[Page 1]\n{parsed_text}"
    return parsed_text


def _convert_with_docling(path: Path, *, kind: str, do_ocr: bool):
    if not docling_enabled():
        raise DocumentParseError(f"Docling parsing is disabled for {path.suffix.lower()} documents.")

    try:
        converter = get_docling_converter(kind, do_ocr)
    except ImportError:
        message = f"Docling is not installed for {path.suffix.lower()} parsing."
        log_event(
            logger,
            logging.INFO,
            "document_parser_attempted",
            parser="docling",
            outcome="error",
            reason="module_unavailable",
            document_suffix=path.suffix.lower(),
            ocr_enabled=do_ocr,
        )
        raise DocumentParseError(message) from None

    start = perf_counter()
    try:
        conversion = converter.convert(path)
        log_event(
            logger,
            logging.INFO,
            "document_parser_attempted",
            parser="docling",
            outcome="success",
            reason=None,
            document_suffix=path.suffix.lower(),
            docling_kind=kind,
            ocr_enabled=do_ocr,
            elapsed_ms=round((perf_counter() - start) * 1000, 2),
        )
        return conversion
    except Exception as exc:
        message = f"Docling failed to parse {path.suffix.lower()} document: {exc}"
        log_event(
            logger,
            logging.WARNING,
            "document_parser_attempted",
            parser="docling",
            outcome="error",
            reason="docling_error",
            document_suffix=path.suffix.lower(),
            docling_kind=kind,
            ocr_enabled=do_ocr,
            elapsed_ms=round((perf_counter() - start) * 1000, 2),
            error=str(exc),
        )
        raise DocumentParseError(message) from exc


def docling_enabled() -> bool:
    return settings.docling_enabled


def log_parser_selected(path: Path, parser_name: str, *, ocr_enabled: bool) -> None:
    log_event(
        logger,
        logging.INFO,
        "document_parser_selected",
        parser=parser_name,
        document_suffix=path.suffix.lower(),
        ocr_enabled=ocr_enabled,
    )


def prewarm_docling_converters() -> dict[str, object]:
    if not docling_enabled():
        return {"status": "disabled", "attempted": False, "warmed_targets": []}

    try:
        InputFormat, *_rest = _import_docling_tools()
    except ImportError:
        log_event(
            logger,
            logging.INFO,
            "docling_prewarm_skipped",
            reason="module_unavailable",
        )
        return {"status": "module_unavailable", "attempted": False, "warmed_targets": []}

    warm_targets = [
        ("pdf", False, InputFormat.PDF),
        ("docx", False, None),
        ("pptx", False, None),
        ("html", False, None),
        ("image", settings.docling_image_ocr, InputFormat.IMAGE),
    ]
    if settings.docling_pdf_ocr_retry:
        warm_targets.insert(1, ("pdf", True, InputFormat.PDF))
    start = perf_counter()
    warmed_targets: list[str] = []

    try:
        for kind, do_ocr, input_format in warm_targets:
            converter = get_docling_converter(kind, do_ocr)
            if input_format is not None:
                converter.initialize_pipeline(input_format)
            warmed_targets.append(f"{kind}:{'ocr' if do_ocr else 'plain'}")
        log_event(
            logger,
            logging.INFO,
            "docling_prewarm_completed",
            warmed_targets=warmed_targets,
            elapsed_ms=round((perf_counter() - start) * 1000, 2),
        )
        return {
            "status": "completed",
            "attempted": True,
            "warmed_targets": warmed_targets,
        }
    except Exception as exc:
        log_event(
            logger,
            logging.WARNING,
            "docling_prewarm_failed",
            warmed_targets=warmed_targets,
            elapsed_ms=round((perf_counter() - start) * 1000, 2),
            error=str(exc),
        )
        return {
            "status": "failed",
            "attempted": True,
            "warmed_targets": warmed_targets,
            "error": str(exc),
        }


@lru_cache(maxsize=4)
def get_docling_converter(kind: str, do_ocr: bool):
    (
        InputFormat,
        PdfPipelineOptions,
        TableStructureOptions,
        RapidOcrOptions,
        PdfFormatOption,
        ImageFormatOption,
        DocumentConverter,
        _generate_multimodal_pages,
    ) = _import_docling_tools()

    if kind == "pdf":
        pipeline_options = PdfPipelineOptions()
        pipeline_options.do_ocr = do_ocr
        if do_ocr:
            pipeline_options.ocr_options = RapidOcrOptions()
        pipeline_options.do_table_structure = True
        pipeline_options.table_structure_options = TableStructureOptions(do_cell_matching=True)
        return DocumentConverter(format_options={InputFormat.PDF: PdfFormatOption(pipeline_options=pipeline_options)})

    if kind == "image":
        pipeline_options = PdfPipelineOptions()
        pipeline_options.do_ocr = do_ocr
        if do_ocr:
            pipeline_options.ocr_options = RapidOcrOptions()
        pipeline_options.do_table_structure = True
        pipeline_options.table_structure_options = TableStructureOptions(do_cell_matching=True)
        return DocumentConverter(
            format_options={InputFormat.IMAGE: ImageFormatOption(pipeline_options=pipeline_options)}
        )

    if kind == "docx":
        return DocumentConverter(allowed_formats=[InputFormat.DOCX])

    if kind == "pptx":
        return DocumentConverter(allowed_formats=[InputFormat.PPTX])

    if kind == "html":
        return DocumentConverter(allowed_formats=[InputFormat.HTML])

    raise ValueError(f"Unsupported Docling converter kind: {kind}")


def _import_docling_tools():
    from docling.datamodel.base_models import InputFormat
    from docling.datamodel.pipeline_options import PdfPipelineOptions, RapidOcrOptions, TableStructureOptions
    from docling.document_converter import DocumentConverter, ImageFormatOption, PdfFormatOption
    from docling.utils.export import generate_multimodal_pages

    return (
        InputFormat,
        PdfPipelineOptions,
        TableStructureOptions,
        RapidOcrOptions,
        PdfFormatOption,
        ImageFormatOption,
        DocumentConverter,
        generate_multimodal_pages,
    )
