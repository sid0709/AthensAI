import { formatDistanceToNow } from "date-fns";
import { Eye, Loader2, Sparkles, Wand2, Search, X } from "lucide-react";
import { BUILTIN_TEMPLATES, DEFAULT_SECTIONS, DEFAULT_THEME } from "../../../data/resumes/seedDocument";
import { fetchGenerationDetail, fetchGenerationHistory } from "../../../services/resumeApi";
import type { HistoryRunSummary } from "../../../types/resume";
import { detailToFullRun } from "../generator/detail-to-full-run";
import type { FullRun } from "../generator/history/history-types";
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { useApplier } from "@/context/applier-context";
import { ResumePreview } from "./preview/ResumePreview";
import { sectionsToDocument } from "../lib/sectionsToDocument";
import type { GeneratorIdentity } from "../../../types/resume";
import { resolveTemplateId } from "../lib/templates";

type GeneratedResumesSectionProps = {
  onLoadIntoEditor?: (run: FullRun) => void;
  pageTabs?: ReactNode;
  pageActions?: ReactNode;
  librarySegment?: ReactNode;
};

export function GeneratedResumesSection({
  onLoadIntoEditor,
  pageTabs,
  pageActions,
  librarySegment,
}: GeneratedResumesSectionProps) {
  const { applier, applierReady } = useApplier();
  const [q, setQ] = useState("");
  const [runs, setRuns] = useState<HistoryRunSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewDetail, setPreviewDetail] = useState<Awaited<ReturnType<typeof fetchGenerationDetail>> | null>(null);
  const [loadingPreview, setLoadingPreview] = useState(false);

  const ownerName = applier?.name ?? "";

  const refresh = useCallback(async () => {
    if (!ownerName) {
      setRuns([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const data = await fetchGenerationHistory({
        applierName: ownerName,
        status: "completed",
        limit: 100,
        sort: "newest",
        search: q || undefined,
      });
      setRuns(data.runs);
      if (!selectedId && data.runs.length) setSelectedId(data.runs[0].id);
    } catch {
      setRuns([]);
    } finally {
      setLoading(false);
    }
  }, [ownerName, q, selectedId]);

  useEffect(() => {
    if (!applierReady) return;
    void refresh();
  }, [applierReady, refresh]);

  const openPreview = async (id: string) => {
    if (!ownerName) return;
    setSelectedId(id);
    setPreviewOpen(true);
    setLoadingPreview(true);
    try {
      setPreviewDetail(await fetchGenerationDetail(id, ownerName));
    } catch {
      setPreviewDetail(null);
    } finally {
      setLoadingPreview(false);
    }
  };

  const handleLoad = async (id: string) => {
    if (!ownerName || !onLoadIntoEditor) return;
    const detail = await fetchGenerationDetail(id, ownerName);
    onLoadIntoEditor(detailToFullRun(detail));
  };

  if (!applierReady || loading) {
    return (
      <div className="athens-toolbar mb-2">
        <div className="athens-surface">
          {pageTabs}
          <div className="athens-toolbar-row">
            {librarySegment}
            <div className="athens-toolbar-actions ml-auto">{pageActions}</div>
          </div>
          <div className="athens-settings__loading">
            <Loader2 className="size-4 animate-spin" aria-hidden="true" />
            Loading generated resumes…
          </div>
        </div>
      </div>
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
          <p className="athens-empty__title">Select an applier to view generated resumes.</p>
        </div>
      </>
    );
  }

  const previewDoc =
    previewDetail?.sections && previewDetail.identity
      ? sectionsToDocument(
          previewDetail.sections as Parameters<typeof sectionsToDocument>[0],
          previewDetail.identity as GeneratorIdentity,
        )
      : null;

  const previewTemplateId = resolveTemplateId(
    previewDetail?.templateId ?? (previewDetail?.config as { templateId?: string })?.templateId,
  );

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
                  placeholder="Search job descriptions…"
                  aria-label="Search generated resumes"
                  className="athens-field__input"
                />
                {q ? (
                  <button type="button" onClick={() => setQ("")} className="athens-field__clear" aria-label="Clear search">
                    <X size={12} aria-hidden="true" />
                  </button>
                ) : null}
              </div>
            </div>
            <div className="athens-toolbar-actions ml-auto">
              {pageActions}
              <span className="athens-count">{runs.length}</span>
            </div>
          </div>
        </div>
      </div>

      {runs.length === 0 ? (
        <div className="athens-empty">
          <Wand2 size={28} aria-hidden="true" />
          <p className="athens-empty__title">No generated resumes yet</p>
          <p className="athens-empty__copy">
            Use the Editor to generate a tailored resume. Skills are extracted automatically — no separate analysis step needed.
          </p>
        </div>
      ) : (
        <div className="athens-card-grid">
          {runs.map((run) => (
            <article key={run.id} className="athens-card">
              <div className="athens-card-chips">
                <span className="athens-status">
                  <Sparkles size={12} aria-hidden="true" />
                  Skills extracted
                </span>
                {run.templateId ? (
                  <span className="athens-chip">
                    {BUILTIN_TEMPLATES.find((t) => t.id === resolveTemplateId(run.templateId))?.name ?? run.templateId}
                  </span>
                ) : null}
              </div>
              <h3 className="athens-card-title truncate" title={run.jobTitle ?? "Generated resume"}>
                {run.jobTitle ?? "Generated resume"}
              </h3>
              <p className="line-clamp-2 min-h-[2.5rem] text-sm text-[var(--athens-text-secondary)]">{run.jobDescription}</p>
              <p className="athens-card-meta">
                {formatDistanceToNow(new Date(run.createdAt), { addSuffix: true })}
                <span aria-hidden="true">·</span>
                {run.model}
                <span aria-hidden="true">·</span>
                {run.tokens.toLocaleString()} tok
              </p>
              <div className="athens-card-footer">
                {onLoadIntoEditor ? (
                  <button
                    type="button"
                    onClick={() => void handleLoad(run.id)}
                    className="athens-btn"
                  >
                    <Wand2 size={16} aria-hidden="true" />
                    Open in editor
                  </button>
                ) : <span />}
                <div className="athens-card-actions">
                  <button
                    type="button"
                    onClick={() => void openPreview(run.id)}
                    className="athens-icon-btn"
                    title="Preview"
                    aria-label="Preview"
                  >
                    <Eye size={16} aria-hidden="true" />
                  </button>
                </div>
              </div>
            </article>
          ))}
        </div>
      )}

      {previewOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50" onClick={() => setPreviewOpen(false)}>
          <div
            className="athens-ui athens-dialog flex max-h-[90vh] w-full max-w-4xl flex-col overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="athens-dialog-header flex items-center justify-between">
              <h3 className="athens-settings__title">Generated resume preview</h3>
              <button type="button" onClick={() => setPreviewOpen(false)} className="athens-btn">
                Close
              </button>
            </div>
            <div className="athens-dialog-body bg-[var(--athens-surface-subtle)]">
              {loadingPreview ? (
                <div className="athens-settings__loading py-16">
                  <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                </div>
              ) : previewDoc ? (
                <ResumePreview
                  document={previewDoc}
                  templateId={previewTemplateId}
                  theme={(previewDetail?.config as { theme?: typeof DEFAULT_THEME })?.theme ?? DEFAULT_THEME}
                  sections={DEFAULT_SECTIONS}
                  generatorIdentity={previewDetail?.identity as GeneratorIdentity}
                  fitToColumn
                />
              ) : (
                <p className="athens-empty__copy py-16 text-center">Preview unavailable.</p>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
