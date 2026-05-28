from __future__ import annotations

from extraction_core.models import LLMProviderSettings
from fastapi import HTTPException

from app.core.config import settings
from app.models import Document

SPREADSHEET_SUFFIXES = (".csv", ".xlsx", ".xls")


def enforce_spreadsheet_external_processing_policy(
    document: Document,
    provider_settings: LLMProviderSettings,
) -> None:
    if not provider_settings.allow_external_processing:
        return
    if not settings.require_redaction_for_external_processing:
        return
    filename = document.original_filename.lower()
    if not filename.endswith(SPREADSHEET_SUFFIXES):
        return
    raise HTTPException(
        status_code=400,
        detail=(
            "This deployment requires redaction before external provider processing, and spreadsheet "
            "documents are not yet supported for that path. Use a local provider or export the sheet to PDF."
        ),
    )
