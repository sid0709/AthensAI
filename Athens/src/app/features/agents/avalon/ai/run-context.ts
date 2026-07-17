/** Per-run correlation context for agent AI calls (runId, jobId, feature). */

let runContext: {
  runId?: string;
  jobId?: string;
  feature?: string;
} = {};

export function setAgentRunContext(ctx: { runId?: string; jobId?: string; feature?: string }): void {
  runContext = { ...ctx };
}

export function clearAgentRunContext(): void {
  runContext = {};
}

export function getAgentRunContext() {
  return { ...runContext };
}
