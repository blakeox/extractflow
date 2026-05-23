from __future__ import annotations

from typing import Final

JOB_STAGE_QUEUED: Final = "queued"
JOB_STAGE_PARSING: Final = "parsing"
JOB_STAGE_EXTRACTING: Final = "extracting"
JOB_STAGE_VALIDATING: Final = "validating"
JOB_STAGE_CALCULATING: Final = "calculating"
JOB_STAGE_COMPLETED: Final = "completed"
JOB_STAGE_FAILED: Final = "failed"

JOB_STAGE_PROGRESS_PCT: dict[str, int] = {
    JOB_STAGE_QUEUED: 0,
    JOB_STAGE_PARSING: 15,
    JOB_STAGE_EXTRACTING: 45,
    JOB_STAGE_VALIDATING: 70,
    JOB_STAGE_CALCULATING: 85,
    JOB_STAGE_COMPLETED: 100,
    JOB_STAGE_FAILED: 0,
}

JOB_STAGE_LABELS: dict[str, str] = {
    JOB_STAGE_QUEUED: "Waiting in queue",
    JOB_STAGE_PARSING: "Parsing document",
    JOB_STAGE_EXTRACTING: "Extracting fields",
    JOB_STAGE_VALIDATING: "Validating results",
    JOB_STAGE_CALCULATING: "Running calculations",
    JOB_STAGE_COMPLETED: "Complete",
    JOB_STAGE_FAILED: "Failed",
}
