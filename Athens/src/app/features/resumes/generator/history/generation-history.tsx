import { useEffect, useMemo, useState, type MouseEvent } from "react";
import { AlertTriangle, Briefcase, CheckCircle2, ChevronLeft, ChevronRight, Clock, Coins, Download, Eye, FileText, Filter, Loader2, Search, SlidersHorizontal, Sparkles, Trash2, Wand2, X } from "lucide-react";
import { useApi } from "@/api/useApi";
import { API_BASE } from "@/lib/api-base";
import { deleteGenerationRun, downloadGenerationPdf } from "../../../../services/resumeApi";
import { templateById } from "../constants/templates";
import { defaultConfig, defaultTheme } from "../constants/defaults";
import { ResumePreview } from "../preview/resume-preview";
import { normalizeGenerated } from "../utils/content";
import { fmtCost, fmtRelative, fmtTokens } from "../utils/format";
import { usageTokenLabels } from "../../../agents/lib/runUsage";
import { cardCls } from "../styles";
import type { FullRun, HistoryFacets, HistorySearchIn, HistorySort, HistoryStatus, LayoutSection, ResumeTheme, RunSummary } from "./history-types";
import { HISTORY_PER_PAGE, HISTORY_SORTS, idStr, jdHeadline, resumeSummarySnippet } from "./history-helpers";
import { EditorCard } from "../components/editor-ui";
import { GenerationSkillAnalysis } from "./generation-skill-analysis";

export function HistoryFilterSelect({
  label,
  value,
  onChange,
  options,
  allLabel = "All",
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: string[];
  allLabel?: string;
}) {
  return (
    <label className="block">
      <span className="text-[10px] uppercase tracking-[0.14em] text-neutral-400 dark:text-white/40 mb-1 block">{label}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full h-9 px-2.5 rounded-lg bg-neutral-50 dark:bg-white/5 border border-neutral-200 dark:border-white/10 text-xs outline-none focus:border-neutral-900 dark:focus:border-white/30"
      >
        <option value="">{allLabel}</option>
        {options.map((o) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
      </select>
    </label>
  );
}

export function GenerationHistory({ applierName, onLoad }: { applierName: string | null; onLoad: (run: FullRun) => void }) {
  const { get } = useApi(API_BASE);
  const [runs, setRuns] = useState<RunSummary[]>([]);
  const [total, setTotal] = useState(0);
  const [facets, setFacets] = useState<HistoryFacets | null>(null);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState<FullRun | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [detailTab, setDetailTab] = useState<"preview" | "jd" | "usage" | "analysis">("preview");

  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [searchIn, setSearchIn] = useState<HistorySearchIn>("all");
  const [status, setStatus] = useState<HistoryStatus>("completed");
  const [model, setModel] = useState("");
  const [provider, setProvider] = useState("");
  const [templateId, setTemplateId] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [sort, setSort] = useState<HistorySort>("newest");
  const [page, setPage] = useState(1);
  const [filtersOpen, setFiltersOpen] = useState(true);

  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search.trim()), 350);
    return () => clearTimeout(t);
  }, [search]);

  useEffect(() => {
    setPage(1);
  }, [debouncedSearch, searchIn, status, model, provider, templateId, dateFrom, dateTo, sort, applierName]);

  const activeFilterCount = [model, provider, templateId, dateFrom, dateTo].filter(Boolean).length + (status !== "completed" ? 1 : 0);

  const clearFilters = () => {
    setStatus("completed");
    setModel("");
    setProvider("");
    setTemplateId("");
    setDateFrom("");
    setDateTo("");
    setSort("newest");
    setSearch("");
  };

  const queryString = useMemo(() => {
    if (!applierName) return "";
    const p = new URLSearchParams();
    p.set("applierName", applierName);
    p.set("limit", String(HISTORY_PER_PAGE));
    p.set("offset", String((page - 1) * HISTORY_PER_PAGE));
    p.set("sort", sort);
    p.set("status", status);
    p.set("includeFacets", page === 1 ? "1" : "0");
    if (debouncedSearch) {
      p.set("search", debouncedSearch);
      p.set("searchIn", searchIn);
    }
    if (model) p.set("model", model);
    if (provider) p.set("provider", provider);
    if (templateId) p.set("templateId", templateId);
    if (dateFrom) p.set("from", dateFrom);
    if (dateTo) p.set("to", dateTo);
    return p.toString();
  }, [applierName, page, sort, status, debouncedSearch, searchIn, model, provider, templateId, dateFrom, dateTo]);

  useEffect(() => {
    if (!applierName || !queryString) {
      setRuns([]);
      setTotal(0);
      return;
    }
    let cancelled = false;
    setLoading(true);
    get(`/personal/resume-generations?${queryString}`)
      .then((r) => {
        if (cancelled) return;
        const res = r as {
          runs?: RunSummary[];
          total?: number;
          facets?: HistoryFacets;
        };
        setRuns(res.runs ?? []);
        setTotal(res.total ?? 0);
        if (res.facets) setFacets(res.facets);
      })
      .catch(() => {
        if (!cancelled) {
          setRuns([]);
          setTotal(0);
        }
      })
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [applierName, queryString, get, refreshKey]);

  const totalPages = Math.max(1, Math.ceil(total / HISTORY_PER_PAGE));

  const openRun = (id: string) => {
    if (!applierName) return;
    setLoadingDetail(true);
    setSelected(null);
    setDetailTab("preview");
    get(`/personal/resume-generations/${id}?applierName=${encodeURIComponent(applierName)}`)
      .then((r) => setSelected((r as { run?: FullRun })?.run ?? null))
      .catch(() => setSelected(null))
      .finally(() => setLoadingDetail(false));
  };

  const handleDelete = async (id: string, e?: MouseEvent) => {
    e?.stopPropagation();
    if (!applierName || deletingId) return;
    if (!confirm("Delete this generated resume from history and the library?")) return;
    setDeletingId(id);
    try {
      await deleteGenerationRun(id, applierName);
      if (selected && idStr(selected._id) === id) setSelected(null);
      setRefreshKey((k) => k + 1);
    } catch {
      /* ignore */
    } finally {
      setDeletingId(null);
    }
  };

  const handleDownloadPdf = async () => {
    if (!selected?.sections || downloadingId) return;
    const id = idStr(selected._id);
    if (!id) return;
    const fallback =
      String(selected.identity?.fullName || applierName || "Resume")
        .replace(/[^\w.\-()+ ]+/g, "_")
        .trim() || "Resume";
    setDownloadingId(id);
    try {
      await downloadGenerationPdf(id, `${fallback}.pdf`);
    } catch (e) {
      alert(e instanceof Error ? e.message : "PDF download failed");
    } finally {
      setDownloadingId(null);
    }
  };

  if (!applierName) {
    return (
      <div className={`${cardCls} flex flex-col items-center justify-center py-16 text-center`}>
        <FileText className="w-10 h-10 text-neutral-300 dark:text-white/20 mb-3" />
        <p className="text-sm text-neutral-500 dark:text-white/50">Select an applier to browse saved resumes.</p>
      </div>
    );
  }

  const cfg = (selected?.config ?? {}) as Record<string, unknown>;
  const detailTemplate = templateById(String(cfg.templateId ?? "classic"));
  const detailTheme = { ...defaultTheme(), ...((cfg.theme as Partial<ResumeTheme>) ?? {}) };
  const detailLayout = Array.isArray(cfg.layout) && (cfg.layout as LayoutSection[]).length ? (cfg.layout as LayoutSection[]) : defaultConfig().layout;
  const detailGenerated = selected ? normalizeGenerated(selected.sections) : null;
  const stats = facets?.stats;

  return (
    <div className="space-y-4">
      {/* Stats strip */}
      {stats && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {[
            { label: "Completed", value: stats.completed.toLocaleString(), icon: CheckCircle2, tone: "text-emerald-600 dark:text-emerald-300" },
            { label: "Total tokens", value: fmtTokens(stats.totalTokens), icon: Sparkles, tone: "text-sky-600 dark:text-sky-300" },
            { label: "Total spend", value: fmtCost(stats.totalCost), icon: Coins, tone: "text-amber-600 dark:text-amber-300" },
            { label: "In view", value: total.toLocaleString(), icon: Filter, tone: "text-neutral-700 dark:text-white/80" },
          ].map(({ label, value, icon: Icon, tone }) => (
            <div key={label} className="rounded-2xl bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-white/10 p-4">
              <div className="flex items-center gap-2 mb-1">
                <Icon className={`w-3.5 h-3.5 ${tone}`} />
                <span className="text-[10px] uppercase tracking-[0.14em] text-neutral-400 dark:text-white/40">{label}</span>
              </div>
              <div className={`text-lg font-semibold tabular-nums ${tone}`}>{value}</div>
            </div>
          ))}
        </div>
      )}

      {/* Search + filter toolbar */}
      <div className="rounded-2xl bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-white/10 shadow-sm overflow-hidden">
        <div className="p-3 sm:p-4 space-y-3">
          <div className="flex flex-col lg:flex-row lg:items-center gap-3">
            <div className="relative flex-1 min-w-0">
              <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-neutral-400 dark:text-white/40" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder={
                  searchIn === "jd"
                    ? "Search job descriptions…"
                    : searchIn === "resume"
                      ? "Search resume content (summary, skills, experience)…"
                      : "Search job descriptions and resume content…"
                }
                className="w-full pl-9 pr-9 h-10 rounded-xl bg-neutral-50 dark:bg-white/5 border border-neutral-200 dark:border-white/10 text-sm outline-none focus:border-neutral-900 dark:focus:border-white/30"
              />
              {search && (
                <button type="button" onClick={() => setSearch("")} className="absolute right-3 top-1/2 -translate-y-1/2 text-neutral-400 hover:text-neutral-700 dark:hover:text-white/70">
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>

            <div className="flex items-center gap-1.5 p-1 rounded-xl bg-neutral-100 dark:bg-white/5 shrink-0">
              {([
                { id: "all" as const, label: "All" },
                { id: "jd" as const, label: "JD" },
                { id: "resume" as const, label: "Resume" },
              ]).map((s) => (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => setSearchIn(s.id)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-medium transition ${
                    searchIn === s.id
                      ? "bg-white dark:bg-neutral-800 text-neutral-900 dark:text-white shadow-sm"
                      : "text-neutral-500 dark:text-white/50 hover:text-neutral-800 dark:hover:text-white/80"
                  }`}
                >
                  {s.label}
                </button>
              ))}
            </div>

            <button
              type="button"
              onClick={() => setFiltersOpen((o) => !o)}
              className={`inline-flex items-center gap-2 px-3.5 h-10 rounded-xl border text-sm shrink-0 transition ${
                filtersOpen || activeFilterCount > 0
                  ? "border-neutral-900 dark:border-white bg-neutral-900 dark:bg-white text-white dark:text-neutral-900"
                  : "border-neutral-200 dark:border-white/10 hover:border-neutral-300 dark:hover:border-white/20"
              }`}
            >
              <SlidersHorizontal className="w-4 h-4" />
              Filters
              {activeFilterCount > 0 && (
                <span className="text-[10px] tabular-nums px-1.5 py-0.5 rounded-md bg-white/20 dark:bg-neutral-900/20">{activeFilterCount}</span>
              )}
            </button>
          </div>

          {/* Status chips */}
          <div className="flex flex-wrap items-center gap-2">
            {([
              { id: "all" as const, label: "All runs", count: (facets?.statusCounts.completed ?? 0) + (facets?.statusCounts.failed ?? 0) },
              { id: "completed" as const, label: "Completed", count: facets?.statusCounts.completed },
              { id: "failed" as const, label: "Failed", count: facets?.statusCounts.failed },
            ]).map((s) => {
              const active = status === s.id;
              return (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => setStatus(s.id)}
                  className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-full border text-xs transition ${
                    active
                      ? "border-sky-500 bg-sky-50 text-sky-800 dark:bg-sky-500/15 dark:text-sky-200 dark:border-sky-500/50"
                      : "border-neutral-200 dark:border-white/10 text-neutral-600 dark:text-white/60 hover:border-neutral-300 dark:hover:border-white/20"
                  }`}
                >
                  {s.label}
                  {typeof s.count === "number" && (
                    <span className={`tabular-nums px-1.5 py-0.5 rounded-md text-[10px] ${active ? "bg-sky-100 dark:bg-sky-900/40" : "bg-neutral-100 dark:bg-white/10"}`}>
                      {s.count}
                    </span>
                  )}
                </button>
              );
            })}

            <div className="ml-auto flex items-center gap-2">
              <select
                value={sort}
                onChange={(e) => setSort(e.target.value as HistorySort)}
                className="h-8 px-2.5 rounded-lg bg-neutral-50 dark:bg-white/5 border border-neutral-200 dark:border-white/10 text-xs outline-none"
              >
                {HISTORY_SORTS.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.label}
                  </option>
                ))}
              </select>
              {(search || activeFilterCount > 0) && (
                <button type="button" onClick={clearFilters} className="text-xs text-neutral-500 dark:text-white/50 hover:text-neutral-800 dark:hover:text-white/80">
                  Clear all
                </button>
              )}
            </div>
          </div>
        </div>

        {filtersOpen && (
          <div className="border-t border-neutral-200 dark:border-white/10 p-3 sm:p-4 bg-neutral-50/50 dark:bg-white/[0.02]">
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
              <HistoryFilterSelect label="Model" value={model} onChange={setModel} options={facets?.models ?? []} />
              <HistoryFilterSelect label="Provider" value={provider} onChange={setProvider} options={facets?.providers ?? []} />
              <label className="block">
                <span className="text-[10px] uppercase tracking-[0.14em] text-neutral-400 dark:text-white/40 mb-1 block">Template</span>
                <select
                  value={templateId}
                  onChange={(e) => setTemplateId(e.target.value)}
                  className="w-full h-9 px-2.5 rounded-lg bg-neutral-50 dark:bg-white/5 border border-neutral-200 dark:border-white/10 text-xs outline-none focus:border-neutral-900 dark:focus:border-white/30"
                >
                  <option value="">All templates</option>
                  {(facets?.templates ?? []).map((id) => (
                    <option key={id} value={id}>
                      {templateById(id).name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block">
                <span className="text-[10px] uppercase tracking-[0.14em] text-neutral-400 dark:text-white/40 mb-1 block">From</span>
                <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className="w-full h-9 px-2.5 rounded-lg bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-white/10 text-xs outline-none" />
              </label>
              <label className="block">
                <span className="text-[10px] uppercase tracking-[0.14em] text-neutral-400 dark:text-white/40 mb-1 block">To</span>
                <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} className="w-full h-9 px-2.5 rounded-lg bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-white/10 text-xs outline-none" />
              </label>
            </div>
          </div>
        )}
      </div>

      {/* Main split view */}
      <div className="grid grid-cols-1 lg:grid-cols-5 gap-5 items-start">
        {/* List panel */}
        <div className={`${cardCls} lg:col-span-2 !p-0 overflow-hidden`}>
          <div className="px-5 py-4 border-b border-neutral-200 dark:border-white/10 flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <FileText className="w-4 h-4 text-sky-500" />
              <h2 className="text-sm font-medium">Generation history</h2>
              <span className="text-[11px] tabular-nums px-2 py-0.5 rounded-full bg-neutral-100 dark:bg-white/10 text-neutral-500 dark:text-white/50">
                {total.toLocaleString()}
              </span>
            </div>
            {loading && <Loader2 className="w-4 h-4 animate-spin text-neutral-400" />}
          </div>

          {!loading && runs.length === 0 && (
            <div className="px-5 py-12 text-center">
              <Search className="w-8 h-8 mx-auto text-neutral-300 dark:text-white/20 mb-2" />
              <p className="text-sm text-neutral-500 dark:text-white/50">No runs match your search or filters.</p>
              {(search || activeFilterCount > 0) && (
                <button type="button" onClick={clearFilters} className="mt-3 text-xs text-sky-600 dark:text-sky-300 hover:underline">
                  Reset filters
                </button>
              )}
            </div>
          )}

          <div className="divide-y divide-neutral-100 dark:divide-white/5 max-h-[680px] overflow-auto">
            {runs.map((run) => {
              const id = idStr(run._id);
              const active = selected && idStr(selected._id) === id;
              const jd = jdHeadline(run.jobDescription || "");
              const snippet = resumeSummarySnippet(run);
              const tpl = templateById(run.config?.templateId ?? "classic");
              const failed = run.status === "failed";
              const stack = run.techStack?.trim();

              return (
                <div
                  key={id}
                  role="button"
                  tabIndex={0}
                  onClick={() => openRun(id)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      openRun(id);
                    }
                  }}
                  className={`w-full text-left px-5 py-4 transition cursor-pointer ${
                    active ? "bg-sky-50/80 dark:bg-sky-500/10" : "hover:bg-neutral-50 dark:hover:bg-white/[0.03]"
                  }`}
                >
                  <div className="flex items-start justify-between gap-3 mb-2">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-1.5 mb-1">
                        <span className="text-xs font-semibold text-neutral-900 dark:text-white truncate max-w-[180px]">{jd || "Untitled run"}</span>
                        {stack && (
                          <span className="text-[10px] px-2 py-0.5 rounded-full bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-200 font-semibold truncate max-w-[140px]" title={stack}>
                            {stack}
                          </span>
                        )}
                        {failed && (
                          <span className="text-[9px] uppercase tracking-wider px-1.5 py-0.5 rounded-md bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-200">
                            Failed
                          </span>
                        )}
                      </div>
                      {snippet && (
                        <p className="text-[11px] text-neutral-500 dark:text-white/50 line-clamp-2 leading-relaxed">{snippet}</p>
                      )}
                    </div>
                    <div className="shrink-0 flex flex-col items-end gap-1">
                      <button
                        type="button"
                        onClick={(e) => void handleDelete(id, e)}
                        disabled={deletingId === id}
                        className="p-1.5 rounded-lg text-neutral-400 hover:text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-900/20 disabled:opacity-50"
                        title="Delete from history and library"
                      >
                        {deletingId === id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
                      </button>
                      <div className="flex items-center gap-1 text-[10px] text-neutral-400 dark:text-white/40">
                        <Clock className="w-3 h-3" />
                        {run.startedAt ? fmtRelative(run.startedAt) : ""}
                      </div>
                      {run.usage && (
                        <div className="text-[10px] text-neutral-400 dark:text-white/40 tabular-nums">
                          {fmtTokens(run.usage.totalTokens)} tok
                        </div>
                      )}
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="text-[10px] px-2 py-0.5 rounded-full bg-neutral-100 dark:bg-white/10 text-neutral-600 dark:text-white/60">{run.model || "model"}</span>
                    {run.provider && (
                      <span className="text-[10px] px-2 py-0.5 rounded-full border border-neutral-200 dark:border-white/10 text-neutral-500 dark:text-white/50">{run.provider}</span>
                    )}
                    <span className="text-[10px] px-2 py-0.5 rounded-full bg-sky-50 text-sky-700 dark:bg-sky-900/30 dark:text-sky-200">{tpl.name}</span>
                    {run.usage?.cost != null && (
                      <span className="text-[10px] tabular-nums text-neutral-400 dark:text-white/40 ml-auto">{fmtCost(run.usage.cost)}</span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          {totalPages > 1 && (
            <div className="px-5 py-3 border-t border-neutral-200 dark:border-white/10 flex items-center justify-between gap-2">
              <button
                type="button"
                disabled={page <= 1}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                className="inline-flex items-center gap-1 px-2.5 h-8 rounded-lg border border-neutral-200 dark:border-white/10 text-xs disabled:opacity-40"
              >
                <ChevronLeft className="w-3.5 h-3.5" /> Prev
              </button>
              <span className="text-[11px] text-neutral-500 dark:text-white/50 tabular-nums">
                Page {page} of {totalPages}
              </span>
              <button
                type="button"
                disabled={page >= totalPages}
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                className="inline-flex items-center gap-1 px-2.5 h-8 rounded-lg border border-neutral-200 dark:border-white/10 text-xs disabled:opacity-40"
              >
                Next <ChevronRight className="w-3.5 h-3.5" />
              </button>
            </div>
          )}
        </div>

        {/* Detail panel */}
        <div className="lg:col-span-3 space-y-4">
          {loadingDetail && (
            <div className={`${cardCls} flex items-center justify-center gap-2 py-20 text-sm text-neutral-500 dark:text-white/50`}>
              <Loader2 className="w-4 h-4 animate-spin" /> Loading resume…
            </div>
          )}

          {!loadingDetail && !selected && (
            <div className={`${cardCls} flex flex-col items-center justify-center py-20 text-center`}>
              <Eye className="w-10 h-10 text-neutral-300 dark:text-white/20 mb-3" />
              <p className="text-sm text-neutral-500 dark:text-white/50">Select a run from the list to preview the resume, JD, usage, and skill analysis.</p>
            </div>
          )}

          {!loadingDetail && selected && (
            <>
              <div className={`${cardCls} !p-0 overflow-hidden`}>
                <div className="px-5 py-4 border-b border-neutral-200 dark:border-white/10 flex flex-wrap items-center justify-between gap-3">
                  <div className="min-w-0">
                    <h3 className="text-sm font-semibold truncate">{jdHeadline(selected.jobDescription || "", 120) || "Generated resume"}</h3>
                    <div className="flex flex-wrap items-center gap-2 mt-1 text-[11px] text-neutral-500 dark:text-white/50">
                      {selected.techStack && (
                        <>
                          <span className="inline-flex items-center px-2 py-0.5 rounded-full bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-200 font-semibold text-[10px]">
                            {selected.techStack}
                          </span>
                          <span>·</span>
                        </>
                      )}
                      <span className="inline-flex items-center gap-1">
                        <Clock className="w-3 h-3" />
                        {selected.startedAt ? new Date(selected.startedAt).toLocaleString() : ""}
                      </span>
                      <span>·</span>
                      <span>{selected.model}</span>
                      <span>·</span>
                      <span>{detailTemplate.name}</span>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      type="button"
                      onClick={() => void handleDownloadPdf()}
                      disabled={!selected.sections || downloadingId === idStr(selected._id)}
                      className="inline-flex items-center gap-1.5 px-3 h-9 rounded-lg border border-neutral-200 dark:border-white/10 text-xs hover:bg-neutral-100 dark:hover:bg-white/5 disabled:opacity-50"
                      title="Download as PDF"
                    >
                      {downloadingId === idStr(selected._id) ? (
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      ) : (
                        <Download className="w-3.5 h-3.5" />
                      )}
                      Download PDF
                    </button>
                    <button
                      type="button"
                      onClick={() => void handleDelete(idStr(selected._id))}
                      disabled={deletingId === idStr(selected._id)}
                      className="inline-flex items-center gap-1.5 px-3 h-9 rounded-lg border border-rose-200 dark:border-rose-800/50 text-rose-600 dark:text-rose-300 text-xs hover:bg-rose-50 dark:hover:bg-rose-900/20 disabled:opacity-50"
                    >
                      {deletingId === idStr(selected._id) ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
                      Delete
                    </button>
                    <button
                      type="button"
                      onClick={() => onLoad(selected)}
                      className="inline-flex items-center gap-1.5 px-3.5 h-9 rounded-lg bg-neutral-900 text-white text-xs hover:bg-neutral-700 dark:bg-white dark:text-neutral-900 dark:hover:bg-white/90"
                    >
                      <Wand2 className="w-3.5 h-3.5" /> Load into editor
                    </button>
                  </div>
                </div>

                <div className="flex border-b border-neutral-200 dark:border-white/10 px-2">
                  {([
                    { id: "preview" as const, label: "Preview", icon: FileText },
                    { id: "jd" as const, label: "Job description", icon: Briefcase },
                    { id: "usage" as const, label: "Usage", icon: Coins },
                    { id: "analysis" as const, label: "Analysis", icon: Sparkles },
                  ]).map((t) => {
                    const Icon = t.icon;
                    const active = detailTab === t.id;
                    return (
                      <button
                        key={t.id}
                        type="button"
                        onClick={() => setDetailTab(t.id)}
                        className={`inline-flex items-center gap-1.5 px-3 py-2.5 text-xs border-b-2 -mb-px transition ${
                          active
                            ? "border-neutral-900 dark:border-white text-neutral-900 dark:text-white font-medium"
                            : "border-transparent text-neutral-500 dark:text-white/50 hover:text-neutral-800 dark:hover:text-white/80"
                        }`}
                      >
                        <Icon className="w-3.5 h-3.5" /> {t.label}
                      </button>
                    );
                  })}
                </div>

                <div className="p-5">
                  {detailTab === "preview" && (
                    <ResumePreview
                      template={detailTemplate}
                      theme={detailTheme}
                      layout={detailLayout}
                      identity={selected.identity ?? null}
                      generated={detailGenerated}
                      onTitleChange={() => {}}
                    />
                  )}
                  {detailTab === "jd" && (
                    <pre className="whitespace-pre-wrap text-[12px] leading-relaxed text-neutral-600 dark:text-white/65 max-h-[70vh] overflow-auto rounded-xl bg-neutral-50 dark:bg-white/[0.03] p-4 border border-neutral-200 dark:border-white/10">
                      {selected.jobDescription || "(no job description stored for this run)"}
                    </pre>
                  )}
                  {detailTab === "usage" && (
                    <div className="space-y-4">
                      {selected.usage ? (
                        <>
                          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                            {(() => {
                              const labels = usageTokenLabels(selected.model);
                              return [
                                { label: labels.input, value: fmtTokens(selected.usage.inputTokens) },
                                { label: labels.cached, value: fmtTokens(selected.usage.cachedTokens) },
                                { label: "Output", value: fmtTokens(selected.usage.outputTokens) },
                                { label: "Total", value: fmtTokens(selected.usage.totalTokens) },
                              ];
                            })().map((row) => (
                              <div key={row.label} className="rounded-xl border border-neutral-200 dark:border-white/10 p-3">
                                <div className="text-[10px] uppercase tracking-wider text-neutral-400 dark:text-white/40">{row.label}</div>
                                <div className="text-sm font-semibold tabular-nums mt-1">{row.value}</div>
                              </div>
                            ))}
                          </div>
                          <div className="flex items-center justify-between rounded-xl bg-sky-50 dark:bg-sky-900/20 border border-sky-200 dark:border-sky-800/40 px-4 py-3">
                            <span className="text-sm text-neutral-600 dark:text-white/70">Estimated cost · {selected.model}</span>
                            <span className="text-lg font-semibold text-sky-600 dark:text-sky-300 tabular-nums">{fmtCost(selected.usage.cost)}</span>
                          </div>
                        </>
                      ) : (
                        <p className="text-sm text-neutral-500 dark:text-white/50">No usage data for this run.</p>
                      )}
                      {selected.status === "failed" && selected.error && (
                        <div className="rounded-xl border border-rose-200 dark:border-rose-800/50 bg-rose-50 dark:bg-rose-900/20 p-4">
                          <div className="flex items-center gap-2 text-rose-700 dark:text-rose-200 text-sm font-medium mb-1">
                            <AlertTriangle className="w-4 h-4" /> Generation failed
                          </div>
                          <p className="text-xs text-rose-600 dark:text-rose-300/90">{selected.error}</p>
                        </div>
                      )}
                    </div>
                  )}
                  {detailTab === "analysis" && selected && <GenerationSkillAnalysis run={selected} />}
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
