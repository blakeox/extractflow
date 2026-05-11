from __future__ import annotations

from app.services.provider_health import get_provider_health
from app.services.provider_probe import probe_provider
from extraction_core.models import LLMProviderCapabilities, LLMProviderCatalogEntry, LLMProviderSettings


def build_langextract_catalog_entry(*, mode: str = "local", allow_external_processing: bool = False):
    settings = LLMProviderSettings.model_construct(
        mode=mode,
        provider_type="langextract",
        provider_label="LangExtract (Ollama)",
        api_style="langextract",
        base_url="http://host.docker.internal:11434/v1",
        api_key_env_var=None,
        api_key_required=False,
        deployment=None,
        api_version=None,
        model="qwen3.5:27b",
        temperature=0.1,
        max_tokens=4000,
        supports_json_mode=False,
        allow_external_processing=allow_external_processing,
        timeout_seconds=120,
        retry_count=2,
        chunk_size=16000,
    )
    return LLMProviderCatalogEntry.model_construct(
        key="langextract",
        label="LangExtract (Ollama)",
        description="Experimental local-only grounded extraction.",
        mode="local",
        provider_type="langextract",
        api_style="langextract",
        base_url="http://host.docker.internal:11434/v1",
        model="qwen3.5:27b",
        enabled=True,
        recommended=False,
        api_key_env_var=None,
        deployment=None,
        tags=["local"],
        capabilities=LLMProviderCapabilities(),
        settings=settings,
    )


def test_langextract_health_is_not_probe_required_when_mode_is_invalid() -> None:
    health = get_provider_health(build_langextract_catalog_entry(mode="cloud"))

    assert health["ready"] is False
    assert health["status"] == "not_ready"
    assert "LangExtract is only supported in local mode" in health["checks"]


def test_langextract_health_is_not_probe_required_when_external_processing_is_enabled() -> None:
    health = get_provider_health(build_langextract_catalog_entry(allow_external_processing=True))

    assert health["ready"] is False
    assert health["status"] == "not_ready"
    assert "LangExtract v1 must keep allow_external_processing disabled" in health["checks"]


def test_langextract_probe_accepts_minimal_generation_request(monkeypatch) -> None:
    settings = LLMProviderSettings(
        mode="local",
        provider_type="langextract",
        provider_label="LangExtract (Ollama)",
        api_style="langextract",
        base_url="http://host.docker.internal:11434/v1",
        model="qwen3.5:27b",
        supports_json_mode=False,
        allow_external_processing=False,
    )

    class FakeResponse:
        status_code = 200

    class FakeClient:
        def __init__(self, timeout: int):
            self.timeout = timeout

        def __enter__(self):
            return self

        def __exit__(self, exc_type, exc, tb):
            return False

        def post(self, url: str, json: dict, headers: dict):
            assert url == "http://host.docker.internal:11434/api/generate"
            assert json == {
                "model": "qwen3.5:27b",
                "prompt": "ping",
                "stream": False,
                "options": {"num_predict": 1},
            }
            assert headers == {"Content-Type": "application/json"}
            return FakeResponse()

    monkeypatch.setattr("app.services.provider_probe.httpx.Client", FakeClient)

    result = probe_provider(settings)

    assert result["reachable"] is True
    assert result["status"] == "reachable"
    assert result["detail"] == "Ollama runtime accepted a minimal generation request for model 'qwen3.5:27b'."


def test_langextract_probe_reports_generate_error_body(monkeypatch) -> None:
    settings = LLMProviderSettings(
        mode="local",
        provider_type="langextract",
        provider_label="LangExtract (Ollama)",
        api_style="langextract",
        base_url="http://host.docker.internal:11434/v1",
        model="qwen3.5:27b",
        supports_json_mode=False,
        allow_external_processing=False,
    )

    class FakeResponse:
        status_code = 404
        text = ""

        @staticmethod
        def json():
            return {"error": "model 'qwen3.5:27b' not found"}

    class FakeClient:
        def __init__(self, timeout: int):
            self.timeout = timeout

        def __enter__(self):
            return self

        def __exit__(self, exc_type, exc, tb):
            return False

        def post(self, url: str, json: dict, headers: dict):
            return FakeResponse()

    monkeypatch.setattr("app.services.provider_probe.httpx.Client", FakeClient)

    result = probe_provider(settings)

    assert result["reachable"] is False
    assert result["status"] == "not_ready"
    assert result["detail"] == "model 'qwen3.5:27b' not found"
