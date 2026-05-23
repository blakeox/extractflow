const JOB_STAGE_LABELS: Record<string, string> = {
  queued: "Waiting in queue",
  parsing: "Parsing document",
  extracting: "Extracting fields",
  validating: "Validating results",
  calculating: "Running calculations",
  completed: "Complete",
  failed: "Failed",
  running: "Processing",
};

export function getJobStageLabel(stage: string | null | undefined): string {
  if (!stage) {
    return "Processing";
  }
  return JOB_STAGE_LABELS[stage] ?? stage.replace(/_/g, " ");
}

export function clampProgressPct(value: number | null | undefined): number {
  if (value == null || Number.isNaN(value)) {
    return 0;
  }
  return Math.max(0, Math.min(100, Math.round(value)));
}
