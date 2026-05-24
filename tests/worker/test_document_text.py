from __future__ import annotations

from app.services.document_text import parse_and_persist_document_text


def test_parse_and_persist_document_text_writes_managed_reference(
    monkeypatch,
    tmp_path,
) -> None:
    from app.core.config import settings

    data_dir = tmp_path / "data"
    parsed_dir = data_dir / "parsed"
    parsed_dir.mkdir(parents=True)
    monkeypatch.setattr(settings, "data_dir", str(data_dir))
    monkeypatch.setattr(settings, "parsed_dir", str(parsed_dir))

    document_path = tmp_path / "invoice.txt"
    document_path.write_text("Invoice total 1200", encoding="utf-8")

    reference, text = parse_and_persist_document_text(42, str(document_path))

    assert text == "Invoice total 1200"
    assert reference.startswith("parsed/")
    stored = data_dir / reference
    assert stored.read_text(encoding="utf-8") == "Invoice total 1200"
