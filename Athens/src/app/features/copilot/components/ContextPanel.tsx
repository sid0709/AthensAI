import React, { useEffect, useState } from "react";
import { ChevronRight, FileText } from "lucide-react";
import { Av } from "../../../components/ui";
import { AthensSwitch } from "../../../components/forms";
import { mono } from "../../../lib/utils";
import { APPLICATIONS } from "../../../data/applications";
import { COPILOT_QUICK_ACTIONS, COPILOT_WORKFLOWS, TOP_APPLICATION_IDS } from "../../../data/copilot";
import { useResumeNavigationOptional } from "../../../context/ResumeNavigationContext";
import { getEditorDraft } from "../../../services/resumeStorage";

type ContextPanelProps = {
  onQuickAction?: (action: string) => void;
  workflows?: Record<string, boolean>;
  onToggleWorkflow?: (name: string, on: boolean) => void;
};

export function ContextPanel({ onQuickAction, workflows, onToggleWorkflow }: ContextPanelProps) {
  const resumeNav = useResumeNavigationOptional();
  const [resumeName, setResumeName] = useState<string | null>(null);

  useEffect(() => {
    getEditorDraft().then((d) => setResumeName(d.document.identity.fullName));
  }, []);

  return (
    <div className="w-60 border-l border-border flex-shrink-0 overflow-y-auto p-5 space-y-5 bg-secondary/20 subtle-scroll">
      <div>
        <p className="text-xs font-bold text-muted-foreground uppercase tracking-wider mb-3">Target Role</p>
        <div className="bg-card border border-border rounded-xl p-4 shadow-sm">
          <p className="text-sm font-bold text-foreground">Senior Frontend Engineer</p>
          <p className="text-sm text-muted-foreground">Vercel · Remote</p>
          <p className="text-xs text-muted-foreground mt-1">94% match · $160k–$200k</p>
          <div className="mt-3 h-2 bg-secondary rounded-full overflow-hidden">
            <div className="h-full w-[94%] bg-primary rounded-full" />
          </div>
          <p className="text-xs text-muted-foreground mt-1">Strong fit — apply soon</p>
        </div>
      </div>

      <div>
        <p className="text-xs font-bold text-muted-foreground uppercase tracking-wider mb-3">Attached resume</p>
        <button
          type="button"
          onClick={() => resumeNav?.openEditor({ tab: "editor" })}
          className="w-full bg-card border border-border rounded-xl p-4 shadow-sm text-left hover:shadow-md transition-all"
        >
          <div className="flex items-center gap-2">
            <FileText className="w-4 h-4 text-primary flex-shrink-0" />
            <div className="min-w-0">
              <p className="text-sm font-bold text-foreground truncate">{resumeName ?? "Current draft"}</p>
              <p className="text-xs text-muted-foreground">Open in Resume Generator</p>
            </div>
          </div>
        </button>
        <button
          type="button"
          onClick={() => resumeNav?.openEditor({ tab: "analysis" })}
          className="w-full mt-2 text-xs font-semibold text-primary hover:underline text-left px-1"
        >
          Resume analysis →
        </button>
      </div>

      <div>
        <p className="text-xs font-bold text-muted-foreground uppercase tracking-wider mb-3">Top Applications</p>
        <div className="bg-card border border-border rounded-xl p-4 space-y-3 shadow-sm">
          {APPLICATIONS.filter((c) => TOP_APPLICATION_IDS.includes(c.id)).map((c) => (
            <div key={c.id} className="flex items-center gap-3">
              <Av name={c.company} size="xs" />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-bold text-foreground truncate">{c.company}</p>
                <p className="text-xs text-muted-foreground" style={mono}>{c.score}% match</p>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div>
        <p className="text-xs font-bold text-muted-foreground uppercase tracking-wider mb-3">Quick Actions</p>
        <div className="space-y-1">
          {COPILOT_QUICK_ACTIONS.map((a) => (
            <button
              key={a}
              type="button"
              onClick={() => onQuickAction?.(a)}
              className="w-full text-left text-sm font-semibold text-muted-foreground hover:text-foreground flex items-center gap-2 py-2.5 px-3 rounded-xl hover:bg-secondary transition-colors min-h-10"
            >
              <ChevronRight className="w-4 h-4 flex-shrink-0" />
              {a}
            </button>
          ))}
        </div>
      </div>

      <div>
        <p className="text-xs font-bold text-muted-foreground uppercase tracking-wider mb-3">Workflow</p>
        <div className="space-y-3">
          {COPILOT_WORKFLOWS.map((w) => (
            <AthensSwitch
              key={w.n}
              label={w.n}
              checked={workflows?.[w.n] ?? w.on}
              onCheckedChange={(checked) => onToggleWorkflow?.(w.n, checked)}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
