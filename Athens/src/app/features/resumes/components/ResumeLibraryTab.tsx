import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { formatDistanceToNow } from "date-fns";
import { Link } from "react-router";
import { Filter, Upload, Download, Star, Files, BarChart3, Trash2, Loader2, Sparkles, Eye, Eraser } from "lucide-react";
import { useApplier } from "@/context/applier-context";
import { resolveProfileDefaultModel } from "../../agents/avalon/ai/model";
import { PATHS } from "../../../config/routes";
import { SearchField } from "../../../components/shared/SearchField";
import { Badge, Pill } from "../../../components/ui";
import { cn } from "../../../lib/utils";
import {
  bulkUploadUserResumes,
  deleteUserResume,
  fetchUserResume,
  fetchUserResumes,
  fileToBase64,
  setPrimaryUserResume,
  uploadUserResume,
  analyzeUserResume,
  clearUserResumeAnalysis,
} from "../../../services/resumeApi";
import type { UserResumeSummary } from "../../../types/resume";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../../../components/ui/dialog";
import { AthensInput, FormField } from "../../../components/forms";
import { downloadBlob } from "../lib/buildResumeModel";
import { ResumePreviewDialog } from "./ResumePreviewDialog";
import { GeneratedResumesSection } from "./GeneratedResumesSection";
import { useResumeSelection } from "../hooks/useResumeSelection";
import type { FullRun } from "../generator/history/history-types";

type AnalyzeProgress = {
  current: number;
  total: number;
  failed: { fileName: string; error: string }[];
};

type ResumeLibraryTabProps = {
  onOpenAnalysis?: () => void;
  onLoadIntoEditor?: (run: FullRun) => void;
};

type LibraryView = "uploaded" | "generated";

type PendingFile = { file: File; techStack?: string; relativePath?: string };

export function ResumeLibraryTab({ onOpenAnalysis, onLoadIntoEditor }: ResumeLibraryTabProps) {
  const { applier, applierReady } = useApplier();
  const [libraryView, setLibraryView] = useState<LibraryView>("uploaded");
  const [q, setQ] = useState("");
  const [stackFilter, setStackFilter] = useState<string>("all");
  const [resumes, setResumes] = useState<UserResumeSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [pendingFile, setPendingFile] = useState<PendingFile | null>(null);
  const [techStackInput, setTechStackInput] = useState("");
  const [bulkPending, setBulkPending] = useState<PendingFile[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [analyzeProgress, setAnalyzeProgress] = useState<AnalyzeProgress | null>(null);
  const [clearingAnalysis, setClearingAnalysis] = useState(false);
  const [previewResume, setPreviewResume] = useState<UserResumeSummary | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const bulkRef = useRef<HTMLInputElement>(null);

  const ownerId = applier?._id != null ? String(applier._id) : "";
  const ownerName = applier?.name ?? "";

  const refresh = useCallback(async () => {
    if (!ownerName) {
      setResumes([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      setResumes(await fetchUserResumes(ownerName, "uploaded"));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load resumes");
    } finally {
      setLoading(false);
    }
  }, [ownerName]);

  useEffect(() => {
    if (!applierReady) return;
    void refresh();
  }, [applierReady, refresh]);

  const stacks = [...new Set(resumes.map((r) => r.techStack))].sort();

  const filtered = resumes.filter((r) => {
    const matchQ =
      !q ||
      [r.fileName, r.techStack, r.extractedText ?? ""].some((x) => x.toLowerCase().includes(q.toLowerCase()));
    const matchStack = stackFilter === "all" || r.techStack === stackFilter;
    return matchQ && matchStack;
  });

  const selectableFiltered = useMemo(
    () => filtered.filter((r) => r.source !== "generated"),
    [filtered],
  );

  const { selectedIds, selectedResumes, selectResume, selectAll, clearSelection } =
    useResumeSelection(selectableFiltered);

  const profile = applier?.autoBidProfile as Record<string, unknown> | undefined;
  const defaultModel = resolveProfileDefaultModel(profile);
  const hasLlmKey = Boolean(profile?.openaiApiKey || profile?.deepseekApiKey);
  const allFilteredSelected =
    selectableFiltered.length > 0 && selectableFiltered.every((r) => selectedIds.has(r.id));
  const someFilteredSelected = selectableFiltered.some((r) => selectedIds.has(r.id));
  const analyzing = analyzeProgress != null;
  const selectedAnalyzedCount = selectedResumes.filter((r) => r.analyzed).length;

  const handleSingleFilePick = (files: FileList | null) => {
    if (!files?.[0]) return;
    setPendingFile({ file: files[0] });
    setTechStackInput("");
    if (fileRef.current) fileRef.current.value = "";
  };

  const confirmSingleUpload = async () => {
    if (!pendingFile || !ownerName || !ownerId || !techStackInput.trim()) return;
    setUploading(true);
    setError(null);
    try {
      const contentBase64 = await fileToBase64(pendingFile.file);
      await uploadUserResume({
        ownerName,
        ownerId,
        techStack: techStackInput.trim(),
        fileName: pendingFile.file.name,
        mimeType: pendingFile.file.type || "application/octet-stream",
        contentBase64,
      });
      setPendingFile(null);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setUploading(false);
    }
  };

  const handleBulkPick = (files: FileList | null) => {
    if (!files?.length) return;
    const items: PendingFile[] = [];
    for (const file of Array.from(files)) {
      const rel = (file as File & { webkitRelativePath?: string }).webkitRelativePath || file.name;
      const parts = rel.split("/").filter(Boolean);
      if (parts.length < 2) continue;
      const techStack = parts[parts.length - 2];
      items.push({ file, techStack, relativePath: rel });
    }
    if (!items.length) {
      setError("Bulk upload requires a folder with subfolders (tech stack) containing resume files.");
      return;
    }
    setBulkPending(items);
    if (bulkRef.current) bulkRef.current.value = "";
  };

  const confirmBulkUpload = async () => {
    if (!bulkPending?.length || !ownerName || !ownerId) return;
    setUploading(true);
    setError(null);
    try {
      const items = await Promise.all(
        bulkPending.map(async (p) => ({
          techStack: p.techStack!,
          fileName: p.file.name,
          mimeType: p.file.type || "application/octet-stream",
          contentBase64: await fileToBase64(p.file),
        })),
      );
      const result = await bulkUploadUserResumes({ ownerName, ownerId, items });
      if (result.failed.length) {
        setError(`${result.failed.length} file(s) failed to upload.`);
      }
      setBulkPending(null);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Bulk upload failed");
    } finally {
      setUploading(false);
    }
  };

  const handleDownload = async (id: string, fileName: string) => {
    if (!ownerName) return;
    const detail = await fetchUserResume(id, ownerName);
    if (!detail.contentBase64) return;
    const bytes = Uint8Array.from(atob(detail.contentBase64), (c) => c.charCodeAt(0));
    await downloadBlob(new Blob([bytes], { type: detail.mimeType }), fileName);
  };

  const handleSetPrimary = async (id: string) => {
    if (!ownerName) return;
    await setPrimaryUserResume(id, ownerName);
    await refresh();
  };

  const handleDelete = async (id: string) => {
    if (!ownerName || !confirm("Delete this resume?")) return;
    await deleteUserResume(id, ownerName);
    await refresh();
  };

  const handleBulkAnalyze = async () => {
    if (!ownerName || !selectedResumes.length || analyzing) return;

    const toAnalyze = selectedResumes.filter((r) => r.source !== "generated");
    if (!toAnalyze.length) {
      setError("Generated resumes are analyzed automatically.");
      return;
    }

    const alreadyAnalyzed = toAnalyze.filter((r) => r.analyzed);
    if (alreadyAnalyzed.length) {
      const reanalyze = confirm(
        `${alreadyAnalyzed.length} selected resume(s) are already analyzed. Re-analyze with AI? This will replace skill scores.`,
      );
      if (!reanalyze) return;
    }

    setError(null);
    const failed: { fileName: string; error: string }[] = [];
    setAnalyzeProgress({ current: 0, total: toAnalyze.length, failed });

    for (let i = 0; i < toAnalyze.length; i++) {
      const resume = toAnalyze[i];
      setAnalyzeProgress({ current: i + 1, total: toAnalyze.length, failed: [...failed] });
      try {
        await analyzeUserResume(ownerName, resume.id, { force: resume.analyzed });
      } catch (err) {
        failed.push({
          fileName: resume.fileName,
          error: err instanceof Error ? err.message : "Analysis failed",
        });
        setAnalyzeProgress({ current: i + 1, total: toAnalyze.length, failed: [...failed] });
      }
    }

    setAnalyzeProgress(null);
    await refresh();
    clearSelection();

    if (failed.length) {
      setError(`${failed.length} of ${toAnalyze.length} resume(s) failed to analyze.`);
    }
  };

  const handleBulkClearAnalysis = async () => {
    if (!ownerName || clearingAnalysis || analyzing) return;

    const toClear = selectedResumes.filter((r) => r.analyzed);
    if (!toClear.length) return;

    const confirmed = confirm(
      `Clear analysis for ${toClear.length} selected resume(s)? Skill data will be removed but the files stay in your library.`,
    );
    if (!confirmed) return;

    setError(null);
    setClearingAnalysis(true);
    const failed: { fileName: string; error: string }[] = [];

    for (const resume of toClear) {
      try {
        await clearUserResumeAnalysis(ownerName, resume.id);
      } catch (err) {
        failed.push({
          fileName: resume.fileName,
          error: err instanceof Error ? err.message : "Failed to clear analysis",
        });
      }
    }

    setClearingAnalysis(false);
    await refresh();
    clearSelection();

    if (failed.length) {
      setError(`${failed.length} of ${toClear.length} resume(s) failed to clear analysis.`);
    }
  };

  if (!applierReady || loading) {
    return (
      <div className="flex items-center justify-center h-64 text-muted-foreground text-sm gap-2">
        <Loader2 className="w-5 h-5 animate-spin" />
        Loading resumes…
      </div>
    );
  }

  if (!ownerName) {
    return (
      <div className="flex items-center justify-center h-64 text-muted-foreground text-sm">
        Select an applier to manage resumes.
      </div>
    );
  }

  const bulkSummary = bulkPending
    ? Object.entries(
        bulkPending.reduce<Record<string, number>>((acc, p) => {
          acc[p.techStack!] = (acc[p.techStack!] ?? 0) + 1;
          return acc;
        }, {}),
      )
    : [];

  return (
    <>
      <div className="flex items-center gap-1 bg-secondary rounded-xl p-1 mb-6 w-fit scroll-row">
        <Pill active={libraryView === "uploaded"} onClick={() => setLibraryView("uploaded")}>
          Uploaded
        </Pill>
        <Pill active={libraryView === "generated"} onClick={() => setLibraryView("generated")}>
          Generated
        </Pill>
      </div>

      {libraryView === "generated" ? (
        <GeneratedResumesSection onLoadIntoEditor={onLoadIntoEditor} />
      ) : (
        <>
      <div className="flex items-center gap-3 mb-6 flex-wrap">
        <SearchField value={q} onChange={setQ} placeholder="Search resumes or tech stacks..." className="flex-1 max-w-md" />
        <select
          value={stackFilter}
          onChange={(e) => setStackFilter(e.target.value)}
          className="h-10 px-3 rounded-xl border border-border bg-card text-sm"
        >
          <option value="all">All stacks</option>
          {stacks.map((s) => (
            <option key={s} value={s}>{s}</option>
          ))}
        </select>
        <button type="button" className="flex items-center gap-2 bg-secondary border border-border text-muted-foreground px-4 py-2.5 rounded-xl text-sm font-semibold min-h-10">
          <Filter className="w-4 h-4" />{stacks.length} stacks
        </button>
        <button
          type="button"
          disabled={uploading}
          onClick={() => bulkRef.current?.click()}
          className="flex items-center gap-2 bg-secondary border border-border text-muted-foreground px-4 py-2.5 rounded-xl text-sm font-semibold hover:text-foreground min-h-10"
        >
          <Files className="w-4 h-4" />Bulk upload
        </button>
        <button
          type="button"
          disabled={uploading}
          onClick={() => fileRef.current?.click()}
          className="flex items-center gap-2 bg-primary text-white px-4 py-2.5 rounded-xl text-sm font-bold hover:bg-primary/90 min-h-10"
        >
          <Upload className="w-4 h-4" />Upload Resume
        </button>
        <div className="flex flex-col items-start gap-0.5">
          <button
            type="button"
            disabled={!hasLlmKey || selectedIds.size === 0 || analyzing || uploading}
            onClick={() => void handleBulkAnalyze()}
            className="flex items-center gap-2 bg-secondary border border-primary/30 text-primary px-4 py-2.5 rounded-xl text-sm font-bold hover:bg-primary/5 min-h-10 disabled:opacity-50"
          >
            {analyzing ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Sparkles className="w-4 h-4" />
            )}
            Analyze selected ({selectedIds.size})
          </button>
          {hasLlmKey && defaultModel ? (
            <span className="text-[10px] text-muted-foreground px-1">Model: {defaultModel}</span>
          ) : (
            <Link to={`${PATHS.settings}/profile`} className="text-[10px] text-primary hover:underline px-1">
              Add API key in Settings → Profile
            </Link>
          )}
        </div>
        <button
          type="button"
          disabled={selectedAnalyzedCount === 0 || clearingAnalysis || analyzing || uploading}
          onClick={() => void handleBulkClearAnalysis()}
          className="flex items-center gap-2 bg-secondary border border-border text-muted-foreground px-4 py-2.5 rounded-xl text-sm font-semibold hover:text-foreground min-h-10 disabled:opacity-50"
          title="Remove skill analysis only — keeps the resume file"
        >
          {clearingAnalysis ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : (
            <Eraser className="w-4 h-4" />
          )}
          Clear analysis ({selectedAnalyzedCount})
        </button>
        {onOpenAnalysis && (
          <button type="button" onClick={onOpenAnalysis} className="flex items-center gap-2 text-sm font-bold text-primary hover:underline">
            <BarChart3 className="w-4 h-4" />Analysis
          </button>
        )}
        <span className="text-sm text-muted-foreground ml-auto">{filtered.length} files</span>
      </div>

      {someFilteredSelected && (
        <div className="flex items-center gap-3 mb-4 py-2 px-3 rounded-xl border border-border/60 bg-secondary/20 text-sm flex-wrap">
          <label className="inline-flex items-center gap-2 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={allFilteredSelected}
              ref={(el) => {
                if (el) el.indeterminate = someFilteredSelected && !allFilteredSelected;
              }}
              onChange={() =>
                selectAll(
                  selectableFiltered.map((r) => r.id),
                  allFilteredSelected,
                )
              }
              className="size-3.5 rounded border-border text-primary focus:ring-primary/30"
            />
            <span className="text-xs text-muted-foreground">
              {selectedIds.size} selected · click cards to toggle · shift-click for range
            </span>
          </label>
          <button
            type="button"
            onClick={clearSelection}
            className="text-xs font-semibold text-muted-foreground hover:text-foreground"
          >
            Clear
          </button>
        </div>
      )}

      {analyzeProgress && (
        <div className="mb-4 rounded-xl border border-border bg-card p-4">
          <div className="flex items-center justify-between gap-2 mb-2 text-sm">
            <span className="font-semibold text-foreground flex items-center gap-2">
              <Loader2 className="w-4 h-4 animate-spin text-primary" />
              Analyzing resumes…
            </span>
            <span className="text-muted-foreground tabular-nums">
              {analyzeProgress.current}/{analyzeProgress.total}
            </span>
          </div>
          <div className="h-2 rounded-full bg-secondary overflow-hidden">
            <div
              className="h-full rounded-full bg-primary transition-all"
              style={{ width: `${(analyzeProgress.current / analyzeProgress.total) * 100}%` }}
            />
          </div>
          {analyzeProgress.failed.length > 0 && (
            <ul className="mt-2 text-xs text-destructive space-y-0.5">
              {analyzeProgress.failed.map((f) => (
                <li key={f.fileName}>
                  {f.fileName}: {f.error}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {error && <p className="text-sm text-destructive mb-4">{error}</p>}

      <input ref={fileRef} type="file" accept=".pdf,.doc,.docx,.txt" className="hidden" onChange={(e) => handleSingleFilePick(e.target.files)} />
      <input ref={bulkRef} type="file" /* @ts-expect-error webkitdirectory */ webkitdirectory="" multiple className="hidden" onChange={(e) => handleBulkPick(e.target.files)} />

      {filtered.length === 0 ? (
        <div className="flex flex-col items-center justify-center h-64 text-center px-4 border border-dashed border-border rounded-xl">
          <Upload className="w-10 h-10 text-muted-foreground/40 mb-3" />
          <p className="font-bold text-foreground">No resumes uploaded yet</p>
          <p className="text-sm text-muted-foreground mt-1 max-w-md">Upload a PDF or DOCX, name its tech stack, or bulk-upload a folder of stack subfolders.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-5">
          {filtered.map((r) => {
            const selectable = r.source !== "generated";
            const selected = selectable && selectedIds.has(r.id);
            return (
            <div
              key={r.id}
              role={selectable ? "button" : undefined}
              tabIndex={selectable ? 0 : undefined}
              onClick={
                selectable
                  ? (e) => {
                      if ((e.target as HTMLElement).closest("button")) return;
                      selectResume(r.id, e.shiftKey);
                    }
                  : undefined
              }
              onKeyDown={
                selectable
                  ? (e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        selectResume(r.id, e.shiftKey);
                      }
                    }
                  : undefined
              }
              className={cn(
                "bg-card border rounded-xl p-5 hover:shadow-md transition-all group shadow-sm",
                selected
                  ? "border-primary ring-2 ring-primary/30 bg-primary/5"
                  : "border-border",
                selectable && "cursor-pointer",
              )}
            >
              <div className="flex items-start justify-between mb-4">
                <div className="w-12 h-12 rounded-xl bg-primary/10 flex items-center justify-center">
                  <Star className="w-6 h-6 text-primary" />
                </div>
                <div className="flex items-center gap-2 flex-wrap justify-end">
                  {selected && <Badge v="violet">Selected</Badge>}
                  {r.isPrimary && <Badge v="violet">Primary</Badge>}
                  {r.source === "generated" ? (
                    <Badge v="violet">Generated</Badge>
                  ) : r.analyzed ? (
                    <Badge v="success">Analyzed</Badge>
                  ) : (
                    <Badge v="subtle">Not analyzed</Badge>
                  )}
                  <Badge v="blue">{r.techStack}</Badge>
                </div>
              </div>
              <p className="text-base font-bold text-foreground mb-1 truncate" title={r.fileName}>{r.fileName}</p>
              <p className="text-sm text-muted-foreground mb-4">
                {(r.sizeBytes / 1024).toFixed(0)} KB · {formatDistanceToNow(new Date(r.uploadedAt), { addSuffix: true })}
                {r.analyzed && r.skillCount != null ? ` · ${r.skillCount} skills` : ""}
              </p>
              <div className="flex items-center justify-end gap-1">
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    setPreviewResume(r);
                  }}
                  className="icon-btn w-9 h-9 text-muted-foreground hover:text-primary"
                  title="Preview"
                >
                  <Eye className="w-4 h-4" />
                </button>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    void handleDownload(r.id, r.fileName);
                  }}
                  className="icon-btn w-9 h-9 text-muted-foreground hover:text-foreground"
                  title="Download"
                >
                  <Download className="w-4 h-4" />
                </button>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    void handleSetPrimary(r.id);
                  }}
                  className="icon-btn w-9 h-9 text-muted-foreground hover:text-amber-500"
                  title="Set primary"
                >
                  <Star className="w-4 h-4" />
                </button>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    void handleDelete(r.id);
                  }}
                  className="icon-btn w-9 h-9 text-muted-foreground hover:text-destructive"
                  title="Delete"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            </div>
            );
          })}
        </div>
      )}

      <Dialog open={Boolean(pendingFile)} onOpenChange={(open) => !open && setPendingFile(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Name this resume&apos;s tech stack</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            File: <strong>{pendingFile?.file.name}</strong>
          </p>
          <FormField label="Tech stack name">
            <AthensInput
              value={techStackInput}
              onChange={(e) => setTechStackInput(e.target.value)}
              placeholder="e.g. React + TypeScript"
              autoFocus
            />
          </FormField>
          <DialogFooter>
            <button type="button" onClick={() => setPendingFile(null)} className="px-4 py-2 rounded-xl border border-border text-sm font-semibold">Cancel</button>
            <button
              type="button"
              disabled={!techStackInput.trim() || uploading}
              onClick={() => void confirmSingleUpload()}
              className="px-4 py-2 rounded-xl bg-primary text-white text-sm font-bold disabled:opacity-50"
            >
              {uploading ? "Uploading…" : "Upload"}
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(bulkPending)} onOpenChange={(open) => !open && setBulkPending(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Confirm bulk upload</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground mb-3">
            {bulkPending?.length} files across {bulkSummary.length} tech stack(s):
          </p>
          <ul className="text-sm space-y-1 max-h-48 overflow-y-auto">
            {bulkSummary.map(([stack, count]) => (
              <li key={stack}><strong>{stack}</strong> — {count} file(s)</li>
            ))}
          </ul>
          <DialogFooter>
            <button type="button" onClick={() => setBulkPending(null)} className="px-4 py-2 rounded-xl border border-border text-sm font-semibold">Cancel</button>
            <button type="button" disabled={uploading} onClick={() => void confirmBulkUpload()} className="px-4 py-2 rounded-xl bg-primary text-white text-sm font-bold disabled:opacity-50">
              {uploading ? "Uploading…" : "Upload all"}
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ResumePreviewDialog
        resumeId={previewResume?.id ?? null}
        ownerName={ownerName}
        fileName={previewResume?.fileName}
        open={Boolean(previewResume)}
        onOpenChange={(open) => !open && setPreviewResume(null)}
      />

        </>
      )}
    </>
  );
}
