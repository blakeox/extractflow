export type WorkspaceUrlState = {
  jobId: number | null;
  resultId: number | null;
  status: string | null;
};

export function parseWorkspaceSearch(search: string): WorkspaceUrlState {
  const params = new URLSearchParams(search);
  const jobParam = params.get("job");
  const resultParam = params.get("result");
  return {
    jobId:
      jobParam && !Number.isNaN(Number(jobParam)) ? Number(jobParam) : null,
    resultId:
      resultParam && !Number.isNaN(Number(resultParam))
        ? Number(resultParam)
        : null,
    status: params.get("status"),
  };
}

export function buildWorkspaceSearch(state: WorkspaceUrlState): string {
  const params = new URLSearchParams();
  if (state.jobId != null) {
    params.set("job", String(state.jobId));
  }
  if (state.resultId != null) {
    params.set("result", String(state.resultId));
  }
  if (state.status) {
    params.set("status", state.status);
  }
  const serialized = params.toString();
  return serialized ? `?${serialized}` : "";
}

export function replaceWorkspaceUrl(state: WorkspaceUrlState) {
  const next = `${window.location.pathname}${buildWorkspaceSearch(state)}`;
  window.history.replaceState(null, "", next);
}
