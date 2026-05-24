from datetime import UTC, datetime

from sqlalchemy import Boolean, Column, DateTime, ForeignKey, Integer, String, Text, UniqueConstraint
from sqlalchemy.orm import relationship
from sqlalchemy.types import JSON

from app.db.database import Base


def utc_now() -> datetime:
    return datetime.now(UTC)


class Template(Base):
    __tablename__ = "templates"
    __table_args__ = (UniqueConstraint("tenant_id", "name", name="uq_template_tenant_name"),)

    id = Column(Integer, primary_key=True)
    tenant_id = Column(String(64), nullable=False, default="default")
    name = Column(String(255), nullable=False)
    description = Column(Text, nullable=False, default="")
    document_type = Column(String(255), nullable=False)
    is_locked = Column(Boolean, nullable=False, default=False)
    created_at = Column(DateTime, nullable=False, default=utc_now)
    updated_at = Column(DateTime, nullable=False, default=utc_now, onupdate=utc_now)

    versions = relationship("TemplateVersion", back_populates="template", cascade="all, delete-orphan")


class TemplateVersion(Base):
    __tablename__ = "template_versions"

    id = Column(Integer, primary_key=True)
    tenant_id = Column(String(64), nullable=False, default="default")
    template_id = Column(Integer, ForeignKey("templates.id"), nullable=False)
    version = Column(String(50), nullable=False)
    definition = Column(JSON, nullable=False)
    created_at = Column(DateTime, nullable=False, default=utc_now)

    template = relationship("Template", back_populates="versions")


class LangExtractFeedbackDecision(Base):
    __tablename__ = "langextract_feedback_decisions"
    __table_args__ = (
        UniqueConstraint("template_version_id", "suggestion_key", name="uq_langextract_feedback_decision"),
    )

    id = Column(Integer, primary_key=True)
    tenant_id = Column(String(64), nullable=False, default="default")
    template_version_id = Column(Integer, ForeignKey("template_versions.id"), nullable=False)
    suggestion_key = Column(String(64), nullable=False)
    dismissed = Column(Boolean, nullable=False, default=True)
    created_at = Column(DateTime, nullable=False, default=utc_now)
    updated_at = Column(DateTime, nullable=False, default=utc_now, onupdate=utc_now)


class Document(Base):
    __tablename__ = "documents"

    id = Column(Integer, primary_key=True)
    tenant_id = Column(String(64), nullable=False, default="default")
    original_filename = Column(String(255), nullable=False)
    content_type = Column(String(255), nullable=False, default="application/octet-stream")
    stored_path = Column(String(500), nullable=False)
    parsed_text_path = Column(String(500), nullable=True)
    status = Column(String(50), nullable=False, default="uploaded")
    created_at = Column(DateTime, nullable=False, default=utc_now)


class ExtractionJob(Base):
    __tablename__ = "extraction_jobs"

    id = Column(Integer, primary_key=True)
    tenant_id = Column(String(64), nullable=False, default="default")
    document_id = Column(Integer, ForeignKey("documents.id"), nullable=False)
    template_version_id = Column(Integer, ForeignKey("template_versions.id"), nullable=False)
    provider_override = Column(JSON, nullable=True)
    status = Column(String(50), nullable=False, default="queued")
    error_message = Column(Text, nullable=True)
    claimed_at = Column(DateTime, nullable=True)
    worker_id = Column(String(255), nullable=True)
    attempt_count = Column(Integer, nullable=False, default=0)
    progress_stage = Column(String(50), nullable=True)
    progress_pct = Column(Integer, nullable=False, default=0)
    created_at = Column(DateTime, nullable=False, default=utc_now)
    updated_at = Column(DateTime, nullable=False, default=utc_now, onupdate=utc_now)


class ExtractionResult(Base):
    __tablename__ = "extraction_results"

    id = Column(Integer, primary_key=True)
    tenant_id = Column(String(64), nullable=False, default="default")
    job_id = Column(Integer, ForeignKey("extraction_jobs.id"), nullable=False, unique=True)
    result_json = Column(JSON, nullable=False)
    review_status = Column(String(50), nullable=False, default="pending")
    created_at = Column(DateTime, nullable=False, default=utc_now)
    updated_at = Column(DateTime, nullable=False, default=utc_now, onupdate=utc_now)


class ReviewEdit(Base):
    __tablename__ = "review_edits"

    id = Column(Integer, primary_key=True)
    tenant_id = Column(String(64), nullable=False, default="default")
    result_id = Column(Integer, ForeignKey("extraction_results.id"), nullable=False)
    reviewer = Column(String(255), nullable=False, default="local-user")
    field_name = Column(String(255), nullable=False)
    previous_value = Column(JSON, nullable=True)
    new_value = Column(JSON, nullable=True)
    reason = Column(Text, nullable=False, default="")
    created_at = Column(DateTime, nullable=False, default=utc_now)


class ExportRecord(Base):
    __tablename__ = "exports"

    id = Column(Integer, primary_key=True)
    tenant_id = Column(String(64), nullable=False, default="default")
    result_id = Column(Integer, ForeignKey("extraction_results.id"), nullable=False)
    export_format = Column(String(50), nullable=False)
    file_path = Column(String(500), nullable=False)
    content_sha256 = Column(String(64), nullable=True)
    exported_at = Column(DateTime, nullable=True)
    reviewer = Column(String(255), nullable=True)
    template_version_id = Column(Integer, ForeignKey("template_versions.id"), nullable=True)
    manifest_json = Column(JSON, nullable=True)
    created_at = Column(DateTime, nullable=False, default=utc_now)


class AuditEvent(Base):
    __tablename__ = "audit_events"

    id = Column(Integer, primary_key=True)
    tenant_id = Column(String(64), nullable=False, default="default")
    actor = Column(String(255), nullable=False, default="system")
    action = Column(String(100), nullable=False)
    object_type = Column(String(100), nullable=False)
    object_id = Column(String(100), nullable=False)
    metadata_json = Column("metadata", JSON, nullable=False, default=dict)
    created_at = Column(DateTime, nullable=False, default=utc_now)


class Setting(Base):
    __tablename__ = "settings"

    id = Column(Integer, primary_key=True)
    key = Column(String(255), nullable=False, unique=True)
    value = Column(JSON, nullable=False)
    updated_at = Column(DateTime, nullable=False, default=utc_now, onupdate=utc_now)
