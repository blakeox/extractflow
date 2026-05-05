from extraction_core.models import ExtractionTemplate
from sqlalchemy.orm import Session

from app.models import Template, TemplateVersion


def create_template(
    db: Session, name: str, description: str, document_type: str, definition: ExtractionTemplate
) -> Template:
    template = Template(name=name, description=description, document_type=document_type)
    db.add(template)
    db.flush()
    version = TemplateVersion(
        template_id=template.id, version=definition.template_version, definition=definition.model_dump()
    )
    db.add(version)
    db.commit()
    db.refresh(template)
    return template


def create_template_version(db: Session, template: Template, definition: ExtractionTemplate) -> TemplateVersion:
    version = TemplateVersion(
        template_id=template.id, version=definition.template_version, definition=definition.model_dump()
    )
    db.add(version)
    db.commit()
    db.refresh(version)
    return version
