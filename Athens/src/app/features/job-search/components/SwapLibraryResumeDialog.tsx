import React, { useEffect, useMemo, useState } from "react";
import { BookMarked, Loader2, Search } from "lucide-react";
import { toast } from "sonner";
import { useApplier } from "@/context/applier-context";
import { setRecommendedResumeFromLibrary } from "../../../api/jobs";
import { Button } from "../../../components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../../../components/ui/dialog";
import { Input } from "../../../components/ui/input";
import { cn } from "../../../lib/utils";
import { fetchUserResumes } from "../../../services/resumeApi";
import type { Job } from "../../../types";
import type { UserResumeSummary } from "../../../types/resume";

type SwapLibraryResumeDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  job: Job;
  onApplied: (next: Job) => void;
};

export function SwapLibraryResumeDialog({
  open,
  onOpenChange,
  job,
  onApplied,
}: SwapLibraryResumeDialogProps) {
  const { applier } = useApplier();
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [resumes, setResumes] = useState<UserResumeSummary[]>([]);
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    const name = String(applier?.name || "").trim();
    setQuery("");
    setSelectedId(job.recommendedResumeId || null);
    if (!name) {
      setResumes([]);
      return;
    }
    let cancelled = false;
    setLoading(true);
    void fetchUserResumes(name, "uploaded")
      .then((rows) => {
        if (cancelled) return;
        setResumes(rows);
        if (!job.recommendedResumeId && job.recommendedResumeStack) {
          const match = rows.find(
            (r) => r.techStack.trim() === job.recommendedResumeStack?.trim(),
          );
          if (match) setSelectedId(match.id);
        }
      })
      .catch((err) => {
        if (cancelled) return;
        toast.error(err instanceof Error ? err.message : "Could not load Library resumes.");
        setResumes([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, applier?.name, job.recommendedResumeId, job.recommendedResumeStack]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return resumes;
    return resumes.filter(
      (r) =>
        r.techStack.toLowerCase().includes(q) ||
        r.fileName.toLowerCase().includes(q),
    );
  }, [query, resumes]);

  const currentLabel = job.recommendedResumeStack
    ? job.recommendedResumeStack
    : job.useCustomizedResume
      ? "Customized"
      : null;

  const handleSave = async () => {
    const name = String(applier?.name || "").trim();
    const jobId = String(job.backendId || job.id || "").trim();
    if (!name || !jobId || !selectedId) {
      toast.error("Select a Library resume.");
      return;
    }
    setSaving(true);
    try {
      const res = await setRecommendedResumeFromLibrary({
        applierName: name,
        jobId,
        resumeId: selectedId,
      });
      if (res.success === false) {
        throw new Error(res.error || "Could not save recommended resume.");
      }
      onApplied({
        ...job,
        recommendedResumeStack: res.recommendedResumeStack || null,
        recommendedResumeId: res.recommendedResumeId || selectedId,
        recommendedResumeReason: res.recommendedResumeReason || null,
        useCustomizedResume: false,
        recommendWarning: null,
        recommendedAt: res.recommendedAt || new Date().toISOString(),
        recommendMode: "manual",
      });
      toast.success(
        res.recommendedResumeStack
          ? `Using Library resume “${res.recommendedResumeStack}”.`
          : "Library resume saved.",
      );
      onOpenChange(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not save recommended resume.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg gap-0 p-0 overflow-hidden">
        <DialogHeader className="px-5 pt-5 pb-3">
          <DialogTitle className="flex items-center gap-2">
            <BookMarked className="size-5 text-primary shrink-0" />
            Choose Library resume
          </DialogTitle>
          <DialogDescription className="text-sm leading-relaxed">
            Swap the recommended stack for{" "}
            <span className="font-medium text-foreground">{job.title}</span>
            {currentLabel ? (
              <>
                {" "}
                (currently{" "}
                <span className="font-medium text-foreground">{currentLabel}</span>)
              </>
            ) : null}
            .
          </DialogDescription>
        </DialogHeader>

        <div className="px-5 pb-3">
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search stack or file name…"
              className="pl-9"
              disabled={loading || saving}
            />
          </div>
        </div>

        <div className="max-h-[min(22rem,50vh)] overflow-y-auto border-y border-border/70 px-2 py-2 subtle-scroll">
          {loading ? (
            <div className="flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" />
              Loading Library…
            </div>
          ) : filtered.length === 0 ? (
            <p className="px-3 py-10 text-center text-sm text-muted-foreground">
              {resumes.length === 0
                ? "No uploaded Library resumes for this profile."
                : "No resumes match your search."}
            </p>
          ) : (
            <ul className="space-y-1">
              {filtered.map((resume) => {
                const active = selectedId === resume.id;
                return (
                  <li key={resume.id}>
                    <button
                      type="button"
                      disabled={saving}
                      onClick={() => setSelectedId(resume.id)}
                      className={cn(
                        "flex w-full flex-col items-start gap-0.5 rounded-lg px-3 py-2.5 text-left transition-colors",
                        active
                          ? "bg-primary/10 ring-1 ring-primary/30"
                          : "hover:bg-secondary/60",
                      )}
                    >
                      <span className="text-sm font-semibold text-foreground">
                        {resume.techStack || "Untitled stack"}
                      </span>
                      <span className="truncate text-xs text-muted-foreground w-full">
                        {resume.fileName}
                        {resume.analyzed ? " · analyzed" : ""}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        <DialogFooter className="px-5 py-4 gap-2 sm:gap-2">
          <Button
            type="button"
            variant="outline"
            disabled={saving}
            onClick={() => onOpenChange(false)}
          >
            Cancel
          </Button>
          <Button
            type="button"
            disabled={saving || !selectedId || loading}
            onClick={() => void handleSave()}
          >
            {saving ? <Loader2 className="size-4 animate-spin" /> : null}
            Use this resume
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
