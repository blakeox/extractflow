import { describe, expect, it, vi } from "vitest";

import {
  dismissMockProviderWarning,
  isBootstrapMockProvider,
  MOCK_PROVIDER_WARNING_DISMISS_KEY,
  readMockProviderWarningDismissed,
} from "./mock-provider";

describe("mock-provider", () => {
  it("detects bootstrap mock providers", () => {
    expect(isBootstrapMockProvider({ provider_type: "mock" })).toBe(true);
    expect(isBootstrapMockProvider({ api_style: "mock" })).toBe(true);
    expect(isBootstrapMockProvider({ provider_type: "langextract" })).toBe(
      false,
    );
  });

  it("reads and writes dismiss state via localStorage", () => {
    const getItem = vi.fn(() => null);
    const setItem = vi.fn();
    Object.defineProperty(window, "localStorage", {
      value: { getItem, setItem, removeItem: vi.fn(), clear: vi.fn() },
      writable: true,
    });

    expect(readMockProviderWarningDismissed()).toBe(false);
    dismissMockProviderWarning();
    expect(setItem).toHaveBeenCalledWith(
      MOCK_PROVIDER_WARNING_DISMISS_KEY,
      "true",
    );

    getItem.mockReturnValue("true");
    expect(readMockProviderWarningDismissed()).toBe(true);
  });
});
