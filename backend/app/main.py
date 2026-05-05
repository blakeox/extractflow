import os
import time
import uuid
from contextlib import asynccontextmanager
from pathlib import Path

from extraction_core.observability import configure_logger, log_event
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from sqlalchemy import text

from app.api.routes import router
from app.bootstrap.seed import seed_sample_template
from app.core.config import settings
from app.db.database import Base, SessionLocal, engine

Base.metadata.create_all(bind=engine)
logger = configure_logger("extractflow.backend")


@asynccontextmanager
async def lifespan(_: FastAPI):
    log_event(logger, 20, "backend_starting", app_name=settings.app_name)
    if settings.seed_samples_on_startup:
        with SessionLocal() as db:
            seed_sample_template(db, Path("/workspace"))
    yield
    log_event(logger, 20, "backend_stopping", app_name=settings.app_name)


app = FastAPI(title=settings.app_name, lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.middleware("http")
async def request_logging_middleware(request: Request, call_next):
    request_id = request.headers.get("X-Request-ID") or uuid.uuid4().hex
    request.state.request_id = request_id
    started_at = time.perf_counter()
    client_host = request.client.host if request.client else None

    try:
        response = await call_next(request)
    except Exception:
        duration_ms = round((time.perf_counter() - started_at) * 1000, 2)
        log_event(
            logger,
            40,
            "request_failed",
            request_id=request_id,
            method=request.method,
            path=request.url.path,
            client=client_host,
            duration_ms=duration_ms,
        )
        raise

    response.headers["X-Request-ID"] = request_id
    duration_ms = round((time.perf_counter() - started_at) * 1000, 2)
    log_event(
        logger,
        20,
        "request_completed",
        request_id=request_id,
        method=request.method,
        path=request.url.path,
        status_code=response.status_code,
        client=client_host,
        duration_ms=duration_ms,
    )
    return response


app.include_router(router, prefix=settings.api_prefix)


@app.get("/healthz")
def healthz():
    return {"status": "ok", "service": "backend", "app_name": settings.app_name}


def _build_readiness_payload() -> tuple[int, dict[str, object]]:
    database_check: dict[str, object] = {"ready": True}
    try:
        with engine.connect() as connection:
            connection.execute(text("SELECT 1"))
    except Exception as exc:  # noqa: BLE001
        database_check = {"ready": False, "detail": str(exc)}

    storage_checks: dict[str, dict[str, object]] = {}
    storage_ready = True
    for name, path in settings.runtime_directories().items():
        ready = path.exists() and path.is_dir() and os.access(path, os.R_OK | os.W_OK)
        storage_checks[name] = {"path": str(path), "ready": ready}
        storage_ready = storage_ready and ready

    ready = database_check["ready"] and storage_ready
    payload = {
        "status": "ready" if ready else "not_ready",
        "service": "backend",
        "checks": {
            "database": database_check,
            "storage": storage_checks,
        },
    }
    return (200 if ready else 503), payload


@app.get("/readyz")
def readyz():
    status_code, payload = _build_readiness_payload()
    return JSONResponse(status_code=status_code, content=payload)
