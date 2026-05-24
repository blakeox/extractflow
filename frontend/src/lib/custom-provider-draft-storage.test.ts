import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  CUSTOM_PROVIDER_DRAFT_STORAGE_KEY,
  readPersistedCustomProviderDraft,
  toPersistedCustomProviderDraft,
  writePersistedCustomProviderDraft,
  type CustomProviderDraftWithEnvVar,
} from "./custom-provider-draft-storage";

const fallback: CustomProviderDraftWithEnvVar = {
  label: "Private Gateway",
  mode: "local",
  api_style: "openai_compatible",
  provider_type: "private_gateway",
  base_url: "http://localhost:8001/v1",
  api_key_env_var: "OPENAI_API_KEY",
  model: "document-extractor-default",
  deployment: "",
  api_version: "2024-10-21",
  allow_external_processing: false,
  supports_json_mode: true,
  temperature: "0.1",
  max_tokens: "6000",
  timeout_seconds: "120",
  retry_count: "2",
  chunk_size: "16000",
};

describe("custom-provider-draft-storage", () => {
  beforeEach(() => {
    vi.mocked(window.localStorage.setItem).mockClear();
    vi.mocked(window.localStorage.getItem).mockReturnValue(null);
  });

  it("does not persist api_key_env_var in localStorage", () => {
    writePersistedCustomProviderDraft({
      ...fallback,
      api_key_env_var: "SECRET_ENV_VAR",
      label: "Updated Gateway",
    });

    expect(window.localStorage.setItem).toHaveBeenCalledTimes(1);
    const [key, value] = vi.mocked(window.localStorage.setItem).mock.calls[0];
    expect(key).toBe(CUSTOM_PROVIDER_DRAFT_STORAGE_KEY);
    const parsed = JSON.parse(String(value)) as Record<string, unknown>;
    expect(parsed).not.toHaveProperty("api_key_env_var");
    expect(JSON.stringify(parsed)).not.toContain("SECRET_ENV_VAR");
    expect(parsed.label).toBe("Updated Gateway");
  });

  it("restores fallback api_key_env_var when reading persisted draft", () => {
    vi.mocked(window.localStorage.getItem).mockReturnValue(
      JSON.stringify({
        label: "Stored Gateway",
        mode: "local",
        api_style: "openai_compatible",
        provider_type: "private_gateway",
        base_url: "http://localhost:8001/v1",
        model: "document-extractor-default",
        deployment: "",
        api_version: "2024-10-21",
        allow_external_processing: false,
        supports_json_mode: true,
        temperature: "0.1",
        max_tokens: "6000",
        timeout_seconds: "120",
        retry_count: "2",
        chunk_size: "16000",
      }),
    );

    const restored = readPersistedCustomProviderDraft(fallback);
    expect(restored.label).toBe("Stored Gateway");
    expect(restored.api_key_env_var).toBe(fallback.api_key_env_var);
  });

  it("strips api_key_env_var when serializing", () => {
    const persisted = toPersistedCustomProviderDraft({
      ...fallback,
      api_key_env_var: "SHOULD_NOT_APPEAR",
    });

    expect(persisted).not.toHaveProperty("api_key_env_var");
  });
});
