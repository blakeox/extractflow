from __future__ import annotations

from sqlalchemy import inspect, text
from sqlalchemy.engine import Engine


def ensure_extraction_job_runtime_columns(engine: Engine) -> None:
    inspector = inspect(engine)
    table_names = set(inspector.get_table_names())
    if "extraction_jobs" not in table_names:
        return

    statements: list[str] = []
    extraction_job_columns = {column["name"] for column in inspector.get_columns("extraction_jobs")}
    if "claimed_at" not in extraction_job_columns:
        statements.append("ALTER TABLE extraction_jobs ADD COLUMN claimed_at TIMESTAMP")
    if "worker_id" not in extraction_job_columns:
        statements.append("ALTER TABLE extraction_jobs ADD COLUMN worker_id VARCHAR(255)")
    if "attempt_count" not in extraction_job_columns:
        statements.append("ALTER TABLE extraction_jobs ADD COLUMN attempt_count INTEGER NOT NULL DEFAULT 0")

    tenant_tables = (
        "templates",
        "template_versions",
        "langextract_feedback_decisions",
        "documents",
        "extraction_jobs",
        "extraction_results",
        "review_edits",
        "exports",
    )
    for table_name in tenant_tables:
        if table_name not in table_names:
            continue
        existing_columns = {column["name"] for column in inspector.get_columns(table_name)}
        if "tenant_id" not in existing_columns:
            statements.append(f"ALTER TABLE {table_name} ADD COLUMN tenant_id VARCHAR(64) NOT NULL DEFAULT 'default'")

    if not statements:
        return

    with engine.begin() as connection:
        for statement in statements:
            connection.execute(text(statement))
