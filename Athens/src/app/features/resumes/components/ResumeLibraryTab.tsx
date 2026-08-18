import React, { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { formatDistanceToNow } from "date-fns";
import { Filter, Upload, Download, Star, Files, Trash2, Loader2, Sparkles, Eye, Eraser, Search, X } from "lucide-react";
import { useApplier } from "@/context/applier-context";
import {
  startResumeAnalyze,
  stopResumeAnalyze,
  waitForResumeAnalyze,
  type ResumeAnalyzeSession,
} from "@/app/api/resumeAnalyze";
import { AthensInput, FormField } from "../../../components/forms";
import { cn } from "../../../lib/utils";
import {
  deleteUserResume,
  fetchUserResume,
  fetchUserResumes,
  fileToBase64,
  setPrimaryUserResume,
  uploadUserResume,
  clearUserResumeAnalysis,
} from "../../../services/resumeApi";
import {
  uploadResumesInParallel,
  type BulkUploadProgress,
} from "../lib/bulkUploadResumes";
import type { UserResumeSummary } from "../../../types/resume";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../../../components/ui/dialog";
import { Checkbox } from "../../../components/ui/checkbox";
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
  pageTabs?: ReactNode;
  pageActions?: ReactNode;
  onLoadIntoEditor?: (run: FullRun) => void;
};

type LibraryView = "uploaded" | "generated";

type PendingFile = { file: File; techStack?: string; relativePath?: string };

export function ResumeLibraryTab({ pageTabs, pageActions, onLoadIntoEditor }: ResumeLibraryTabProps) {
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
  const [uploadProgress, setUploadProgress] = useState<BulkUploadProgress | null>(null);
  const [analyzeSession, setAnalyzeSession] = useState<ResumeAnalyzeSession | null>(null);
  const [clearingAnalysis, setClearingAnalysis] = useState(false);
  const [bulkDeleting, setBulkDeleting] = useState(false);
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
  const hasLlmKey = Boolean(
    profile?.openaiApiKey ||
    profile?.deepseekApiKey ||
    profile?.openaiApiKeyConfigured ||
    profile?.deepseekApiKeyConfigured,
  );
  const allFilteredSelected =
    selectableFiltered.length > 0 && selectableFiltered.every((r) => selectedIds.has(r.id));
  const someFilteredSelected = selectableFiltered.some((r) => selectedIds.has(r.id));
  const analyzing =
    analyzeProgress != null ||
    analyzeSession?.status === "running" ||
    analyzeSession?.status === "stopping";
  const stoppingAnalysis = analyzeSession?.status === "stopping";
  const selectedAnalyzedCount = selectedResumes.filter((r) => r.analyzed).length;

  const applyAnalyzeSessionProgress = useCallback(
    (session: ResumeAnalyzeSession) => {
      setAnalyzeSession(session);
      const items = session.progress?.items || session.items || {};
      const failed = Object.entries(items)
        .filter(([, item]) => item.status === "failed")
        .map(([id, item]) => ({
          fileName: resumes.find((resume) => resume.id === id)?.fileName || id,
          error: item.error || "Analysis failed",
        }));
      const completed = Number(session.completed ?? session.progress?.completed ?? 0);
      const failedCount = Number(session.failed ?? session.progress?.failed ?? 0);
      setAnalyzeProgress({
        current: completed + failedCount,
        total: Number(session.total ?? session.progress?.total ?? 0),
        failed,
      });
    },
    [resumes],
  );

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
    const pending = bulkPending;
    setBulkPending(null);
    setUploading(true);
    setError(null);
    setUploadProgress({ current: 0, total: pending.length, failed: [] });
    try {
      const result = await uploadResumesInParallel({
        ownerName,
        ownerId,
        items: pending.map((p) => ({ file: p.file, techStack: p.techStack! })),
        onProgress: setUploadProgress,
      });
      if (result.failed.length) {
        const sample = result.failed
          .slice(0, 3)
          .map((f) => `${f.fileName}: ${f.error}`)
          .join(" · ");
        setError(
          `${result.failed.length} of ${pending.length} file(s) failed to upload.${sample ? ` ${sample}` : ""}`,
        );
      }
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Bulk upload failed");
    } finally {
      setUploadProgress(null);
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
    if (!ownerName || !confirm("Delete this resume permanently? The file and any analysis will be removed.")) return;
    setError(null);
    try {
      await deleteUserResume(id, ownerName);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Delete failed");
    }
  };

  const handleBulkDelete = async () => {
    if (!ownerName || !selectedResumes.length || bulkDeleting || analyzing || uploading) return;

    const toDelete = selectedResumes.filter((r) => r.source !== "generated");
    if (!toDelete.length) {
      setError("Generated resumes are removed from History, not the Uploaded library.");
      return;
    }

    const confirmed = confirm(
      `Permanently delete ${toDelete.length} selected resume(s)? Files and analysis will be removed from Storage and the library.`,
    );
    if (!confirmed) return;

    setError(null);
    setBulkDeleting(true);
    const failed: { fileName: string; error: string }[] = [];

    for (const resume of toDelete) {
      try {
        await deleteUserResume(resume.id, ownerName);
      } catch (err) {
        failed.push({
          fileName: resume.fileName,
          error: err instanceof Error ? err.message : "Delete failed",
        });
      }
    }

    setBulkDeleting(false);
    await refresh();
    clearSelection();

    if (failed.length) {
      const sample = failed
        .slice(0, 3)
        .map((f) => `${f.fileName}: ${f.error}`)
        .join(" · ");
      setError(
        `${failed.length} of ${toDelete.length} resume(s) failed to delete.${sample ? ` ${sample}` : ""}`,
      );
    }
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
    setAnalyzeProgress({ current: 0, total: toAnalyze.length, failed: [] });
    try {
      const started = await startResumeAnalyze({
        applierName: ownerName,
        profileId: ownerId || undefined,
        resumeIds: toAnalyze.map((resume) => resume.id),
        force: alreadyAnalyzed.length > 0,
      });
      applyAnalyzeSessionProgress(started);
      const finished = await waitForResumeAnalyze({
        onProgress: applyAnalyzeSessionProgress,
      });
      const items = finished.progress?.items || finished.items || {};
      const failed = Object.entries(items)
        .filter(([, item]) => item.status === "failed")
        .map(([id, item]) => ({
          fileName: toAnalyze.find((resume) => resume.id === id)?.fileName || id,
          error: item.error || "Analysis failed",
        }));
      if (failed.length) setError(`${failed.length} of ${toAnalyze.length} resume(s) failed to analyze.`);
      else if (finished.status === "cancelled") setError("Resume analysis was stopped.");
      await refresh();
      clearSelection();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Analysis failed");
    } finally {
      setAnalyzeProgress(null);
      setAnalyzeSession(null);
    }
  };

  const handleStopAnalysis = async () => {
    if (!analyzing || stoppingAnalysis) return;
    try {
      const stopped = await stopResumeAnalyze();
      applyAnalyzeSessionProgress(stopped);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to stop analysis");
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

  const librarySegment = (
    <div className="athens-segment" role="group" aria-label="Resume source">
      {(["uploaded", "generated"] as const).map((view) => {
        const active = libraryView === view;
        return (
          <button
            key={view}
            type="button"
            aria-pressed={active}
            onClick={() => setLibraryView(view)}
            className={cn(active && "is-active")}
          >
            <span className="athens-segment__label">{view === "uploaded" ? "Uploaded" : "Generated"}</span>
          </button>
        );
      })}
    </div>
  );

  if (libraryView === "generated") {
    return (
      <GeneratedResumesSection
        onLoadIntoEditor={onLoadIntoEditor}
        pageTabs={pageTabs}
        pageActions={pageActions}
        librarySegment={librarySegment}
      />
    );
  }

  if (!applierReady || loading) {
    return (
      <>
        <div className="athens-toolbar mb-2">
          <div className="athens-surface">
            {pageTabs}
            <div className="athens-toolbar-row">
              {librarySegment}
              <div className="athens-toolbar-actions ml-auto">{pageActions}</div>
            </div>
          </div>
        </div>
        <div className="athens-settings__loading">
          <Loader2 className="size-4 animate-spin" aria-hidden="true" />
          Loading resumes…
        </div>
      </>
    );
  }

  if (!ownerName) {
    return (
      <>
        <div className="athens-toolbar mb-2">
          <div className="athens-surface">
            {pageTabs}
            <div className="athens-toolbar-row">
              {librarySegment}
              <div className="athens-toolbar-actions ml-auto">{pageActions}</div>
            </div>
          </div>
        </div>
        <div className="athens-empty">
          <p className="athens-empty__title">Select an applier to manage resumes.</p>
        </div>
      </>
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
  const showSelectionDock = someFilteredSelected || analyzing || clearingAnalysis || bulkDeleting;

  return (
    <>
      <div className="athens-toolbar mb-2">
        <div className="athens-surface">
          {pageTabs}
          <div className="athens-toolbar-row">
            {librarySegment}
            <div className="athens-field-group">
              <div className="athens-field">
                <Search className="athens-field__icon" aria-hidden="true" />
                <input
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                  placeholder="Search resumes or tech stacks…"
                  aria-label="Search resumes"
                  className="athens-field__input"
                />
                {q ? (
                  <button type="button" onClick={() => setQ("")} className="athens-field__clear" aria-label="Clear search">
                    <X size={12} aria-hidden="true" />
                  </button>
                ) : null}
              </div>
              <div className="athens-field-divider" aria-hidden />
              <label className="athens-field athens-field--company">
                <Filter className="athens-field__icon" aria-hidden="true" />
                <select
                  value={stackFilter}
                  onChange={(e) => setStackFilter(e.target.value)}
                  aria-label="Filter by tech stack"
                  className="athens-field__input"
                >
                  <option value="all">All stacks</option>
                  {stacks.map((s) => (
                    <option key={s} value={s}>{s}</option>
                  ))}
                </select>
              </label>
            </div>
            <div className="athens-toolbar-actions ml-auto">
              <button type="button" disabled={uploading} onClick={() => bulkRef.current?.click()} className="athens-btn">
                <Files size={16} aria-hidden="true" />
                Bulk upload
              </button>
              <button type="button" disabled={uploading} onClick={() => fileRef.current?.click()} className="athens-btn-primary">
                <Upload size={16} aria-hidden="true" />
                Upload
              </button>
              {pageActions}
              <span className="athens-count">{filtered.length}</span>
            </div>
          </div>

          {showSelectionDock ? (
            <div className="athens-dock-row">
              <label className="athens-select-label cursor-pointer">
                <Checkbox
                  checked={allFilteredSelected ? true : someFilteredSelected ? "indeterminate" : false}
                  onCheckedChange={() =>
                    selectAll(
                      selectableFiltered.map((r) => r.id),
                      allFilteredSelected,
                    )
                  }
                  aria-label="Select all visible resumes"
                />
                <span>
                  {selectedIds.size} selected
                </span>
              </label>
              <button type="button" onClick={clearSelection} className="athens-text-btn">
                Clear
              </button>
              <div className="athens-toolbar-actions ml-auto">
                <button
                  type="button"
                  disabled={!hasLlmKey || (!analyzing && selectedIds.size === 0) || uploading || bulkDeleting}
                  onClick={() => void (analyzing ? handleStopAnalysis() : handleBulkAnalyze())}
                  className="athens-btn"
                >
                  {analyzing ? <Loader2 size={16} className="animate-spin" aria-hidden="true" /> : <Sparkles size={16} aria-hidden="true" />}
                  {analyzing
                    ? stoppingAnalysis ? "Stopping analysis…" : "Stop analysis"
                    : `Analyze (${selectedIds.size})`}
                </button>
                <button
                  type="button"
                  disabled={selectedAnalyzedCount === 0 || clearingAnalysis || analyzing || uploading || bulkDeleting}
                  onClick={() => void handleBulkClearAnalysis()}
                  className="athens-btn"
                  title="Remove skill analysis only — keeps the resume file"
                >
                  {clearingAnalysis ? <Loader2 size={16} className="animate-spin" aria-hidden="true" /> : <Eraser size={16} aria-hidden="true" />}
                  Clear analysis
                </button>
                <button
                  type="button"
                  disabled={selectedIds.size === 0 || bulkDeleting || analyzing || uploading || clearingAnalysis}
                  onClick={() => void handleBulkDelete()}
                  className="athens-btn-danger"
                  title="Permanently delete selected resumes (file + analysis)"
                >
                  {bulkDeleting ? <Loader2 size={16} className="animate-spin" aria-hidden="true" /> : <Trash2 size={16} aria-hidden="true" />}
                  Delete
                </button>
              </div>
            </div>
          ) : null}

          {uploadProgress ? (
            <div className="athens-dock-row" role="status" aria-live="polite">
              <div className="athens-progress">
                <div className="athens-progress__meta">
                  <span className="inline-flex items-center gap-2">
                    <Loader2 size={16} className="animate-spin" aria-hidden="true" />
                    Uploading resumes…
                  </span>
                  <span>{uploadProgress.current}/{uploadProgress.total}</span>
                </div>
                <div className="athens-progress__track">
                  <div
                    className="athens-progress__bar"
                    style={{
                      width: `${uploadProgress.total ? (uploadProgress.current / uploadProgress.total) * 100 : 0}%`,
                    }}
                  />
                </div>
                {uploadProgress.failed.length > 0 ? (
                  <ul className="mt-2 max-h-24 space-y-0.5 overflow-y-auto text-xs text-[var(--athens-danger)]">
                    {uploadProgress.failed.map((f) => (
                      <li key={`${f.fileName}-${f.error}`}>
                        {f.fileName}: {f.error}
                      </li>
                    ))}
                  </ul>
                ) : null}
              </div>
            </div>
          ) : null}

          {analyzeProgress ? (
            <div className="athens-dock-row" role="status" aria-live="polite">
              <div className="athens-progress">
                <div className="athens-progress__meta">
                  <span className="inline-flex items-center gap-2">
                    <Loader2 size={16} className="animate-spin" aria-hidden="true" />
                    Analyzing resumes…
                  </span>
                  <span>{analyzeProgress.current}/{analyzeProgress.total}</span>
                </div>
                <div className="athens-progress__track">
                  <div
                    className="athens-progress__bar"
                    style={{ width: `${(analyzeProgress.current / analyzeProgress.total) * 100}%` }}
                  />
                </div>
                {analyzeProgress.failed.length > 0 ? (
                  <ul className="mt-2 space-y-0.5 text-xs text-[var(--athens-danger)]">
                    {analyzeProgress.failed.map((f) => (
                      <li key={f.fileName}>
                        {f.fileName}: {f.error}
                      </li>
                    ))}
                  </ul>
                ) : null}
              </div>
            </div>
          ) : null}

          {error ? (
            <div className="athens-dock-row">
              <div className="athens-callout is-danger flex w-full items-center gap-2 text-sm">
                {error}
              </div>
            </div>
          ) : null}
        </div>
      </div>

      <input ref={fileRef} type="file" accept=".pdf,.doc,.docx,.txt" className="hidden" onChange={(e) => handleSingleFilePick(e.target.files)} />
      <input ref={bulkRef} type="file" /* @ts-expect-error webkitdirectory */ webkitdirectory="" multiple className="hidden" onChange={(e) => handleBulkPick(e.target.files)} />

      {filtered.length === 0 ? (
        <div className="athens-empty">
          <Upload size={28} aria-hidden="true" />
          <p className="athens-empty__title">No resumes uploaded yet</p>
          <p className="athens-empty__copy">Upload a PDF or DOCX, name its tech stack, or bulk-upload a folder of stack subfolders.</p>
        </div>
      ) : (
        <div className="athens-card-grid">
          {filtered.map((r) => {
            const selectable = r.source !== "generated";
            const selected = selectable && selectedIds.has(r.id);
            return (
            <article
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
              className={cn("athens-card", selected && "is-selected", selectable && "cursor-pointer")}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="athens-card-chips">
                  {selected ? <span className="athens-status">Selected</span> : null}
                  {r.isPrimary ? <span className="athens-status">Primary</span> : null}
                  {r.source === "generated" ? (
                    <span className="athens-status">Generated</span>
                  ) : r.analyzed ? (
                    <span className="athens-status">Analyzed</span>
                  ) : (
                    <span className="athens-status">Not analyzed</span>
                  )}
                  <span className="athens-chip">{r.techStack}</span>
                </div>
              </div>
              <h3 className="athens-card-title truncate" title={r.fileName}>{r.fileName}</h3>
              <p className="athens-card-meta">
                {(r.sizeBytes / 1024).toFixed(0)} KB
                <span aria-hidden="true">·</span>
                {formatDistanceToNow(new Date(r.uploadedAt), { addSuffix: true })}
                {r.analyzed && r.skillCount != null ? (
                  <>
                    <span aria-hidden="true">·</span>
                    {r.skillCount} skills
                  </>
                ) : null}
              </p>
              <div className="athens-card-footer">
                <div className="athens-card-tools">
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      setPreviewResume(r);
                    }}
                    className="athens-icon-btn"
                    title="Preview"
                    aria-label="Preview"
                  >
                    <Eye size={16} aria-hidden="true" />
                  </button>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      void handleDownload(r.id, r.fileName);
                    }}
                    className="athens-icon-btn"
                    title="Download"
                    aria-label="Download"
                  >
                    <Download size={16} aria-hidden="true" />
                  </button>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      void handleSetPrimary(r.id);
                    }}
                    className="athens-icon-btn"
                    title="Set primary"
                    aria-label="Set primary"
                  >
                    <Star size={16} aria-hidden="true" />
                  </button>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      void handleDelete(r.id);
                    }}
                    className="athens-icon-btn"
                    title="Delete"
                    aria-label="Delete"
                  >
                    <Trash2 size={16} aria-hidden="true" />
                  </button>
                </div>
              </div>
            </article>
            );
          })}
        </div>
      )}

      <Dialog open={Boolean(pendingFile)} onOpenChange={(open) => !open && setPendingFile(null)}>
        <DialogContent className="athens-ui athens-dialog flex flex-col gap-0 overflow-hidden p-0 sm:max-w-lg">
          <DialogHeader className="athens-dialog-header">
            <DialogTitle className="athens-settings__title">Name this resume&apos;s tech stack</DialogTitle>
          </DialogHeader>
          <div className="athens-dialog-body space-y-4">
            <p className="athens-settings__lede">
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
          </div>
          <DialogFooter className="athens-dialog-footer">
            <button type="button" onClick={() => setPendingFile(null)} className="athens-btn">Cancel</button>
            <button
              type="button"
              disabled={!techStackInput.trim() || uploading}
              onClick={() => void confirmSingleUpload()}
              className="athens-btn-primary"
            >
              {uploading ? "Uploading…" : "Upload"}
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(bulkPending)} onOpenChange={(open) => !open && setBulkPending(null)}>
        <DialogContent className="athens-ui athens-dialog flex flex-col gap-0 overflow-hidden p-0 sm:max-w-lg">
          <DialogHeader className="athens-dialog-header">
            <DialogTitle className="athens-settings__title">Confirm bulk upload</DialogTitle>
          </DialogHeader>
          <div className="athens-dialog-body space-y-3">
            <p className="athens-settings__lede">
              {bulkPending?.length} files across {bulkSummary.length} tech stack(s):
            </p>
            <ul className="max-h-48 space-y-1 overflow-y-auto text-sm">
              {bulkSummary.map(([stack, count]) => (
                <li key={stack}><strong>{stack}</strong> — {count} file(s)</li>
              ))}
            </ul>
          </div>
          <DialogFooter className="athens-dialog-footer">
            <button type="button" onClick={() => setBulkPending(null)} className="athens-btn">Cancel</button>
            <button type="button" disabled={uploading} onClick={() => void confirmBulkUpload()} className="athens-btn-primary">
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
  );
}
