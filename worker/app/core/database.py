from app.core.config import settings
from extraction_core.runtime import database_connect_args
from extraction_core.runtime_schema import ensure_extraction_job_runtime_columns
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

engine = create_engine(settings.database_url, connect_args=database_connect_args(settings.database_url))
ensure_extraction_job_runtime_columns(engine)
SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False)
