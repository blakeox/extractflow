from __future__ import annotations

from app import main as worker_main


def test_initialize_worker_runtime_records_docling_startup_details(monkeypatch) -> None:
    statuses: list[tuple[str, dict | None]] = []

    monkeypatch.setattr(
        worker_main.settings.__class__,
        "ensure_paths",
        lambda self: None,
    )
    monkeypatch.setattr(worker_main.settings, "docling_enabled", True)
    monkeypatch.setattr(worker_main.settings, "docling_prewarm", True)
    monkeypatch.setattr(worker_main.settings, "docling_pdf_ocr_retry", True)
    monkeypatch.setattr(worker_main.settings, "docling_image_ocr", False)
    monkeypatch.setattr(
        worker_main,
        "write_worker_status",
        lambda state, details=None: statuses.append((state, details)),
    )
    monkeypatch.setattr(
        worker_main,
        "prewarm_docling_converters",
        lambda: {"status": "completed", "attempted": True, "warmed_targets": ["pdf:plain"]},
    )

    worker_main.initialize_worker_runtime()

    assert statuses[0] == (
        "starting",
        {
            "docling_enabled": True,
            "docling_prewarm": True,
            "docling_pdf_ocr_retry": True,
            "docling_image_ocr": False,
        },
    )
    assert statuses[1] == (
        "starting",
        {
            "docling_enabled": True,
            "docling_prewarm": True,
            "docling_pdf_ocr_retry": True,
            "docling_image_ocr": False,
            "docling_prewarm_result": {
                "status": "completed",
                "attempted": True,
                "warmed_targets": ["pdf:plain"],
            },
        },
    )


def test_main_prewarms_docling_when_enabled(monkeypatch) -> None:
    events: list[object] = []

    monkeypatch.setattr(
        worker_main.settings.__class__,
        "ensure_paths",
        lambda self: events.append("ensure_paths"),
    )
    monkeypatch.setattr(worker_main.settings, "docling_prewarm", True)
    monkeypatch.setattr(
        worker_main, "write_worker_status", lambda state, details=None: events.append(("status", state))
    )
    monkeypatch.setattr(
        worker_main,
        "prewarm_docling_converters",
        lambda: events.append("prewarm") or {"status": "completed", "attempted": True, "warmed_targets": []},
    )

    class StopLoop(RuntimeError):
        pass

    def stop_after_first_iteration() -> None:
        events.append("process_once")
        raise StopLoop

    monkeypatch.setattr(worker_main, "process_once", stop_after_first_iteration)
    monkeypatch.setattr(worker_main.time, "sleep", lambda _seconds: None)

    try:
        worker_main.main()
    except StopLoop:
        pass

    assert events[:5] == ["ensure_paths", ("status", "starting"), "prewarm", ("status", "starting"), "process_once"]


def test_main_skips_docling_prewarm_when_disabled(monkeypatch) -> None:
    events: list[object] = []

    monkeypatch.setattr(
        worker_main.settings.__class__,
        "ensure_paths",
        lambda self: events.append("ensure_paths"),
    )
    monkeypatch.setattr(worker_main.settings, "docling_prewarm", False)
    monkeypatch.setattr(
        worker_main, "write_worker_status", lambda state, details=None: events.append(("status", state))
    )
    monkeypatch.setattr(worker_main, "prewarm_docling_converters", lambda: events.append("prewarm"))

    class StopLoop(RuntimeError):
        pass

    def stop_after_first_iteration() -> None:
        events.append("process_once")
        raise StopLoop

    monkeypatch.setattr(worker_main, "process_once", stop_after_first_iteration)
    monkeypatch.setattr(worker_main.time, "sleep", lambda _seconds: None)

    try:
        worker_main.main()
    except StopLoop:
        pass

    assert events[:3] == ["ensure_paths", ("status", "starting"), "process_once"]
    assert "prewarm" not in events
