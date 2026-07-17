import { useCallback } from "react";
import { Bot, Loader2, Plus } from "lucide-react";
import { useApplier } from "@/context/applier-context";
import { PageShell } from "../../components/layout/PageShell";
import { useAgentSessions } from "./context/AgentSessionsContext";
import { RunHistoryPanel } from "./components/RunHistoryPanel";
import { SessionTabs } from "./components/SessionTabs";

export function AgentsPage() {
  const { applier, applierReady } = useApplier();
  const { sessions, openDeploy, registerSlot } = useAgentSessions();

  const slotRef = useCallback(
    (el: HTMLDivElement | null) => registerSlot(el),
    [registerSlot],
  );

  return (
    <PageShell fullWidth className="bg-gradient-to-b from-violet-500/[0.03] via-background to-background">
      <div className="px-4 sm:px-6 lg:px-8 pt-5 pb-8 max-w-[1600px] mx-auto space-y-5">
        <header className="flex flex-wrap items-start justify-between gap-4">
          <div className="space-y-1">
            <div className="flex items-center gap-2.5">
              <div className="w-10 h-10 rounded-2xl bg-gradient-to-br from-violet-600 to-indigo-600 flex items-center justify-center shadow-lg shadow-violet-500/20">
                <Bot className="w-5 h-5 text-white" />
              </div>
              <div>
                <h1 className="text-xl font-bold text-foreground tracking-tight">Avalon Controller</h1>
                <p className="text-sm text-muted-foreground">
                  Auto-apply through your Chrome extension — scan, analyze, inject
                </p>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            <button
              type="button"
              onClick={openDeploy}
              className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-gradient-to-r from-violet-600 to-indigo-600 text-white text-sm font-bold shadow-md shadow-violet-500/25 hover:shadow-lg hover:shadow-violet-500/30 transition-shadow"
            >
              <Plus className="w-4 h-4" />
              Queue jobs
            </button>
          </div>
        </header>

        {!applierReady ? (
          <div className="flex flex-col items-center justify-center py-32 text-muted-foreground gap-3">
            <Loader2 className="w-8 h-8 animate-spin text-violet-500" />
            <p className="text-sm font-medium">Loading your profile…</p>
          </div>
        ) : (
          <>
            <SessionTabs />
            <div className="flex items-start gap-4 min-w-0">
              <div ref={slotRef} className="flex-1 min-w-0" />
              <RunHistoryPanel applierName={applier?.name ?? ""} sessions={sessions} />
            </div>
          </>
        )}
      </div>
    </PageShell>
  );
}
