import { formatDistanceToNow } from "date-fns";
import { CheckCircle, Clock, Coins, Hash, Wand2, Loader2 } from "lucide-react";
import { KPI, Pill, Badge } from "../../../components/ui";
import { AthensSelect } from "../../../components/forms";
import { SearchField } from "../../../components/shared/SearchField";
import { cn } from "../../../lib/utils";
import { useResumeHistory } from "../hooks/useResumeHistory";
import { ResumePreview } from "./preview/ResumePreview";
import { BUILTIN_TEMPLATES, DEFAULT_SECTIONS, DEFAULT_THEME } from "../../../data/resumes/seedDocument";
import type { EditorDraft } from "../../../types/resume";
import { resolveTemplateId } from "../lib/templates";

type ResumeHistoryTabProps = {
  onLoadIntoEditor?: (payload: { config: Partial<EditorDraft>; sections?: Record<string, unknown> }) => void;
};

export function ResumeHistoryTab({ onLoadIntoEditor }: ResumeHistoryTabProps) {
  const history = useResumeHistory();
  const {
    loading,
    stats,
    filtered,
    selected,
    selectedDetail,
    detailDocument,
    filters,
    setFilters,
    setSelectedId,
    models,
    providers,
    templates,
  } = history;

  const templateId = resolveTemplateId(
    selected?.templateId ?? (selectedDetail?.config as { templateId?: string } | undefined)?.templateId,
  );
  const previewTheme = (selectedDetail?.config as { theme?: typeof DEFAULT_THEME })?.theme ?? DEFAULT_THEME;

  const handleLoad = () => {
    if (!selectedDetail || !onLoadIntoEditor) return;
    const cfg = (selectedDetail.config ?? {}) as Partial<EditorDraft>;
    onLoadIntoEditor({
      config: {
        ...cfg,
        jobDescription: selectedDetail.jobDescription,
        provider: selectedDetail.provider,
        model: selectedDetail.model,
        templateId: resolveTemplateId(selectedDetail.templateId ?? cfg.templateId),
        generatorIdentity: selectedDetail.identity,
      },
      sections: selectedDetail.sections,
    });
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64 text-muted-foreground gap-2">
        <Loader2 className="w-5 h-5 animate-spin" />
        Loading history…
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <KPI label="Completed" value={String(stats.completed)} icon={CheckCircle} accent="emerald" />
        <KPI label="Total tokens" value={stats.totalTokens.toLocaleString()} icon={Hash} accent="violet" />
        <KPI label="Total spend" value={`$${stats.totalSpend.toFixed(4)}`} icon={Coins} accent="blue" />
        <KPI label="In view" value={String(stats.inView)} icon={Clock} accent="amber" />
      </div>

      <div className="bg-card border border-border rounded-xl p-4 space-y-3 shadow-sm">
        <SearchField
          value={filters.search}
          onChange={(search) => setFilters({ ...filters, search })}
          placeholder="Search job descriptions…"
          className="max-w-xl"
        />
        <div className="flex flex-wrap gap-2 items-center">
          {(["all", "completed", "failed"] as const).map((st) => (
            <Pill key={st} active={filters.status === st} onClick={() => setFilters({ ...filters, status: st })}>
              {st === "all" ? "All runs" : st.charAt(0).toUpperCase() + st.slice(1)}
            </Pill>
          ))}
        </div>
        <div className="flex flex-wrap gap-3">
          <AthensSelect label="Model" value={filters.model} onChange={(model) => setFilters({ ...filters, model })} options={["all", ...models].map((o) => ({ value: o, label: o === "all" ? "All" : o }))} className="min-w-[140px]" />
          <AthensSelect label="Provider" value={filters.provider} onChange={(provider) => setFilters({ ...filters, provider })} options={["all", ...providers].map((o) => ({ value: o, label: o === "all" ? "All" : o }))} className="min-w-[140px]" />
          <AthensSelect label="Template" value={filters.templateId} onChange={(templateId) => setFilters({ ...filters, templateId })} options={["all", ...templates].map((o) => ({ value: o, label: o === "all" ? "All" : o }))} className="min-w-[140px]" />
          <AthensSelect
            label="Sort"
            value={filters.sort}
            onChange={(sort) => setFilters({ ...filters, sort: sort as "newest" | "oldest" })}
            options={[
              { value: "newest", label: "Newest first" },
              { value: "oldest", label: "Oldest first" },
            ]}
            className="min-w-[140px]"
          />
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[340px_1fr] gap-4 min-h-[480px]">
        <div className="bg-card border border-border rounded-xl overflow-hidden shadow-sm">
          <div className="overflow-y-auto max-h-[560px] subtle-scroll">
            {filtered.length === 0 ? (
              <p className="p-8 text-center text-sm text-muted-foreground">No generation runs yet. Use the Editor to generate a tailored resume.</p>
            ) : (
              filtered.map((run) => (
                <button
                  key={run.id}
                  type="button"
                  onClick={() => setSelectedId(run.id)}
                  className={cn(
                    "w-full text-left p-4 border-b border-border hover:bg-secondary/50 transition-colors",
                    selected?.id === run.id && "bg-primary/5 border-l-2 border-l-primary",
                  )}
                >
                  <p className="text-sm font-bold text-foreground truncate">{run.jobTitle ?? "Untitled role"}</p>
                  <p className="text-xs text-muted-foreground line-clamp-2 mt-1">{run.jobDescription}</p>
                  <div className="flex flex-wrap gap-1.5 mt-2">
                    <Badge v="subtle">{run.model}</Badge>
                    <Badge v="subtle">{run.provider}</Badge>
                    {run.templateId && (
                      <Badge v="blue">
                        {BUILTIN_TEMPLATES.find((t) => t.id === resolveTemplateId(run.templateId))?.name ?? run.templateId}
                      </Badge>
                    )}
                  </div>
                  <div className="flex items-center gap-3 mt-2 text-xs text-muted-foreground">
                    <span>{formatDistanceToNow(new Date(run.createdAt), { addSuffix: true })}</span>
                    <span>{run.tokens.toLocaleString()} tok</span>
                    <span>${run.costUsd.toFixed(4)}</span>
                    <Badge v={run.status === "completed" ? "success" : run.status === "failed" ? "err" : "warn"}>{run.status}</Badge>
                  </div>
                </button>
              ))
            )}
          </div>
        </div>

        <div className="bg-card border border-border rounded-xl overflow-hidden shadow-sm flex flex-col">
          {selected ? (
            <>
              <div className="p-4 border-b border-border space-y-2 flex-shrink-0">
                <div className="flex items-start justify-between gap-3">
                  <h3 className="text-base font-bold text-foreground">{selected.jobTitle ?? "Generation run"}</h3>
                  {onLoadIntoEditor && selectedDetail && selected.status === "completed" && (
                    <button
                      type="button"
                      onClick={handleLoad}
                      className="flex items-center gap-1.5 text-xs font-bold text-primary hover:underline shrink-0"
                    >
                      <Wand2 className="w-3.5 h-3.5" />
                      Load into editor
                    </button>
                  )}
                </div>
                <p className="text-xs text-muted-foreground line-clamp-3">{selected.jobDescription}</p>
                <div className="flex gap-4 text-xs text-muted-foreground">
                  <span>{selected.tokens.toLocaleString()} tokens</span>
                  <span>${selected.costUsd.toFixed(4)}</span>
                  <span>{selected.model} · {selected.provider}</span>
                </div>
              </div>
              <div className="flex-1 overflow-auto p-4 subtle-scroll min-h-0">
                {detailDocument ? (
                  <ResumePreview
                    document={detailDocument}
                    templateId={templateId}
                    theme={previewTheme}
                    sections={DEFAULT_SECTIONS}
                    generatorIdentity={selectedDetail?.identity ?? undefined}
                    fitToColumn
                  />
                ) : (
                  <p className="text-sm text-muted-foreground self-center">Preview unavailable for this run.</p>
                )}
              </div>
            </>
          ) : (
            <div className="flex-1 flex items-center justify-center p-8 text-center text-muted-foreground">
              <p className="text-sm">Select a run from the list to preview the resume.</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
