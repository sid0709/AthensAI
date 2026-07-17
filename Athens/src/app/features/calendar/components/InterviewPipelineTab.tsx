import { useMemo } from "react";
import type { ElementType } from "react";
import { TrendingUp, Clock, Ghost, Target, Zap, Building2, FileText } from "lucide-react";
import { cn } from "../../../lib/utils";
import { computePipelineMetrics } from "../lib/interviewAnalytics";
import type { CalendarEvent } from "../../../data/calendar";

type InterviewPipelineTabProps = {
  events: CalendarEvent[];
};

function MetricCard({
  label,
  value,
  sub,
  icon: Icon,
  accent,
}: {
  label: string;
  value: string;
  sub?: string;
  icon: ElementType;
  accent?: string;
}) {
  return (
    <div className="bg-card border border-border rounded-xl p-4 shadow-sm">
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="text-xs font-bold uppercase tracking-wide text-muted-foreground">{label}</p>
          <p className={cn("text-2xl font-bold mt-1", accent ?? "text-foreground")}>{value}</p>
          {sub && <p className="text-xs text-muted-foreground mt-0.5">{sub}</p>}
        </div>
        <div className="w-9 h-9 rounded-lg bg-primary/10 flex items-center justify-center">
          <Icon className="w-4 h-4 text-primary" />
        </div>
      </div>
    </div>
  );
}

function pct(n: number): string {
  return `${Math.round(n * 100)}%`;
}

export function InterviewPipelineTab({ events }: InterviewPipelineTabProps) {
  const m = useMemo(() => computePipelineMetrics(events), [events]);

  return (
    <div className="flex-1 overflow-y-auto subtle-scroll space-y-6 pb-6">
      <div>
        <h3 className="text-lg font-bold text-foreground">Interview pipeline analytics</h3>
        <p className="text-sm text-muted-foreground mt-0.5">
          Pass rates, stage conversion, velocity, and drop-off patterns across your interview funnel.
        </p>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <MetricCard icon={Target} label="Pass rate" value={pct(m.passRate)} sub={`${m.completed} completed rounds`} accent="text-emerald-600" />
        <MetricCard icon={TrendingUp} label="Offer rate" value={pct(m.offerRate)} sub="Reached offer stage" accent="text-violet-600" />
        <MetricCard icon={Ghost} label="Ghost rate" value={pct(m.ghostRate)} sub="Ignored / no response" accent="text-amber-600" />
        <MetricCard icon={Clock} label="Avg stage gap" value={m.avgDaysPerStage > 0 ? `${m.avgDaysPerStage.toFixed(1)}d` : "—"} sub="Days between rounds" />
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <MetricCard icon={Zap} label="Time to offer" value={m.velocityDays != null ? `${m.velocityDays.toFixed(0)}d` : "—"} sub="Intro → offer (avg)" />
        <MetricCard icon={Target} label="Fail rate" value={pct(m.failRate)} sub="Explicit rejections" />
        <MetricCard icon={Clock} label="Scheduled" value={String(m.scheduledCount)} sub="Upcoming rounds" />
        <MetricCard icon={Clock} label="Pending" value={String(m.pendingCount)} sub="Awaiting outcome" />
      </div>

      {/* Stage conversion funnel */}
      <div className="bg-card border border-border rounded-xl p-5 shadow-sm">
        <h4 className="text-sm font-bold text-foreground mb-4">Stage conversion</h4>
        <div className="space-y-3">
          {m.stageConversion.length === 0 ? (
            <p className="text-sm text-muted-foreground">No stage data yet.</p>
          ) : (
            m.stageConversion.map((s) => (
              <div key={s.step}>
                <div className="flex items-center justify-between text-sm mb-1">
                  <span className="font-semibold text-foreground">{s.label}</span>
                  <span className="text-muted-foreground">
                    {s.passed}/{s.entered} passed · <span className="font-mono font-bold text-foreground">{pct(s.rate)}</span>
                  </span>
                </div>
                <div className="h-2 rounded-full bg-secondary overflow-hidden">
                  <div
                    className="h-full rounded-full bg-primary transition-all"
                    style={{ width: `${Math.round(s.rate * 100)}%` }}
                  />
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      <div className="grid lg:grid-cols-2 gap-4">
        {/* By company */}
        <div className="bg-card border border-border rounded-xl p-5 shadow-sm">
          <h4 className="text-sm font-bold text-foreground mb-3 flex items-center gap-2">
            <Building2 className="w-4 h-4 text-primary" />
            By company
          </h4>
          <div className="space-y-2">
            {m.byCompany.slice(0, 6).map((c) => (
              <div key={c.company} className="flex items-center gap-3 text-sm">
                <span className="flex-1 truncate font-medium text-foreground">{c.company}</span>
                <span className="text-muted-foreground text-xs">{c.passed}/{c.total}</span>
                <span className="font-mono font-bold w-10 text-right">{pct(c.rate)}</span>
              </div>
            ))}
          </div>
        </div>

        {/* By profile */}
        <div className="bg-card border border-border rounded-xl p-5 shadow-sm">
          <h4 className="text-sm font-bold text-foreground mb-3 flex items-center gap-2">
            <FileText className="w-4 h-4 text-primary" />
            By resume profile
          </h4>
          <div className="space-y-2">
            {m.byProfile.map((p) => (
              <div key={p.profile} className="flex items-center gap-3 text-sm">
                <span className="flex-1 truncate font-medium text-foreground">{p.profile}</span>
                <span className="text-muted-foreground text-xs">{p.passed}/{p.total}</span>
                <span className="font-mono font-bold w-10 text-right">{pct(p.rate)}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Drop reasons */}
      {m.dropReasons.length > 0 && (
        <div className="bg-card border border-border rounded-xl p-5 shadow-sm">
          <h4 className="text-sm font-bold text-foreground mb-3">Drop-off reasons</h4>
          <div className="space-y-2">
            {m.dropReasons.map((d) => (
              <div key={d.reason} className="flex items-start gap-3 text-sm">
                <span className="flex-1 text-muted-foreground">{d.reason}</span>
                <span className="font-mono font-bold text-foreground">{d.count}×</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Pipeline volume funnel */}
      <div className="bg-card border border-border rounded-xl p-5 shadow-sm">
        <h4 className="text-sm font-bold text-foreground mb-4">Pipeline volume by stage</h4>
        <div className="flex items-end gap-2 h-32">
          {m.funnel.map((f) => {
            const max = Math.max(...m.funnel.map((x) => x.count), 1);
            const h = (f.count / max) * 100;
            return (
              <div key={f.step} className="flex-1 flex flex-col items-center gap-1 min-w-0">
                <span className="text-xs font-mono font-bold text-foreground">{f.count}</span>
                <div
                  className="w-full rounded-t-md bg-primary/70 min-h-[4px]"
                  style={{ height: `${h}%` }}
                />
                <span className="text-[10px] text-muted-foreground text-center truncate w-full">{f.label}</span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
