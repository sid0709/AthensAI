import { useState } from "react";
import { createPortal } from "react-dom";
import { Loader2, X, Zap, ArrowRight, Plus, Rocket, Link2, Search, Calendar, FilterX } from "lucide-react";
import { Skeleton } from "../../../components/ui/skeleton";
import type { DeployOptions } from "../../../types/agent";
import type { JobCandidate } from "../../../services/agentApi";
import { useDeployForm } from "../hooks/useDeployForm";

function JobRow({ job, action, onClick }: { job: JobCandidate; action: "add" | "remove"; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={job.url}
      className={`w-full text-left px-3 py-2 border-b border-border/50 last:border-0 flex items-center gap-2 ${action === "add" ? "hover:bg-primary/5" : "hover:bg-rose-50"}`}
    >
      <div className="min-w-0 flex-1">
        <div className="text-xs font-medium text-foreground truncate">{job.title || "(untitled)"}</div>
        <div className="text-[10px] text-muted-foreground truncate">{job.company || job.source}</div>
      </div>
      <span className={`text-[10px] font-semibold shrink-0 ${action === "add" ? "text-primary" : "text-rose-500"}`}>
        {action === "add" ? "Add" : "Remove"}
      </span>
    </button>
  );
}

function CandidateListSkeleton({ count = 6 }: { count?: number }) {
  return (
    <div aria-busy="true" aria-live="polite" className="divide-y divide-border/50">
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="px-3 py-2.5 flex items-center gap-2">
          <div className="min-w-0 flex-1 space-y-1.5">
            <Skeleton className="h-3 w-3/4 max-w-[180px]" />
            <Skeleton className="h-2.5 w-1/2 max-w-[120px]" />
          </div>
          <Skeleton className="h-3 w-7 shrink-0" />
        </div>
      ))}
    </div>
  );
}

export function DeployAgentModal({
  onClose,
  onDeploy,
  asNewSession = false,
}: {
  onClose: () => void;
  onDeploy: (opts: DeployOptions) => Promise<void> | void;
  /** Creates a brand-new tabbed session (with its own Avalon extension pairing) instead of queuing into the active one. */
  asNewSession?: boolean;
}) {
  const form = useDeployForm(onDeploy, { asNewSession });
  const [urlInput, setUrlInput] = useState("");

  const submitUrl = () => {
    if (form.addUrlToQueue(urlInput)) setUrlInput("");
  };

  const modal = (
    <div translate="no" className="notranslate fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/30 backdrop-blur-sm" onClick={onClose} />
      <div className="relative z-10 bg-card rounded-3xl border border-border w-full max-w-3xl shadow-2xl flex flex-col max-h-[92vh]">
        {/* Header */}
        <div className="flex items-center justify-between px-6 pt-5 pb-3 border-b border-border shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-primary/10 flex items-center justify-center">
              <Rocket size={18} className="text-primary" />
            </div>
            <div>
              <h2 className="text-lg font-bold text-foreground leading-tight">
                {asNewSession ? "New Session" : "Queue Jobs"}
              </h2>
              <p className="text-xs text-muted-foreground">
                {form.profileName || "No profile"} · Avalon extension auto-apply
              </p>
            </div>
          </div>
          <button type="button" onClick={onClose} className="p-2 rounded-lg hover:bg-secondary">
            <X size={18} />
          </button>
        </div>

        <div className="px-6 py-5 overflow-y-auto space-y-4">
          {/* Source + manual URL — two ways to add */}
          <div className="grid sm:grid-cols-2 gap-3">
            <label className="flex flex-col gap-1.5">
              <span className="text-xs font-semibold text-foreground">From a job source</span>
              <select
                value={form.source}
                onChange={(e) => form.setSource(e.target.value)}
                disabled={!form.profileName || !form.sources.length}
                className="w-full rounded-xl border border-border bg-background px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-50"
              >
                <option value="">{form.sources.length ? "Select job source…" : "No posted jobs found"}</option>
                {form.sources.map((s) => (
                  <option key={s.title} value={s.title}>{s.title} · {s.type} — {s.posted} posted</option>
                ))}
              </select>
            </label>

            <label className="flex flex-col gap-1.5">
              <span className="text-xs font-semibold text-foreground">Or paste a job URL</span>
              <div className="flex gap-2">
                <div className="flex-1 flex items-center gap-1.5 rounded-xl border border-border bg-background px-2.5 py-2 focus-within:ring-2 focus-within:ring-ring">
                  <Link2 size={13} className="text-muted-foreground shrink-0" />
                  <input
                    value={urlInput}
                    onChange={(e) => setUrlInput(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), submitUrl())}
                    placeholder="https://jobs.example.com/…"
                    className="flex-1 min-w-0 bg-transparent text-sm focus:outline-none"
                  />
                </div>
                <button
                  type="button"
                  onClick={submitUrl}
                  disabled={!urlInput.trim()}
                  className="inline-flex items-center gap-1 px-3 rounded-xl bg-primary/10 text-primary text-xs font-bold hover:bg-primary/20 disabled:opacity-40"
                >
                  <Plus size={13} /> Add
                </button>
              </div>
            </label>
          </div>

          {/* Filters — title search + posted-date range */}
          <div className="rounded-xl border border-border bg-secondary/20 px-3 py-2.5 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide">Filters</span>
              {form.hasFilter && (
                <button
                  type="button"
                  onClick={form.clearFilters}
                  className="inline-flex items-center gap-1 text-[11px] font-semibold text-muted-foreground hover:text-foreground"
                >
                  <FilterX size={11} /> Clear filters
                </button>
              )}
            </div>
            <div className="grid sm:grid-cols-2 gap-2">
              <div className="flex items-center gap-1.5 rounded-lg border border-border bg-background px-2.5 py-2 focus-within:ring-2 focus-within:ring-ring">
                <Search size={13} className="text-muted-foreground shrink-0" />
                <input
                  value={form.titleQuery}
                  onChange={(e) => form.setTitleQuery(e.target.value)}
                  placeholder="Filter by title…"
                  className="flex-1 min-w-0 bg-transparent text-sm focus:outline-none"
                />
                {form.titleQuery && (
                  <button type="button" onClick={() => form.setTitleQuery("")} className="text-muted-foreground hover:text-foreground shrink-0">
                    <X size={12} />
                  </button>
                )}
              </div>
              <div className="flex items-center gap-1.5">
                <div className="flex items-center gap-1.5 flex-1 rounded-lg border border-border bg-background px-2.5 py-2 focus-within:ring-2 focus-within:ring-ring">
                  <Calendar size={13} className="text-muted-foreground shrink-0" />
                  <input
                    type="date"
                    value={form.postedFrom}
                    max={form.postedTo || undefined}
                    onChange={(e) => form.setPostedFrom(e.target.value)}
                    title="Posted from"
                    className="flex-1 min-w-0 bg-transparent text-xs text-foreground focus:outline-none"
                  />
                </div>
                <span className="text-xs text-muted-foreground shrink-0">–</span>
                <div className="flex items-center gap-1.5 flex-1 rounded-lg border border-border bg-background px-2.5 py-2 focus-within:ring-2 focus-within:ring-ring">
                  <input
                    type="date"
                    value={form.postedTo}
                    min={form.postedFrom || undefined}
                    onChange={(e) => form.setPostedTo(e.target.value)}
                    title="Posted to"
                    className="flex-1 min-w-0 bg-transparent text-xs text-foreground focus:outline-none"
                  />
                </div>
              </div>
            </div>
          </div>

          {/* Candidates → Queue */}
          <div className="grid grid-cols-2 gap-3">
            <div className="rounded-xl border border-border overflow-hidden flex flex-col">
              <div className="flex items-center justify-between px-3 py-2 bg-secondary/40 border-b border-border">
                <span className="text-[11px] font-semibold text-muted-foreground">
                  Candidates · {form.loadingJobs ? "…" : form.candidates.length}
                </span>
                <button type="button" onClick={form.addAll} disabled={form.loadingJobs || !form.candidates.length} className="inline-flex items-center gap-0.5 text-[11px] font-semibold text-primary disabled:opacity-40">
                  Add all <ArrowRight size={11} />
                </button>
              </div>
              <div className="h-72 overflow-auto">
                {form.loadingJobs ? (
                  <CandidateListSkeleton />
                ) : form.candidates.length === 0 ? (
                  <div className="p-3 text-xs text-muted-foreground">
                    {form.hasFilter
                      ? "No posted jobs match. Adjust the source or filters."
                      : "Select a job source, filter by title/date, or paste a URL above."}
                  </div>
                ) : (
                  form.candidates.map((j) => <JobRow key={j.id} job={j} action="add" onClick={() => form.addToQueue(j)} />)
                )}
              </div>
            </div>

            <div className="rounded-xl border border-primary/40 overflow-hidden flex flex-col">
              <div className="flex items-center justify-between px-3 py-2 bg-primary/5 border-b border-border">
                <span className="text-[11px] font-semibold text-primary">Queue · {form.queue.length}</span>
                <button type="button" onClick={form.clearQueue} disabled={!form.queue.length} className="text-[11px] font-semibold text-muted-foreground disabled:opacity-40">Clear</button>
              </div>
              <div className="h-72 overflow-auto">
                {form.queue.length === 0 ? (
                  <div className="p-4 text-xs text-muted-foreground flex flex-col items-center gap-1.5 text-center justify-center h-full">
                    <Plus size={18} className="opacity-40" />
                    Add candidates or paste a URL to build the queue.
                  </div>
                ) : (
                  form.queue.map((j) => <JobRow key={j.id} job={j} action="remove" onClick={() => form.removeFromQueue(j.id)} />)
                )}
              </div>
            </div>
          </div>

          {/* Optional session name — Avalon session ID is assigned automatically */}
          <div className="grid gap-3">
            <label className="flex flex-col gap-1.5">
              <span className="text-xs font-semibold text-muted-foreground">Session name <span className="font-normal">(optional)</span></span>
              <input
                value={form.name}
                onChange={(e) => form.setName(e.target.value)}
                placeholder="Auto-named from the source if left blank"
                className="w-full rounded-xl border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
              />
            </label>
          </div>
          {asNewSession && (
            <p className="text-[11px] text-muted-foreground -mt-2">
              A unique Avalon session ID is assigned automatically. Open the Avalon extension, sign in, and pick this session from the list — no typing needed.
            </p>
          )}

          <p className="text-xs text-muted-foreground text-center">
            <span className="font-semibold text-primary">{form.queue.length}</span> job{form.queue.length === 1 ? "" : "s"} will open in the Avalon controller.
          </p>

          {form.err && (
            <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{form.err}</p>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between gap-3 px-6 py-4 border-t border-border shrink-0">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2.5 rounded-xl border border-border text-sm font-semibold hover:bg-secondary"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={(e) => form.handleSubmit(e as unknown as React.FormEvent)}
            disabled={form.loading || !form.valid || !form.applierReady}
            className="inline-flex items-center justify-center gap-2 px-5 py-2.5 rounded-xl bg-primary text-white text-sm font-bold hover:bg-primary/90 disabled:opacity-50"
          >
            {form.loading ? (
              <><Loader2 size={13} className="animate-spin" /> {asNewSession ? "Creating…" : "Starting…"}</>
            ) : (
              <><Zap size={13} /> {asNewSession ? "Create session" : "Start session"}</>
            )}
          </button>
        </div>
      </div>
    </div>
  );

  return createPortal(modal, document.body);
}
