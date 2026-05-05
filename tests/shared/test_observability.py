from __future__ import annotations

import json
import logging

from extraction_core.observability import JsonFormatter


def test_json_formatter_includes_event_fields() -> None:
    formatter = JsonFormatter()
    record = logging.LogRecord(
        name="extractflow.test",
        level=logging.INFO,
        pathname=__file__,
        lineno=1,
        msg="request_completed",
        args=(),
        exc_info=None,
    )
    record.event_data = {"event": "request_completed", "request_id": "req-123", "status_code": 200}

    payload = json.loads(formatter.format(record))

    assert payload["logger"] == "extractflow.test"
    assert payload["event"] == "request_completed"
    assert payload["request_id"] == "req-123"
    assert payload["status_code"] == 200
