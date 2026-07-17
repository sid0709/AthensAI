import React from "react";
import { Building } from "lucide-react";
import { RadarChart, Radar, PolarGrid, PolarAngleAxis, ResponsiveContainer } from "recharts";
import { Av, Badge, Score } from "../../../components/ui";
import { SlidePanel, SlidePanelHeader } from "../../../components/overlays";
import { RADAR_DATA } from "../../../data/applications";
import { mono } from "../../../lib/utils";
import { useResumeNavigationOptional } from "../../../context/ResumeNavigationContext";
import { useAppNavigationOptional } from "../../../context/AppNavigationContext";
import type { Application, BadgeVariant } from "../../../types";

function stageBadgeVariant(stage: string): BadgeVariant {
  if (stage === "Hired") return "success";
  if (stage === "Offer") return "violet";
  if (stage === "Interview") return "blue";
  return "default";
}

type ApplicationDetailPanelProps = {
  app: Application | null;
  onClose: () => void;
};

export function ApplicationDetailPanel({ app, onClose }: ApplicationDetailPanelProps) {
  const resumeNav = useResumeNavigationOptional();
  const appNav = useAppNavigationOptional();

  const buildJd = () =>
    app
      ? `${app.role} at ${app.company}\nLocation: ${app.location}\nRequired skills: ${app.tags.join(", ")}\n${app.salary ? `Compensation: ${app.salary}\n` : ""}Source: ${app.source}`
      : "";

  return (
    <SlidePanel open={!!app} onOpenChange={(open) => !open && onClose()} width="sm">
      {app && (
        <>
          <SlidePanelHeader title="Application Details" onClose={onClose} />
          <div className="flex-1 overflow-y-auto p-5 space-y-5 subtle-scroll">
            <div className="flex flex-col items-center text-center pb-5 border-b border-border">
              <Av name={app.company} size="lg" />
              <h3 className="text-base font-bold text-foreground mt-3">{app.role}</h3>
              <p className="text-sm text-muted-foreground">{app.company}</p>
              <p className="text-xs text-muted-foreground flex items-center gap-1 mt-1">
                <Building className="w-3.5 h-3.5" />
                {app.location}
              </p>
              <div className="flex items-center gap-2 mt-3">
                <Score score={app.score} />
                <Badge v={stageBadgeVariant(app.stage)}>{app.stage}</Badge>
              </div>
            </div>

            <div>
              <p className="text-xs font-bold text-muted-foreground uppercase tracking-wider mb-3">Fit Profile</p>
              <ResponsiveContainer width="100%" height={160}>
                <RadarChart data={RADAR_DATA} margin={{ top: 8, right: 12, bottom: 8, left: 12 }}>
                  <PolarGrid stroke="rgba(0,0,0,0.08)" radialLines={false} />
                  <PolarAngleAxis dataKey="dim" tick={{ fill: "#6b6b84", fontSize: 10 }} tickLine={false} />
                  <Radar name="You" dataKey="you" stroke="#6c5ce7" strokeWidth={1.5} fill="#6c5ce7" fillOpacity={0.2} />
                  <Radar name="Target" dataKey="target" stroke="#2dd4bf" strokeWidth={1} strokeDasharray="3 2" fill="transparent" />
                </RadarChart>
              </ResponsiveContainer>
            </div>

            <div className="space-y-4 text-sm">
              <div>
                <p className="text-muted-foreground text-xs uppercase tracking-wider font-bold mb-1">Contact</p>
                <p className="text-foreground" style={mono}>{app.email}</p>
              </div>
              <div>
                <p className="text-muted-foreground text-xs uppercase tracking-wider font-bold mb-1">Source</p>
                <p className="text-foreground">{app.source}</p>
              </div>
              <div>
                <p className="text-muted-foreground text-xs uppercase tracking-wider font-bold mb-2">Skills Match</p>
                <div className="flex flex-wrap gap-1.5">{app.tags.map((t) => <Badge key={t} v="subtle">{t}</Badge>)}</div>
              </div>
              <div>
                <p className="text-muted-foreground text-xs uppercase tracking-wider font-bold mb-2">AI Analysis</p>
                <div className="bg-secondary/50 border border-border rounded-xl p-3 text-sm text-foreground/75 leading-relaxed">
                  Strong fit for this role. Your {app.tags[0]} experience aligns well. Recommend following up if no response in 7 days.
                </div>
              </div>
            </div>
          </div>

          <div className="p-5 border-t border-border space-y-2 flex-shrink-0">
            <button type="button" onClick={() => appNav?.navigate("interviews")} className="w-full bg-primary text-white rounded-xl py-3 text-sm font-bold hover:bg-primary/90 transition-colors min-h-10">
              Prep for Interview →
            </button>
            <button
              type="button"
              onClick={() => resumeNav?.openEditor({ jd: buildJd(), tab: "editor" })}
              className="w-full bg-secondary border border-border text-foreground rounded-xl py-3 text-sm font-semibold hover:bg-muted transition-colors min-h-10"
            >
              Tailor Resume
            </button>
            <button type="button" onClick={() => { if (window.confirm("Withdraw this application?")) onClose(); }} className="w-full text-rose-600 text-sm font-semibold py-2.5 hover:bg-rose-50 rounded-xl transition-colors min-h-10">
              Withdraw Application
            </button>
          </div>
        </>
      )}
    </SlidePanel>
  );
}
