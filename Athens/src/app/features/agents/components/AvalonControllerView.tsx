import { useMemo, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  Circle,
  Copy,
  ExternalLink,
  Layers,
  ListOrdered,
  Loader2,
  Pause,
  Play,
  Square,
  RefreshCw,
  Scan,
  Settings2,
  Sparkles,
  Terminal,
  TreePine,
  Zap,
} from "lucide-react";
import type { ActionableTree } from "@avalon/shared";
import { useApplier } from "@/context/applier-context";
import { cn } from "../../../lib/utils";
import { useSessionRelay } from "../context/AgentSessionsContext";
import type { JobPipelineState, useAvalonRelay } from "../hooks/useAvalonRelay";
import { ApplyStatusPanel } from "./ApplyStatusPanel";
import { DEFAULT_JOB_BUDGET_USD } from "../lib/agentBudget";
import { isBetaTier } from "../../../lib/beta";
import { AgentResumePdfPreview, agentJobResumePdfUrl } from "./AgentResumePdfPreview";
import { resolveProfileDefaultModel } from "../avalon/ai/model";
import { formatAgentRate, resolveAgentModelPricing, type AgentPricingRates } from "../avalon/ai/pricing";

const WORKSPACE_PANEL =
  "rounded-2xl border border-border/80 bg-card shadow-sm flex flex-col min-w-0 overflow-hidden";
/** Shared height for Queue / Activity / Pipeline — scroll inside, not viewport-stretched */
const MAIN_PANEL_H = "h-[440px]";
/** Preview row below the three columns */
const PREVIEW_PANEL_H = "h-[380px]";

function pipelineStepClass(step: number, highlightStep: number, done: boolean, enabled: boolean): string {
  return cn(
    "w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl text-sm font-semibold transition-all border",
    highlightStep === step && "ring-2 ring-violet-500 border-violet-500/50 bg-violet-500/10 shadow-sm",
    done && highlightStep !== step && "border-emerald-500/30 bg-emerald-500/5 text-emerald-800",
    !done && highlightStep !== step && "border-border hover:bg-secondary",
    !enabled && "opacity-40 cursor-not-allowed hover:bg-transparent",
  );
}

function nextPipelineStep(pipeline: JobPipelineState): number {
  if (!pipeline.opened) return 2;
  if (!pipeline.validated) return 3;
  if (!pipeline.resumeReady) return 4;
  if (!pipeline.scanned) return 5;
  if (!pipeline.analyzed) return 6;
  if (!pipeline.applied) return 7;
  if (!pipeline.verified) return 8;
  return 8;
}

const RESUME_SECTION_LABELS: { id: "summary" | "skills" | "experience"; label: string }[] = [
  { id: "summary", label: "Summary" },
  { id: "skills", label: "Skills" },
  { id: "experience", label: "Experience" },
];

function applyDisabledReason(relay: ReturnType<typeof useAvalonRelay>, hasPlan: boolean): string | null {
  if (!hasPlan) return "Run Analyze first to build a fill plan.";
  if (relay.analyzing) return "Analysis still running…";
  if (relay.applying) return "Apply already in progress…";
  if (!relay.treePage?.tabId) return "Tab context lost — open the job and scan the form again.";
  if (!relay.canExecute) {
    return relay.executeDisabledReason ?? "Extension disconnected — click Reconnect in settings.";
  }
  const job = relay.jobQueue[relay.activeJobIndex];
  if (job && !job.id.startsWith("manual:") && job.source !== "manual" && !relay.activeResume?.file.base64 && !relay.activeResume?.resumePdfPath) {
    return "Generate tailored résumé first (step 4) and preview the PDF.";
  }
  return null;
}

function fieldId(groupIdx: number, childIdx: number): string {
  return `${groupIdx}:${childIdx}`;
}

function treeFieldLabel(tree: ActionableTree, id: string): string {
  const [groupIdx, childIdx] = id.split(":").map((part) => Number(part));
  if (!Number.isFinite(groupIdx) || !Number.isFinite(childIdx)) return id;
  return tree[groupIdx]?.children[childIdx]?.target ?? id;
}

type WorkflowStep = {
  id: string;
  label: string;
  done: boolean;
  active: boolean;
};

type WorkflowIconState = "done" | "active" | "idle";

function workflowIconState(step: WorkflowStep): WorkflowIconState {
  if (step.done) return "done";
  if (step.active) return "active";
  return "idle";
}

function formatPricingPolicy(rates?: AgentPricingRates | null): string {
  if (!rates) return "Pricing pending";
  return `${formatAgentRate(rates.promptPer1M)} in / ${formatAgentRate(rates.completionPer1M)} out per 1M`;
}

/** Stable CSS-only icon slot — avoids SVG swaps while extensions may wrap nearby text nodes. */
function WorkflowStepIcon({ state }: { state: WorkflowIconState }) {
  return (
    <span
      className={cn(
        "inline-flex size-3.5 shrink-0 items-center justify-center rounded-full border text-[9px] leading-none transition-colors",
        state === "done" && "border-emerald-500 bg-emerald-500 text-white",
        state === "active" && "border-violet-500 bg-violet-500",
        state === "idle" && "border-current text-muted-foreground",
      )}
      aria-hidden
    >
      <span className={cn("hidden h-1.5 w-2 -rotate-45 border-b border-l border-white", state === "done" && "block")} />
    </span>
  );
}

function WorkflowRail({ steps }: { steps: WorkflowStep[] }) {
  return (
    <div className="flex items-center gap-1 overflow-x-auto pb-1">
      {steps.map((step, i) => (
        <div key={step.id} className="flex items-center shrink-0">
          <div
            className={cn(
              "flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-semibold transition-colors",
              step.done && "bg-emerald-500/10 text-emerald-700",
              step.active && !step.done && "bg-violet-500/15 text-violet-700 ring-1 ring-violet-500/30",
              !step.done && !step.active && "text-muted-foreground",
            )}
          >
            <WorkflowStepIcon state={workflowIconState(step)} />
            <span className="whitespace-nowrap">{step.label}</span>
          </div>
          {i < steps.length - 1 && <span className="w-3 h-px bg-border mx-0.5 shrink-0" aria-hidden />}
        </div>
      ))}
    </div>
  );
}

function StatusDot({ ok, warn }: { ok?: boolean; warn?: boolean }) {
  return (
    <span
      className={cn(
        "w-2 h-2 rounded-full shrink-0",
        ok && "bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.6)]",
        warn && !ok && "bg-amber-500 shadow-[0_0_8px_rgba(245,158,11,0.5)]",
        !ok && !warn && "bg-red-500/80",
      )}
    />
  );
}

export function AvalonControllerView({
  onQueueJobs,
}: {
  onQueueJobs?: () => void;
}) {
  const { applier } = useApplier();
  const [showSettings, setShowSettings] = useState(false);

  // The relay lives in a persistent per-session engine (AgentSessionsProvider), so
  // state survives navigation and background runs; here we just consume it.
  const relay = useSessionRelay();

  const selectedFieldLabel =
    relay.selectedTreeFieldId && relay.actionableTree
      ? treeFieldLabel(relay.actionableTree, relay.selectedTreeFieldId)
      : null;

  const activeJob = relay.jobQueue[relay.activeJobIndex];
  const profileDefaultModel = useMemo(
    () => resolveProfileDefaultModel(applier?.autoBidProfile as Record<string, unknown> | undefined),
    [applier?.autoBidProfile],
  );
  const latestRateRequest = useMemo(
    () => [...relay.jobUsage.requests].reverse().find((request) => request.pricingRates),
    [relay.jobUsage.requests],
  );
  const latestModelRequest = useMemo(
    () => [...relay.jobUsage.requests].reverse().find((request) => request.model),
    [relay.jobUsage.requests],
  );
  const activeAiModel = latestModelRequest?.model || latestRateRequest?.model || profileDefaultModel || "Expected model (profile default)";
  const inferredPricing = resolveAgentModelPricing(profileDefaultModel);
  const activePricingRates = latestRateRequest?.pricingRates ?? null;
  const activeProvider = latestRateRequest?.provider ?? null;
  const activePricingPolicy = activePricingRates
    ? formatPricingPolicy(activePricingRates)
    : inferredPricing
      ? `Est. ${formatPricingPolicy(inferredPricing.rates)}`
      : "Rates pending first response";
  const pipeline = relay.activePipeline;
  const hasTree = pipeline.scanned && Boolean(relay.actionableTree?.length);
  const hasPlan = pipeline.analyzed && Boolean(relay.formAnalysis?.fields.length);
  const hasResumeDraft = pipeline.resumeReady;
  const liveOk = relay.connected && relay.peers.extension;
  const applyBlocked = applyDisabledReason(relay, hasPlan);
  const canApply = hasPlan && !applyBlocked;
  const pipelineLocked = relay.autoRunning || relay.applying;
  const verifyWaiting = relay.applyPhase?.phase === "verify-wait";
  const verifyWaitSeconds = verifyWaiting ? relay.applyPhase?.secondsLeft : undefined;
  const showPreviewWorkspace = hasTree || Boolean(activeJob || relay.generatingResume || relay.activeResume || relay.resumeError);
  const kitSubmitActive = Boolean(activeJob && relay.kitSubmitJobId === activeJob.id);

  const highlightStep = useMemo(() => {
    if (relay.validatingTab) return 3;
    if (relay.generatingResume) return 4;
    if (relay.analyzing) return 6;
    if (relay.applying) return 7;
    if (relay.verifying) return 8;
    if (verifyWaiting) return 8;
    return nextPipelineStep(pipeline);
  }, [pipeline, relay.analyzing, relay.applying, relay.generatingResume, relay.validatingTab, relay.verifying, verifyWaiting]);

  const workflowSteps: WorkflowStep[] = [
    { id: "connect", label: "Connected", done: relay.canExecute, active: !relay.canExecute },
    {
      id: "resume",
      label: "Résumé",
      done: pipeline.resumeReady,
      active: highlightStep === 4 && !pipeline.resumeReady,
    },
    { id: "open", label: "Opened", done: pipeline.opened, active: highlightStep === 2 },
    { id: "scan", label: "Scanned", done: pipeline.scanned, active: highlightStep === 5 },
    { id: "analyze", label: "Analyzed", done: pipeline.analyzed, active: highlightStep === 6 },
    {
      id: "apply",
      label: "Applied",
      done: pipeline.applied,
      active: highlightStep === 7,
    },
    {
      id: "verify",
      label: "Verified",
      done: pipeline.verified,
      active: highlightStep === 8,
    },
  ];

  const fieldCount = relay.actionableTree?.reduce((n, g) => n + g.children.length, 0) ?? 0;
  const budgetSpent = relay.jobUsage.totalCostUsd;
  const budgetLimit = relay.jobBudgetLimitUsd;
  const budgetRatio = budgetLimit > 0 ? budgetSpent / budgetLimit : 0;
  const budgetNearLimit = budgetRatio >= 0.8 && budgetRatio <= 1;
  const budgetOverLimit = budgetSpent > budgetLimit;
  const isBeta = isBetaTier(applier?.tier);

  const copyScript = async () => {
    if (!relay.displayedScript.trim()) return;
    try {
      await navigator.clipboard.writeText(relay.displayedScript);
      relay.pushLog(relay.selectedTreeFieldId ? "Copied field step" : "Copied full fill plan", true);
    } catch {
      relay.pushLog("Could not copy to clipboard", false);
    }
  };

  return (
    <div translate="no" className="notranslate space-y-4 min-w-0">
      {/* Status + workflow rail */}
      <div className="rounded-2xl border border-border/80 bg-card/80 backdrop-blur-sm shadow-sm overflow-hidden">
        <div className="px-4 py-3 flex flex-wrap items-center justify-between gap-3 border-b border-border/60">
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-secondary/60 border border-border/50">
              <StatusDot ok={liveOk} warn={relay.connected && !relay.peers.extension} />
              <span className="text-xs font-semibold text-foreground">
                {liveOk
                  ? "Extension live"
                  : relay.connected
                    ? "Relay only — waiting for extension"
                    : "Disconnected"}
              </span>
            </div>
            {relay.registered && (
              <span className="text-[11px] text-muted-foreground font-mono">
                session {relay.registered.sessionId.slice(0, 8)}
              </span>
            )}
            {applier?.name && (
              <span className="text-[11px] text-muted-foreground">
                profile <span className="font-semibold text-foreground">{applier.name}</span>
              </span>
            )}
            <span className="text-[11px] text-muted-foreground">
              AI{" "}
              <span className="font-semibold text-foreground">{activeAiModel}</span>
              {activeProvider ? ` · ${activeProvider}` : ""}
              {" · "}
              {activePricingPolicy}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setShowSettings((v) => !v)}
              className={cn(
                "p-2 rounded-lg border border-border hover:bg-secondary transition-colors",
                showSettings && "bg-secondary",
              )}
              title="Connection settings"
            >
              <Settings2 className="w-4 h-4 text-muted-foreground" />
            </button>
            <button
              type="button"
              onClick={() => relay.connect()}
              className="p-2 rounded-lg border border-border hover:bg-secondary transition-colors"
              title="Reconnect relay"
            >
              <RefreshCw className="w-4 h-4 text-muted-foreground" />
            </button>
          </div>
        </div>

        {showSettings && (
          <div className="px-4 py-3 bg-secondary/30 border-b border-border/60 flex flex-wrap gap-2 items-end">
            <input
              value={relay.serverUrl}
              onChange={(e) => relay.setServerUrl(e.target.value)}
              placeholder="Relay URL"
              className="flex-1 min-w-[160px] rounded-xl border border-border bg-background px-3 py-2 text-xs"
            />
            <label className="flex flex-col gap-1 shrink-0 min-w-[160px]">
              <span className="text-[10px] font-semibold text-muted-foreground">Avalon session ID</span>
              <input
                value={relay.sessionId}
                readOnly
                className="w-full rounded-xl border border-border bg-secondary/40 px-3 py-2 text-xs font-mono text-muted-foreground"
                title="Assigned automatically — pick this session in the Avalon extension"
              />
            </label>
            <label className="flex flex-col gap-1 shrink-0">
              <span className="text-[10px] font-semibold text-muted-foreground">AI budget / job (USD)</span>
              <input
                type="number"
                min={0.01}
                max={5}
                step={0.01}
                value={relay.jobBudgetLimitUsd}
                onChange={(e) => relay.setJobBudgetLimitUsd(Number.parseFloat(e.target.value) || DEFAULT_JOB_BUDGET_USD)}
                className="w-24 rounded-xl border border-border bg-background px-3 py-2 text-xs"
              />
            </label>
            {isBeta && (
              <label
                className="flex items-start gap-2 shrink-0 max-w-[220px] cursor-pointer select-none rounded-xl border border-border bg-background px-3 py-2"
                title="When on, Chrome is focused only when a job tab opens. When off, Avalon never steals focus."
              >
                <input
                  type="checkbox"
                  className="mt-0.5 rounded border-border"
                  checked={relay.allowWindowFocus}
                  onChange={(e) => relay.setAllowWindowFocus(e.target.checked)}
                />
                <span className="text-[10px] leading-snug">
                  <span className="font-semibold text-foreground">Grant window focus</span>
                  <span className="block text-muted-foreground">
                    {relay.allowWindowFocus
                      ? "Focus Chrome only when opening a job tab"
                      : "Won’t steal focus — safer for multitasking"}
                  </span>
                </span>
              </label>
            )}
            <button
              type="button"
              onClick={relay.connect}
              className="px-4 py-2 rounded-xl bg-foreground text-background text-xs font-bold hover:opacity-90"
            >
              {relay.connected ? "Reconnect" : "Connect"}
            </button>
          </div>
        )}

        <div className="px-4 py-2.5">
          <WorkflowRail steps={workflowSteps} />
        </div>
      </div>

      {/* Live apply pipeline status */}
      <ApplyStatusPanel
        applying={relay.applying}
        analyzing={relay.analyzing}
        generatingResume={relay.generatingResume}
        applyPhase={relay.applyPhase}
        activeResume={relay.activeResume}
        jobTitle={activeJob?.title}
      />

      {/* Token + cost usage for the current job */}
      {relay.jobUsage.requests.length > 0 && (
        <div className="rounded-2xl border border-border/80 bg-card shadow-sm overflow-hidden">
          <div className="px-4 py-2.5 border-b border-border/60 flex flex-wrap items-center justify-between gap-2 bg-gradient-to-r from-violet-500/5 to-transparent">
            <h2 className="text-sm font-bold text-foreground flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-violet-600" />
              AI usage · this job
              {activeJob && <span className="text-xs font-normal text-muted-foreground truncate max-w-[180px]">· {activeJob.title}</span>}
            </h2>
            <div className="flex items-center gap-3 text-xs flex-wrap">
              <span className="text-muted-foreground">
                {activeAiModel}
                {activeProvider ? ` · ${activeProvider}` : ""}
              </span>
              <span className="text-muted-foreground">{activePricingPolicy}</span>
              <span className="font-bold text-foreground">
                {relay.jobUsage.totalTokens.toLocaleString()} tokens
              </span>
              {relay.jobUsage.cachedTokens > 0 && (
                <span className="text-muted-foreground">({relay.jobUsage.cachedTokens.toLocaleString()} cached)</span>
              )}
              <span
                className={cn(
                  "font-bold",
                  budgetOverLimit && "text-red-700",
                  budgetNearLimit && !budgetOverLimit && "text-amber-700",
                  !budgetNearLimit && !budgetOverLimit && "text-violet-700",
                )}
              >
                ${budgetSpent.toFixed(4)} / ${budgetLimit.toFixed(2)}
              </span>
            </div>
          </div>
          <div className="px-2 py-1.5 max-h-[180px] overflow-y-auto subtle-scroll">
            <table className="w-full text-[11px]">
              <thead>
                <tr className="text-muted-foreground text-left">
                  <th className="font-semibold px-2 py-1">Request</th>
                  <th className="font-semibold px-2 py-1">Model / pricing</th>
                  <th className="font-semibold px-2 py-1 text-right">In</th>
                  <th className="font-semibold px-2 py-1 text-right">Cached</th>
                  <th className="font-semibold px-2 py-1 text-right">Out</th>
                  <th className="font-semibold px-2 py-1 text-right">Total</th>
                  <th className="font-semibold px-2 py-1 text-right">Cost</th>
                </tr>
              </thead>
              <tbody>
                {relay.jobUsage.requests.map((r, i) => {
                  const rowPricingPolicy = r.pricingRates
                    ? formatPricingPolicy(r.pricingRates)
                    : r.costUsd > 0
                      ? "Server-priced"
                      : "—";
                  const displayModel = r.model ?? "—";
                  return (
                    <tr key={`${r.label}-${i}`} className="border-t border-border/40">
                      <td className="px-2 py-1 text-foreground truncate max-w-[180px]" title={`${r.label} · ${r.at}`}>
                        {r.label}
                      </td>
                      <td className="px-2 py-1 text-muted-foreground">
                        <div className="max-w-[220px] truncate" title={`${r.provider ? `${r.provider} · ` : ""}${displayModel}`}>
                          {displayModel}
                          {r.provider ? ` · ${r.provider}` : ""}
                        </div>
                        <div className="text-[10px] truncate" title={rowPricingPolicy}>
                          {rowPricingPolicy}
                        </div>
                      </td>
                      <td className="px-2 py-1 text-right text-muted-foreground">{r.promptTokens.toLocaleString()}</td>
                      <td className="px-2 py-1 text-right text-muted-foreground">{r.cachedTokens ? r.cachedTokens.toLocaleString() : "—"}</td>
                      <td className="px-2 py-1 text-right text-muted-foreground">{r.completionTokens.toLocaleString()}</td>
                      <td className="px-2 py-1 text-right font-medium text-foreground">{r.totalTokens.toLocaleString()}</td>
                      <td className="px-2 py-1 text-right font-medium text-violet-700">${r.costUsd.toFixed(5)}</td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr className="border-t border-border/60 font-bold">
                  <td className="px-2 py-1 text-foreground">Total</td>
                  <td className="px-2 py-1 text-muted-foreground font-medium">{activePricingPolicy}</td>
                  <td className="px-2 py-1 text-right">{relay.jobUsage.promptTokens.toLocaleString()}</td>
                  <td className="px-2 py-1 text-right">{relay.jobUsage.cachedTokens.toLocaleString()}</td>
                  <td className="px-2 py-1 text-right">{relay.jobUsage.completionTokens.toLocaleString()}</td>
                  <td className="px-2 py-1 text-right">{relay.jobUsage.totalTokens.toLocaleString()}</td>
                  <td className="px-2 py-1 text-right text-violet-700">${relay.jobUsage.totalCostUsd.toFixed(4)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
      )}

      {applyBlocked && hasPlan && (
        <div className="rounded-xl border border-amber-200/80 bg-gradient-to-r from-amber-50 to-orange-50 px-4 py-3 text-xs text-amber-900 flex flex-wrap items-center justify-between gap-2">
          <span>{applyBlocked}</span>
          {!relay.canExecute && (
            <button
              type="button"
              onClick={() => relay.connect()}
              className="shrink-0 px-3 py-1 rounded-lg bg-amber-900/10 text-amber-900 font-semibold hover:bg-amber-900/15"
            >
              Reconnect
            </button>
          )}
        </div>
      )}

      {relay.executeDisabledReason && !relay.canExecute && !hasPlan && (
        <div className="rounded-xl border border-amber-200/80 bg-gradient-to-r from-amber-50 to-orange-50 px-4 py-3 text-xs text-amber-900">
          {relay.executeDisabledReason}
        </div>
      )}

      {/* Main workspace — Queue · Activity · Pipeline */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 min-w-0">
        {/* Left — job queue */}
        <aside className={cn(WORKSPACE_PANEL, MAIN_PANEL_H, "lg:col-span-3")}>
          <div className="shrink-0 px-4 py-3 border-b border-border/60 bg-gradient-to-r from-violet-500/5 to-transparent">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-bold text-foreground flex items-center gap-2">
                <ListOrdered className="w-4 h-4 text-violet-600" />
                Queue
              </h2>
              <span className="text-[10px] font-bold text-violet-600 bg-violet-500/10 px-2 py-0.5 rounded-full">
                {relay.jobQueue.length}
              </span>
            </div>
            {relay.jobQueue.length > 0 && (
              <button
                type="button"
                onClick={() => void relay.applyQueue()}
                disabled={!relay.canExecute || relay.applying}
                className="mt-2 w-full inline-flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-bold text-white bg-violet-600 hover:bg-violet-500 disabled:opacity-40"
                title="Open each job, scan, and fill — stops before submit for your review"
              >
                {relay.applying ? "Applying…" : `Apply all (${relay.jobQueue.length})`}
              </button>
            )}
          </div>

          <div className="flex-1 min-h-0 overflow-y-auto subtle-scroll p-2 space-y-1.5">
            {relay.jobQueue.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full py-10 px-4 text-center">
                <div className="w-12 h-12 rounded-2xl bg-secondary flex items-center justify-center mb-3">
                  <Layers className="w-6 h-6 text-muted-foreground" />
                </div>
                <p className="text-xs font-semibold text-foreground">No jobs queued</p>
                <p className="text-[11px] text-muted-foreground mt-1 mb-4">
                  Pick posted jobs from Job Search, or queue a batch here.
                </p>
                <button
                  type="button"
                  onClick={onQueueJobs}
                  className="text-xs font-bold text-violet-600 hover:text-violet-700"
                >
                  + Queue jobs
                </button>
              </div>
            ) : (
              relay.jobQueue.map((job, i) => {
                const active = i === relay.activeJobIndex;
                const applied = relay.appliedJobIds.has(job.id);
                const budgetSkipped = relay.budgetSkippedJobIds.has(job.id);
                return (
                  <div
                    key={job.id}
                    className={cn(
                      "w-full rounded-xl p-3 border transition-all",
                      active
                        ? "border-violet-500/50 bg-violet-500/8 shadow-sm shadow-violet-500/10 ring-1 ring-violet-500/20"
                        : "border-border/60 hover:border-border hover:bg-secondary/40",
                    )}
                  >
                    <button
                      type="button"
                      onClick={() => relay.selectActiveJob(i)}
                      className="w-full text-left"
                    >
                      <div className="flex items-start gap-2.5">
                        <span
                          className={cn(
                            "w-6 h-6 rounded-lg flex items-center justify-center text-[10px] font-bold shrink-0",
                            active ? "bg-violet-600 text-white" : "bg-secondary text-muted-foreground",
                          )}
                        >
                          {i + 1}
                        </span>
                        <div className="min-w-0 flex-1">
                          <p className="text-xs font-semibold text-foreground truncate leading-snug">
                            {job.title || "(untitled)"}
                          </p>
                          <p className="text-[10px] text-muted-foreground truncate mt-0.5">
                            {job.company || job.source}
                          </p>
                        </div>
                        <ExternalLink className="w-3.5 h-3.5 text-muted-foreground shrink-0 mt-0.5" />
                      </div>
                    </button>
                    {applied ? (
                      <div className="mt-2 w-full inline-flex items-center justify-center gap-1.5 px-2 py-1 rounded-lg text-[10px] font-bold text-emerald-700 bg-emerald-500/10">
                        ✓ Applied
                      </div>
                    ) : budgetSkipped ? (
                      <div className="mt-2 w-full inline-flex items-center justify-center gap-1.5 px-2 py-1 rounded-lg text-[10px] font-bold text-amber-800 bg-amber-500/10">
                        Budget skip
                      </div>
                    ) : (
                      <button
                        type="button"
                        onClick={() => {
                          relay.selectActiveJob(i);
                          void relay.runPipelineAuto(job);
                        }}
                        disabled={!relay.canExecute || relay.applying || relay.autoRunning}
                        className="mt-2 w-full inline-flex items-center justify-center gap-1.5 px-2 py-1 rounded-lg text-[10px] font-bold text-violet-700 bg-violet-500/10 hover:bg-violet-500/20 disabled:opacity-40"
                      >
                        Apply (auto-submit)
                      </button>
                    )}
                  </div>
                );
              })
            )}
          </div>

          {activeJob && (
            <div className="shrink-0 px-3 py-2 border-t border-border/60 bg-secondary/20">
              <p className="text-[10px] text-muted-foreground truncate" title={activeJob.url}>
                {activeJob.url}
              </p>
            </div>
          )}
        </aside>

        {/* Center — event log / terminal */}
        <div className={cn(WORKSPACE_PANEL, MAIN_PANEL_H, "lg:col-span-6")}>
          <div className="shrink-0 px-4 py-2.5 border-b border-border/60 flex items-center gap-2">
            <Terminal className="w-3.5 h-3.5 text-muted-foreground" />
            <h2 className="text-xs font-bold text-foreground">Activity</h2>
          </div>
          <div className="flex-1 min-h-0 overflow-y-auto subtle-scroll p-2 space-y-1">
            {relay.logs.length === 0 && (
              <p className="text-[11px] text-muted-foreground text-center py-8">Waiting for events…</p>
            )}
            {relay.logs.map((entry) => (
              <div
                key={entry.id}
                className={cn(
                  "text-[10px] font-mono leading-relaxed px-2 py-1.5 rounded-lg border border-transparent",
                  entry.success === true && "bg-emerald-500/8 text-emerald-800 border-emerald-500/15",
                  entry.success === false && "bg-red-500/8 text-red-800 border-red-500/15",
                  entry.success === undefined && "text-foreground/80",
                )}
              >
                <span className="text-muted-foreground">{entry.at}</span> {entry.message}
              </div>
            ))}
          </div>
        </div>

        {/* Right — pipeline */}
        <aside className={cn(WORKSPACE_PANEL, MAIN_PANEL_H, "lg:col-span-3")}>
          <div className="shrink-0 px-4 pt-4 pb-2">
            <h2 className="text-xs font-bold text-muted-foreground uppercase tracking-wider">Pipeline</h2>
          </div>
          <div className="flex-1 min-h-0 overflow-y-auto subtle-scroll px-4 pb-2 space-y-2">
          <button
            type="button"
            onClick={() => void relay.runPipelineAuto()}
            disabled={
              !activeJob ||
              !relay.canExecute ||
              relay.autoRunning ||
              pipelineLocked ||
              relay.validatingTab ||
              relay.generatingResume ||
              relay.analyzing ||
              relay.verifying
            }
            className="w-full flex items-center justify-center gap-2 rounded-xl border-2 border-violet-500/40 bg-violet-500/10 px-3 py-2.5 text-sm font-semibold text-violet-900 hover:bg-violet-500/20 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {relay.autoRunning ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                {relay.autoRunState === "paused" ? "Paused" : "Auto-running…"}
              </>
            ) : (
              <>
                <Play className="w-4 h-4" />
                Auto-run (steps 2–8)
              </>
            )}
          </button>
          {relay.autoRunning && (
            <div className="flex items-center gap-2">
              {relay.autoRunState === "paused" ? (
                <button
                  type="button"
                  onClick={() => relay.resumeAutoRun()}
                  className="flex-1 inline-flex items-center justify-center gap-1.5 rounded-xl border border-border px-3 py-2 text-xs font-semibold hover:bg-secondary"
                >
                  <Play className="w-3.5 h-3.5" /> Resume
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => relay.pauseAutoRun()}
                  className="flex-1 inline-flex items-center justify-center gap-1.5 rounded-xl border border-border px-3 py-2 text-xs font-semibold hover:bg-secondary"
                >
                  <Pause className="w-3.5 h-3.5" /> Pause
                </button>
              )}
              <button
                type="button"
                onClick={() => relay.stopAutoRun()}
                className="flex-1 inline-flex items-center justify-center gap-1.5 rounded-xl border border-red-300/70 text-red-700 px-3 py-2 text-xs font-semibold hover:bg-red-500/10"
              >
                <Square className="w-3.5 h-3.5" /> Stop
              </button>
            </div>
          )}
          <button
            type="button"
            onClick={() => void relay.openActiveJob()}
            disabled={!activeJob || !relay.canExecute || pipelineLocked || relay.autoRunning}
            className={pipelineStepClass(2, highlightStep, pipeline.opened, Boolean(activeJob && relay.canExecute && !pipelineLocked && !relay.autoRunning))}
          >
            {pipeline.opened ? <CheckCircle2 className="w-4 h-4" /> : <ExternalLink className="w-4 h-4" />}
            2 · Open job link
          </button>
          <button
            type="button"
            onClick={() => void relay.validateActiveTab()}
            disabled={false && (!pipeline.opened || !relay.canExecute || relay.validatingTab || pipelineLocked)}
            className={pipelineStepClass(
              3,
              highlightStep,
              pipeline.validated,
              pipeline.opened && relay.canExecute && !relay.validatingTab && !pipelineLocked,
            )}
          >
            {relay.validatingTab ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : pipeline.validated ? (
              <CheckCircle2 className="w-4 h-4" />
            ) : (
              <CheckCircle2 className="w-4 h-4" />
            )}
            {relay.validatingTab ? "Checking…" : "3 · Verify opened tab is a job form"}
          </button>
          {relay.tabValidity && (
            <div
              className={cn(
                "rounded-xl border px-3 py-2 text-[11px]",
                relay.tabValidity.valid
                  ? "border-emerald-300/70 bg-emerald-50 text-emerald-900"
                  : "border-red-300/70 bg-red-50 text-red-900",
              )}
            >
              <span className="font-bold">{relay.tabValidity.valid ? "Valid form" : `Skipped (${relay.tabValidity.kind})`}</span>
              {" — "}
              {relay.tabValidity.reason}
            </div>
          )}
          <button
            type="button"
            onClick={() =>
              void relay.generateActiveJobResume(Boolean(hasResumeDraft && relay.activeResume?.file?.base64))
            }
            disabled={!pipeline.validated || relay.generatingResume || pipelineLocked}
            className={pipelineStepClass(
              4,
              highlightStep,
              pipeline.resumeReady,
              pipeline.validated && !relay.generatingResume && !pipelineLocked,
            )}
          >
            {relay.generatingResume ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
            {relay.generatingResume
              ? "Generating résumé…"
              : hasResumeDraft && relay.activeResume?.file?.base64
                ? "4 · Résumé ready (regenerate)"
                : hasResumeDraft
                  ? "4 · Load saved résumé"
                  : "4 · Generate / load résumé"}
          </button>
          <button
            type="button"
            onClick={() => void relay.fetchActionableTree()}
            disabled={false && (!pipeline.resumeReady || !relay.canExecute || pipelineLocked)}
            className={pipelineStepClass(
              5,
              highlightStep,
              pipeline.scanned,
              pipeline.resumeReady && relay.canExecute && !pipelineLocked,
            )}
          >
            {pipeline.scanned ? <CheckCircle2 className="w-4 h-4" /> : <TreePine className="w-4 h-4" />}
            5 · Scan DOM (with dropdown probe)
          </button>
          <button
            type="button"
            onClick={() => void relay.analyzeTree()}
            disabled={!pipeline.scanned || relay.analyzing || pipelineLocked}
            className={cn(
              pipelineStepClass(6, highlightStep, pipeline.analyzed, pipeline.scanned && !relay.analyzing && !pipelineLocked),
              pipeline.scanned && !relay.analyzing && !pipelineLocked && "font-bold",
            )}
          >
            {relay.analyzing ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : pipeline.analyzed ? (
              <CheckCircle2 className="w-4 h-4" />
            ) : (
              <Sparkles className="w-4 h-4" />
            )}
            {relay.analyzing ? "Analyzing…" : "6 · Analyze form"}
          </button>
          <button
            type="button"
            onClick={() => void relay.applyActionPlan()}
            disabled={!pipeline.analyzed || !canApply || pipelineLocked || relay.analyzing}
            className={pipelineStepClass(
              7,
              highlightStep,
              pipeline.applied,
              pipeline.analyzed && Boolean(canApply) && !pipelineLocked && !relay.analyzing,
            )}
          >
            {relay.applying ? <Loader2 className="w-4 h-4 animate-spin" /> : <Zap className="w-4 h-4" />}
            {relay.applying ? "Injecting…" : "7 · Apply fill plan"}
          </button>
          {kitSubmitActive && (
            <div className="mt-2">
              <span className="inline-flex items-center justify-center w-full text-[10px] font-bold text-violet-700 bg-violet-500/10 px-2 py-0.5 rounded-full border border-violet-500/15">
                kit submit
              </span>
            </div>
          )}
          <button
            type="button"
            onClick={() => void relay.verifyActiveResult()}
            disabled={!pipeline.applied || !relay.canExecute || relay.verifying || verifyWaiting || pipelineLocked}
            className={pipelineStepClass(
              8,
              highlightStep,
              pipeline.verified,
              pipeline.applied && relay.canExecute && !relay.verifying && !verifyWaiting && !pipelineLocked,
            )}
          >
            {verifyWaiting && verifyWaitSeconds != null ? (
              <>
                <span className="w-5 h-5 rounded-full bg-violet-600 text-white text-[10px] font-bold flex items-center justify-center shrink-0">
                  {verifyWaitSeconds}
                </span>
                8 · Waiting for submit result
              </>
            ) : relay.verifying ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                Verifying…
              </>
            ) : (
              <>
                <CheckCircle2 className="w-4 h-4" />
                8 · Verify result
              </>
            )}
          </button>
          {relay.verifyResult && (
            <div
              className={cn(
                "rounded-xl border px-3 py-2 text-[11px] space-y-1",
                relay.verifyResult.kind === "success" && "border-emerald-300/70 bg-emerald-50 text-emerald-900",
                relay.verifyResult.kind === "failed" && "border-red-300/70 bg-red-50 text-red-900",
                relay.verifyResult.kind === "additional" && "border-amber-300/70 bg-amber-50 text-amber-900",
              )}
            >
              <div className="flex items-center gap-1.5 font-bold">
                {relay.verifyResult.kind === "success" ? (
                  <>
                    <CheckCircle2 className="w-3.5 h-3.5" /> Success
                  </>
                ) : relay.verifyResult.kind === "additional" ? (
                  <>
                    <AlertTriangle className="w-3.5 h-3.5" /> Additional step required
                  </>
                ) : (
                  <>
                    <AlertTriangle className="w-3.5 h-3.5" /> Failed
                  </>
                )}
              </div>
              <p className="leading-snug">{relay.verifyResult.reason}</p>
              {relay.verifyResult.detail && (
                <p className="leading-snug font-medium">{relay.verifyResult.detail}</p>
              )}
            </div>
          )}
          <button
            type="button"
            onClick={() => void relay.markActiveJobApplied()}
            disabled={!activeJob || relay.applying}
            className="w-full flex items-center justify-center gap-2 px-4 py-2 rounded-xl bg-emerald-600 text-white text-sm font-bold hover:bg-emerald-500 disabled:opacity-40"
            title="Mark this job Applied in MongoDB with the current profile"
          >
            <CheckCircle2 className="w-4 h-4" />
            Mark as Applied
          </button>
          {hasPlan && relay.injectionPlan && (
            <p className="text-[10px] text-center text-muted-foreground pt-1">
              {relay.injectionPlan.steps.length} steps · uses drafted PDF
            </p>
          )}
          {relay.formAnalysis?.usage && (
            <p className="text-[10px] text-center text-violet-600 font-medium">
              {relay.formAnalysis.usage.totalTokens} tokens
              {relay.formAnalysis.usage.cost
                ? ` · $${relay.formAnalysis.usage.cost.totalUsd.toFixed(4)}`
                : ""}
            </p>
          )}
          </div>
          <p className="shrink-0 px-4 pb-4 text-[9px] text-center text-muted-foreground leading-relaxed">
            Steps run in order: open → verify tab → résumé → scan → analyze → apply → verify.
          </p>
        </aside>
      </div>

      {/* Preview workspace — full width below the three columns */}
      {showPreviewWorkspace && (
        hasTree ? (
          <div className={cn(WORKSPACE_PANEL, PREVIEW_PANEL_H, "w-full min-w-0")}>
              <div className="shrink-0 px-4 py-3 border-b border-border/60 flex flex-wrap items-center justify-between gap-3 bg-gradient-to-r from-violet-500/5 via-transparent to-indigo-500/5">
                <div>
                  <h2 className="text-sm font-bold text-foreground flex items-center gap-2">
                    <TreePine className="w-4 h-4 text-violet-600" />
                    Form fields
                    <span className="text-[10px] font-bold text-muted-foreground bg-secondary px-2 py-0.5 rounded-full">
                      {fieldCount} targets
                    </span>
                  </h2>
                  {relay.treePage?.url && (
                    <p className="text-[10px] text-muted-foreground mt-0.5 truncate max-w-xl">{relay.treePage.url}</p>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => relay.generatePlan()}
                  disabled={!hasPlan || relay.applying || relay.analyzing}
                  className="text-xs font-semibold text-violet-600 hover:text-violet-700 disabled:opacity-50"
                >
                  Rebuild plan
                </button>
              </div>

              <div className="flex-1 min-h-0 grid grid-cols-1 lg:grid-cols-5 gap-0 lg:divide-x divide-border/60">
                <div className="lg:col-span-3 p-4 min-h-0 overflow-y-auto subtle-scroll space-y-4">
                  {relay.actionableTree!.map((group, groupIdx) => (
                    <div key={groupIdx}>
                      <h3 className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest mb-2 sticky top-0 bg-card py-1">
                        {group.content || "Section"}
                      </h3>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                        {group.children.map((entry, childIdx) => {
                          const id = fieldId(groupIdx, childIdx);
                          const plan = relay.actionPlanByFieldId.get(id);
                          const required = entry.target.includes("*");
                          const selected = relay.selectedTreeFieldId === id;
                          const skipped = plan?.shouldSkip === "Yes";
                          return (
                            <button
                              key={childIdx}
                              type="button"
                              onClick={() => relay.selectTreeTarget(entry, id)}
                              disabled={!relay.canExecute}
                              className={cn(
                                "text-left rounded-xl border px-3 py-2.5 transition-all",
                                selected
                                  ? "border-violet-500 bg-violet-500/8 ring-1 ring-violet-500/25"
                                  : "border-border/60 hover:border-border hover:bg-secondary/30",
                                skipped && "opacity-60",
                              )}
                            >
                              <div className="flex items-start justify-between gap-1">
                                <span className="text-[11px] font-semibold text-foreground leading-snug line-clamp-2">
                                  {entry.target.replace(/\*+$/, "").trim()}
                                </span>
                                {required && (
                                  <span className="text-[8px] font-bold text-rose-600 bg-rose-50 px-1 rounded shrink-0">
                                    req
                                  </span>
                                )}
                              </div>
                              <p className="text-[9px] text-muted-foreground mt-1">
                                {entry.controlType} · {entry.control.tag}
                              </p>
                              {plan && (
                                <div
                                  className={cn(
                                    "mt-1.5 text-[9px] font-medium truncate",
                                    skipped ? "text-muted-foreground" : "text-violet-700",
                                  )}
                                >
                                  {plan.action} → {plan.value}
                                </div>
                              )}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  ))}
                </div>

                <div className="lg:col-span-2 p-4 flex flex-col bg-secondary/10 min-h-0 overflow-hidden">
                  <div className="shrink-0 flex items-center justify-between gap-2 mb-3">
                    <h3 className="text-xs font-bold text-foreground truncate">
                      {selectedFieldLabel ? selectedFieldLabel : "Fill plan"}
                    </h3>
                    <div className="flex items-center gap-2 shrink-0">
                      {relay.selectedTreeFieldId && (
                        <button
                          type="button"
                          onClick={() => relay.setSelectedTreeFieldId(null)}
                          className="text-[10px] font-semibold text-violet-600"
                        >
                          All steps
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => void copyScript()}
                        disabled={!relay.displayedScript.trim()}
                        className="p-1.5 rounded-lg border border-border hover:bg-card disabled:opacity-40"
                      >
                        <Copy className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                  <textarea
                    value={relay.displayedScript}
                    readOnly
                    spellCheck={false}
                    placeholder="Run Analyze to generate the deterministic fill plan…"
                    className="flex-1 min-h-0 w-full rounded-xl border border-border bg-card px-3 py-2.5 text-[11px] font-mono leading-relaxed resize-none focus:outline-none shadow-inner overflow-y-auto subtle-scroll"
                  />
                </div>
              </div>
            </div>
          ) : (
            <div className={cn(WORKSPACE_PANEL, PREVIEW_PANEL_H, "w-full min-w-0")}>
              <div className="shrink-0 px-4 py-2.5 border-b border-border/60 flex items-center justify-between gap-2">
                <h2 className="text-xs font-bold text-foreground flex items-center gap-2">
                  {relay.generatingResume ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin text-violet-600" />
                  ) : (
                    <Sparkles className="w-3.5 h-3.5 text-violet-600" />
                  )}
                  4 · Tailored résumé
                </h2>
                {relay.activeResume && (
                  <span
                    className={cn(
                      "text-[9px] font-bold px-2 py-0.5 rounded-full",
                      relay.activeResume.reused
                        ? "text-muted-foreground bg-secondary"
                        : "text-violet-700 bg-violet-500/10",
                    )}
                  >
                    {relay.activeResume.reused ? "reused" : "generated"}
                  </span>
                )}
              </div>
              {relay.resumeError && !relay.activeResume && (
                <div className="px-4 py-4 space-y-2">
                  <p className="text-[11px] text-red-700">{relay.resumeError}</p>
                  <button
                    type="button"
                    onClick={() => void relay.generateActiveJobResume()}
                    className="text-[10px] font-semibold text-violet-600 hover:text-violet-700"
                  >
                    Retry generation
                  </button>
                </div>
              )}
              {relay.generatingResume && !relay.activeResume && !relay.resumeError && (
                <div className="px-4 py-6 flex flex-col gap-3">
                  <div className="flex items-center gap-2 text-[11px] text-violet-800 font-semibold">
                    <Loader2 className="w-4 h-4 animate-spin text-violet-600 shrink-0" />
                    {relay.resumeGenerateStep ?? "Generating tailored résumé…"}
                  </div>
                  <div className="space-y-1.5">
                    {RESUME_SECTION_LABELS.map(({ id, label }) => {
                      const done = Boolean(relay.resumeGeneratedSections[id]);
                      return (
                        <div
                          key={id}
                          className={cn(
                            "flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-[11px] border",
                            done
                              ? "border-emerald-500/30 bg-emerald-500/5 text-emerald-800"
                              : "border-border/60 text-muted-foreground",
                          )}
                        >
                          {done ? (
                            <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
                          ) : relay.resumeGenerateStep?.toLowerCase().includes(label.toLowerCase()) ? (
                            <Loader2 className="w-3.5 h-3.5 animate-spin shrink-0" />
                          ) : (
                            <Circle className="w-3.5 h-3.5 shrink-0" />
                          )}
                          {label}
                          {done ? " generated" : ""}
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
              {!hasResumeDraft && !relay.generatingResume && !relay.resumeError && activeJob && (
                <div className="px-4 py-8 text-center text-[11px] text-muted-foreground">
                  Click <span className="font-semibold text-violet-700">4 · Generate / load résumé</span> in the pipeline to start.
                </div>
              )}
              {relay.activeResume && (relay.activeResume.file.base64 || activeJob) && (
                <>
                  <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
                  <AgentResumePdfPreview
                    applierName={applier?.name}
                    jobId={activeJob?.id}
                    base64={relay.activeResume.file.base64}
                    mimeType={relay.activeResume.file.mimeType}
                    className="w-full flex-1 min-h-[240px] max-h-[360px] bg-secondary/20 border-0"
                  />
                  </div>
                  <div className="px-4 py-2 border-t border-border/60 flex flex-col gap-1">
                    <div className="flex items-center justify-between gap-2">
                      <span
                        className="text-[10px] text-muted-foreground truncate"
                        title={relay.activeResume.file.name}
                      >
                        {relay.activeResume.file.name.replace(/\.txt$/i, ".pdf")}
                      </span>
                      <a
                        href={
                          activeJob && applier?.name
                            ? agentJobResumePdfUrl(applier.name, activeJob.id)
                            : relay.activeResume.file.base64
                              ? `data:${relay.activeResume.file.mimeType};base64,${relay.activeResume.file.base64}`
                              : undefined
                        }
                        download={`${relay.activeResume.file.name.replace(/\.txt$/i, ".pdf")}`}
                        target="_blank"
                        rel="noreferrer"
                        className="text-[10px] font-semibold text-violet-600 hover:text-violet-700 shrink-0"
                      >
                        Save draft PDF
                      </a>
                    </div>
                    {relay.activeResume.resumePdfPath && (
                      <p className="text-[9px] text-muted-foreground truncate" title={relay.activeResume.resumePdfPath}>
                        Saved locally · {relay.activeResume.resumePdfPath}
                      </p>
                    )}
                  </div>
                </>
              )}
              {hasResumeDraft && activeJob && !relay.generatingResume && (
                <div className="px-4 py-3 border-t border-border/60">
                  <p className="text-[10px] text-center text-muted-foreground">
                    Use step 4 in the pipeline to regenerate.
                  </p>
                </div>
              )}
            </div>
          )
      )}

      {/* Empty state CTA */}
      {!hasTree && relay.canExecute && activeJob && pipeline.opened && (
        <div className="rounded-2xl border border-dashed border-violet-500/30 bg-gradient-to-br from-violet-500/5 to-indigo-500/5 p-10 text-center">
          <div className="w-14 h-14 rounded-2xl bg-violet-500/10 flex items-center justify-center mx-auto mb-4">
            <Scan className="w-7 h-7 text-violet-600" />
          </div>
          <h3 className="text-base font-bold text-foreground">Ready to scan</h3>
          <p className="text-sm text-muted-foreground mt-1 max-w-md mx-auto">
            Complete steps 2–4, then use <span className="font-semibold">5 · Scan DOM</span> once the job form is open in Chrome.
          </p>
        </div>
      )}
    </div>
  );
}
