"""Baseline schema from SQLAlchemy models.

Revision ID: 0001_baseline
Revises:
Create Date: 2026-05-24
"""

from __future__ import annotations

from alembic import op

revision = "0001_baseline"
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    from app.db.database import Base

    bind = op.get_bind()
    Base.metadata.create_all(bind=bind)


def downgrade() -> None:
    from app.db.database import Base

    bind = op.get_bind()
    Base.metadata.drop_all(bind=bind)
