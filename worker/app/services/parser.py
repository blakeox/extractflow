from __future__ import annotations

from pathlib import Path

import pandas as pd
import pytesseract
from docx import Document as DocxDocument
from PIL import Image
from pypdf import PdfReader


def parse_document(path: str) -> str:
    file_path = Path(path)
    suffix = file_path.suffix.lower()
    if suffix == ".pdf":
        return parse_pdf(file_path)
    if suffix in {".docx"}:
        return parse_docx(file_path)
    if suffix in {".txt", ".md"}:
        return file_path.read_text(encoding="utf-8", errors="ignore")
    if suffix in {".png", ".jpg", ".jpeg", ".tiff"}:
        return pytesseract.image_to_string(Image.open(file_path))
    if suffix in {".csv", ".xlsx", ".xls"}:
        return parse_spreadsheet(file_path)
    return file_path.read_text(encoding="utf-8", errors="ignore")


def parse_pdf(path: Path) -> str:
    reader = PdfReader(str(path))
    chunks: list[str] = []
    for index, page in enumerate(reader.pages, start=1):
        chunks.append(f"[Page {index}]\n{page.extract_text() or ''}")
    return "\n\n".join(chunks)


def parse_docx(path: Path) -> str:
    doc = DocxDocument(str(path))
    return "\n".join(paragraph.text for paragraph in doc.paragraphs)


def parse_spreadsheet(path: Path) -> str:
    if path.suffix.lower() == ".csv":
        data = pd.read_csv(path)
    else:
        data = pd.read_excel(path)
    return data.to_csv(index=False)
