from __future__ import annotations

import json
from pathlib import Path

from sqlalchemy.orm import Session

from app.models import Template, TemplateVersion
from extraction_core.models import ExtractionTemplate


def seed_sample_template(db: Session, repo_root: Path) -> bool:
    existing = db.query(Template).filter(Template.name == "General Document Extraction Template").first()
    if existing:
        return False

    sample_path = repo_root / "samples" / "general-template.json"
    if not sample_path.exists():
        return False

    definition = ExtractionTemplate.model_validate(json.loads(sample_path.read_text(encoding="utf-8")))
    template = Template(
        name="General Document Extraction Template",
        description=definition.description,
        document_type=definition.document_type,
    )
    db.add(template)
    db.flush()
    db.add(
        TemplateVersion(
            template_id=template.id,
            version=definition.template_version,
            definition=definition.model_dump(mode="json"),
        )
    )
    db.commit()
    return True
