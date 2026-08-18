import React, { useCallback, useEffect, useMemo, useState } from "react";
import { BarChart3, Loader2, Search, X } from "lucide-react";
import { useApplier } from "@/context/applier-context";
import { fetchUserResumes } from "../../../services/resumeApi";
import type { UserResumeSummary } from "../../../types/resume";
import { toCategorizedSkills } from "../lib/skillCategories";
import { ResumeSkillProfilePanel } from "./analysis/ResumeSkillProfilePanel";

type ResumeAnalysisTabProps = {
  onOpenLibrary?: () => void;
};

export function ResumeAnalysisTab({ onOpenLibrary }: ResumeAnalysisTabProps) {
  const { applier, applierReady } = useApplier();
  const ownerName = applier?.name ?? "";
  const [resumes, setResumes] = useState<UserResumeSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedResumeId, setSelectedResumeId] = useState<string | null>(null);
  const [query, setQuery] = useState("");

  const analyzedResumes = useMemo(
    () => resumes.filter((r) => r.analyzed && r.source !== "generated"),
    [resumes],
  );

  const visibleResumes = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return analyzedResumes;
    return analyzedResumes.filter((r) =>
      [r.techStack, r.fileName].some((x) => x.toLowerCase().includes(q)),
    );
  }, [analyzedResumes, query]);

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

  const selectedResume = analyzedResumes.find((r) => r.id === selectedResumeId);
  const selectedSkills = toCategorizedSkills(selectedResume?.skillProfile);

  if (!applierReady || loading) {
    return (
      <div className="athens-settings__loading">
        <Loader2 className="size-4 animate-spin" aria-hidden="true" />
        Loading analysis…
      </div>
    );
  }

  if (!ownerName) {
    return (
      <div className="athens-empty">
        <p className="athens-empty__title">Select an applier to view resume analysis.</p>
      </div>
    );
  }

  if (!analyzedResumes.length) {
    return (
      <div className="athens-empty">
        <BarChart3 size={28} aria-hidden="true" />
        <p className="athens-empty__title">No analyzed resumes yet</p>
        <p className="athens-empty__copy">
          Go to the Library tab, select uploaded resumes, and run Analyze to see skill radar charts here.
        </p>
        {onOpenLibrary ? (
          <button type="button" onClick={onOpenLibrary} className="athens-btn-primary mt-4">
            Open Library
          </button>
        ) : null}
      </div>
    );
  }

  return (
    <div className="grid min-h-[520px] grid-cols-1 gap-4 lg:grid-cols-[280px_1fr]">
      <aside className="athens-surface flex min-h-[520px] flex-col overflow-hidden">
        <div className="space-y-2 border-b border-[var(--athens-border)] px-4 py-3">
          <div>
            <h3 className="athens-settings__title">Analyzed resumes</h3>
            <p className="athens-settings__lede">{analyzedResumes.length} available</p>
          </div>
          {analyzedResumes.length > 8 ? (
            <div className="athens-field-group">
              <div className="athens-field min-w-0">
                <Search className="athens-field__icon" aria-hidden="true" />
                <input
                  type="search"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search stack or file"
                  aria-label="Search analyzed resumes"
                  className="athens-field__input"
                />
                {query ? (
                  <button type="button" onClick={() => setQuery("")} className="athens-field__clear" aria-label="Clear search">
                    <X size={12} aria-hidden="true" />
                  </button>
                ) : null}
              </div>
            </div>
          ) : null}
        </div>
        <ul className="subtle-scroll flex-1 space-y-1 overflow-y-auto p-2">
          {visibleResumes.map((r) => {
            const active = r.id === selectedResumeId;
            const skillCount = r.skillCount ?? r.skillProfile?.length;
            return (
              <li key={r.id}>
                <button
                  type="button"
                  onClick={() => setSelectedResumeId(r.id)}
                  className={`athens-queue-row w-full text-left ${active ? "is-selected" : ""}`}
                >
                  <div>
                    <div className="athens-card-title truncate">{r.techStack}</div>
                    <div className="mt-0.5 truncate text-xs text-[var(--athens-text-secondary)]">{r.fileName}</div>
                    {skillCount != null ? (
                      <div className="athens-card-meta mt-1">{skillCount} skills</div>
                    ) : null}
                  </div>
                </button>
              </li>
            );
          })}
          {!visibleResumes.length ? (
            <li className="px-3 py-6 text-center text-xs text-[var(--athens-text-muted)]">No matches</li>
          ) : null}
        </ul>
      </aside>

      <div className="athens-surface min-h-[520px] overflow-hidden">
        <ResumeSkillProfilePanel
          key={selectedResumeId ?? "none"}
          skills={selectedSkills}
          title={selectedResume ? `${selectedResume.techStack} — ${selectedResume.fileName}` : "Skill analysis"}
          description="Skills extracted from this resume with category and proficiency level (1–5)."
        />
      </div>
    </div>
  );
}
