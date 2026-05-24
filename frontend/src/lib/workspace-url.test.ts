import { describe, expect, it } from "vitest";

import { buildWorkspaceSearch, parseWorkspaceSearch } from "./workspace-url";

describe("workspace-url", () => {
  it("round-trips job and status params", () => {
    const parsed = parseWorkspaceSearch("?job=12&status=failed");
    expect(parsed.jobId).toBe(12);
    expect(parsed.status).toBe("failed");
    expect(buildWorkspaceSearch(parsed)).toBe("?job=12&status=failed");
  });
});
