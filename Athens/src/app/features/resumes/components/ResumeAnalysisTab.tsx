import React, { useCallback, useEffect, useMemo, useState } from "react";
import { BarChart3, Loader2 } from "lucide-react";
import { useApplier } from "@/context/applier-context";
import { fetchUserResumes } from "../../../services/resumeApi";
import type { UserResumeSummary } from "../../../types/resume";
import { useResumeAnalysisGraph } from "../../knowledge-graph/hooks/useResumeAnalysisGraph";
import { ResumeSkillAnalysisView } from "./analysis/ResumeSkillAnalysisView";

type ResumeAnalysisTabProps = {
  onOpenLibrary?: () => void;
};

export function ResumeAnalysisTab({ onOpenLibrary }: ResumeAnalysisTabProps) {
  const { applier, applierReady } = useApplier();
  const ownerName = applier?.name ?? "";
  const [resumes, setResumes] = useState<UserResumeSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedResumeId, setSelectedResumeId] = useState<string | null>(null);

  const analyzedResumes = useMemo(
    () => resumes.filter((r) => r.analyzed && r.source !== "generated"),
    [resumes],
  );

  const refresh = useCallback(async () => {
    if (!ownerName) {
      setResumes([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      setResumes(await fetchUserResumes(ownerName, "uploaded"));
    } finally {
      setLoading(false);
    }
  }, [ownerName]);

  useEffect(() => {
    if (!applierReady) return;
    void refresh();
  }, [applierReady, refresh]);

  useEffect(() => {
    if (!analyzedResumes.length) {
      setSelectedResumeId(null);
      return;
    }
    setSelectedResumeId((prev) =>
      prev && analyzedResumes.some((r) => r.id === prev) ? prev : analyzedResumes[0].id,
    );
  }, [analyzedResumes]);

  const graph = useResumeAnalysisGraph(selectedResumeId);
  const selectedResume = analyzedResumes.find((r) => r.id === selectedResumeId);

  if (!applierReady || loading) {
    return (
      <div className="flex items-center justify-center h-64 text-muted-foreground text-sm gap-2">
        <Loader2 className="w-5 h-5 animate-spin" />
        Loading analysis…
      </div>
    );
  }

  if (!ownerName) {
    return (
      <div className="flex items-center justify-center h-64 text-muted-foreground text-sm">
        Select an applier to view resume analysis.
      </div>
    );
  }

  if (!analyzedResumes.length) {
    return (
      <div className="flex flex-col items-center justify-center h-64 text-center px-4 border border-dashed border-border rounded-xl">
        <BarChart3 className="w-10 h-10 text-muted-foreground/40 mb-3" />
        <p className="font-bold text-foreground">No analyzed resumes yet</p>
        <p className="text-sm text-muted-foreground mt-1 max-w-md">
          Go to the Library tab, select uploaded resumes, and run Analyze to see skill radar charts here.
        </p>
        {onOpenLibrary && (
          <button
            type="button"
            onClick={onOpenLibrary}
            className="mt-4 px-4 py-2 rounded-xl bg-primary text-white text-sm font-bold hover:bg-primary/90"
          >
            Open Library
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[280px_1fr] gap-5 min-h-[520px]">
      <aside className="rounded-xl border border-border bg-card overflow-hidden flex flex-col">
        <div className="px-4 py-3 border-b border-border">
          <h3 className="text-sm font-bold text-foreground">Analyzed resumes</h3>
          <p className="text-xs text-muted-foreground mt-0.5">{analyzedResumes.length} available</p>
        </div>
        <ul className="flex-1 overflow-y-auto subtle-scroll p-2 space-y-1">
          {analyzedResumes.map((r) => {
            const active = r.id === selectedResumeId;
            return (
              <li key={r.id}>
                <button
                  type="button"
                  onClick={() => setSelectedResumeId(r.id)}
                  className={`w-full text-left rounded-lg px-3 py-2.5 transition-colors ${
                    active
                      ? "bg-primary/10 border border-primary/30"
                      : "hover:bg-secondary border border-transparent"
                  }`}
                >
                  <div className="text-xs font-bold text-foreground truncate">{r.techStack}</div>
                  <div className="text-[11px] text-muted-foreground truncate mt-0.5">{r.fileName}</div>
                  {r.skillCount != null ? (
                    <div className="text-[10px] text-primary font-semibold mt-1">{r.skillCount} skills</div>
                  ) : null}
                </button>
              </li>
            );
          })}
        </ul>
      </aside>

      <div className="rounded-xl border border-border bg-card overflow-hidden min-h-[520px]">
        <ResumeSkillAnalysisView
          key={selectedResumeId ?? "none"}
          graph={graph}
          title={selectedResume ? `${selectedResume.techStack} — ${selectedResume.fileName}` : "Skill analysis"}
          description="Skills extracted from this resume with category and proficiency level (1–5), matching My Skills."
        />
      </div>
    </div>
  );
}
