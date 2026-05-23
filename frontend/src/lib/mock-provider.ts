export const MOCK_PROVIDER_WARNING_DISMISS_KEY =
  "extractflow-dismiss-mock-provider-warning";

type ProviderLike = {
  provider_type?: string;
  api_style?: string;
};

export function isBootstrapMockProvider(
  settings: ProviderLike | null | undefined,
): boolean {
  if (!settings) {
    return false;
  }
  return settings.provider_type === "mock" || settings.api_style === "mock";
}

export function readMockProviderWarningDismissed(): boolean {
  if (typeof window === "undefined") {
    return false;
  }
  return (
    window.localStorage.getItem(MOCK_PROVIDER_WARNING_DISMISS_KEY) === "true"
  );
}

export function dismissMockProviderWarning(): void {
  if (typeof window === "undefined") {
    return;
  }
  window.localStorage.setItem(MOCK_PROVIDER_WARNING_DISMISS_KEY, "true");
}
