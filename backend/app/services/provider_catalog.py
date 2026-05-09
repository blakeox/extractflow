from __future__ import annotations

import json

from extraction_core.models import LLMProviderCapabilities, LLMProviderCatalogEntry, LLMProviderSettings

from app.core.config import settings


def list_provider_catalog() -> list[LLMProviderCatalogEntry]:
    catalog = [
        _catalog_entry(
            key="mock",
            label="Mock Extractor",
            description="Bootstrap provider for local workflow validation without a live model runtime.",
            mode="local",
            provider_type="mock",
            api_style="mock",
            model="mock-extractor",
            recommended=False,
            tags=["bootstrap", "test", "offline"],
            capabilities=LLMProviderCapabilities(
                supports_chat_completions=False,
                supports_json_mode=True,
                supports_streaming=False,
                supports_remote_processing=False,
                requires_api_key=False,
                supports_local_runtime=True,
            ),
            settings=LLMProviderSettings(
                mode="local",
                provider_type="mock",
                provider_label="Mock Extractor",
                api_style="mock",
                model="mock-extractor",
                supports_json_mode=True,
                allow_external_processing=False,
            ),
        ),
        _catalog_entry(
            key="langextract-ollama",
            label="LangExtract (Ollama)",
            description="Experimental grounded extraction adapter using LangExtract with a local Ollama runtime.",
            mode="local",
            provider_type="langextract",
            api_style="langextract",
            base_url=settings.default_local_provider_base_url,
            model="qwen3.5:27b",
            recommended=False,
            tags=["local", "experimental", "grounded", "ollama"],
            capabilities=LLMProviderCapabilities(
                supports_chat_completions=False,
                supports_json_mode=False,
                supports_streaming=False,
                supports_remote_processing=False,
                requires_api_key=False,
                supports_local_runtime=True,
            ),
            settings=LLMProviderSettings(
                mode="local",
                provider_type="langextract",
                provider_label="LangExtract (Ollama)",
                api_style="langextract",
                base_url=settings.default_local_provider_base_url,
                model="qwen3.5:27b",
                supports_json_mode=False,
                allow_external_processing=False,
            ),
        ),
        _catalog_entry(
            key="ollama-qwen35",
            label="Ollama",
            description="Local runtime through an OpenAI-compatible gateway exposed by Ollama.",
            mode="local",
            provider_type="ollama",
            base_url=settings.default_local_provider_base_url,
            model="qwen3.5:27b",
            recommended=True,
            tags=["local", "docker", "ollama"],
            capabilities=LLMProviderCapabilities(supports_local_runtime=True),
            settings=LLMProviderSettings(
                mode="local",
                provider_type="ollama",
                provider_label="Ollama",
                api_style="openai_compatible",
                base_url=settings.default_local_provider_base_url,
                model="qwen3.5:27b",
                supports_json_mode=True,
                allow_external_processing=False,
            ),
        ),
        _catalog_entry(
            key="lm-studio-mistral",
            label="LM Studio",
            description="Desktop local model runtime with an OpenAI-compatible local server.",
            mode="local",
            provider_type="lm_studio",
            base_url=settings.default_lm_studio_base_url,
            model="mistral-nemo-instruct",
            tags=["local", "desktop", "openai-compatible"],
            capabilities=LLMProviderCapabilities(supports_local_runtime=True),
            settings=LLMProviderSettings(
                mode="local",
                provider_type="lm_studio",
                provider_label="LM Studio",
                api_style="openai_compatible",
                base_url=settings.default_lm_studio_base_url,
                model="mistral-nemo-instruct",
                supports_json_mode=True,
                allow_external_processing=False,
            ),
        ),
        _catalog_entry(
            key="openai-gpt41",
            label="OpenAI",
            description="Managed cloud inference for strong structured extraction performance.",
            mode="cloud",
            provider_type="openai",
            base_url=settings.default_openai_base_url,
            model="gpt-4.1",
            tags=["cloud", "managed", "structured-output"],
            capabilities=LLMProviderCapabilities(
                supports_remote_processing=True,
                requires_api_key=True,
            ),
            settings=LLMProviderSettings(
                mode="cloud",
                provider_type="openai",
                provider_label="OpenAI",
                api_style="openai_compatible",
                base_url=settings.default_openai_base_url,
                api_key_env_var="OPENAI_API_KEY",
                api_key_required=True,
                model="gpt-4.1",
                supports_json_mode=True,
                allow_external_processing=True,
            ),
        ),
        _catalog_entry(
            key="azure-openai-gpt41-mini",
            label="Azure OpenAI",
            description="Azure-hosted OpenAI deployment with deployment-scoped routing and Azure API key auth.",
            mode="cloud",
            provider_type="azure_openai",
            api_style="azure_openai",
            base_url=settings.default_azure_openai_base_url,
            model="gpt-4.1-mini",
            deployment=settings.default_azure_openai_deployment,
            tags=["cloud", "azure", "deployment-scoped"],
            capabilities=LLMProviderCapabilities(
                supports_remote_processing=True,
                requires_api_key=True,
            ),
            settings=LLMProviderSettings(
                mode="cloud",
                provider_type="azure_openai",
                provider_label="Azure OpenAI",
                api_style="azure_openai",
                base_url=settings.default_azure_openai_base_url,
                api_key_env_var="AZURE_OPENAI_API_KEY",
                api_key_required=True,
                deployment=settings.default_azure_openai_deployment,
                api_version=settings.default_azure_openai_api_version,
                model="gpt-4.1-mini",
                supports_json_mode=True,
                allow_external_processing=True,
            ),
        ),
        _catalog_entry(
            key="deepseek-chat",
            label="DeepSeek",
            description="Cloud provider with OpenAI-compatible chat completions and lower-cost options.",
            mode="cloud",
            provider_type="deepseek",
            base_url=settings.default_deepseek_base_url,
            model="deepseek-chat",
            tags=["cloud", "cost-optimized", "openai-compatible"],
            capabilities=LLMProviderCapabilities(
                supports_remote_processing=True,
                requires_api_key=True,
            ),
            settings=LLMProviderSettings(
                mode="cloud",
                provider_type="deepseek",
                provider_label="DeepSeek",
                api_style="openai_compatible",
                base_url=settings.default_deepseek_base_url,
                api_key_env_var="DEEPSEEK_API_KEY",
                api_key_required=True,
                model="deepseek-chat",
                supports_json_mode=True,
                allow_external_processing=True,
            ),
        ),
        _catalog_entry(
            key="kimi-k2",
            label="Kimi",
            description="Moonshot Kimi endpoint exposed through an OpenAI-compatible API surface.",
            mode="cloud",
            provider_type="kimi",
            base_url=settings.default_kimi_base_url,
            model="kimi-k2-0711-preview",
            tags=["cloud", "moonshot", "openai-compatible"],
            capabilities=LLMProviderCapabilities(
                supports_remote_processing=True,
                requires_api_key=True,
            ),
            settings=LLMProviderSettings(
                mode="cloud",
                provider_type="kimi",
                provider_label="Kimi",
                api_style="openai_compatible",
                base_url=settings.default_kimi_base_url,
                api_key_env_var="KIMI_API_KEY",
                api_key_required=True,
                model="kimi-k2-0711-preview",
                supports_json_mode=True,
                allow_external_processing=True,
            ),
        ),
    ]
    catalog.extend(_load_custom_catalog())
    return catalog


def _catalog_entry(**kwargs) -> LLMProviderCatalogEntry:
    return LLMProviderCatalogEntry.model_validate(kwargs)


def _load_custom_catalog() -> list[LLMProviderCatalogEntry]:
    if not settings.provider_catalog_json:
        return []
    raw = json.loads(settings.provider_catalog_json)
    if not isinstance(raw, list):
        raise ValueError("PROVIDER_CATALOG_JSON must be a JSON array.")
    return [LLMProviderCatalogEntry.model_validate(item) for item in raw]
