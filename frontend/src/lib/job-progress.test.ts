import { describe, expect, it } from "vitest";

import { clampProgressPct, getJobStageLabel } from "./job-progress";

describe("job-progress helpers", () => {
  it("labels known stages", () => {
    expect(getJobStageLabel("parsing")).toBe("Parsing document");
    expect(getJobStageLabel("unknown_stage")).toBe("unknown stage");
  });

  it("clamps progress values", () => {
    expect(clampProgressPct(150)).toBe(100);
    expect(clampProgressPct(-5)).toBe(0);
    expect(clampProgressPct(null)).toBe(0);
  });
});
