import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Socket } from "socket.io-client";
import {
  DEFAULT_SESSION_ID,
  SOCKET_EVENTS,
  createActionId,
  type ActionablePageContext,
  type ActionableTarget,
  type ActionableTree,
  type ActionResult,
  type ApplyProgress,
  type AttachedFile,
  type InjectionPlan,
  type RegisteredPayload,
  type RemoteAction,
  type TabInfo,
  type TargetSelector,
} from "@avalon/shared";
import { analyzeFormFields } from "../avalon/ai/analyze-form";
import { buildApplyInjectionPlanPayload } from "../avalon/ai/apply-injection-plan";
import { buildFormInjectionPlan } from "../avalon/ai/generate-injection-plan";
import type { FieldActionPlan, FormAnalysisResult } from "../avalon/ai/types";
import {
  avalonRelayUrl,
  createAvalonSocket,
  persistAvalonSessionId,
  storedAvalonSessionId,
} from "../../../services/agentApi";
import {
  applyToJob,
  fetchAgentJobResumePdf,
  fetchJobDescription,
  fetchJobsWithGeneratedResumes,
  fetchSubmissionKitResume,
  generateJobResumeStream,
  type ResumeSectionPurpose,
} from "../../../api/jobs";
import { isBetaTier } from "../../../lib/beta";
import { classifyApplyOutcome, type ApplyPageState } from "../lib/applyOutcome";
import { clampJobBudgetUsd, loadJobBudgetUsd, saveJobBudgetUsd } from "../lib/agentBudget";
import { withOtpMutex } from "../lib/agentJobConcurrency";
import {
  loadAllowWindowFocus,
  saveAllowWindowFocus,
} from "../lib/agentWindowFocus";
import { mapPool } from "../lib/mapPool";
import { generateRecoveryScript } from "../avalon/ai/recover-apply";
import { verifyApplyOutcome, type ApplyVerifyResult } from "../avalon/ai/verify-apply";
import { validateJobPage, type PageValidityResult } from "../avalon/ai/validate-page";
import { postApplyLog, type ApplyLogEvent } from "../../../api/avalonLog";
import { requestVerificationCode } from "../../../api/mail";
import { setAgentRunContext, clearAgentRunContext } from "../avalon/ai/run-context";

/** Short unique id for one apply run (used to correlate the debug log file + Mongo doc). */
function newRunId(): string {
  return `run_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

/** Max self-healing retries for a single failed apply (per Phase C). */
const MAX_RECOVERY_ATTEMPTS = 4;

/**
 * Generic cues that a page is asking for an emailed verification / one-time code
 * (Phase D). Language-based only — no sender/vendor strings, per Guide.md.
 */
const VERIFICATION_CUE =
  /\b(verification code|verify your (email|identity)|one[- ]?time (code|password|passcode)|enter the code|check your (email|inbox)|we (sent|emailed|texted) you a code|confirmation code|security code|otp\b|passcode|6[- ]digit|4[- ]digit)\b/i;

interface StepRunResult {
  id: string;
  label: string;
  op: string;
  ok: boolean;
  error?: string;
}

/**
 * Result of the manual "Verify result" step (pipeline step 6). Three outcomes:
 *  - success:    the application was submitted/received.
 *  - failed:     rejected or unconfirmed — `reason` explains why.
 *  - additional: an extra step is required (OTP / email verification code / link).
 */
export interface ManualVerifyResult {
  kind: "success" | "failed" | "additional";
  reason: string;
  detail?: string;
}

/** One AI request's token + cost usage, for the per-job usage panel. */
export interface UsageEntry {
  label: string;
  at: string;
  model?: string | null;
  provider?: string | null;
  promptTokens: number;
  cachedTokens: number;
  completionTokens: number;
  totalTokens: number;
  costUsd: number;
  pricingRates?: {
    promptPer1M: number;
    completionPer1M: number;
  };
}

/** Loose usage shape accepted from any AI call (ai-bff, résumé gen, analyze). */
type UsageLike =
  | {
      model?: string | null;
      provider?: string | null;
      promptTokens?: number;
      cachedTokens?: number;
      completionTokens?: number;
      totalTokens?: number;
      costUsd?: number;
      pricingRates?: {
        promptPer1M?: number;
        completionPer1M?: number;
      };
      cost?:
        | {
            totalUsd?: number;
            rates?: {
              promptPer1M?: number;
              completionPer1M?: number;
            };
          }
        | number;
    }
  | undefined
  | null;

/** A generated per-job résumé held for attach + preview. */
export interface JobResume {
  jobId: string;
  file: AttachedFile;
  reused: boolean;
  generationId: string | null;
  resumePdfPath?: string | null;
}

interface SubmissionKitCache {
  applierName: string;
  resumeId: string;
  file: AttachedFile;
}

/** Manual/link-only jobs have no Mongo id or JD, so no tailored résumé is generated. */
function isManualJob(job: QueuedJob): boolean {
  return job.source === "manual" || job.id.startsWith("manual:");
}

/** Strip legacy `-{8 hex job id}` from upload names (e.g. "David Moll-6a5656e3.pdf"). */
function profileResumeFileName(name: string, fallback = "resume.pdf"): string {
  const raw = (name || fallback).trim() || fallback;
  const cleaned = raw.replace(/-[a-f0-9]{8}(?=\.(pdf|docx?)$)/i, "");
  return cleaned.toLowerCase().endsWith(".pdf") || /\.docx?$/i.test(cleaned)
    ? cleaned
    : `${cleaned}.pdf`;
}

  /** Read a suggested pipeline restart step from verify guidance (language/numbers only). */
export function parseRetryPipelineStep(detail?: string, reason?: string): number {
  const text = `${detail ?? ""} ${reason ?? ""}`.toLowerCase();
  const explicit = text.match(/\b(?:re-?run|retry|from)\s*(?:step\s*)?([2-8])\b/);
  if (explicit) return Number(explicit[1]);
  const markers = [...text.matchAll(/\b([5-8])\s*·/g)].map((m) => Number(m[1]));
  if (markers.length) return Math.min(...markers);
  if (/\bscan\b/.test(text) && /\banaly/.test(text)) return 5;
  if (/verify again/.test(text)) return 8;
  return 5;
}

const PIPELINE_AUTO_MAX_CYCLES = 4;
/** Grace period after submit / OTP fill / inbox poll (Greenhouse OTP flow). */
const VERIFY_RESULT_WAIT_MS = 10_000;
const OTP_STEP_WAIT_MS = 6_000;
/** How many times to poll Gmail before giving up on a Greenhouse OTP. */
const OTP_FETCH_MAX_ATTEMPTS = 5;

/**
 * When step 8 · Verify result is not "success" we loop, but the recovery differs by
 * cause:
 *  - "additional" (a security/verification code page appeared) → run the OTP flow;
 *    never re-scan (that would wipe the code boxes).
 *  - "failed" (something else — e.g. a missing/next form) → re-run 5 · Scan →
 *    6 · Analyze → 7 · Apply.
 * Bounded to this many retries to avoid spinning forever.
 */
const MAX_VERIFY_RETRIES = 3;

export interface AvalonLogEntry {
  id: string;
  at: string;
  message: string;
  success?: boolean;
}

export interface QueuedJob {
  id: string;
  title: string;
  company: string;
  url: string;
  source: string;
}

/** Greenhouse-only OTP automation — other ATS platforms stay manual at step 8. */
function isGreenhouseJob(job: QueuedJob | null | undefined): boolean {
  return /greenhouse\.io/i.test(job?.url ?? "");
}

/** Company name for OTP inbox matching — job.company, else Greenhouse ?for= slug. */
function greenhouseOtpCompanyName(job: QueuedJob | null | undefined): string {
  const fromJob = job?.company?.trim() || "";
  if (fromJob) return fromJob;
  const slug = job?.url?.match(/[?&]for=([^&]+)/i)?.[1];
  return slug ? decodeURIComponent(slug).replace(/\+/g, " ") : "";
}

/** Per-job manual pipeline progress (steps 2–8). */
export interface JobPipelineState {
  opened: boolean;
  validated: boolean;
  resumeReady: boolean;
  scanned: boolean;
  analyzed: boolean;
  applied: boolean;
  verified: boolean;
}

const EMPTY_PIPELINE: JobPipelineState = {
  opened: false,
  validated: false,
  resumeReady: false,
  scanned: false,
  analyzed: false,
  applied: false,
  verified: false,
};

/**
 * Options for a relay instance. Multi-session mounts pass a distinct `sessionId`
 * per engine and `persist: false` (the session list owns persistence); the default
 * single-session mount omits both to preserve the original localStorage behavior.
 */
export interface AvalonRelayOptions {
  sessionId?: string;
  /** Human-readable name advertised to the relay (extension session picker). */
  sessionLabel?: string;
  persist?: boolean;
  /**
   * When set, the queue + apply progress (jobQueue, activeJobIndex, appliedJobIds,
   * pipelineByJobId) are persisted to localStorage under this key and restored on
   * mount — so a hard refresh (or a dev-server Fast Refresh full reload) doesn't
   * wipe an in-progress queue the way pure in-memory state would. Distinct from
   * `sessionId`/`persist` above, which govern the *Avalon relay* pairing id, not
   * this UI-facing queue state.
   */
  persistKey?: string;
  accountTier?: string | null;
  /** User/account namespace for relay pairing (see Project Avalon extension). */
  profileId?: string;
}

export const QUEUE_STORAGE_PREFIX = "athens-agent-queue-";

interface PersistedQueueState {
  jobQueue: QueuedJob[];
  activeJobIndex: number;
  appliedJobIds: string[];
  pipelineByJobId: Record<string, JobPipelineState>;
}

function loadPersistedQueue(persistKey: string): PersistedQueueState | null {
  try {
    const raw = localStorage.getItem(`${QUEUE_STORAGE_PREFIX}${persistKey}`);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<PersistedQueueState>;
    if (!Array.isArray(parsed.jobQueue)) return null;
    return {
      jobQueue: parsed.jobQueue,
      activeJobIndex: typeof parsed.activeJobIndex === "number" ? parsed.activeJobIndex : 0,
      appliedJobIds: Array.isArray(parsed.appliedJobIds) ? parsed.appliedJobIds : [],
      pipelineByJobId: parsed.pipelineByJobId && typeof parsed.pipelineByJobId === "object" ? parsed.pipelineByJobId : {},
    };
  } catch {
    return null;
  }
}

export function useAvalonRelay(applicantContext: string, applierName = "", options?: AvalonRelayOptions) {
  const persistKey = options?.persistKey;
  const initialPersisted = useMemo(() => (persistKey ? loadPersistedQueue(persistKey) : null), [persistKey]);
  const persistSession = options?.persist !== false;
  const accountIsBeta = isBetaTier(options?.accountTier);
  const [serverUrl, setServerUrl] = useState(() => avalonRelayUrl());
  const [sessionId, setSessionId] = useState(() => options?.sessionId ?? storedAvalonSessionId());
  const [connected, setConnected] = useState(false);
  const [registered, setRegistered] = useState<RegisteredPayload | null>(null);
  const [peers, setPeers] = useState({ extension: false, controller: false });
  const [tabs, setTabs] = useState<TabInfo[]>([]);
  const [selectedTabId, setSelectedTabId] = useState<number | "">("");
  // Combobox option probing is always on — it's what makes Greenhouse/Ashby
  // dropdowns fillable, and the small extra scan time is worth it on every site.
  const probeComboboxes = true;
  const [logs, setLogs] = useState<AvalonLogEntry[]>([]);
  const [screenshot, setScreenshot] = useState<string | null>(null);
  const [actionableTree, setActionableTree] = useState<ActionableTree | null>(null);
  const [treePage, setTreePage] = useState<ActionablePageContext | null>(null);
  const [formAnalysis, setFormAnalysis] = useState<FormAnalysisResult | null>(null);
  const [generatedScript, setGeneratedScript] = useState("");
  const [fieldScriptsById, setFieldScriptsById] = useState<Record<string, string>>({});
  const [injectionPlan, setInjectionPlan] = useState<InjectionPlan | null>(null);
  const [selectedTreeFieldId, setSelectedTreeFieldId] = useState<string | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [applying, setApplying] = useState(false);
  const [jobQueue, setJobQueue] = useState<QueuedJob[]>(() => initialPersisted?.jobQueue ?? []);
  const [activeJobIndex, setActiveJobIndex] = useState(() => initialPersisted?.activeJobIndex ?? 0);
  const [applyPhase, setApplyPhase] = useState<ApplyProgress | null>(null);
  const [appliedJobIds, setAppliedJobIds] = useState<Set<string>>(
    () => new Set(initialPersisted?.appliedJobIds ?? []),
  );
  const [resumesByJobId, setResumesByJobId] = useState<Record<string, JobResume>>({});
  const [resumeJobId, setResumeJobId] = useState<string | null>(null);
  const [generatingResume, setGeneratingResume] = useState(false);
  const [generatingResumeJobId, setGeneratingResumeJobId] = useState<string | null>(null);
  const [resumeGenerateStep, setResumeGenerateStep] = useState<string | null>(null);
  const [resumeGeneratedSections, setResumeGeneratedSections] = useState<
    Partial<Record<ResumeSectionPurpose, boolean>>
  >({});
  const [pipelineByJobId, setPipelineByJobId] = useState<Record<string, JobPipelineState>>(
    () => initialPersisted?.pipelineByJobId ?? {},
  );
  const [resumeError, setResumeError] = useState<string | null>(null);
  const [kitSubmitJobId, setKitSubmitJobId] = useState<string | null>(null);
  const [verifyResult, setVerifyResult] = useState<ManualVerifyResult | null>(null);
  const [verifying, setVerifying] = useState(false);
  const [tabValidity, setTabValidity] = useState<PageValidityResult | null>(null);
  const [validatingTab, setValidatingTab] = useState(false);
  const [usageRequests, setUsageRequests] = useState<UsageEntry[]>([]);
  const [applyDone, setApplyDone] = useState(false);
  const [autoRunning, setAutoRunning] = useState(false);
  // "idle" | "running" | "paused" — drives the Pause/Resume/Stop controls.
  const [autoRunState, setAutoRunState] = useState<"idle" | "running" | "paused">("idle");
  const [jobBudgetLimitUsd, setJobBudgetLimitUsdState] = useState(() => loadJobBudgetUsd());
  const [allowWindowFocus, setAllowWindowFocusState] = useState(() => loadAllowWindowFocus());
  const [budgetSkippedJobIds, setBudgetSkippedJobIds] = useState<Set<string>>(() => new Set());

  const socketRef = useRef<Socket | null>(null);
  const jobRunCostRef = useRef(0);
  const jobBudgetLimitRef = useRef(jobBudgetLimitUsd);
  jobBudgetLimitRef.current = jobBudgetLimitUsd;
  const allowWindowFocusRef = useRef(allowWindowFocus);
  allowWindowFocusRef.current = allowWindowFocus;
  const applyingRef = useRef(false);
  const autoRunningRef = useRef(false);
  // Interrupt controls for the auto-run/queue loops (checked between steps).
  const autoAbortRef = useRef(false);
  const autoPauseRef = useRef(false);
  // Queue-level stop (survives per-job abort resets so "Apply all" fully halts).
  const queueAbortRef = useRef(false);
  // Aborts in-flight fetches (résumé stream, AI calls) for the current run when Stop
  // is pressed. Null when no run is active, so manual steps are never auto-aborted.
  const runAbortRef = useRef<AbortController | null>(null);
  const pendingActionsRef = useRef<
    Map<string, { resolve: (result: ActionResult) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> }>
  >(new Map());
  const resumeGenByJobIdRef = useRef<Map<string, Promise<AttachedFile>>>(new Map());
  const submissionKitCacheRef = useRef<SubmissionKitCache | null>(null);
  // Debug run-logging: current run id, its job, a buffered event list + flush timer.
  const runIdRef = useRef<string | null>(null);
  const runJobRef = useRef<QueuedJob | null>(null);
  const runEventsRef = useRef<ApplyLogEvent[]>([]);
  const runFlushTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const sessionIdRef = useRef(sessionId);
  const sessionLabelRef = useRef(options?.sessionLabel?.trim() || "");
  /** Last label we successfully advertised to the relay (avoids redundant re-REGISTER). */
  const advertisedLabelRef = useRef("");
  const profileIdRef = useRef(options?.profileId ?? "");
  const selectedTabIdRef = useRef(selectedTabId);
  const jobQueueRef = useRef(jobQueue);
  const activeJobIndexRef = useRef(activeJobIndex);
  sessionIdRef.current = sessionId;
  sessionLabelRef.current = options?.sessionLabel?.trim() || "";
  profileIdRef.current = options?.profileId ?? "";
  selectedTabIdRef.current = selectedTabId;
  jobQueueRef.current = jobQueue;
  activeJobIndexRef.current = activeJobIndex;

  // Persist the queue + apply progress so a hard refresh (or a dev-server full
  // reload) doesn't wipe an in-progress run the way pure in-memory state would.
  // Résumés/logs/live tree stay in-memory only — this is deliberately just enough
  // to restore "what's queued and how far did it get".
  useEffect(() => {
    if (!persistKey) return;
    try {
      const snapshot: PersistedQueueState = {
        jobQueue,
        activeJobIndex,
        appliedJobIds: Array.from(appliedJobIds),
        pipelineByJobId,
      };
      localStorage.setItem(`${QUEUE_STORAGE_PREFIX}${persistKey}`, JSON.stringify(snapshot));
    } catch {
      /* storage unavailable or full — non-fatal */
    }
  }, [persistKey, jobQueue, activeJobIndex, appliedJobIds, pipelineByJobId]);

  const canExecute = connected && peers.extension;
  const executeDisabledReason = !connected
    ? "Connect to the Avalon relay server first."
    : !peers.extension
      ? `Extension not on your profile (id "${profileIdRef.current || 'default'}") + session "${sessionId || DEFAULT_SESSION_ID}". Install the Avalon extension, sign in, and match the session ID.`
      : null;

  /** Flush buffered run-log events to the backend (local JSONL + Mongo). */
  const flushRunLog = useCallback(
    (extra?: { status?: string; finished?: boolean }) => {
      const runId = runIdRef.current;
      if (!runId) return;
      const events = runEventsRef.current.splice(0);
      if (!events.length && !extra?.status && !extra?.finished) return;
      void postApplyLog({
        runId,
        applierName: applierName || undefined,
        job: runJobRef.current ?? undefined,
        events,
        ...extra,
      });
    },
    [applierName],
  );

  const scheduleRunFlush = useCallback(() => {
    if (runFlushTimerRef.current) return;
    runFlushTimerRef.current = setTimeout(() => {
      runFlushTimerRef.current = null;
      flushRunLog();
    }, 800);
  }, [flushRunLog]);

  const pushLog = useCallback(
    (message: string, success?: boolean) => {
      setLogs((prev) => [
        {
          id: `${Date.now()}_${Math.random()}`,
          at: new Date().toLocaleTimeString(),
          message,
          success,
        },
        ...prev.slice(0, 199),
      ]);
      // Mirror every UI log line into the active run's debug log.
      if (runIdRef.current) {
        runEventsRef.current.push({
          at: new Date().toISOString(),
          level: success === false ? "error" : success === true ? "success" : "info",
          message,
        });
        scheduleRunFlush();
      }
    },
    [scheduleRunFlush],
  );

  const setJobBudgetLimitUsd = useCallback((value: number) => {
    const clamped = clampJobBudgetUsd(value);
    setJobBudgetLimitUsdState(clamped);
    saveJobBudgetUsd(clamped);
  }, []);

  const setAllowWindowFocus = useCallback((value: boolean) => {
    setAllowWindowFocusState(value);
    saveAllowWindowFocus(value);
    allowWindowFocusRef.current = value;
  }, []);

  const resetJobRunCost = useCallback(() => {
    jobRunCostRef.current = 0;
  }, []);

  const checkBudgetExceeded = useCallback(
    () => jobRunCostRef.current > jobBudgetLimitRef.current,
    [],
  );

  /** Record one AI request's token/cost usage for the per-job usage panel. */
  const recordUsage = useCallback((label: string, u: UsageLike): { exceeded: boolean } => {
    if (!u) return { exceeded: checkBudgetExceeded() };
    const costUsd =
      u.costUsd ?? (typeof u.cost === "number" ? u.cost : u.cost?.totalUsd) ?? 0;
    const rawRates = u.pricingRates ?? (typeof u.cost === "number" ? undefined : u.cost?.rates);
    const pricingRates =
      rawRates?.promptPer1M != null && rawRates?.completionPer1M != null
        ? {
            promptPer1M: rawRates.promptPer1M,
            completionPer1M: rawRates.completionPer1M,
          }
        : undefined;
    if ((u.totalTokens ?? 0) === 0 && costUsd === 0) return { exceeded: checkBudgetExceeded() };
    jobRunCostRef.current += costUsd;
    setUsageRequests((prev) => [
      ...prev,
      {
        label,
        at: new Date().toLocaleTimeString(),
        model: u.model,
        provider: u.provider,
        promptTokens: u.promptTokens ?? 0,
        cachedTokens: u.cachedTokens ?? 0,
        completionTokens: u.completionTokens ?? 0,
        totalTokens: u.totalTokens ?? 0,
        costUsd,
        pricingRates,
      },
    ]);
    return { exceeded: checkBudgetExceeded() };
  }, [checkBudgetExceeded]);

  /**
   * True for the AbortError we throw/reject with when the run is stopped — matches
   * both our own thrown Errors and the DOMException fetch() raises on abort (which is
   * not always `instanceof Error`).
   */
  const isAbortError = useCallback(
    (error: unknown): boolean =>
      typeof error === "object" && error !== null && (error as { name?: string }).name === "AbortError",
    [],
  );

  /** Throw an AbortError if the current auto-run has been stopped (checked between awaits). */
  const throwIfAborted = useCallback(() => {
    if (autoAbortRef.current) {
      const err = new Error("Auto-run stopped");
      err.name = "AbortError";
      throw err;
    }
  }, []);

  /** Signal for the current run's fetches (résumé/AI). Undefined outside an active run. */
  const runSignal = useCallback(() => runAbortRef.current?.signal, []);

  /**
   * Reject every in-flight extension round-trip (emitActionAsync) immediately — used
   * by Stop so a 120s scan / 180s apply doesn't keep the loop hostage until timeout.
   */
  const abortAllPending = useCallback((reason = "Auto-run stopped") => {
    for (const [, entry] of pendingActionsRef.current) {
      clearTimeout(entry.timer);
      const err = new Error(reason);
      err.name = "AbortError";
      entry.reject(err);
    }
    pendingActionsRef.current.clear();
  }, []);

  const markPipeline = useCallback((jobId: string, patch: Partial<JobPipelineState>) => {
    if (!jobId) return;
    setPipelineByJobId((prev) => ({
      ...prev,
      [jobId]: { ...EMPTY_PIPELINE, ...prev[jobId], ...patch },
    }));
  }, []);

  /** Clear scan/analyze state when switching queue jobs (pipeline flags stay per job). */
  const resetJobWorkspace = useCallback(() => {
    setActionableTree(null);
    setFormAnalysis(null);
    setTreePage(null);
    setTabValidity(null);
    setVerifyResult(null);
    setApplyDone(false);
    setInjectionPlan(null);
    setGeneratedScript("");
    setFieldScriptsById({});
    setSelectedTreeFieldId(null);
    setKitSubmitJobId(null);
  }, []);

  const resetJobUsage = useCallback(() => setUsageRequests([]), []);

  /** Begin a new debug run (starts a JSONL file + Mongo doc via the meta event). */
  const startRunLog = useCallback(
    (job: QueuedJob, meta: Record<string, unknown>) => {
      const runId = newRunId();
      runIdRef.current = runId;
      runJobRef.current = job;
      runEventsRef.current = [];
      setAgentRunContext({ runId, jobId: job.id });
      void postApplyLog({
        runId,
        applierName: applierName || undefined,
        job,
        meta: { startedAt: new Date().toISOString(), ...meta },
        status: "running",
      });
      return runId;
    },
    [applierName],
  );

  /** Log a structured, data-rich event to the active run (no UI line). */
  const logRunData = useCallback(
    (phase: string, data: unknown, message?: string) => {
      if (!runIdRef.current) return;
      runEventsRef.current.push({
        at: new Date().toISOString(),
        level: "info",
        phase,
        message: message ?? `[${phase}]`,
        data,
      });
      scheduleRunFlush();
    },
    [scheduleRunFlush],
  );

  /** Close out the current debug run and flush everything. */
  const endRunLog = useCallback(
    (status: string) => {
      if (!runIdRef.current) return;
      flushRunLog({ status, finished: true });
      runIdRef.current = null;
      runJobRef.current = null;
      clearAgentRunContext();
    },
    [flushRunLog],
  );

  const emitAction = useCallback(
    (remoteAction: RemoteAction) => {
      if (!socketRef.current?.connected) {
        pushLog("Not connected", false);
        return;
      }
      socketRef.current.emit(SOCKET_EVENTS.EXECUTE_ACTION, remoteAction);
      pushLog(`Sent ${remoteAction.action} (${remoteAction.id})`);
    },
    [pushLog],
  );

  const connect = useCallback(() => {
    socketRef.current?.removeAllListeners();
    socketRef.current?.disconnect();
    const next = createAvalonSocket(serverUrl);
    socketRef.current = next;

    next.on("connect", () => {
      setConnected(true);
      pushLog("Connected to relay server");
      next.emit(
        SOCKET_EVENTS.REGISTER,
        {
          role: "controller",
          sessionId: sessionIdRef.current || undefined,
          profileId: profileIdRef.current || undefined,
          label: sessionLabelRef.current || undefined,
        },
        (response: RegisteredPayload) => {
          setRegistered(response);
          setSessionId((prev) => prev || response.sessionId);
          setPeers(response.peers);
          advertisedLabelRef.current = sessionLabelRef.current;
          pushLog(`Registered session ${response.sessionId}`);
        },
      );
    });

    next.on("disconnect", (reason) => {
      setConnected(false);
      setPeers({ extension: false, controller: false });
      if (reason !== "io client disconnect") {
        pushLog(`Disconnected (${reason})`);
      }
    });

    next.on("connect_error", (err) => {
      pushLog(`Connection error: ${err.message}`, false);
    });

    next.on("peers-update", (payload: { peers: typeof peers }) => {
      setPeers(payload.peers);
    });

    next.on(SOCKET_EVENTS.TABS_UPDATE, (nextTabs: TabInfo[]) => {
      setTabs(nextTabs);
      if (nextTabs.length && selectedTabIdRef.current === "") {
        const active = nextTabs.find((t) => t.active) ?? nextTabs[0];
        setSelectedTabId(active.id);
      }
    });

    next.on(SOCKET_EVENTS.ACTION_RESULT, (result: ActionResult) => {
      // Resolve any awaiting orchestration step (applyJob) before state updates.
      const entry = pendingActionsRef.current.get(result.actionId);
      if (entry) {
        pendingActionsRef.current.delete(result.actionId);
        clearTimeout(entry.timer);
        entry.resolve(result);
      }
      const data = result.data as
        | {
            tree?: ActionableTree;
            page?: ActionablePageContext;
            applied?: number;
            skipped?: number;
            failed?: number;
            urlMismatch?: { expected: string; actual: string };
          }
        | undefined;
      if (result.success && data?.tree) {
        setActionableTree(data.tree);
        setFormAnalysis(null);
        setGeneratedScript("");
        setFieldScriptsById({});
        setInjectionPlan(null);
        setSelectedTreeFieldId(null);
        if (data.page) {
          setTreePage(data.page);
          setSelectedTabId(data.page.tabId);
        }
        const activeJob = jobQueueRef.current[activeJobIndexRef.current];
        if (activeJob) {
          markPipeline(activeJob.id, { scanned: true, analyzed: false, applied: false, verified: false });
        }
        const groups = data.tree.length;
        const targets = data.tree.reduce((n, g) => n + g.children.length, 0);
        const pageHint = data.page?.url ? ` · ${data.page.url}` : "";
        pushLog(`Actionable tree: ${groups} group(s), ${targets} target(s)${pageHint}`, true);
        return;
      }
      if (result.success && data?.applied != null) {
        applyingRef.current = false;
        setApplying(false);
        const mismatch =
          data.urlMismatch != null
            ? ` (page URL changed: expected ${data.urlMismatch.expected})`
            : "";
        pushLog(
          `Apply inject: ${data.applied} applied, ${data.skipped ?? 0} skipped, ${data.failed ?? 0} failed${mismatch}`,
          (data.failed ?? 0) === 0,
        );
        return;
      }
      if (!result.success && applyingRef.current) {
        applyingRef.current = false;
        setApplying(false);
      }
      pushLog(
        result.success
          ? `Action ${result.actionId} OK${result.data ? `: ${JSON.stringify(result.data)}` : ""}`
          : `Action ${result.actionId} failed: ${result.error}`,
        result.success,
      );
    });

    next.on(SOCKET_EVENTS.APPLY_PROGRESS, (progress: ApplyProgress) => {
      setApplyPhase((prev) => {
        if (
          prev?.phase === "error" &&
          progress.phase !== "error" &&
          progress.phase !== "done" &&
          progress.phase !== "submitted"
        ) {
          return prev;
        }
        return progress;
      });
      pushLog(progress.message, progress.phase !== "error");
    });

    next.on(SOCKET_EVENTS.SCREENSHOT_RESULT, (payload: { dataUrl?: string; error?: string }) => {
      if (payload.dataUrl) {
        setScreenshot(payload.dataUrl);
        pushLog("Screenshot received", true);
      } else {
        pushLog(`Screenshot failed: ${payload.error}`, false);
      }
    });
  }, [markPipeline, pushLog, serverUrl]);

  useEffect(() => {
    connect();
    return () => {
      socketRef.current?.removeAllListeners();
      socketRef.current?.disconnect();
    };
  }, [connect]);

  // Persist the configured session so a reload re-registers into the SAME
  // session instead of falling back to the shared "default" one. Multi-session
  // engines opt out (persist:false) — the session list owns their ids.
  useEffect(() => {
    if (!persistSession) return;
    persistAvalonSessionId(sessionId);
  }, [persistSession, sessionId]);

  // If the session ID or display label changes while connected, re-register
  // (debounced) so the extension picker sees fresh Athens session names.
  const sessionLabel = options?.sessionLabel?.trim() || "";
  useEffect(() => {
    if (!connected || !registered) return;
    const desired = sessionId.trim() || DEFAULT_SESSION_ID;
    const needId = desired !== registered.sessionId;
    const needLabel = sessionLabel !== advertisedLabelRef.current;
    if (!needId && !needLabel) return;
    const timer = setTimeout(() => {
      const sock = socketRef.current;
      if (!sock?.connected) return;
      sock.emit(
        SOCKET_EVENTS.REGISTER,
        {
          role: "controller",
          sessionId: desired,
          profileId: profileIdRef.current || undefined,
          label: sessionLabel || undefined,
        },
        (response: RegisteredPayload) => {
          advertisedLabelRef.current = sessionLabel;
          setRegistered(response);
          setPeers(response.peers);
          pushLog(`Registered session ${response.sessionId}`);
        },
      );
    }, 800);
    return () => clearTimeout(timer);
  }, [connected, registered, sessionId, sessionLabel, pushLog]);

  /** Aggregated token + cost usage for the current job (total + per-request list). */
  const jobUsage = useMemo(() => {
    const sum = (k: keyof UsageEntry) =>
      usageRequests.reduce((n, r) => n + (typeof r[k] === "number" ? (r[k] as number) : 0), 0);
    return {
      requests: usageRequests,
      totalTokens: sum("totalTokens"),
      promptTokens: sum("promptTokens"),
      cachedTokens: sum("cachedTokens"),
      completionTokens: sum("completionTokens"),
      totalCostUsd: usageRequests.reduce((n, r) => n + r.costUsd, 0),
    };
  }, [usageRequests]);

  const actionPlanByFieldId = useMemo(() => {
    const map = new Map<string, FieldActionPlan>();
    for (const field of formAnalysis?.fields ?? []) {
      map.set(field.id, field);
    }
    return map;
  }, [formAnalysis]);

  const displayedScript = useMemo(() => {
    if (selectedTreeFieldId) {
      const snippet = fieldScriptsById[selectedTreeFieldId];
      if (snippet) return snippet;
      return `No step for "${selectedTreeFieldId}" — skipped or no value. Run Analyze to rebuild.`;
    }
    return generatedScript;
  }, [fieldScriptsById, generatedScript, selectedTreeFieldId]);

  const buildPlanFromFields = useCallback(
    (fields: FieldActionPlan[]): InjectionPlan | null => {
      if (!actionableTree?.length || !fields.length) return null;
      const { plan, preview, fieldPreviews } = buildFormInjectionPlan({
        tree: actionableTree,
        fields,
      });
      setInjectionPlan(plan);
      setGeneratedScript(preview);
      setFieldScriptsById(Object.fromEntries(fieldPreviews.map((entry) => [entry.id, entry.preview])));
      pushLog(`Fill plan built · ${plan.steps.length} step(s)`, true);
      return plan;
    },
    [actionableTree, pushLog],
  );

  const fetchActionableTree = useCallback(() => {
    emitAction({
      id: createActionId(),
      tabId: selectedTabId === "" ? undefined : Number(selectedTabId),
      action: "fetch_actionable_tree",
      payload: { probeComboboxes },
    });
  }, [emitAction, probeComboboxes, selectedTabId]);

  const getActiveQueuedJob = useCallback((): QueuedJob | null => {
    const queue = jobQueueRef.current;
    const idx = activeJobIndexRef.current;
    return queue[idx] ?? null;
  }, []);

  /**
   * Generate (or reuse) a per-job résumé via the Resume Generator pipeline.
   * Throws on failure — apply must abort (no bundled fallback).
   */
  const ensureJobResume = useCallback(
    async (job: QueuedJob, options?: { forceRegenerate?: boolean }): Promise<AttachedFile> => {
      if (!applierName) throw new Error("Select an applier profile before applying");
      if (isManualJob(job)) throw new Error(`"${job.title}" is a manual job — résumé generation requires a saved job with description`);

      if (!options?.forceRegenerate) {
        const cached = resumesByJobId[job.id];
        if (cached?.file?.base64) {
          setResumeJobId(job.id);
          setResumeError(null);
          markPipeline(job.id, { resumeReady: true });
          return cached.file;
        }
        // Job Search (or a prior Agent run) may already have a draft on disk —
        // load it before spending an LLM call.
        if (applierName) {
          try {
            const draft = await fetchAgentJobResumePdf(applierName, job.id, runSignal());
            const file: AttachedFile = {
              name: profileResumeFileName(draft.fileName, `${applierName}.pdf`),
              mimeType: draft.mimeType,
              base64: draft.pdfBase64,
            };
            setResumesByJobId((prev) => ({
              ...prev,
              [job.id]: {
                jobId: job.id,
                file,
                reused: true,
                generationId: null,
                resumePdfPath: null,
              },
            }));
            setResumeJobId(job.id);
            setResumeError(null);
            markPipeline(job.id, { resumeReady: true });
            pushLog(`Résumé reused for "${job.title}" (loaded existing draft)`, true);
            return file;
          } catch {
            /* no draft yet — fall through to generate */
          }
        }
      } else {
        resumeGenByJobIdRef.current.delete(job.id);
        setResumesByJobId((prev) => {
          const next = { ...prev };
          delete next[job.id];
          return next;
        });
      }

      const jd = await fetchJobDescription(job.id, runSignal());
      if (!jd) throw new Error(`No job description for "${job.title}" — cannot generate tailored résumé`);

      pushLog(
        options?.forceRegenerate
          ? `Regenerating tailored résumé for "${job.title}" (Resume Generator + JD)…`
          : `Loading or generating tailored résumé for "${job.title}"…`,
        true,
      );
      const gen = await generateJobResumeStream(
        {
          applierName,
          jobId: job.id,
          jobDescription: jd,
          forceRegenerate: options?.forceRegenerate,
        },
        (progress) => {
          if (progress.stepLabel) setResumeGenerateStep(progress.stepLabel);
          if (Object.keys(progress.completedSections).length > 0) {
            setResumeGeneratedSections((prev) => ({ ...prev, ...progress.completedSections }));
          }
        },
        runSignal(),
      );
      if (!gen.reused) {
        recordUsage(`Résumé generation${gen.model ? ` (${gen.model})` : ""}`, {
          ...(gen.usage ?? {}),
          model: gen.model,
          provider: gen.provider,
        });
      }
      const file: AttachedFile = {
        name: profileResumeFileName(gen.fileName, `${applierName}.pdf`),
        mimeType: gen.mimeType,
        base64: gen.pdfBase64,
      };
      setResumesByJobId((prev) => ({
        ...prev,
        [job.id]: {
          jobId: job.id,
          file,
          reused: gen.reused,
          generationId: gen.generationId,
          resumePdfPath: gen.resumePdfPath ?? null,
        },
      }));
      setResumeJobId(job.id);
      setResumeError(null);
      markPipeline(job.id, { resumeReady: true });
      const modelNote = gen.model ? ` · ${gen.provider ? `${gen.provider}/` : ""}${gen.model}` : "";
      const pathNote = gen.resumePdfPath ? ` · saved ${gen.resumePdfPath}` : "";
      pushLog(`Résumé ${gen.reused ? "reused" : "generated"} for "${job.title}"${modelNote}${pathNote}`, true);
      return file;
    },
    [applierName, markPipeline, pushLog, recordUsage, resumesByJobId, runSignal],
  );

  /** Start résumé generation for a queued job (deduped per job id). */
  const startResumeForJob = useCallback(
    (job: QueuedJob, options?: { forceRegenerate?: boolean }): Promise<AttachedFile | null> => {
      if (isManualJob(job)) return Promise.resolve(null);
      if (!options?.forceRegenerate) {
        const inflight = resumeGenByJobIdRef.current.get(job.id);
        if (inflight) return inflight.then((file) => file);
      }

      const promise = (async () => {
        setGeneratingResume(true);
        setGeneratingResumeJobId(job.id);
        setResumeGenerateStep(options?.forceRegenerate ? "Starting regeneration…" : "Loading résumé…");
        setResumeGeneratedSections({});
        setResumeJobId(job.id);
        setResumeError(null);
        try {
          return await ensureJobResume(job, options);
        } catch (error) {
          if (isAbortError(error)) {
            pushLog("Résumé generation stopped", false);
            throw error;
          }
          const msg = error instanceof Error ? error.message : "Résumé generation failed";
          setResumeError(msg);
          pushLog(msg, false);
          throw error;
        } finally {
          setGeneratingResume(false);
          setGeneratingResumeJobId(null);
          setResumeGenerateStep(null);
          resumeGenByJobIdRef.current.delete(job.id);
        }
      })();

      resumeGenByJobIdRef.current.set(job.id, promise);
      return promise;
    },
    [ensureJobResume, isAbortError, pushLog],
  );

  const generateActiveJobResume = useCallback(
    async (forceRegenerate = false) => {
      const job = getActiveQueuedJob();
      if (!job) {
        pushLog("Select a queued job first", false);
        return;
      }
      if (isManualJob(job)) {
        pushLog(`"${job.title}" is manual — résumé generation needs a MongoDB job with description`, false);
        return;
      }
      // Only burn an LLM regenerate when we actually have an in-memory PDF to
      // replace. Persisted pipeline.resumeReady alone must not force regenerate
      // (common after reload, or when Job Search already generated the draft).
      const hasCachedFile = Boolean(resumesByJobId[job.id]?.file?.base64);
      const effectiveForce = Boolean(forceRegenerate && hasCachedFile);
      try {
        await startResumeForJob(job, { forceRegenerate: effectiveForce });
      } catch {
        /* logged in startResumeForJob */
      }
    },
    [getActiveQueuedJob, pushLog, resumesByJobId, startResumeForJob],
  );

  const getResumeForJob = useCallback(
    (job: QueuedJob): AttachedFile | null => {
      const entry = resumesByJobId[job.id];
      return entry?.file?.base64 ? entry.file : null;
    },
    [resumesByJobId],
  );

  // When the queue (or applier) changes, discover Job Search drafts and hydrate
  // the active job's PDF so Step 4 / auto-apply reuse instead of regenerating.
  const resumesByJobIdRef = useRef(resumesByJobId);
  resumesByJobIdRef.current = resumesByJobId;

  useEffect(() => {
    if (!applierName || jobQueue.length === 0) return;
    const jobs = jobQueue.filter((j) => !isManualJob(j));
    if (!jobs.length) return;
    let cancelled = false;
    void (async () => {
      const existing = await fetchJobsWithGeneratedResumes(
        applierName,
        jobs.map((j) => j.id),
      );
      if (cancelled || existing.size === 0) return;

      setPipelineByJobId((prev) => {
        const next = { ...prev };
        let changed = false;
        for (const id of existing) {
          if (next[id]?.resumeReady) continue;
          next[id] = { ...EMPTY_PIPELINE, ...next[id], resumeReady: true };
          changed = true;
        }
        return changed ? next : prev;
      });

      // Prefetch PDFs for the active job and the next few in queue (not all 200).
      const start = Math.max(0, activeJobIndex);
      const prefetch = jobs.slice(start, start + 5).filter((j) => existing.has(j.id));
      await mapPool(prefetch, 4, async (job) => {
        if (cancelled) return;
        if (resumesByJobIdRef.current[job.id]?.file?.base64) return;
        try {
          const draft = await fetchAgentJobResumePdf(applierName, job.id);
          if (cancelled) return;
          setResumesByJobId((prev) => {
            if (prev[job.id]?.file?.base64) return prev;
            return {
              ...prev,
              [job.id]: {
                jobId: job.id,
                file: {
                  name: profileResumeFileName(draft.fileName, `${applierName}.pdf`),
                  mimeType: draft.mimeType,
                  base64: draft.pdfBase64,
                },
                reused: true,
                generationId: null,
                resumePdfPath: null,
              },
            };
          });
          setPipelineByJobId((prev) => ({
            ...prev,
            [job.id]: { ...EMPTY_PIPELINE, ...prev[job.id], resumeReady: true },
          }));
        } catch {
          /* draft PDF not on disk yet — ensureJobResume will still reuse Mongo content */
        }
      });
    })();
    return () => {
      cancelled = true;
    };
  }, [applierName, jobQueue, activeJobIndex]);

  useEffect(() => {
    submissionKitCacheRef.current = null;
    setKitSubmitJobId(null);
  }, [applierName, accountIsBeta]);

  const loadSubmissionKitFile = useCallback(async (): Promise<AttachedFile> => {
    if (!applierName) throw new Error("Select an applier profile before applying");
    const cached = submissionKitCacheRef.current;
    if (cached?.applierName === applierName && cached.file.base64) return cached.file;

    const kit = await fetchSubmissionKitResume(applierName, runSignal());
    const fileName = kit.fileName.toLowerCase().endsWith(".pdf") ? kit.fileName : `${kit.fileName}.pdf`;
    const file: AttachedFile = {
      name: fileName,
      mimeType: "application/pdf",
      base64: kit.contentBase64,
    };
    submissionKitCacheRef.current = {
      applierName,
      resumeId: kit.resumeId,
      file,
    };
    return file;
  }, [applierName, runSignal]);

  const resolveResumeForSubmission = useCallback(
    async (job: QueuedJob, generatedFile: AttachedFile): Promise<AttachedFile> => {
      if (accountIsBeta) {
        setKitSubmitJobId(null);
        return {
          ...generatedFile,
          name: profileResumeFileName(generatedFile.name),
        };
      }
      const kitFile = await loadSubmissionKitFile();
      // Non-Beta tiers upload kit PDF bytes, but use the same generated-resume filename Beta uses.
      const submissionFile: AttachedFile = {
        ...kitFile,
        name: profileResumeFileName(generatedFile.name, kitFile.name),
      };
      setKitSubmitJobId(job.id);
      pushLog(`Resume Generator Kit PDF selected for "${job.title}" (${submissionFile.name})`, true);
      return submissionFile;
    },
    [accountIsBeta, loadSubmissionKitFile, pushLog],
  );

  const analyzeTree = useCallback(async () => {
    if (!actionableTree?.length) {
      pushLog("Fetch an actionable tree first", false);
      return;
    }
    if (!treePage?.tabId) {
      pushLog("No page context — scan the form on the target tab first", false);
      return;
    }
    if (!canExecute) {
      pushLog(executeDisabledReason ?? "Cannot execute", false);
      return;
    }

    setAnalyzing(true);
    try {
      const result = await analyzeFormFields({
        tree: actionableTree,
        applicantContext: applicantContext || undefined,
      });
      setFormAnalysis(result);
      recordUsage("Analyze form", result.usage);
      setGeneratedScript("");
      setFieldScriptsById({});
      setInjectionPlan(null);
      setSelectedTreeFieldId(null);
      const cost = result.usage?.cost?.totalUsd;
      pushLog(
        `Action plan: ${result.fields.length} field(s)${cost != null ? ` · $${cost.toFixed(6)}` : ""}`,
        true,
      );
      buildPlanFromFields(result.fields);
      const job = getActiveQueuedJob();
      if (job) markPipeline(job.id, { analyzed: true });
    } catch (error) {
      pushLog(error instanceof Error ? error.message : "Analysis failed", false);
    } finally {
      setAnalyzing(false);
    }
  }, [
    actionableTree,
    applicantContext,
    buildPlanFromFields,
    canExecute,
    executeDisabledReason,
    getActiveQueuedJob,
    markPipeline,
    pushLog,
    treePage,
  ]);

  const generatePlan = useCallback((): InjectionPlan | null => {
    if (!formAnalysis?.fields.length) {
      pushLog("Analyze the form first", false);
      return null;
    }
    return buildPlanFromFields(formAnalysis.fields);
  }, [buildPlanFromFields, formAnalysis?.fields.length, pushLog]);

  const highlightControl = useCallback(
    (control: TargetSelector) => {
      emitAction({
        id: createActionId(),
        tabId: selectedTabId === "" ? undefined : Number(selectedTabId),
        target: control,
        action: "highlight",
        payload: {},
      });
    },
    [emitAction, selectedTabId],
  );

  const selectTreeTarget = useCallback(
    (entry: ActionableTarget, id: string) => {
      setSelectedTreeFieldId(id);
      highlightControl(entry.control);
      const hasStep = Boolean(fieldScriptsById[id]);
      pushLog(
        `Selected "${entry.target}"${hasStep ? " — showing field step" : " — no step (skipped or no value)"}`,
      );
    },
    [fieldScriptsById, highlightControl, pushLog],
  );

  const requestTabs = useCallback(() => {
    socketRef.current?.emit(SOCKET_EVENTS.REQUEST_TABS);
    pushLog("Requested tab list");
  }, [pushLog]);

  const requestScreenshot = useCallback(() => {
    socketRef.current?.emit(SOCKET_EVENTS.REQUEST_SCREENSHOT, {
      tabId: selectedTabId === "" ? undefined : Number(selectedTabId),
    });
    pushLog("Requested screenshot");
  }, [pushLog, selectedTabId]);

  const navigateToJob = useCallback(
    (job: QueuedJob) => {
      if (!canExecute) {
        pushLog(executeDisabledReason ?? "Cannot navigate — extension not connected", false);
        return;
      }
      emitAction({
        id: createActionId(),
        tabId: selectedTabId === "" ? undefined : Number(selectedTabId),
        action: "navigate",
        payload: { url: job.url },
      });
      pushLog(`Navigating to ${job.title || job.url}`);
    },
    [canExecute, emitAction, executeDisabledReason, pushLog, selectedTabId],
  );

  const enqueueJobs = useCallback(
    (jobs: QueuedJob[]) => {
      setJobQueue(jobs);
      setActiveJobIndex(0);
      pushLog(`Queued ${jobs.length} job(s) for application`, true);
    },
    [pushLog],
  );

  /** Emit an action and resolve with its ACTION_RESULT (or reject on timeout). */
  const emitActionAsync = useCallback(
    (action: RemoteAction, timeoutMs = 120000): Promise<ActionResult> =>
      new Promise((resolve, reject) => {
        if (!socketRef.current?.connected) {
          reject(new Error("Not connected to relay"));
          return;
        }
        // Non-Beta always grants focus. Beta uses the user toggle (default on).
        const stamped: RemoteAction = {
          ...action,
          allowWindowFocus: accountIsBeta ? allowWindowFocusRef.current : true,
        };
        const timer = setTimeout(() => {
          pendingActionsRef.current.delete(stamped.id);
          reject(new Error(`Action "${stamped.action}" timed out`));
        }, timeoutMs);
        pendingActionsRef.current.set(stamped.id, { resolve, reject, timer });
        socketRef.current.emit(SOCKET_EVENTS.EXECUTE_ACTION, stamped);
        pushLog(`Sent ${stamped.action} (${stamped.id})`);
      }),
    [accountIsBeta, pushLog],
  );

  const runApplyWithPlan = useCallback(
    async (plan: InjectionPlan, page: ActionablePageContext, resumeFile: AttachedFile) => {
      applyingRef.current = true;
      setApplying(true);
      try {
        const payload = buildApplyInjectionPlanPayload(plan, page, { autoSubmit: true, resumeFile });
        const applyRes = await emitActionAsync(
          {
            id: createActionId(),
            tabId: page.tabId,
            action: "apply_injection_plan",
            payload: payload as unknown as Record<string, unknown>,
          },
          180000,
        );
        if (!applyRes.success) throw new Error(applyRes.error || "Apply failed");
        const applyData = applyRes.data as
          | { submitted?: boolean; filesFound?: number; filesAttached?: number }
          | undefined;
        const filesFound = applyData?.filesFound ?? 0;
        const filesAttached = applyData?.filesAttached ?? 0;
        if (filesFound > 0 && filesAttached === 0) {
          throw new Error(`Résumé was not attached (${filesAttached}/${filesFound})`);
        }
        if (filesFound > 0) {
          pushLog(`Résumé uploaded to ${filesAttached}/${filesFound} field(s)`, filesAttached > 0);
        }
        pushLog(
          applyData?.submitted ? "Fill plan applied and submitted" : "Fill plan applied — review before submit",
          true,
        );
      } finally {
        applyingRef.current = false;
        setApplying(false);
      }
    },
    [emitActionAsync, pushLog],
  );

  const applyActionPlan = useCallback(async () => {
    if (!actionableTree?.length || !formAnalysis?.fields.length) {
      pushLog("Analyze the form first to build an action plan", false);
      return;
    }
    if (!treePage?.tabId) {
      pushLog("No page context — fetch the actionable tree on the target tab first", false);
      return;
    }
    if (!canExecute) {
      pushLog(executeDisabledReason ?? "Cannot execute", false);
      return;
    }

    const plan = injectionPlan ?? generatePlan();
    if (!plan || plan.steps.length === 0) {
      pushLog("No fill plan to apply", false);
      return;
    }

    const job = getActiveQueuedJob();
    if (!job || isManualJob(job)) {
      pushLog("Select a queued MongoDB job with a drafted résumé", false);
      return;
    }

    const generatedResumeFile = getResumeForJob(job);
    if (!generatedResumeFile) {
      pushLog("Generate tailored résumé first (step 1) — preview the PDF before applying", false);
      return;
    }

    try {
      const submissionFile = await resolveResumeForSubmission(job, generatedResumeFile);
      await runApplyWithPlan(plan, treePage, submissionFile);
      setApplyDone(true);
      markPipeline(job.id, { applied: true });
    } catch (error) {
      pushLog(error instanceof Error ? error.message : "Apply failed", false);
    }
  }, [
    actionableTree?.length,
    canExecute,
    executeDisabledReason,
    formAnalysis?.fields.length,
    generatePlan,
    getActiveQueuedJob,
    getResumeForJob,
    injectionPlan,
    markPipeline,
    pushLog,
    resolveResumeForSubmission,
    runApplyWithPlan,
    treePage,
  ]);

  /** Open the active queue job URL in a new browser tab (step 2 — after résumé preview). */
  /** Close a tab (best-effort) via the extension. */
  const closeTab = useCallback(
    async (tabId: number) => {
      await emitActionAsync({ id: createActionId(), tabId, action: "close_tab", payload: {} }, 10000).catch(() => {});
    },
    [emitActionAsync],
  );

  const abortForBudget = useCallback(
    async (job: QueuedJob, tabId?: number) => {
      const spent = jobRunCostRef.current;
      const limit = jobBudgetLimitRef.current;
      pushLog(
        `"${job.title}" skipped — AI budget exceeded ($${spent.toFixed(4)} / $${limit.toFixed(2)})`,
        false,
      );
      setBudgetSkippedJobIds((prev) => new Set(prev).add(job.id));
      if (tabId) await closeTab(tabId);
    },
    [closeTab, pushLog],
  );

  /**
   * Validity gate — after a job tab is opened, read the page + scan its structure
   * and let the AI decide whether it's a live application form. Returns the scanned
   * tree/page so callers can reuse them (no double scan). Probing is off (fast).
   */
  const validateOpenedTab = useCallback(
    async (
      tabId: number,
      job: QueuedJob,
    ): Promise<{ validity: PageValidityResult; tree: ActionableTree | null; pageCtx: ActionablePageContext | null }> => {
      let text = "";
      let controlCount = 0;
      try {
        const st = await emitActionAsync(
          { id: createActionId(), tabId, action: "read_page_state", payload: {} },
          15000,
        );
        const d = (st.data as { text?: string; controlCount?: number } | undefined) ?? {};
        text = d.text ?? "";
        controlCount = d.controlCount ?? 0;
      } catch {
        /* read failed → treated as low signal below */
      }

      let tree: ActionableTree | null = null;
      let pageCtx: ActionablePageContext | null = null;
      try {
        const tr = await emitActionAsync(
          { id: createActionId(), tabId, action: "fetch_actionable_tree", payload: { probeComboboxes: false } },
          60000,
        );
        const d = (tr.data as { tree?: ActionableTree; page?: ActionablePageContext } | undefined) ?? {};
        tree = d.tree ?? null;
        pageCtx = d.page ?? null;
      } catch {
        /* scan failed */
      }
      const fieldCount = tree
        ? tree.reduce((n, g) => n + g.children.filter((c) => c.controlType !== "link").length, 0)
        : 0;

      const validity = await validateJobPage(
        {
          text,
          title: pageCtx?.title,
          url: pageCtx?.url ?? job.url,
          fieldCount,
          controlCount,
        },
        runSignal(),
      );
      recordUsage("Verify tab (AI)", validity.usage);
      return { validity, tree, pageCtx };
    },
    [emitActionAsync, recordUsage, runSignal],
  );

  /** Pipeline step 2 — open the active job's URL in a fresh tab (open only). */
  const openActiveJob = useCallback(async () => {
    const job = getActiveQueuedJob();
    if (!job) {
      pushLog("Select a queued job first", false);
      return;
    }
    if (!canExecute) {
      pushLog(executeDisabledReason ?? "Cannot open job — extension not connected", false);
      return;
    }
    setTabValidity(null);
    setVerifyResult(null);
    setApplyDone(false);
    resetJobUsage();
    try {
      const opened = await emitActionAsync({
        id: createActionId(),
        action: "open_tab",
        payload: { url: job.url },
      });
      if (!opened.success) throw new Error(opened.error || "Failed to open tab");
      const openedData = opened.data as { tabId?: number; page?: ActionablePageContext };
      const tabId = openedData.tabId;
      setActionableTree(null);
      setFormAnalysis(null);
      setInjectionPlan(null);
      setGeneratedScript("");
      setFieldScriptsById({});
      setSelectedTreeFieldId(null);
      setTabValidity(null);
      setVerifyResult(null);
      setApplyDone(false);
      if (tabId) setSelectedTabId(tabId);
      setTreePage(openedData.page ?? null);
      markPipeline(job.id, {
        opened: true,
        validated: false,
        scanned: false,
        analyzed: false,
        applied: false,
        verified: false,
      });
      pushLog(`Opened "${job.title}" — verify it's a valid application form next`, true);
    } catch (error) {
      pushLog(error instanceof Error ? error.message : "Failed to open job", false);
    }
  }, [canExecute, emitActionAsync, executeDisabledReason, getActiveQueuedJob, markPipeline, pushLog]);

  /**
   * Pipeline step 3 — verify the opened tab is a live job-application form. If it's
   * expired / not found / an error / not a form, close the tab and mark the job
   * handled so the queue moves on (per the requested flow).
   */
  const validateActiveTab = useCallback(async () => {
    const job = getActiveQueuedJob();
    const tabId = treePage?.tabId ?? (typeof selectedTabId === "number" ? selectedTabId : undefined);
    if (!tabId) {
      pushLog("Open the job link first (step 2)", false);
      return;
    }
    if (!canExecute) {
      pushLog(executeDisabledReason ?? "Cannot verify — extension not connected", false);
      return;
    }
    setValidatingTab(true);
    setTabValidity(null);
    try {
      const jobForCheck: QueuedJob =
        job ?? { id: "", title: treePage?.title ?? "this application", company: "", url: treePage?.url ?? "", source: "" };
      const { validity } = await validateOpenedTab(tabId, jobForCheck);
      setTabValidity(validity);
      if (validity.valid) {
        if (job) markPipeline(job.id, { validated: true });
        pushLog(`Valid application form — ${validity.reason}`, true);
      } else {
        pushLog(`Not a usable form (${validity.kind}) — ${validity.reason}; closing tab`, false);
        await closeTab(tabId);
        if (job) {
          setAppliedJobIds((prev) => new Set(prev).add(job.id));
          if (!isManualJob(job) && applierName) {
            try {
              await applyToJob(job.id, applierName);
            } catch {
              /* non-fatal */
            }
          }
        }
      }
    } catch (error) {
      pushLog(error instanceof Error ? error.message : "Validity check failed", false);
    } finally {
      setValidatingTab(false);
    }
  }, [
    applierName,
    canExecute,
    closeTab,
    executeDisabledReason,
    getActiveQueuedJob,
    markPipeline,
    pushLog,
    selectedTabId,
    treePage,
    validateOpenedTab,
  ]);

  /** Read the post-submit page (innerText + remaining control count) via CSP-safe read_page_state. */
  const readApplyPageState = useCallback(
    async (tabId: number, submitted: boolean) => {
      try {
        const res = await emitActionAsync(
          {
            id: createActionId(),
            tabId,
            action: "read_page_state",
            payload: {},
          },
          15000,
        );
        const data =
          (res.data as { text?: string; controlCount?: number; otpInputs?: number } | undefined) ?? {};
        return {
          text: data.text ?? "",
          controlCount: data.controlCount ?? 0,
          otpInputs: data.otpInputs ?? 0,
          submitted,
        };
      } catch {
        return { text: "", controlCount: 0, otpInputs: 0, submitted };
      }
    },
    [emitActionAsync],
  );

  /**
   * Wait that prefers the Avalon extension service worker (`wait` action) so the
   * delay survives Athens-tab background throttling. Falls back to local timers
   * when the extension is disconnected. Stop aborts via abortAllPending / autoAbortRef.
   */
  const waitUnlessAborted = useCallback(
    async (
      ms: number,
      onSecond?: (secondsLeft: number) => void,
      tabId?: number,
    ): Promise<boolean> => {
      let remaining = ms;
      let lastSecond = -1;
      while (remaining > 0) {
        if (autoAbortRef.current || queueAbortRef.current) return false;
        const secondsLeft = Math.ceil(remaining / 1000);
        if (onSecond && secondsLeft !== lastSecond) {
          onSecond(secondsLeft);
          lastSecond = secondsLeft;
        }
        // 1s chunks: enough for countdown UI, few enough that a backgrounded
        // Athens tab is woken by each extension reply instead of N×250ms clamps.
        const chunk = Math.min(1000, remaining);
        if (canExecute) {
          const res = await emitActionAsync(
            {
              id: createActionId(),
              ...(typeof tabId === "number" ? { tabId } : {}),
              action: "wait",
              payload: { ms: chunk },
            },
            chunk + 15_000,
          ).catch(() => null);
          if (autoAbortRef.current || queueAbortRef.current) return false;
          if (!res?.success) {
            // Extension wait failed — finish this chunk locally so the pipeline
            // still advances (Chrome may throttle this if Athens is hidden).
            await new Promise((resolve) => setTimeout(resolve, chunk));
          }
        } else {
          await new Promise((resolve) => setTimeout(resolve, chunk));
        }
        remaining -= chunk;
      }
      return !(autoAbortRef.current || queueAbortRef.current);
    },
    [canExecute, emitActionAsync],
  );

  /** Pause after submit so the result page can load before step 8 reads it. */
  const waitBeforeVerify = useCallback(
    async (tabId?: number): Promise<void> => {
      await waitUnlessAborted(
        VERIFY_RESULT_WAIT_MS,
        (secondsLeft) =>
          setApplyPhase({
            phase: "verify-wait",
            message: `Waiting for result page (${secondsLeft}s)…`,
            secondsLeft,
            at: Date.now(),
          }),
        tabId,
      );
    },
    [waitUnlessAborted],
  );

  /** Mark a (non-manual) queued job Applied in the pipeline and badge it locally. */
  const markJobApplied = useCallback(
    async (job: QueuedJob) => {
      setAppliedJobIds((prev) => new Set(prev).add(job.id));
      if (job.source === "manual" || job.id.startsWith("manual:") || !applierName) return;
      try {
        await applyToJob(job.id, applierName);
      } catch (error) {
        pushLog(`Could not mark "${job.title}" applied: ${error instanceof Error ? error.message : error}`, false);
      }
    },
    [applierName, pushLog],
  );

  /**
   * Verify the post-submit outcome with the AI: wait for the page to settle after
   * the submit click, read its innerText, and let the model decide success vs a
   * verification-code step vs errors — far more reliable than phrase matching.
   * Falls back to the heuristic classifier only if the AI call fails.
   */
  const verifyAfterSubmit = useCallback(
    async (
      tabId: number,
      job: QueuedJob,
      submitted: boolean,
      settleMs = OTP_STEP_WAIT_MS,
    ): Promise<{ verdict: ApplyVerifyResult; state: ApplyPageState }> => {
      await emitActionAsync(
        { id: createActionId(), tabId, action: "wait", payload: { ms: settleMs } },
        settleMs + 5000,
      ).catch(() => {});
      const state = await readApplyPageState(tabId, submitted);
      try {
        const verdict = await verifyApplyOutcome(
          { pageText: state.text, jobTitle: job.title, controlCount: state.controlCount },
          runSignal(),
        );
        recordUsage("Verify result (AI)", verdict.usage);
        pushLog(`Verify (AI): ${verdict.status} — ${verdict.reason}`, verdict.status === "success");
        return { verdict, state };
      } catch (error) {
        const outcome = classifyApplyOutcome(state);
        pushLog(
          `Verify (AI failed, using heuristic): ${outcome.applied ? "success" : "unconfirmed"} — ${error instanceof Error ? error.message : error}`,
          outcome.applied,
        );
        return {
          verdict: { status: outcome.applied ? "success" : "incomplete", reason: outcome.reason },
          state,
        };
      }
    },
    [emitActionAsync, pushLog, readApplyPageState, recordUsage, runSignal],
  );

  /**
   * Greenhouse-only: poll Gmail (via Athens-server IMAP) for the emailed OTP,
   * fill the security-code inputs in the extension, and click submit. Each poll
   * waits OTP_STEP_WAIT_MS so the verification email has time to arrive.
   */
  const handleGreenhouseOtpFlow = useCallback(
    async (tabId: number, job: QueuedJob | null): Promise<{ filled: boolean; clicked: boolean }> => {
      if (!applierName) {
        pushLog("Greenhouse OTP: no applier profile — cannot read Gmail", false);
        return { filled: false, clicked: false };
      }

      const companyName = greenhouseOtpCompanyName(job);
      const jobTitle = job?.title?.trim() || "";

      for (let attempt = 1; attempt <= OTP_FETCH_MAX_ATTEMPTS; attempt += 1) {
        if (autoAbortRef.current) {
          pushLog("Greenhouse OTP: stopped", false);
          return { filled: false, clicked: false };
        }
        const slept = await waitUnlessAborted(
          OTP_STEP_WAIT_MS,
          (secondsLeft) =>
            setApplyPhase({
              phase: "verify-wait",
              message: `Waiting for verification email (${attempt}/${OTP_FETCH_MAX_ATTEMPTS}, ${secondsLeft}s)…`,
              secondsLeft,
              at: Date.now(),
            }),
          tabId,
        );
        if (!slept) {
          pushLog("Greenhouse OTP: stopped while waiting for the verification email", false);
          return { filled: false, clicked: false };
        }

        pushLog(`Greenhouse OTP: reading Gmail for "${applierName}" (attempt ${attempt}/${OTP_FETCH_MAX_ATTEMPTS})…`, true);
        const inbox = await withOtpMutex(applierName, () =>
          requestVerificationCode(
            applierName,
            { companyName: companyName || undefined, jobTitle: jobTitle || undefined },
            runSignal(),
          ),
        );

        // Surface EXACTLY what was read + how the AI decided, into the Activity feed.
        if (inbox.emails?.length) {
          pushLog(
            `Greenhouse OTP: scanned ${inbox.emails.length} newest email(s) → ` +
              inbox.emails
                .map((e) => `#${e.index} ${e.from ? `${e.from.replace(/^.*<|>.*$/g, "").trim()} ` : ""}"${e.subject || "(no subject)"}"`)
                .join("  |  "),
            false,
          );
        } else {
          pushLog(
            `Greenhouse OTP: inbox returned ${inbox.scanned ?? 0} email(s), none listed — the verification email may not have synced into the mailbox yet`,
            false,
          );
        }
        if (inbox.debug) {
          pushLog(
            `Greenhouse OTP: AI ${
              inbox.debug.aiFound ? `picked email #${inbox.debug.selectedIndex}` : "did not find a verification email"
            }${inbox.debug.note ? ` — ${inbox.debug.note}` : ""}`,
            Boolean(inbox.code),
          );
        }

        if (!inbox.code) {
          pushLog(`Greenhouse OTP: no code yet (attempt ${attempt}/${OTP_FETCH_MAX_ATTEMPTS}) — retrying`, false);
          continue;
        }

        pushLog(`Greenhouse OTP: got code "${inbox.code}" from "${inbox.subject ?? "verification email"}"`, true);

        if (autoAbortRef.current) {
          pushLog("Greenhouse OTP: stopped before filling the code", false);
          return { filled: false, clicked: false };
        }
        const fillRes = await emitActionAsync(
          {
            id: createActionId(),
            tabId,
            action: "fill_verification_code",
            payload: { code: inbox.code, platform: "greenhouse" },
          },
          30_000,
        );
        const fillData = fillRes.data as { filled?: number; clicked?: boolean; mode?: string } | undefined;
        if (!fillRes.success || !(fillData?.filled ?? 0)) {
          pushLog(`Greenhouse OTP: could not fill code — ${fillRes.error ?? "inputs not found"}`, false);
          return { filled: false, clicked: false };
        }

        pushLog(
          `Greenhouse OTP: filled ${fillData?.filled} char(s) (${fillData?.mode ?? "unknown"})${
            fillData?.clicked ? " and clicked submit" : ""
          } — sent "${inbox.code}"`,
          true,
        );

        await waitUnlessAborted(
          OTP_STEP_WAIT_MS,
          (secondsLeft) =>
            setApplyPhase({
              phase: "verify-wait",
              message: `Waiting for OTP submit (${secondsLeft}s)…`,
              secondsLeft,
              at: Date.now(),
            }),
          tabId,
        );
        return { filled: true, clicked: fillData?.clicked ?? false };
      }

      return { filled: false, clicked: false };
    },
    [applierName, emitActionAsync, pushLog, runSignal, waitUnlessAborted],
  );

  /**
   * Manual pipeline step 8 — classify post-submit outcome (success / failed / additional).
   * Shared by the manual Verify button and auto-run orchestration.
   */
  const computeVerifyResult = useCallback(
    async (tabId: number, job: QueuedJob | null): Promise<ManualVerifyResult> => {
      const jobForVerify: QueuedJob =
        job ?? { id: "", title: treePage?.title ?? "this application", company: "", url: treePage?.url ?? "", source: "" };
      const { verdict, state } = await verifyAfterSubmit(tabId, jobForVerify, true, OTP_STEP_WAIT_MS);

      if (verdict.status === "success") {
        if (job) await markJobApplied(job);
        return { kind: "success", reason: verdict.reason || "Application submitted." };
      }

      // Greenhouse OTP is detected from the DOM (the #email-verification fieldset /
      // security-input boxes reported by read_page_state), NOT from the AI verdict —
      // the model frequently mislabels the code page as "incomplete". Whenever those
      // boxes are present we run the emailed-code flow and NEVER re-scan (which would
      // wipe the already-filled form). The AI's needs_verification is kept as a
      // secondary signal for safety.
      const greenhouse = isGreenhouseJob(jobForVerify);
      // DOM signal (rebuilt extension) OR the emailed-code prompt in the page text
      // (works with the current extension) OR the AI's secondary guess.
      const otpPageDetected =
        (state.otpInputs ?? 0) > 0 ||
        VERIFICATION_CUE.test(state.text) ||
        verdict.status === "needs_verification";
      if (greenhouse && otpPageDetected) {
        pushLog(
          `Greenhouse: verification code page detected (${state.otpInputs ?? 0} code box(es)) — fetching from Gmail…`,
          true,
        );
        const otp = await handleGreenhouseOtpFlow(tabId, job);
        if (autoAbortRef.current) {
          return { kind: "failed", reason: "Stopped during Greenhouse OTP." };
        }
        if (otp.filled) {
          pushLog("Greenhouse OTP submitted — re-running step 8 · Verify result…", true);
          const { verdict: retryVerdict, state: retryState } = await verifyAfterSubmit(
            tabId,
            jobForVerify,
            true,
            OTP_STEP_WAIT_MS,
          );
          if (retryVerdict.status === "success") {
            if (job) await markJobApplied(job);
            return { kind: "success", reason: retryVerdict.reason || "Application submitted after OTP." };
          }
          // Still on the code page (wrong/expired code, or a fresh code was sent) →
          // "additional" so the retry loop re-polls Gmail without re-scanning.
          const stillOtp = (retryState.otpInputs ?? 0) > 0 || retryVerdict.status === "needs_verification";
          return {
            kind: stillOtp ? "additional" : "failed",
            reason: retryVerdict.reason || "OTP submitted but application not confirmed.",
            detail: stillOtp ? "OTP may be wrong or expired — will retry." : "Check the page or re-run verify.",
          };
        }
        // Code not available yet (email in flight) → "additional" so the retry loop
        // waits and polls again instead of re-scanning the form.
        return {
          kind: "additional",
          reason: verdict.reason || "Verification code required.",
          detail: "Waiting for the Greenhouse verification email — will retry.",
        };
      }

      if (verdict.status === "needs_verification") {
        // Non-Greenhouse: enter the code manually, then click Verify again.
        return {
          kind: "additional",
          reason: verdict.reason || "Verification required.",
          detail: "Enter the emailed verification code/link on the page, then click Verify again.",
        };
      }

      return {
        kind: "failed",
        reason: verdict.reason || "Could not confirm the application.",
        detail: "Re-run 5 · Scan DOM → 6 · Analyze → 7 · Apply, then 8 · Verify again.",
      };
    },
    [handleGreenhouseOtpFlow, markJobApplied, pushLog, treePage?.title, treePage?.url, verifyAfterSubmit],
  );

  /**
   * Re-run pipeline steps 5 · Scan → 6 · Analyze → 7 · Apply on the current tab,
   * in-place (same primitives the auto-run uses). Returns true only if all three
   * completed and the fill plan was applied/submitted. Used by the verify retry
   * loop to advance multi-step application forms.
   */
  const rescanAnalyzeApply = useCallback(
    async (tabId: number, job: QueuedJob | null): Promise<boolean> => {
      // Step 5 — Scan DOM (with dropdown probe, same as the manual button).
      const treeRes = await emitActionAsync(
        { id: createActionId(), tabId, action: "fetch_actionable_tree", payload: { probeComboboxes } },
        120000,
      );
      if (!treeRes.success) {
        pushLog(treeRes.error || "Scan failed", false);
        return false;
      }
      const scanData = treeRes.data as { tree?: ActionableTree; page?: ActionablePageContext };
      const tree = scanData.tree ?? null;
      if (!tree?.length) {
        pushLog("Scan returned no fillable fields", false);
        return false;
      }
      const pageCtx: ActionablePageContext = scanData.page ?? { tabId, url: job?.url ?? "" };
      setActionableTree(tree);
      setTreePage(pageCtx);
      setFormAnalysis(null);
      setInjectionPlan(null);
      setGeneratedScript("");
      setFieldScriptsById({});
      setSelectedTreeFieldId(null);
      if (job) markPipeline(job.id, { scanned: true, analyzed: false, applied: false, verified: false });
      pushLog(`Scanned ${tree.length} section(s)`, true);

      // Step 6 — Analyze form + build the fill plan.
      let plan: InjectionPlan;
      setAnalyzing(true);
      try {
        const result = await analyzeFormFields({ tree, applicantContext: applicantContext || undefined }, runSignal());
        setFormAnalysis(result);
        const usage = recordUsage("Analyze form", result.usage);
        if (usage.exceeded) return false;
        const built = buildFormInjectionPlan({ tree, fields: result.fields });
        plan = built.plan;
        if (!plan.steps.length) {
          pushLog("Analyze produced empty fill plan", false);
          return false;
        }
        setInjectionPlan(plan);
        setGeneratedScript(built.preview);
        setFieldScriptsById(Object.fromEntries(built.fieldPreviews.map((entry) => [entry.id, entry.preview])));
        if (job) markPipeline(job.id, { analyzed: true });
        pushLog(`Action plan: ${result.fields.length} field(s)`, true);
      } catch (error) {
        pushLog(error instanceof Error ? error.message : "Analysis failed", false);
        return false;
      } finally {
        setAnalyzing(false);
      }

      // Step 7 — Apply the fill plan (auto-submit).
      const resumeFile = job ? getResumeForJob(job) : null;
      if (!resumeFile?.base64) {
        pushLog("Tailored résumé required to re-apply — generate it first (step 4)", false);
        return false;
      }
      try {
        const submissionFile = job ? await resolveResumeForSubmission(job, resumeFile) : resumeFile;
        await runApplyWithPlan(plan, pageCtx, submissionFile);
        setApplyDone(true);
        if (job) markPipeline(job.id, { applied: true });
      } catch (error) {
        pushLog(error instanceof Error ? error.message : "Apply failed", false);
        return false;
      }
      return true;
    },
    [
      applicantContext,
      emitActionAsync,
      getResumeForJob,
      markPipeline,
      probeComboboxes,
      pushLog,
      recordUsage,
      resolveResumeForSubmission,
      runApplyWithPlan,
      runSignal,
    ],
  );

  /**
   * Manual pipeline step 6 — "Verify result". Reads the current page and classifies
   * the outcome into one of three results the user asked for: success / failed
   * (with reason) / additional process required (OTP, email verification code/link).
   *
   * On a non-success outcome we retry by cause (bounded to MAX_VERIFY_RETRIES):
   *  - "additional" (a security/verification code page) → re-run the OTP flow.
   *  - "failed" (e.g. a missing/next form) → re-run 5 · Scan → 6 · Analyze → 7 · Apply.
   */
  const verifyActiveResult = useCallback(async () => {
    const job = getActiveQueuedJob();
    const tabId = treePage?.tabId ?? (typeof selectedTabId === "number" ? selectedTabId : undefined);
    if (!tabId) {
      pushLog("No tab to verify — open the job and scan the form first", false);
      return;
    }
    if (!canExecute) {
      pushLog(executeDisabledReason ?? "Cannot verify — extension not connected", false);
      return;
    }
    setVerifying(true);
    setVerifyResult(null);
    try {
      await waitBeforeVerify(tabId);
      let result = await computeVerifyResult(tabId, job);
      setVerifyResult(result);
      pushLog(`Verify result: ${result.kind} — ${result.reason}`, result.kind === "success");

      // Recovery depends on WHY it wasn't success:
      //  - "additional" → a security/verification code page appeared. Re-run the OTP
      //    flow (computeVerifyResult re-detects the page, re-polls Gmail, fills, re-submits).
      //    NEVER re-scan here — that would wipe the code boxes.
      //  - "failed" → not a code page (e.g. a missing/next form). Re-run
      //    5 · Scan → 6 · Analyze → 7 · Apply.
      let attempt = 0;
      while (result.kind !== "success" && attempt < MAX_VERIFY_RETRIES) {
        attempt += 1;
        if (result.kind === "additional") {
          pushLog(
            `Verify not success (verification code page) — retry ${attempt}/${MAX_VERIFY_RETRIES}: re-fetch OTP → step 8 (no re-scan)`,
            false,
          );
          await waitBeforeVerify(tabId);
          result = await computeVerifyResult(tabId, job);
          setVerifyResult(result);
          pushLog(
            `Verify result (OTP retry ${attempt}/${MAX_VERIFY_RETRIES}): ${result.kind} — ${result.reason}`,
            result.kind === "success",
          );
          continue;
        }
        pushLog(
          `Verify not success (${result.kind}) — retry ${attempt}/${MAX_VERIFY_RETRIES}: re-running 5 · Scan → 6 · Analyze → 7 · Apply`,
          false,
        );
        const advanced = await rescanAnalyzeApply(tabId, job);
        if (!advanced) {
          pushLog(`Retry ${attempt}/${MAX_VERIFY_RETRIES} could not complete Scan/Analyze/Apply — stopping retries`, false);
          break;
        }
        await waitBeforeVerify(tabId);
        result = await computeVerifyResult(tabId, job);
        setVerifyResult(result);
        pushLog(
          `Verify result (retry ${attempt}/${MAX_VERIFY_RETRIES}): ${result.kind} — ${result.reason}`,
          result.kind === "success",
        );
      }

      if (result.kind === "success") {
        if (job) markPipeline(job.id, { verified: true });
        await closeTab(tabId); // application done → close the job tab
      } else if (attempt >= MAX_VERIFY_RETRIES) {
        pushLog(`Still not confirmed after ${MAX_VERIFY_RETRIES} retries — leaving for manual review`, false);
      }
    } catch (error) {
      const msg = error instanceof Error ? error.message : "Verify failed";
      setVerifyResult({ kind: "failed", reason: msg });
      pushLog(msg, false);
    } finally {
      setApplyPhase((prev) => (prev?.phase === "verify-wait" ? null : prev));
      setVerifying(false);
    }
  }, [
    canExecute,
    closeTab,
    computeVerifyResult,
    executeDisabledReason,
    getActiveQueuedJob,
    markPipeline,
    pushLog,
    rescanAnalyzeApply,
    selectedTabId,
    treePage,
    waitBeforeVerify,
  ]);

  /** Explicitly mark the active queued job Applied to MongoDB with the current profile. */
  const markActiveJobApplied = useCallback(async () => {
    const job = getActiveQueuedJob();
    if (!job) {
      pushLog("Select a queued job to mark applied", false);
      return;
    }
    if (isManualJob(job) || !applierName) {
      pushLog("Manual/link-only jobs can't be marked applied in the pipeline", false);
      return;
    }
    await markJobApplied(job);
    // Marking applied is an explicit "done" — interrupt any running pipeline first.
    autoAbortRef.current = true;
    autoPauseRef.current = false;
    await markJobApplied(job);
    pushLog(`Marked "${job.title}" as Applied for ${applierName}`, true);
    // Also tell the extension to close the job tab (the application is done).
    const tabId = treePage?.tabId ?? (typeof selectedTabId === "number" ? selectedTabId : undefined);
    if (tabId) {
      await closeTab(tabId);
      pushLog("Closed the job tab", true);
    }
  }, [applierName, closeTab, getActiveQueuedJob, markJobApplied, pushLog, selectedTabId, treePage]);

  /** Pause the running auto-run/queue between steps. */
  const pauseAutoRun = useCallback(() => {
    if (!autoRunningRef.current) return;
    autoPauseRef.current = true;
    setAutoRunState("paused");
    pushLog("Auto-run paused", true);
  }, [pushLog]);

  /** Resume a paused auto-run/queue. */
  const resumeAutoRun = useCallback(() => {
    if (!autoRunningRef.current) return;
    autoPauseRef.current = false;
    setAutoRunState("running");
    pushLog("Auto-run resumed", true);
  }, [pushLog]);

  /**
   * Stop the running auto-run/queue. Beyond flipping the interrupt flags this
   * immediately (a) rejects every in-flight extension round-trip and (b) aborts the
   * run's fetches (résumé stream + AI calls) so a long op can't hold the loop until
   * its 120s/180s timeout — the loop's `throwIfAborted`/catch then unwinds cleanly.
   */
  const stopAutoRun = useCallback(() => {
    autoAbortRef.current = true;
    autoPauseRef.current = false;
    queueAbortRef.current = true;
    runAbortRef.current?.abort();
    abortAllPending();
    pushLog("Stopping auto-run…", false);
  }, [abortAllPending, pushLog]);

  /**
   * Auto-run pipeline steps 2–8 in order (open → verify tab → résumé → scan →
   * analyze → apply → verify). One job at a time — parallel Chrome tabs interrupt
   * each other; speed comes from resume prefetch + extension-side waits.
   */
  const runPipelineAuto = useCallback(async (jobOverride?: QueuedJob) => {
    if (autoRunningRef.current || applyingRef.current) return;
    const job = jobOverride ?? getActiveQueuedJob();
    if (!job) {
      pushLog("Select a queued job first", false);
      return;
    }
    if (!canExecute) {
      pushLog(executeDisabledReason ?? "Cannot auto-run — extension not connected", false);
      return;
    }
    if (isManualJob(job)) {
      pushLog(`"${job.title}" is manual — auto-run needs a MongoDB job with tailored résumé`, false);
      return;
    }

    autoRunningRef.current = true;
    autoAbortRef.current = false;
    autoPauseRef.current = false;
    runAbortRef.current = new AbortController();
    setAutoRunning(true);
    setAutoRunState("running");
    startRunLog(job, { url: job.url, company: job.company, source: job.source, mode: "auto-run", sessionId: sessionIdRef.current });
    resetJobRunCost();

    const startStep = 2;
    let cycle = 0;
    let tabId: number | undefined;
    let pageCtx: ActionablePageContext | null = null;
    let tree: ActionableTree | null = null;
    let plan: InjectionPlan | null = null;
    let resumeFile: AttachedFile | null = null;
    let finalStatus = "stopped";

    const abort = (message: string, status = "failed") => {
      pushLog(message, false);
      finalStatus = status;
    };

    const budgetAbort = async (): Promise<boolean> => {
      if (!checkBudgetExceeded()) return false;
      await abortForBudget(job, tabId);
      finalStatus = "budget-exceeded";
      return true;
    };

    // Between-step interrupt gate: blocks while paused, returns false if stopped.
    // Pause polling uses extension `wait` when connected so a backgrounded Athens
    // tab does not freeze the pause loop under Chrome timer throttling.
    const gate = async (): Promise<boolean> => {
      while (autoPauseRef.current && !autoAbortRef.current && !queueAbortRef.current) {
        await waitUnlessAborted(300, undefined, tabId);
      }
      if (autoAbortRef.current || queueAbortRef.current) {
        pushLog("Auto-run stopped", false);
        return false;
      }
      if (checkBudgetExceeded()) {
        await abortForBudget(job, tabId);
        finalStatus = "budget-exceeded";
        return false;
      }
      return true;
    };

    try {
      while (cycle < PIPELINE_AUTO_MAX_CYCLES) {
        cycle += 1;
        if (!(await gate())) return;
        pushLog(
          "Auto-run: steps 2–8 (open → verify tab → résumé → scan → analyze → apply → verify)…",
          true,
        );

        if (!(await gate())) return;
        if (startStep <= 2) {
          setTabValidity(null);
          setVerifyResult(null);
          setApplyDone(false);
          resetJobUsage();
          tree = null;
          plan = null;
          resumeFile = null;
          const opened = await emitActionAsync({
            id: createActionId(),
            action: "open_tab",
            payload: { url: job.url, active: true },
          });
          if (!opened.success) {
            abort(opened.error || "Failed to open tab");
            return;
          }
          const openedData = opened.data as { tabId?: number; page?: ActionablePageContext };
          tabId = openedData.tabId;
          if (!tabId) {
            abort("Open tab returned no tab id");
            return;
          }
          pageCtx = openedData.page ?? null;
          setSelectedTabId(tabId);
          setTreePage(pageCtx);
          setActionableTree(null);
          setFormAnalysis(null);
          setInjectionPlan(null);
          setGeneratedScript("");
          setFieldScriptsById({});
          setSelectedTreeFieldId(null);
          markPipeline(job.id, {
            opened: true,
            validated: false,
            scanned: false,
            analyzed: false,
            applied: false,
            verified: false,
          });
          pushLog(`Opened "${job.title}"`, true);
        }

        if (!(await gate())) return;
        if (startStep <= 3) {
          if (!tabId) {
            abort("No tab for validation");
            return;
          }
          setValidatingTab(true);
          setTabValidity(null);
          try {
            const { validity } = await validateOpenedTab(tabId, job);
            setTabValidity(validity);
            if (!validity.valid) {
              pushLog(`Not a usable form (${validity.kind}) — ${validity.reason}; closing tab`, false);
              await closeTab(tabId);
              setAppliedJobIds((prev) => new Set(prev).add(job.id));
              if (applierName) {
                try {
                  await applyToJob(job.id, applierName);
                } catch {
                  /* non-fatal */
                }
              }
              finalStatus = `skipped-${validity.kind}`;
              return;
            }
            markPipeline(job.id, { validated: true });
            pushLog(`Valid application form — ${validity.reason}`, true);
          } finally {
            setValidatingTab(false);
          }
          if (await budgetAbort()) return;
        }

        if (!(await gate())) return;
        if (startStep <= 4) {
          try {
            resumeFile = await startResumeForJob(job);
            if (!resumeFile?.base64) {
              abort("Résumé generation failed — missing PDF");
              return;
            }
          } catch {
            return;
          }
          if (await budgetAbort()) return;
        }

        if (!(await gate())) return;
        if (startStep <= 5) {
          if (!tabId) {
            abort("No tab for scan");
            return;
          }
          tree = null;
          plan = null;
          const treeRes = await emitActionAsync(
            {
              id: createActionId(),
              tabId,
              action: "fetch_actionable_tree",
              payload: { probeComboboxes },
            },
            120000,
          );
          if (!treeRes.success) {
            abort(treeRes.error || "Scan failed");
            return;
          }
          const scanData = treeRes.data as { tree?: ActionableTree; page?: ActionablePageContext };
          tree = scanData.tree ?? null;
          if (!tree?.length) {
            abort("Scan returned no fillable fields");
            return;
          }
          pageCtx = scanData.page ?? pageCtx;
          setActionableTree(tree);
          setTreePage(pageCtx);
          setFormAnalysis(null);
          setInjectionPlan(null);
          setGeneratedScript("");
          setFieldScriptsById({});
          setSelectedTreeFieldId(null);
          markPipeline(job.id, { scanned: true, analyzed: false, applied: false, verified: false });
          pushLog(`Scanned ${tree.length} section(s)`, true);
        }

        if (!(await gate())) return;
        if (startStep <= 6) {
          if (!tree?.length) {
            abort("Missing form tree — scan first");
            return;
          }
          plan = null;
          setAnalyzing(true);
          try {
            const result = await analyzeFormFields(
              { tree, applicantContext: applicantContext || undefined },
              runSignal(),
            );
            setFormAnalysis(result);
            const usage = recordUsage("Analyze form", result.usage);
            if (usage.exceeded) {
              await abortForBudget(job, tabId);
              finalStatus = "budget-exceeded";
              return;
            }
            const built = buildFormInjectionPlan({ tree, fields: result.fields });
            plan = built.plan;
            if (!plan.steps.length) {
              abort("Analyze produced empty fill plan");
              return;
            }
            setInjectionPlan(plan);
            setGeneratedScript(built.preview);
            setFieldScriptsById(Object.fromEntries(built.fieldPreviews.map((entry) => [entry.id, entry.preview])));
            markPipeline(job.id, { analyzed: true });
            pushLog(`Action plan: ${result.fields.length} field(s)`, true);
          } catch (error) {
            abort(error instanceof Error ? error.message : "Analysis failed");
            return;
          } finally {
            setAnalyzing(false);
          }
        }

        if (!(await gate())) return;
        if (startStep <= 7) {
          if (!pageCtx?.tabId) {
            abort("No page context for apply");
            return;
          }
          if (!plan?.steps.length) {
            abort("No fill plan to apply");
            return;
          }
          if (!resumeFile?.base64) {
            resumeFile = getResumeForJob(job);
          }
          if (!resumeFile?.base64) {
            abort("Generate tailored résumé first");
            return;
          }
          try {
            const submissionFile = await resolveResumeForSubmission(job, resumeFile);
            await runApplyWithPlan(plan, pageCtx, submissionFile);
            setApplyDone(true);
            markPipeline(job.id, { applied: true });
          } catch (error) {
            abort(error instanceof Error ? error.message : "Apply failed");
            return;
          }
        }

        // Step 8 · Verify result. On any non-success outcome the page is usually
        // the next screen of a multi-step form, so loop back to 5 · Scan →
        // 6 · Analyze → 7 · Apply → 8 · Verify, up to MAX_VERIFY_RETRIES times.
        if (!(await gate())) return;
        if (!tabId) {
          abort("No tab to verify");
          return;
        }
        setVerifying(true);
        setVerifyResult(null);
        try {
          await waitBeforeVerify(tabId);
          throwIfAborted();
          let verify = await computeVerifyResult(tabId, job);
          if (await budgetAbort()) return;
          setVerifyResult(verify);
          pushLog(`Verify result: ${verify.kind} — ${verify.reason}`, verify.kind === "success");

          let attempt = 0;
          while (verify.kind !== "success" && attempt < MAX_VERIFY_RETRIES) {
            if (!(await gate())) return;
            attempt += 1;
            // "additional" = a security/verification code page appeared → re-run the
            // OTP flow (re-detect page, re-poll Gmail, fill, re-submit). NEVER re-scan
            // here — that would wipe the emailed-code boxes.
            if (verify.kind === "additional") {
              pushLog(
                `Verify not success (verification code page) — retry ${attempt}/${MAX_VERIFY_RETRIES}: re-fetch OTP → step 8 (no re-scan)`,
                false,
              );
              await waitBeforeVerify(tabId);
              verify = await computeVerifyResult(tabId, job);
              if (await budgetAbort()) return;
              setVerifyResult(verify);
              pushLog(
                `Verify result (OTP retry ${attempt}/${MAX_VERIFY_RETRIES}): ${verify.kind} — ${verify.reason}`,
                verify.kind === "success",
              );
              continue;
            }
            // "failed" = not a code page (e.g. a missing/next form) → re-run 5→6→7.
            pushLog(
              `Verify not success (${verify.kind}) — retry ${attempt}/${MAX_VERIFY_RETRIES}: re-running 5 · Scan → 6 · Analyze → 7 · Apply`,
              false,
            );
            const advanced = await rescanAnalyzeApply(tabId, job);
            if (checkBudgetExceeded()) {
              await abortForBudget(job, tabId);
              finalStatus = "budget-exceeded";
              return;
            }
            if (!advanced) {
              pushLog(
                `Retry ${attempt}/${MAX_VERIFY_RETRIES} could not complete Scan/Analyze/Apply — stopping retries`,
                false,
              );
              break;
            }
            if (!(await gate())) return;
            await waitBeforeVerify(tabId);
            verify = await computeVerifyResult(tabId, job);
            if (await budgetAbort()) return;
            setVerifyResult(verify);
            pushLog(
              `Verify result (retry ${attempt}/${MAX_VERIFY_RETRIES}): ${verify.kind} — ${verify.reason}`,
              verify.kind === "success",
            );
          }

          if (verify.kind === "success") {
            markPipeline(job.id, { verified: true });
            await closeTab(tabId); // application done → close the job tab
            pushLog(`Auto-run complete — "${job.title}" submitted and verified.`, true);
            finalStatus = "applied";
          } else {
            pushLog(
              `Auto-run finished — "${job.title}" not confirmed after ${MAX_VERIFY_RETRIES} retries; left for manual review.`,
              false,
            );
            finalStatus = "unconfirmed";
          }
        } catch (error) {
          if (isAbortError(error)) {
            pushLog("Verify stopped", false);
            finalStatus = "stopped";
          } else {
            const msg = error instanceof Error ? error.message : "Verify failed";
            setVerifyResult({ kind: "failed", reason: msg });
            pushLog(msg, false);
            finalStatus = "error";
          }
        } finally {
          setApplyPhase((prev) => (prev?.phase === "verify-wait" ? null : prev));
          setVerifying(false);
        }
        return;
      }
    } catch (error) {
      if (isAbortError(error)) {
        pushLog("Auto-run stopped", false);
        finalStatus = "stopped";
      } else {
        pushLog(error instanceof Error ? error.message : "Auto-run failed", false);
        finalStatus = "error";
      }
    } finally {
      autoRunningRef.current = false;
      autoAbortRef.current = false;
      autoPauseRef.current = false;
      runAbortRef.current = null;
      setAutoRunning(false);
      setAutoRunState("idle");
      setApplyPhase((prev) => (prev?.phase === "verify-wait" ? null : prev));
      endRunLog(finalStatus);
    }
  }, [
    abortForBudget,
    applicantContext,
    applierName,
    canExecute,
    checkBudgetExceeded,
    closeTab,
    computeVerifyResult,
    emitActionAsync,
    endRunLog,
    executeDisabledReason,
    getActiveQueuedJob,
    getResumeForJob,
    isAbortError,
    markPipeline,
    probeComboboxes,
    pushLog,
    recordUsage,
    resetJobRunCost,
    resetJobUsage,
    resolveResumeForSubmission,
    rescanAnalyzeApply,
    runApplyWithPlan,
    runSignal,
    startResumeForJob,
    startRunLog,
    throwIfAborted,
    validateOpenedTab,
    waitBeforeVerify,
    waitUnlessAborted,
  ]);

  /**
   * Re-scan the page's actionable tree for the recovery loop. Dropdown/combobox
   * option probing is intentionally OFF here — recovery only needs the field
   * structure + labels, and probing adds latency the retry loop can't afford.
   */
  const rescanTree = useCallback(
    async (tabId: number): Promise<ActionableTree | null> => {
      try {
        const res = await emitActionAsync(
          {
            id: createActionId(),
            tabId,
            action: "fetch_actionable_tree",
            payload: { probeComboboxes: false },
          },
          60000,
        );
        const data = res.data as { tree?: ActionableTree } | undefined;
        return data?.tree ?? null;
      } catch {
        return null;
      }
    },
    [emitActionAsync],
  );

  /**
   * Phase C — self-healing retry. When an apply doesn't confirm, hand the AI the
   * live DOM + previous plan + failures; it authors an `execute_script` recovery
   * snippet (which also clicks Submit). Re-read + re-classify each round, up to 10×.
   * Returns true if the application was confirmed and marked Applied.
   */
  const runRecoveryLoop = useCallback(
    async (params: {
      tabId: number;
      job: QueuedJob;
      planSteps: InjectionPlan["steps"];
      firstState: ApplyPageState;
      firstReason: string;
      firstResults?: StepRunResult[];
      resumeFile?: AttachedFile;
      pageCtx?: ActionablePageContext;
    }): Promise<boolean> => {
      const { tabId, job, planSteps, resumeFile, pageCtx } = params;
      let state = params.firstState;
      let reason = params.firstReason;
      let lastResults: StepRunResult[] = params.firstResults ?? [];

      // The AI recovery script runs in the isolated world and CANNOT set
      // input.files. So on the first recovery pass, re-run the résumé attach via
      // the executor's MAIN-world path — this fixes a genuine upload miss (which
      // recovery could otherwise never repair).
      const fileSteps = planSteps.filter((s) => s.op === "attachFile");
      if (fileSteps.length > 0 && resumeFile) {
        try {
          pushLog(`Recovery: re-attaching résumé via MAIN world…`, true);
          await emitActionAsync(
            {
              id: createActionId(),
              tabId,
              action: "apply_injection_plan",
              payload: buildApplyInjectionPlanPayload({ steps: fileSteps }, pageCtx ?? { tabId, url: job.url }, {
                autoSubmit: false,
                resumeFile,
              }) as unknown as Record<string, unknown>,
            },
            60000,
          );
        } catch (error) {
          pushLog(`Recovery: résumé re-attach failed — ${error instanceof Error ? error.message : error}`, false);
        }
      }

      // Greenhouse OTP: do not re-scan from step 5 — fetch the emailed code and re-verify.
      const looksLikeOtpPage =
        (state.otpInputs ?? 0) > 0 ||
        VERIFICATION_CUE.test(state.text) ||
        /security-input-|email-verification/i.test(state.text) ||
        /needs_verification|verification/i.test(reason);
      if (isGreenhouseJob(job) && looksLikeOtpPage) {
        pushLog("Recovery: Greenhouse OTP page — fetching code from Gmail (no re-scan)", true);
        const otp = await handleGreenhouseOtpFlow(tabId, job);
        if (otp.filled) {
          const { verdict } = await verifyAfterSubmit(tabId, job, true, OTP_STEP_WAIT_MS);
          if (verdict.status === "success") {
            await markJobApplied(job);
            pushLog(`"${job.title}" applied after Greenhouse OTP — ${verdict.reason}`, true);
            return true;
          }
          pushLog(`Greenhouse OTP submitted but not confirmed — ${verdict.reason}`, false);
        }
        return false;
      }

      for (let attempt = 1; attempt <= MAX_RECOVERY_ATTEMPTS; attempt += 1) {
        setApplyPhase({
          phase: "fields",
          message: `Self-healing attempt ${attempt}/${MAX_RECOVERY_ATTEMPTS} — ${reason}`,
          at: Date.now(),
        });

        const tree = await rescanTree(tabId);
        if (!tree) {
          pushLog(`Recovery ${attempt}: could not re-scan the page`, false);
          break;
        }

        // Phase D — automated inbox reading (Gmail IMAP) has been removed. If the
        // page is asking for an emailed code, flag it so the user can enter it
        // manually; recovery still proceeds without an auto-fetched code.
        const otpCode: string | null = null;
        const treeHasVerificationInputs = tree.some((g) =>
          g.children.some(
            (c) =>
              /\b(security code|verification code|enter the code|one[- ]?time code|otp|passcode)\b/i.test(
                c.target,
              ) ||
              (c.controlType === 'text' &&
                c.target.includes('code') &&
                g.children.filter((cc) => cc.controlType === 'text').length >= 4),
          ),
        );
        if (VERIFICATION_CUE.test(state.text) || treeHasVerificationInputs) {
          pushLog(
            `Recovery ${attempt}: verification code required — enter it manually on the page (auto email read disabled)`,
            false,
          );
        }

        let recovery;
        try {
          recovery = await generateRecoveryScript({
            jobTitle: job.title,
            pageUrl: job.url,
            pageText: state.text,
            outcomeReason: reason,
            previousPlan: planSteps.map((s) => ({ id: s.id, label: s.label, op: s.op, value: s.value })),
            stepResults: lastResults,
            tree,
            attempt,
            maxAttempts: MAX_RECOVERY_ATTEMPTS,
            applicantContext: applicantContext || undefined,
            otpCode,
          }, runSignal());
          recordUsage(`Recovery ${attempt} (AI)`, recovery.usage);
          if (checkBudgetExceeded()) return false;
        } catch (error) {
          pushLog(`Recovery ${attempt}: AI failed — ${error instanceof Error ? error.message : error}`, false);
          continue;
        }

        if (recovery.reasoning) pushLog(`Recovery ${attempt}: ${recovery.reasoning}`, true);

        let scriptError: string | null = null;
        try {
          const scriptRes = await emitActionAsync(
            {
              id: createActionId(),
              tabId,
              action: "execute_script",
              payload: { source: recovery.script },
            },
            60000,
          );
          if (!scriptRes.success) {
            scriptError = scriptRes.error ?? "unknown";
            pushLog(`Recovery ${attempt}: script error — ${scriptRes.error}`, false);
          }
        } catch (error) {
          scriptError = error instanceof Error ? error.message : String(error);
          pushLog(`Recovery ${attempt}: script threw — ${scriptError}`, false);
        }
        logRunData("recovery", {
          attempt,
          reason,
          otpCode: otpCode ? "(fetched)" : null,
          reasoning: recovery.reasoning,
          script: recovery.script,
          scriptError,
          pageTextBefore: state.text,
        });

        // Re-verify with the AI (settles the page, reads innerText, classifies).
        lastResults = [];
        const { verdict, state: newState } = await verifyAfterSubmit(tabId, job, true, 3000);
        if (checkBudgetExceeded()) return false;
        state = newState;
        logRunData("recovery-verify", { attempt, status: verdict.status, reason: verdict.reason, pageText: newState.text });
        if (verdict.status === "success") {
          pushLog(`"${job.title}" recovered on attempt ${attempt} — ${verdict.reason}`, true);
          await markJobApplied(job);
          return true;
        }
        reason = verdict.reason || verdict.status;
      }

      pushLog(`"${job.title}" still unconfirmed after ${MAX_RECOVERY_ATTEMPTS} recovery attempts`, false);
      return false;
    },
    [applicantContext, applierName, checkBudgetExceeded, emitActionAsync, handleGreenhouseOtpFlow, markJobApplied, pushLog, recordUsage, rescanTree, runSignal, verifyAfterSubmit, logRunData],
  );

  /**
   * Drive one job end-to-end: draft résumé → open tab → scan → analyze → fill → submit.
   */
  const applyJob = useCallback(
    async (job: QueuedJob) => {
      if (!canExecute) {
        pushLog(executeDisabledReason ?? "Cannot apply — extension not connected", false);
        return;
      }
      setApplying(true);
      applyingRef.current = true;
      setApplyDone(false);
      resetJobUsage();
      resetJobRunCost();
      startRunLog(job, { url: job.url, company: job.company, source: job.source, sessionId: sessionIdRef.current });
      let finalStatus = "failed";
      let tabId: number | undefined;
      try {
        pushLog(`Applying to "${job.title}"…`, true);
        let resumeFile = getResumeForJob(job);
        const preGenerated = Boolean(resumeFile);
        if (!resumeFile) {
          resumeFile = await startResumeForJob(job);
        }
        if (checkBudgetExceeded()) {
          await abortForBudget(job);
          finalStatus = "budget-exceeded";
          return;
        }
        if (!resumeFile) throw new Error("Tailored résumé PDF is required but was not generated");
        logRunData("resume", {
          fileName: resumeFile.name,
          mimeType: resumeFile.mimeType,
          base64Bytes: resumeFile.base64?.length ?? 0,
          preGenerated,
          reused: resumesByJobId[job.id]?.reused ?? null,
        });

        const opened = await emitActionAsync({
          id: createActionId(),
          action: "open_tab",
          payload: { url: job.url },
        });
        if (!opened.success) throw new Error(opened.error || "Failed to open tab");
        const openedData = opened.data as { tabId?: number; page?: ActionablePageContext };
        tabId = openedData.tabId;
        if (!tabId) throw new Error("open_tab returned no tab id");
        setSelectedTabId(tabId);

        // Validity gate — skip dead/expired/non-form links (close tab + mark handled).
        const gate = await validateOpenedTab(tabId, job);
        if (checkBudgetExceeded()) {
          await abortForBudget(job, tabId);
          finalStatus = "budget-exceeded";
          return;
        }
        logRunData("validity", { kind: gate.validity.kind, valid: gate.validity.valid, reason: gate.validity.reason });
        if (!gate.validity.valid) {
          pushLog(`"${job.title}" skipped — ${gate.validity.kind}: ${gate.validity.reason}`, false);
          setVerifyResult({ kind: "failed", reason: `Link not usable (${gate.validity.kind})`, detail: gate.validity.reason });
          await closeTab(tabId);
          await markJobApplied(job);
          finalStatus = `skipped-${gate.validity.kind}`;
          return;
        }

        const treeRes = await emitActionAsync({
          id: createActionId(),
          tabId,
          action: "fetch_actionable_tree",
          payload: { probeComboboxes },
        });
        if (!treeRes.success) throw new Error(treeRes.error || "Form scan failed");
        const treeData = treeRes.data as { tree?: ActionableTree; page?: ActionablePageContext };
        const tree = treeData.tree;
        const pageCtx = treeData.page ?? openedData.page;
        if (!tree?.length || !pageCtx) throw new Error("No fillable fields found on the page");
        logRunData("scan", {
          url: pageCtx.url,
          groups: tree.length,
          fields: tree.flatMap((g) =>
            g.children.map((c) => ({ group: g.content?.slice(0, 40), target: c.target, controlType: c.controlType })),
          ),
        });

        setAnalyzing(true);
        const analysis = await analyzeFormFields({ tree, applicantContext: applicantContext || undefined }, runSignal());
        setAnalyzing(false);
        recordUsage("Analyze form", analysis.usage);
        if (checkBudgetExceeded()) {
          await abortForBudget(job, tabId);
          finalStatus = "budget-exceeded";
          return;
        }
        setActionableTree(tree);
        setTreePage(pageCtx);
        setFormAnalysis(analysis);
        logRunData("analyze", {
          fields: analysis.fields.map((f) => ({ id: f.id, action: f.action, shouldSkip: f.shouldSkip, value: f.value })),
          usage: analysis.usage ?? null,
        });

        const built = buildFormInjectionPlan({ tree, fields: analysis.fields });
        setInjectionPlan(built.plan);
        setGeneratedScript(built.preview);
        if (!built.plan.steps.length) throw new Error("Plan has no fillable steps");
        logRunData("plan", {
          steps: built.plan.steps.map((s) => ({ id: s.id, label: s.label, op: s.op, value: s.value })),
          fileSteps: built.plan.steps.filter((s) => s.op === "attachFile").length,
        });

        const submissionFile = await resolveResumeForSubmission(job, resumeFile);
        logRunData("submission-file", {
          fileName: submissionFile.name,
          mimeType: submissionFile.mimeType,
          base64Bytes: submissionFile.base64?.length ?? 0,
          generatedFileName: resumeFile.name,
          submissionKit: !accountIsBeta,
        });
        const payload = buildApplyInjectionPlanPayload(built.plan, pageCtx, {
          autoSubmit: true,
          resumeFile: submissionFile,
        });
        const applyRes = await emitActionAsync(
          {
            id: createActionId(),
            tabId,
            action: "apply_injection_plan",
            payload: payload as unknown as Record<string, unknown>,
          },
          180000,
        );
        if (!applyRes.success) throw new Error(applyRes.error || "Apply failed");
        const applyData = applyRes.data as
          | { submitted?: boolean; result?: StepRunResult[]; filesFound?: number; filesAttached?: number }
          | undefined;
        setApplyDone(true);
        const submitted = Boolean(applyData?.submitted);
        const firstResults = Array.isArray(applyData?.result) ? applyData!.result : [];

        // Résumé-upload status — informational only. A 0/N reading is often a
        // false negative (a dropzone briefly resets the input), so we NEVER abort
        // on it; the AI verify below reads the real page and decides the outcome.
        const filesFound = applyData?.filesFound ?? 0;
        const filesAttached = applyData?.filesAttached ?? 0;
        logRunData("apply-result", { filesFound, filesAttached, submitted, results: firstResults });
        if (filesFound === 0) {
          pushLog(`Résumé: no file field detected on "${job.title}"`, false);
        } else {
          pushLog(`Résumé attach reported ${filesAttached}/${filesFound} — verifying on page…`, filesAttached > 0);
        }

        // AI verify: wait for the page to settle, read innerText, classify.
        const { verdict, state: pageState } = await verifyAfterSubmit(tabId, job, submitted, OTP_STEP_WAIT_MS);
        if (checkBudgetExceeded()) {
          await abortForBudget(job, tabId);
          finalStatus = "budget-exceeded";
          return;
        }
        logRunData("verify", { status: verdict.status, reason: verdict.reason, pageText: pageState.text, controlCount: pageState.controlCount });
        if (verdict.status === "success") {
          pushLog(`"${job.title}" applied — ${verdict.reason}`, true);
          await markJobApplied(job);
          finalStatus = "applied";
        } else if (
          isGreenhouseJob(job) &&
          ((pageState.otpInputs ?? 0) > 0 ||
            VERIFICATION_CUE.test(pageState.text) ||
            verdict.status === "needs_verification")
        ) {
          pushLog(
            `"${job.title}" needs Greenhouse OTP (${pageState.otpInputs ?? 0} code box(es)) — fetching from Gmail…`,
            true,
          );
          const otp = await handleGreenhouseOtpFlow(tabId, job);
          if (otp.filled) {
            const { verdict: retryVerdict } = await verifyAfterSubmit(tabId, job, submitted, OTP_STEP_WAIT_MS);
            logRunData("verify-after-otp", { status: retryVerdict.status, reason: retryVerdict.reason });
            if (retryVerdict.status === "success") {
              pushLog(`"${job.title}" applied after OTP — ${retryVerdict.reason}`, true);
              await markJobApplied(job);
              finalStatus = "applied";
            } else {
              pushLog(
                `"${job.title}" OTP submitted but not confirmed (${retryVerdict.status}) — ${retryVerdict.reason}`,
                false,
              );
              finalStatus = "unconfirmed";
            }
          } else {
            pushLog(`"${job.title}" Greenhouse OTP not found in Gmail`, false);
            finalStatus = "unconfirmed";
          }
        } else {
          // needs_verification / error / incomplete → self-healing loop (OTP,
          // missing fields, blocks). Re-scan uses probe-off; up to 10×.
          pushLog(`"${job.title}" not confirmed (${verdict.status}) — ${verdict.reason}; starting self-healing`, false);
          const recovered = await runRecoveryLoop({
            tabId,
            job,
            planSteps: built.plan.steps,
            firstState: pageState,
            firstReason: verdict.reason || verdict.status,
            firstResults,
            resumeFile: submissionFile,
            pageCtx,
          });
          if (checkBudgetExceeded()) {
            await abortForBudget(job, tabId);
            finalStatus = "budget-exceeded";
            return;
          }
          finalStatus = recovered ? "applied-recovered" : "unconfirmed";
        }
      } catch (error) {
        const msg = error instanceof Error ? error.message : "Apply failed";
        pushLog(msg, false);
        logRunData("error", { message: msg, stack: error instanceof Error ? error.stack : null });
        finalStatus = "error";
      } finally {
        setAnalyzing(false);
        setApplying(false);
        applyingRef.current = false;
        endRunLog(finalStatus);
      }
    },
    [abortForBudget, applicantContext, canExecute, checkBudgetExceeded, emitActionAsync, getResumeForJob, startResumeForJob, executeDisabledReason, handleGreenhouseOtpFlow, markJobApplied, probeComboboxes, pushLog, recordUsage, resetJobRunCost, resetJobUsage, resolveResumeForSubmission, runRecoveryLoop, runSignal, verifyAfterSubmit, startRunLog, logRunData, endRunLog, resumesByJobId, validateOpenedTab, closeTab],
  );

  /**
   * "Apply all" — one job at a time (parallel tabs interrupt each other).
   * Prefetches résumés for the next few queued jobs while the current apply runs
   * so step 4 is often already warm.
   */
  const applyQueue = useCallback(async () => {
    if (!jobQueue.length) {
      pushLog("Queue is empty — add jobs first", false);
      return;
    }
    if (!canExecute) {
      pushLog(executeDisabledReason ?? "Cannot apply — extension not connected", false);
      return;
    }
    if (autoRunningRef.current || applyingRef.current) {
      pushLog("Apply all already running — stop first or wait", false);
      return;
    }

    queueAbortRef.current = false;
    pushLog("Apply all · one job at a time (prefetching upcoming résumés)", true);

    const prefetchAhead = (fromIndex: number) => {
      const ahead = jobQueue
        .slice(fromIndex + 1, fromIndex + 4)
        .filter((j) => !appliedJobIds.has(j.id) && !budgetSkippedJobIds.has(j.id) && !isManualJob(j));
      for (const next of ahead) {
        if (resumesByJobIdRef.current[next.id]?.file?.base64) continue;
        void startResumeForJob(next).catch(() => {
          /* non-fatal — pipeline will generate when that job starts */
        });
      }
    };

    for (let i = 0; i < jobQueue.length; i += 1) {
      if (queueAbortRef.current || autoAbortRef.current) {
        pushLog("Apply all stopped", false);
        break;
      }
      const job = jobQueue[i];
      if (appliedJobIds.has(job.id) || budgetSkippedJobIds.has(job.id)) continue;
      if (isManualJob(job)) continue;
      setActiveJobIndex(i);
      prefetchAhead(i);
      await runPipelineAuto(job);
    }
    if (!queueAbortRef.current && !autoAbortRef.current) {
      pushLog(`Queue complete · ${jobQueue.length} job(s) processed`, true);
    }
  }, [
    appliedJobIds,
    budgetSkippedJobIds,
    canExecute,
    executeDisabledReason,
    jobQueue,
    pushLog,
    runPipelineAuto,
    startResumeForJob,
  ]);

  const selectActiveJob = useCallback(
    (index: number) => {
      const job = jobQueue[index];
      resetJobWorkspace();
      setActiveJobIndex(index);
      if (job) {
        setResumeJobId(job.id);
        if (resumesByJobId[job.id]?.file?.base64) {
          markPipeline(job.id, { resumeReady: true });
        }
      }
    },
    [jobQueue, markPipeline, resetJobWorkspace, resumesByJobId],
  );

  const activePipeline = useMemo((): JobPipelineState => {
    const job = jobQueue[activeJobIndex];
    if (!job) return EMPTY_PIPELINE;
    const stored = pipelineByJobId[job.id] ?? EMPTY_PIPELINE;
    return {
      ...stored,
      resumeReady: stored.resumeReady || Boolean(resumesByJobId[job.id]?.file?.base64),
    };
  }, [activeJobIndex, jobQueue, pipelineByJobId, resumesByJobId]);

  const isGeneratingActiveResume =
    generatingResume && generatingResumeJobId === jobQueue[activeJobIndex]?.id;

  return {
    serverUrl,
    setServerUrl,
    sessionId,
    setSessionId,
    connected,
    registered,
    peers,
    tabs,
    selectedTabId,
    setSelectedTabId,
    logs,
    screenshot,
    actionableTree,
    treePage,
    formAnalysis,
    displayedScript,
    fieldScriptsById,
    injectionPlan,
    selectedTreeFieldId,
    setSelectedTreeFieldId,
    analyzing,
    applying,
    autoRunning,
    canExecute,
    executeDisabledReason,
    actionPlanByFieldId,
    jobQueue,
    activeJobIndex,
    selectActiveJob,
    activePipeline,
    appliedJobIds,
    resumesByJobId,
    activeResume: resumeJobId ? resumesByJobId[resumeJobId] ?? null : null,
    generatingResume: isGeneratingActiveResume,
    resumeGenerateStep,
    resumeGeneratedSections,
    resumeError,
    kitSubmitJobId,
    applyPhase,
    verifyResult,
    verifying,
    verifyActiveResult,
    setVerifyResult,
    tabValidity,
    validatingTab,
    validateActiveTab,
    applyDone,
    jobUsage,
    jobBudgetLimitUsd,
    setJobBudgetLimitUsd,
    allowWindowFocus,
    setAllowWindowFocus,
    accountIsBeta,
    budgetSkippedJobIds,
    markActiveJobApplied,
    socketRef,
    connect,
    fetchActionableTree,
    analyzeTree,
    generatePlan,
    generateActiveJobResume,
    openActiveJob,
    runPipelineAuto,
    autoRunState,
    pauseAutoRun,
    resumeAutoRun,
    stopAutoRun,
    applyActionPlan,
    selectTreeTarget,
    requestTabs,
    requestScreenshot,
    navigateToJob,
    enqueueJobs,
    applyJob,
    applyQueue,
    pushLog,
  };
}
