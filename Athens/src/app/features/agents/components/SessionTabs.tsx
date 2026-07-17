import { useState } from "react";
import { Loader2, Pause, Play, Plus, X } from "lucide-react";
import { cn } from "../../../lib/utils";
import { useAgentSessions, type AgentSessionMeta, type AgentSessionStatus } from "../context/AgentSessionsContext";

/**
 * Tab per Avalon session — each is an independent relay bound to its own
 * unique `sessionId` (Chrome extension pairing). Within a session, Apply-all
 * runs jobs one at a time (parallel tabs interrupt each other); engines stay
 * mounted so leaving the Agents page does not tear down a running pipeline.
 */

function statusDotClass(status?: AgentSessionStatus): string {
  if (!status) return "bg-red-500/80";
  if (status.autoRunState === "running") return "bg-blue-600 animate-pulse";
  if (status.autoRunState === "paused") return "bg-amber-500";
  if (status.connected && status.extension) return "bg-emerald-500";
  if (status.connected) return "bg-amber-500";
  return "bg-red-500/80";
}

function SessionTab({
  session,
  status,
  active,
  onSelect,
  onClose,
  onRename,
}: {
  session: AgentSessionMeta;
  status?: AgentSessionStatus;
  active: boolean;
  onSelect: () => void;
  onClose: () => void;
  onRename: (name: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(session.name);

  const commitRename = () => {
    setEditing(false);
    const trimmed = draft.trim();
    if (trimmed && trimmed !== session.name) onRename(trimmed);
    else setDraft(session.name);
  };

  return (
    <div
      className={cn(
        "group flex items-center gap-2 pl-3 pr-2 py-2 rounded-xl border text-sm font-semibold shrink-0 cursor-pointer transition-colors",
        active
          ? "border-violet-500/50 bg-violet-500/10 text-violet-900"
          : "border-border/60 bg-card text-muted-foreground hover:bg-secondary/50",
      )}
      onClick={onSelect}
    >
      <span className={cn("w-2 h-2 rounded-full shrink-0", statusDotClass(status))} />
      {editing ? (
        <input
          autoFocus
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onClick={(e) => e.stopPropagation()}
          onBlur={commitRename}
          onKeyDown={(e) => {
            if (e.key === "Enter") commitRename();
            if (e.key === "Escape") {
              setDraft(session.name);
              setEditing(false);
            }
          }}
          className="bg-transparent border-b border-violet-400 outline-none text-sm font-semibold w-28"
        />
      ) : (
        <span
          className="truncate max-w-[140px]"
          onDoubleClick={(e) => {
            e.stopPropagation();
            setEditing(true);
          }}
          title="Double-click to rename"
        >
          {session.name}
        </span>
      )}
      {status && status.autoRunState !== "idle" && (
        <span className="shrink-0">
          {status.autoRunState === "running" ? (
            <Play className="w-3 h-3 text-blue-600" />
          ) : (
            <Pause className="w-3 h-3 text-amber-600" />
          )}
        </span>
      )}
      {status && status.queueLength > 0 && (
        <span className="text-[10px] font-bold text-muted-foreground shrink-0">
          {status.appliedCount}/{status.queueLength}
        </span>
      )}
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onClose();
        }}
        className="shrink-0 p-0.5 rounded hover:bg-black/10 opacity-0 group-hover:opacity-100 transition-opacity"
        title="Close session"
      >
        <X className="w-3 h-3" />
      </button>
    </div>
  );
}

export function SessionTabs() {
  const { sessions, activeSessionId, statusById, setActiveSession, removeSession, renameSession, openNewSession } =
    useAgentSessions();

  return (
    <div className="flex items-center gap-2 overflow-x-auto pb-1">
      {sessions.map((session) => (
        <SessionTab
          key={session.id}
          session={session}
          status={statusById[session.id]}
          active={session.id === activeSessionId}
          onSelect={() => setActiveSession(session.id)}
          onClose={() => removeSession(session.id)}
          onRename={(name) => renameSession(session.id, name)}
        />
      ))}
      <button
        type="button"
        onClick={openNewSession}
        className="shrink-0 inline-flex items-center gap-1.5 px-3 py-2 rounded-xl border border-dashed border-border text-xs font-semibold text-muted-foreground hover:border-violet-400 hover:text-violet-700 transition-colors"
        title="Start a new session on its own extension pairing"
      >
        <Plus className="w-3.5 h-3.5" />
        New session
      </button>
      {sessions.some((s) => statusById[s.id] === undefined) && (
        <Loader2 className="w-3.5 h-3.5 animate-spin text-muted-foreground shrink-0" />
      )}
    </div>
  );
}
