import React, { useEffect } from "react";
import { Area, AreaChart, ResponsiveContainer } from "recharts";
import { Bot, Loader2 } from "lucide-react";
import { useApplier } from "@/context/applier-context";
import { useAgentRunContextOptional } from "../../../context/AgentRunContext";
import { fetchAgentDashboard, fetchAgentRuns } from "../../../services/agentApi";
import type { RunSummary } from "../../../types/agent";

const FALLBACK_CHART = [
  { h: "6a", t: 0 },
  { h: "9a", t: 0 },
  { h: "12p", t: 0 },
  { h: "3p", t: 0 },
  { h: "6p", t: 0 },
  { h: "9p", t: 0 },
];

type AgentActivityPanelProps = {
  onNavigateAgents?: () => void;
};

export function AgentActivityPanel({ onNavigateAgents }: AgentActivityPanelProps) {
  const { applier, applierReady } = useApplier();
  const agentCtx = useAgentRunContextOptional();
  const profileId = applier?._id != null ? String(applier._id) : null;

  const [runs, setRuns] = React.useState<RunSummary[]>([]);
  const [activeRuns, setActiveRuns] = React.useState(0);
  const [runsToday, setRunsToday] = React.useState(0);
  const [chartData, setChartData] = React.useState(FALLBACK_CHART);
  const [loading, setLoading] = React.useState(true);

  useEffect(() => {
    if (!applierReady) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const [dash, runList] = await Promise.all([
          fetchAgentDashboard(profileId),
          fetchAgentRuns(profileId, 5),
        ]);
        if (cancelled) return;
        setRuns(runList.slice(0, 3));
        setActiveRuns(dash?.activeRuns ?? runList.filter((r) => r.status === "running").length);
        setRunsToday(dash?.succeededToday ?? 0);
        const subs = dash?.submissions7d?.length ? dash.submissions7d : dash?.applications7d ?? [];
        if (subs.length) {
          setChartData(subs.map((d) => ({ h: d.day, t: d.count })));
        }
      } catch {
        if (!cancelled) setRuns([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [profileId, applierReady]);

  return (
    <div className="bg-card border border-border rounded-xl p-5 shadow-sm">
      <div className="flex items-center gap-2 mb-4">
        <Bot className="w-5 h-5 text-violet-600" />
        <div>
          <h3 className="text-sm font-bold text-foreground">Agent Activity</h3>
          <p className="text-xs text-muted-foreground">
            {loading ? "Loading…" : `${runsToday} submitted today · ${activeRuns} active runs`}
          </p>
        </div>
      </div>
      {loading ? (
        <div className="flex items-center justify-center py-8 text-muted-foreground">
          <Loader2 className="w-5 h-5 animate-spin" />
        </div>
      ) : (
        <>
          <ResponsiveContainer width="100%" height={80}>
            <AreaChart data={chartData} margin={{ top: 0, right: 0, bottom: 0, left: 0 }}>
              <defs>
                <linearGradient id="agentGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#6c5ce7" stopOpacity={0.3} />
                  <stop offset="100%" stopColor="#6c5ce7" stopOpacity={0} />
                </linearGradient>
              </defs>
              <Area type="monotone" dataKey="t" stroke="#6c5ce7" strokeWidth={2} fill="url(#agentGrad)" />
            </AreaChart>
          </ResponsiveContainer>
          <div className="grid grid-cols-3 gap-2 mt-3">
            {runs.slice(0, 3).map((r) => (
              <button
                key={r.id}
                type="button"
                onClick={() => {
                  agentCtx?.openRun(r);
                  onNavigateAgents?.();
                }}
                className="bg-secondary/50 rounded-lg py-2 px-1 text-center hover:bg-secondary transition-colors"
              >
                <p className="text-xs font-bold text-foreground truncate">{r.agentName}</p>
                <p className="text-[10px] text-muted-foreground">{r.submitted}/{r.jobCount} submitted</p>
              </button>
            ))}
            {runs.length === 0 && (
              <p className="col-span-3 text-xs text-muted-foreground text-center py-2">No runs yet</p>
            )}
          </div>
        </>
      )}
    </div>
  );
}
