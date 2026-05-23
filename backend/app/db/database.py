from extraction_core.runtime import database_connect_args
from extraction_core.runtime_schema import ensure_extraction_job_runtime_columns
from sqlalchemy import create_engine
from sqlalchemy.orm import declarative_base, sessionmaker

from app.core.config import settings

engine = create_engine(settings.database_url, connect_args=database_connect_args(settings.database_url))
ensure_extraction_job_runtime_columns(engine)
SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False)
Base = declarative_base()


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
