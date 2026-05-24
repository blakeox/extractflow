from datetime import UTC, datetime

from sqlalchemy import Column, DateTime, ForeignKey, Integer, String, Text
from sqlalchemy.orm import declarative_base
from sqlalchemy.types import JSON

Base = declarative_base()


def utc_now() -> datetime:
    return datetime.now(UTC)


class Document(Base):
    __tablename__ = "documents"

    id = Column(Integer, primary_key=True)
    tenant_id = Column(String(64), nullable=False, default="default")
    original_filename = Column(String(255), nullable=False)
    content_type = Column(String(255), nullable=False)
    stored_path = Column(String(500), nullable=False)
    parsed_text_path = Column(String(500), nullable=True)
    status = Column(String(50), nullable=False)
    created_at = Column(DateTime, nullable=False, default=utc_now)


class TemplateVersion(Base):
    __tablename__ = "template_versions"

    id = Column(Integer, primary_key=True)
    tenant_id = Column(String(64), nullable=False, default="default")
    template_id = Column(Integer, ForeignKey("templates.id"), nullable=False)
    version = Column(String(50), nullable=False)
    definition = Column(JSON, nullable=False)
    created_at = Column(DateTime, nullable=False, default=utc_now)


class ExtractionJob(Base):
    __tablename__ = "extraction_jobs"

    id = Column(Integer, primary_key=True)
    tenant_id = Column(String(64), nullable=False, default="default")
    document_id = Column(Integer, ForeignKey("documents.id"), nullable=False)
    template_version_id = Column(Integer, ForeignKey("template_versions.id"), nullable=False)
    provider_override = Column(JSON, nullable=True)
    status = Column(String(50), nullable=False)
    error_message = Column(Text, nullable=True)
    claimed_at = Column(DateTime, nullable=True)
    worker_id = Column(String(255), nullable=True)
    attempt_count = Column(Integer, nullable=False, default=0)
    progress_stage = Column(String(50), nullable=True)
    progress_pct = Column(Integer, nullable=False, default=0)
    created_at = Column(DateTime, nullable=False, default=utc_now)
    updated_at = Column(DateTime, nullable=False, default=utc_now)


class ExtractionResult(Base):
    __tablename__ = "extraction_results"

    id = Column(Integer, primary_key=True)
    tenant_id = Column(String(64), nullable=False, default="default")
    job_id = Column(Integer, ForeignKey("extraction_jobs.id"), nullable=False, unique=True)
    result_json = Column(JSON, nullable=False)
    review_status = Column(String(50), nullable=False)
    created_at = Column(DateTime, nullable=False, default=utc_now)
    updated_at = Column(DateTime, nullable=False, default=utc_now, onupdate=utc_now)


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
