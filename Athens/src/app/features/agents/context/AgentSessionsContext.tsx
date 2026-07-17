import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type Context,
  type MutableRefObject,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { useApplier } from "@/context/applier-context";
import { storedAvalonSessionId } from "../../../services/agentApi";
import type { DeployOptions } from "../../../types/agent";
import {
  resolveProfileDefaultModel,
  setProfileApplierName,
  setProfileDefaultModel,
} from "../avalon/ai/model";
import { formatApplierProfile } from "../avalon/ai/profile";
import { AvalonControllerView } from "../components/AvalonControllerView";
import { DeployAgentModal } from "../components/DeployAgentModal";
import { QUEUE_STORAGE_PREFIX, useAvalonRelay, type QueuedJob } from "../hooks/useAvalonRelay";

/**
 * Persistent, multi-session Avalon engine.
 *
 * `useAvalonRelay` used to live inside the Agents page, so navigating away
 * unmounted it and wiped the socket + queue + pipeline. Here the engines are
 * mounted in `AppProviders` (which wraps the router and never unmounts on route
 * changes), so every session's state survives navigation and background runs keep
 * going. Each session is an independent relay bound to its own Avalon `sessionId`
 * (extension pairing); the active session's controller is portaled into the Agents
 * page. The list starts with a single session and grows to N (tabbed) in Phase 3.
 */

type Relay = ReturnType<typeof useAvalonRelay>;

declare global {
  // Keep context identity stable across Vite Fast Refresh. Without this, a hot
  // update can leave the mounted provider on the previous module instance while
  // AgentsPage imports the refreshed hook, producing a false "missing provider"
  // crash even though AgentSessionsProvider is visibly in the tree.
  var __athensSessionRelayContext: Context<Relay | null> | undefined;
  var __athensAgentSessionsContext: Context<AgentSessionsContextValue | null> | undefined;
}

export interface AgentSessionMeta {
  id: string;
  name: string;
  /** Avalon relay session id the extension must match. Empty = shared default. */
  sessionId: string;
  createdAt: number;
}

/** Small live summary per session, for the tab bar (never the whole relay object). */
export interface AgentSessionStatus {
  connected: boolean;
  extension: boolean;
  autoRunState: "idle" | "running" | "paused";
  queueLength: number;
  appliedCount: number;
}

interface AgentSessionsContextValue {
  sessions: AgentSessionMeta[];
  activeSessionId: string;
  statusById: Record<string, AgentSessionStatus>;
  setActiveSession: (id: string) => void;
  createSession: (opts?: { name?: string; sessionId?: string; jobs?: QueuedJob[] }) => string;
  removeSession: (id: string) => void;
  renameSession: (id: string, name: string) => void;
  setSessionQueue: (id: string, jobs: QueuedJob[]) => void;
  /** Opens the deploy modal to queue jobs into the active session. */
  openDeploy: () => void;
  /** Opens the deploy modal in "create a new session" mode (name + Avalon session id). */
  openNewSession: () => void;
  registerSlot: (el: HTMLElement | null) => void;
}

/** Live relay for the session whose controller is currently rendered. */
const SessionRelayContext =
  globalThis.__athensSessionRelayContext ?? (globalThis.__athensSessionRelayContext = createContext<Relay | null>(null));

export function useSessionRelay(): Relay {
  const ctx = useContext(SessionRelayContext);
  if (!ctx) throw new Error("useSessionRelay must be used within a session engine");
  return ctx;
}

const AgentSessionsContext =
  globalThis.__athensAgentSessionsContext ??
  (globalThis.__athensAgentSessionsContext = createContext<AgentSessionsContextValue | null>(null));

export function useAgentSessions(): AgentSessionsContextValue {
  const ctx = useContext(AgentSessionsContext);
  if (!ctx) throw new Error("useAgentSessions must be used within AgentSessionsProvider");
  return ctx;
}

const SESSIONS_STORAGE_KEY = "athens-agent-sessions";

let sessionSeq = 0;
function newSessionKey(): string {
  sessionSeq += 1;
  return `sess_${Date.now().toString(36)}_${sessionSeq}`;
}

/** Non-empty Avalon relay id — empty/default collapses sessions onto one extension slot. */
function newAvalonSessionId(): string {
  return `avalon_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function ensureUniqueAvalonSessionId(
  requested: string | undefined,
  existing: AgentSessionMeta[],
): string {
  const used = new Set(
    existing.map((s) => s.sessionId?.trim()).filter((id): id is string => Boolean(id)),
  );
  let base = requested?.trim() || newAvalonSessionId();
  if (!used.has(base)) return base;
  let n = 2;
  while (used.has(`${base}_${n}`)) n += 1;
  return `${base}_${n}`;
}

function defaultSession(name = "Session 1", sessionId?: string): AgentSessionMeta {
  return {
    id: newSessionKey(),
    name,
    sessionId: sessionId?.trim() || newAvalonSessionId(),
    createdAt: Date.now(),
  };
}

function loadSessions(): AgentSessionMeta[] {
  try {
    const raw = localStorage.getItem(SESSIONS_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as AgentSessionMeta[];
      if (Array.isArray(parsed) && parsed.length && parsed.every((s) => s?.id)) {
        const seen = new Set<string>();
        return parsed.map((s) => {
          let sid = s.sessionId?.trim() || "";
          if (!sid || seen.has(sid)) {
            do {
              sid = newAvalonSessionId();
            } while (seen.has(sid));
          }
          seen.add(sid);
          return { ...s, sessionId: sid };
        });
      }
    }
  } catch {
    /* fall through to a fresh default */
  }
  const stored = storedAvalonSessionId()?.trim();
  return [defaultSession("Session 1", stored || newAvalonSessionId())];
}

export function AgentSessionsProvider({ children }: { children: ReactNode }) {
  const { applier } = useApplier();
  const applierName = applier?.name ?? "";
  const profileId = applier?._id != null ? String(applier._id) : "";
  const accountTier = applier?.tier ?? null;
  const applicantContext = useMemo(
    () => formatApplierProfile(applier?.autoBidProfile as Record<string, unknown> | undefined),
    [applier?.autoBidProfile],
  );

  useEffect(() => {
    setProfileApplierName(applierName || undefined);
    const profile = applier?.autoBidProfile as Record<string, unknown> | undefined;
    setProfileDefaultModel(resolveProfileDefaultModel(profile));
  }, [applierName, applier?.autoBidProfile]);

  const [sessions, setSessions] = useState<AgentSessionMeta[]>(() => loadSessions());
  const [activeSessionId, setActiveSessionId] = useState<string>(() => sessions[0]?.id ?? "");
  const [statusById, setStatusById] = useState<Record<string, AgentSessionStatus>>({});
  const [slotEl, setSlotEl] = useState<HTMLElement | null>(null);
  const [deployMode, setDeployMode] = useState<"closed" | "queue" | "new-session">("closed");

  // Live relay per session for imperative provider actions (enqueue/stop).
  const enginesRef = useRef<Map<string, Relay>>(new Map());
  // Jobs queued before an engine has mounted (createSession/setSessionQueue).
  const pendingJobsRef = useRef<Map<string, QueuedJob[]>>(new Map());

  useEffect(() => {
    try {
      localStorage.setItem(SESSIONS_STORAGE_KEY, JSON.stringify(sessions));
    } catch {
      /* storage unavailable */
    }
  }, [sessions]);

  // Keep the active id valid as sessions are added/removed.
  useEffect(() => {
    if (sessions.length && !sessions.some((s) => s.id === activeSessionId)) {
      setActiveSessionId(sessions[0].id);
    }
  }, [sessions, activeSessionId]);

  const registerEngine = useCallback((id: string, relay: Relay) => {
    enginesRef.current.set(id, relay);
  }, []);
  const unregisterEngine = useCallback((id: string) => {
    enginesRef.current.delete(id);
  }, []);

  const publishStatus = useCallback((id: string, status: AgentSessionStatus) => {
    setStatusById((prev) => {
      const cur = prev[id];
      if (
        cur &&
        cur.connected === status.connected &&
        cur.extension === status.extension &&
        cur.autoRunState === status.autoRunState &&
        cur.queueLength === status.queueLength &&
        cur.appliedCount === status.appliedCount
      ) {
        return prev;
      }
      return { ...prev, [id]: status };
    });
  }, []);

  const setActiveSession = useCallback((id: string) => setActiveSessionId(id), []);

  const createSession = useCallback(
    (opts?: { name?: string; sessionId?: string; jobs?: QueuedJob[] }) => {
      const trimmedName = opts?.name?.trim();
      const id = newSessionKey();
      const requestedSessionId = opts?.sessionId?.trim() || newAvalonSessionId();
      setSessions((prev) => {
        // Idempotent under React Strict Mode double-invoke of updaters.
        if (prev.some((s) => s.id === id)) return prev;
        const sessionId = ensureUniqueAvalonSessionId(requestedSessionId, prev);
        const meta: AgentSessionMeta = {
          id,
          name: trimmedName || `Session ${prev.length + 1}`,
          sessionId,
          createdAt: Date.now(),
        };
        if (opts?.jobs?.length) pendingJobsRef.current.set(meta.id, opts.jobs);
        return [...prev, meta];
      });
      setActiveSessionId(id);
      return id;
    },
    [],
  );

  const removeSession = useCallback((id: string) => {
    enginesRef.current.get(id)?.stopAutoRun();
    pendingJobsRef.current.delete(id);
    try {
      localStorage.removeItem(`${QUEUE_STORAGE_PREFIX}${id}`);
    } catch {
      /* storage unavailable */
    }
    setStatusById((prev) => {
      if (!(id in prev)) return prev;
      const next = { ...prev };
      delete next[id];
      return next;
    });
    setSessions((prev) => {
      const next = prev.filter((s) => s.id !== id);
      return next.length ? next : [defaultSession()];
    });
  }, []);

  const renameSession = useCallback((id: string, name: string) => {
    setSessions((prev) => prev.map((s) => (s.id === id ? { ...s, name } : s)));
  }, []);

  const setSessionQueue = useCallback((id: string, jobs: QueuedJob[]) => {
    const engine = enginesRef.current.get(id);
    if (engine) engine.enqueueJobs(jobs);
    else pendingJobsRef.current.set(id, jobs);
  }, []);

  const openDeploy = useCallback(() => setDeployMode("queue"), []);
  const openNewSession = useCallback(() => setDeployMode("new-session"), []);
  const registerSlot = useCallback((el: HTMLElement | null) => setSlotEl(el), []);

  // "queue" mode fills the ACTIVE session's queue (Phase 1 behavior); "new-session"
  // mode spins up a brand-new session on its own Avalon sessionId (Phase 3).
  const handleDeploy = useCallback(
    (opts: DeployOptions) => {
      const jobs: QueuedJob[] = (opts.jobs ?? []).map((j) => ({
        id: j.id,
        title: j.title,
        company: j.company,
        url: j.url,
        source: j.source,
      }));
      if (opts.createNewSession) {
        createSession({ name: opts.name, sessionId: opts.avalonSessionId, jobs });
      } else {
        setSessionQueue(activeSessionId, jobs);
      }
      setDeployMode("closed");
    },
    [activeSessionId, createSession, setSessionQueue],
  );

  const value = useMemo<AgentSessionsContextValue>(
    () => ({
      sessions,
      activeSessionId,
      statusById,
      setActiveSession,
      createSession,
      removeSession,
      renameSession,
      setSessionQueue,
      openDeploy,
      openNewSession,
      registerSlot,
    }),
    [
      sessions,
      activeSessionId,
      statusById,
      setActiveSession,
      createSession,
      removeSession,
      renameSession,
      setSessionQueue,
      openDeploy,
      openNewSession,
      registerSlot,
    ],
  );

  return (
    <AgentSessionsContext.Provider value={value}>
      {sessions.map((session) => (
        <AgentSessionEngine
          key={session.id}
          meta={session}
          active={session.id === activeSessionId}
          slotEl={slotEl}
          applicantContext={applicantContext}
          applierName={applierName}
          profileId={profileId}
          accountTier={accountTier}
          registerEngine={registerEngine}
          unregisterEngine={unregisterEngine}
          publishStatus={publishStatus}
          pendingJobsRef={pendingJobsRef}
          onQueueJobs={openDeploy}
        />
      ))}
      {children}
      {deployMode !== "closed" && (
        <DeployAgentModal
          onClose={() => setDeployMode("closed")}
          onDeploy={handleDeploy}
          asNewSession={deployMode === "new-session"}
        />
      )}
    </AgentSessionsContext.Provider>
  );
}

function AgentSessionEngine({
  meta,
  active,
  slotEl,
  applicantContext,
  applierName,
  profileId,
  accountTier,
  registerEngine,
  unregisterEngine,
  publishStatus,
  pendingJobsRef,
  onQueueJobs,
}: {
  meta: AgentSessionMeta;
  active: boolean;
  slotEl: HTMLElement | null;
  applicantContext: string;
  applierName: string;
  profileId: string;
  accountTier: string | null;
  registerEngine: (id: string, relay: Relay) => void;
  unregisterEngine: (id: string) => void;
  publishStatus: (id: string, status: AgentSessionStatus) => void;
  pendingJobsRef: MutableRefObject<Map<string, QueuedJob[]>>;
  onQueueJobs: () => void;
}) {
  const relay = useAvalonRelay(applicantContext, applierName, {
    sessionId: meta.sessionId,
    sessionLabel: meta.name,
    persist: false,
    persistKey: meta.id,
    accountTier,
    profileId,
  });

  // Expose the latest relay for imperative provider actions (enqueue/stop). Writing
  // to a ref during render keeps it current for event-handler-time reads.
  registerEngine(meta.id, relay);
  useEffect(() => () => unregisterEngine(meta.id), [meta.id, unregisterEngine]);

  // Drain any jobs queued before this engine mounted.
  const { enqueueJobs } = relay;
  useEffect(() => {
    const pending = pendingJobsRef.current.get(meta.id);
    if (pending?.length) {
      enqueueJobs(pending);
      pendingJobsRef.current.delete(meta.id);
    }
  }, [meta.id, enqueueJobs, pendingJobsRef]);

  // Publish a compact status summary for the tab bar.
  const { connected, autoRunState } = relay;
  const extension = relay.peers.extension;
  const queueLength = relay.jobQueue.length;
  const appliedCount = relay.appliedJobIds.size;
  useEffect(() => {
    publishStatus(meta.id, { connected, extension, autoRunState, queueLength, appliedCount });
  }, [meta.id, publishStatus, connected, extension, autoRunState, queueLength, appliedCount]);

  if (!active || !slotEl) return null;
  return createPortal(
    <SessionRelayContext.Provider value={relay}>
      <AvalonControllerView onQueueJobs={onQueueJobs} />
    </SessionRelayContext.Provider>,
    slotEl,
  );
}
