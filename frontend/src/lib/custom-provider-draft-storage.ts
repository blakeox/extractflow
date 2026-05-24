export const CUSTOM_PROVIDER_DRAFT_STORAGE_KEY = "custom-provider-draft";

/** Fields safe to persist locally (no secret names or credential material). */
export type PersistedCustomProviderDraft = {
  label: string;
  mode: "local" | "cloud";
  api_style: "openai_compatible" | "azure_openai";
  provider_type: string;
  base_url: string;
  model: string;
  deployment: string;
  api_version: string;
  allow_external_processing: boolean;
  supports_json_mode: boolean;
  temperature: string;
  max_tokens: string;
  timeout_seconds: string;
  retry_count: string;
  chunk_size: string;
};

export type CustomProviderDraftWithEnvVar = PersistedCustomProviderDraft & {
  api_key_env_var: string;
};

export function toPersistedCustomProviderDraft(
  draft: CustomProviderDraftWithEnvVar,
): PersistedCustomProviderDraft {
  return {
    label: draft.label,
    mode: draft.mode,
    api_style: draft.api_style,
    provider_type: draft.provider_type,
    base_url: draft.base_url,
    model: draft.model,
    deployment: draft.deployment,
    api_version: draft.api_version,
    allow_external_processing: draft.allow_external_processing,
    supports_json_mode: draft.supports_json_mode,
    temperature: draft.temperature,
    max_tokens: draft.max_tokens,
    timeout_seconds: draft.timeout_seconds,
    retry_count: draft.retry_count,
    chunk_size: draft.chunk_size,
  };
}

function browserLocalStorage(): Storage | null {
  return globalThis.localStorage ?? null;
}

export function readPersistedCustomProviderDraft(
  fallback: CustomProviderDraftWithEnvVar,
): CustomProviderDraftWithEnvVar {
  const storage = browserLocalStorage();
  if (!storage) {
    return fallback;
  }

  const savedDraft = storage.getItem(CUSTOM_PROVIDER_DRAFT_STORAGE_KEY);
  if (!savedDraft) {
    return fallback;
  }

  try {
    const parsed = JSON.parse(
      savedDraft,
    ) as Partial<PersistedCustomProviderDraft>;
    return {
      ...fallback,
      ...parsed,
      api_key_env_var: fallback.api_key_env_var,
    };
  } catch {
    storage.removeItem(CUSTOM_PROVIDER_DRAFT_STORAGE_KEY);
    return fallback;
  }
}

export function writePersistedCustomProviderDraft(
  draft: CustomProviderDraftWithEnvVar,
): void {
  const storage = browserLocalStorage();
  if (!storage) {
    return;
  }
  storage.setItem(
    CUSTOM_PROVIDER_DRAFT_STORAGE_KEY,
    JSON.stringify(toPersistedCustomProviderDraft(draft)),
  );
}
