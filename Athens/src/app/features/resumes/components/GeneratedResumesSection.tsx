import { formatDistanceToNow } from "date-fns";
import { Eye, Loader2, Sparkles, Wand2 } from "lucide-react";
import { Badge } from "../../../components/ui";
import { SearchField } from "../../../components/shared/SearchField";
import { BUILTIN_TEMPLATES, DEFAULT_SECTIONS, DEFAULT_THEME } from "../../../data/resumes/seedDocument";
import { fetchGenerationDetail, fetchGenerationHistory } from "../../../services/resumeApi";
import type { HistoryRunSummary } from "../../../types/resume";
import { detailToFullRun } from "../generator/detail-to-full-run";
import { useCallback, useEffect, useState } from "react";
import { useApplier } from "@/context/applier-context";
import { ResumePreview } from "./preview/ResumePreview";
import { sectionsToDocument } from "../lib/sectionsToDocument";
import type { GeneratorIdentity } from "../../../types/resume";
import { resolveTemplateId } from "../lib/templates";

type GeneratedResumesSectionProps = {
  onLoadIntoEditor?: (run: FullRun) => void;
};

export function GeneratedResumesSection({ onLoadIntoEditor }: GeneratedResumesSectionProps) {
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
      <div className="flex items-center justify-center h-64 text-muted-foreground text-sm gap-2">
        <Loader2 className="w-5 h-5 animate-spin" />
        Loading generated resumes…
      </div>
    );
  }

  if (!ownerName) {
    return (
      <div className="flex items-center justify-center h-64 text-muted-foreground text-sm">
        Select an applier to view generated resumes.
      </div>
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
      <div className="flex items-center gap-3 mb-6 flex-wrap">
        <SearchField value={q} onChange={setQ} placeholder="Search job descriptions…" className="flex-1 max-w-md" />
        <span className="text-sm text-muted-foreground ml-auto">{runs.length} generated</span>
      </div>

      {runs.length === 0 ? (
        <div className="flex flex-col items-center justify-center h-64 text-center px-4 border border-dashed border-border rounded-xl">
          <Wand2 className="w-10 h-10 text-muted-foreground/40 mb-3" />
          <p className="font-bold text-foreground">No generated resumes yet</p>
          <p className="text-sm text-muted-foreground mt-1 max-w-md">
            Use the Editor to generate a tailored resume. Skills are extracted automatically — no separate analysis step needed.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-5">
          {runs.map((run) => (
            <div key={run.id} className="bg-card border border-border rounded-xl p-5 hover:shadow-md transition-all shadow-sm">
              <div className="flex items-start justify-between mb-4">
                <div className="w-12 h-12 rounded-xl bg-violet-500/10 flex items-center justify-center">
                  <Sparkles className="w-6 h-6 text-violet-600" />
                </div>
                <div className="flex items-center gap-2 flex-wrap justify-end">
                  <Badge v="success">Skills extracted</Badge>
                  {run.templateId && (
                    <Badge v="blue">
                      {BUILTIN_TEMPLATES.find((t) => t.id === resolveTemplateId(run.templateId))?.name ?? run.templateId}
                    </Badge>
                  )}
                </div>
              </div>
              <p className="text-base font-bold text-foreground mb-1 truncate" title={run.jobTitle ?? "Generated resume"}>
                {run.jobTitle ?? "Generated resume"}
              </p>
              <p className="text-sm text-muted-foreground line-clamp-2 mb-3 min-h-[2.5rem]">{run.jobDescription}</p>
              <p className="text-xs text-muted-foreground mb-4">
                {formatDistanceToNow(new Date(run.createdAt), { addSuffix: true })} · {run.model} · {run.tokens.toLocaleString()} tok
              </p>
              <div className="flex items-center justify-between gap-2">
                {onLoadIntoEditor && (
                  <button
                    type="button"
                    onClick={() => void handleLoad(run.id)}
                    className="flex items-center gap-1.5 text-xs font-bold text-primary hover:underline"
                  >
                    <Wand2 className="w-3.5 h-3.5" />
                    Open in editor
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => void openPreview(run.id)}
                  className="icon-btn w-9 h-9 text-muted-foreground hover:text-primary ml-auto"
                  title="Preview"
                >
                  <Eye className="w-4 h-4" />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {previewOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50" onClick={() => setPreviewOpen(false)}>
          <div
            className="bg-card border border-border rounded-xl max-w-4xl w-full max-h-[90vh] overflow-hidden flex flex-col shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="p-4 border-b border-border flex items-center justify-between">
              <h3 className="font-bold text-foreground">Generated resume preview</h3>
              <button type="button" onClick={() => setPreviewOpen(false)} className="text-sm font-semibold text-muted-foreground hover:text-foreground">
                Close
              </button>
            </div>
            <div className="flex-1 overflow-auto p-4 bg-secondary/20">
              {loadingPreview ? (
                <div className="flex justify-center py-16">
                  <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
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
                <p className="text-center text-sm text-muted-foreground py-16">Preview unavailable.</p>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
