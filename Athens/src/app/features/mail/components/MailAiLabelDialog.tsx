import { useCallback, useEffect, useMemo, useState } from "react";
import { Check, ChevronDown, ChevronRight, Loader2, Sparkles, X } from "lucide-react";
import {
  fetchMailLabelDefinitions,
  fetchUnlabeledThreads,
  runMailAiLabel,
  saveMailLabelDefinitions,
  type MailAiLabelResult,
  type MailLabelDefinitions,
} from "@/api/mail";
import { AthensTextarea } from "../../../components/forms";
import { PaginationBar } from "../../../components/shared/PaginationBar";
import { Checkbox } from "../../../components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../../../components/ui/dialog";
import { LABEL_DOT_CLASS } from "../../../data/mail";
import { cn } from "../../../lib/utils";
import { buildLabelTree } from "../hooks/useMailLabels";
import type { MailLabel, MailThread } from "../../../types";

type MailAiLabelDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  applierName: string | undefined;
  labels: MailLabel[];
  onComplete?: () => void;
};

type RowStatus = "idle" | "running" | "done" | "skipped" | "error";

/** Canonical storage key for a Gmail label definition. */
function labelDefKey(label: Pick<MailLabel, "path" | "name">): string {
  return String(label.path || label.name || "").trim();
}

/**
 * Resolve a definition for a label. Stored keys may be full path, short name,
 * or a legacy alias — try all of them.
 */
function resolveDefinition(
  definitions: MailLabelDefinitions,
  label: MailLabel,
): string {
  const candidates = [label.path, label.name, label.shortName]
    .map((k) => String(k || "").trim())
    .filter(Boolean);
  for (const key of candidates) {
    const value = definitions[key];
    if (typeof value === "string" && value.trim()) return value;
  }
  // Legacy: nested short name stored without parent prefix
  const short = String(label.shortName || "").trim();
  if (short) {
    const match = Object.entries(definitions).find(
      ([k, v]) =>
        typeof v === "string" &&
        v.trim() &&
        (k === short || k.endsWith(`/${short}`)),
    );
    if (match) return match[1];
  }
  // Still return empty string stored under canonical key if present
  for (const key of candidates) {
    if (key in definitions) return String(definitions[key] ?? "");
  }
  return "";
}

/** Remap any loose aliases onto canonical path/name keys for the current label set. */
function canonicalizeDefinitions(
  raw: MailLabelDefinitions,
  labels: MailLabel[],
): MailLabelDefinitions {
  const out: MailLabelDefinitions = { ...raw };
  for (const label of labels) {
    const key = labelDefKey(label);
    if (!key) continue;
    const value = resolveDefinition(raw, label);
    if (value) out[key] = value;
  }
  return out;
}

function formatRowDate(thread: MailThread) {
  if (!thread.date) return thread.time;
  try {
    return new Date(thread.date).toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
    });
  } catch {
    return thread.time;
  }
}

export function MailAiLabelDialog({
  open,
  onOpenChange,
  applierName,
  labels,
  onComplete,
}: MailAiLabelDialogProps) {
  const [threads, setThreads] = useState<MailThread[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [definitionsOpen, setDefinitionsOpen] = useState(false);
  const [definitions, setDefinitions] = useState<MailLabelDefinitions>({});
  const [definitionsDirty, setDefinitionsDirty] = useState(false);
  const [savingDefinitions, setSavingDefinitions] = useState(false);
  const [definitionsSaved, setDefinitionsSaved] = useState(false);

  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const [mailboxById, setMailboxById] = useState<Record<string, string>>({});
  const [running, setRunning] = useState(false);
  const [runError, setRunError] = useState<string | null>(null);
  const [rowStatus, setRowStatus] = useState<Record<string, RowStatus>>({});
  const [rowResults, setRowResults] = useState<Record<string, MailAiLabelResult>>({});
  const [summary, setSummary] = useState<{ applied: number; skipped: number; failed: number } | null>(null);

  const labelTree = useMemo(() => buildLabelTree(labels), [labels]);
  const pageIds = useMemo(() => threads.map((t) => t.id), [threads]);
  const selectedOnPage = pageIds.filter((id) => selectedIds.has(id)).length;
  const allOnPageSelected = pageIds.length > 0 && selectedOnPage === pageIds.length;
  const indeterminate = selectedOnPage > 0 && !allOnPageSelected;
  const totalSelected = selectedIds.size;

  const loadThreads = useCallback(async () => {
    if (!applierName) return;
    setLoading(true);
    setLoadError(null);
    try {
      const threadResult = await fetchUnlabeledThreads(applierName, { page, pageSize });
      setThreads(threadResult.threads);
      setTotal(threadResult.total);
      setMailboxById((prev) => {
        const next = { ...prev };
        for (const t of threadResult.threads) {
          if (t.mailbox) next[t.id] = t.mailbox;
        }
        return next;
      });
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : "Failed to load unlabeled mail");
    } finally {
      setLoading(false);
    }
  }, [applierName, page, pageSize]);

  // Load definitions once when the dialog opens — not on every page change
  // (paging previously re-fetched and wiped hydrated / in-progress text).
  useEffect(() => {
    if (!open || !applierName) return;
    let cancelled = false;
    (async () => {
      try {
        const defs = await fetchMailLabelDefinitions(applierName);
        if (cancelled) return;
        setDefinitions(canonicalizeDefinitions(defs, labels));
        setDefinitionsDirty(false);
        if (Object.values(defs).some((v) => String(v || "").trim())) {
          setDefinitionsOpen(true);
        }
      } catch (e) {
        if (!cancelled) {
          setRunError(e instanceof Error ? e.message : "Failed to load label definitions");
        }
      }
    })();
    return () => {
      cancelled = true;
    };
    // labels remapped in the following effect when they arrive
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, applierName]);

  // When Gmail labels arrive/change, remap alias keys onto canonical path keys.
  useEffect(() => {
    if (!open || labels.length === 0) return;
    setDefinitions((prev) => canonicalizeDefinitions(prev, labels));
  }, [open, labels]);

  useEffect(() => {
    if (!open || !applierName) return;
    void loadThreads();
  }, [open, applierName, loadThreads]);

  // Reset when opening — never while closing. Clearing state during Radix's
  // exit animation causes React insertBefore crashes (lucide icons in the footer).
  useEffect(() => {
    if (!open) return;
    setSelectedIds(new Set());
    setMailboxById({});
    setRowStatus({});
    setRowResults({});
    setSummary(null);
    setRunError(null);
    setLoadError(null);
    setPage(1);
    setDefinitionsSaved(false);
    setDefinitionsOpen(false);
    setDefinitions({});
    setDefinitionsDirty(false);
    setRunning(false);
  }, [open]);

  const handleDefinitionChange = (label: MailLabel, value: string) => {
    const key = labelDefKey(label);
    if (!key) return;
    setDefinitions((prev) => ({ ...prev, [key]: value }));
    setDefinitionsDirty(true);
    setDefinitionsSaved(false);
  };

  const handleSaveDefinitions = async () => {
    if (!applierName) return;
    setSavingDefinitions(true);
    try {
      const payload = canonicalizeDefinitions(definitions, labels);
      const saved = await saveMailLabelDefinitions(applierName, payload);
      setDefinitions(canonicalizeDefinitions(saved, labels));
      setDefinitionsDirty(false);
      setDefinitionsSaved(true);
    } catch (e) {
      setRunError(e instanceof Error ? e.message : "Failed to save definitions");
    } finally {
      setSavingDefinitions(false);
    }
  };

  const toggleSelectAll = () => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (allOnPageSelected) {
        pageIds.forEach((id) => next.delete(id));
      } else {
        pageIds.forEach((id) => next.add(id));
      }
      return next;
    });
  };

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleRun = async () => {
    if (!applierName || totalSelected === 0 || running) return;

    if (definitionsDirty) {
      await handleSaveDefinitions();
    }

    const messages = [...selectedIds]
      .map((id) => {
        const thread = threads.find((t) => t.id === id);
        return {
          uid: Number(id),
          mailbox: thread?.mailbox || mailboxById[id],
        };
      })
      .filter((m) => Number.isFinite(m.uid));

    setRunning(true);
    setRunError(null);
    setSummary(null);
    setRowStatus(Object.fromEntries(messages.map((m) => [String(m.uid), "running"])));

    try {
      const { results } = await runMailAiLabel(applierName, {
        messages,
        labelDefinitions: definitions,
      });

      const nextStatus: Record<string, RowStatus> = {};
      const nextResults: Record<string, MailAiLabelResult> = {};
      let applied = 0;
      let skipped = 0;
      let failed = 0;

      for (const r of results) {
        const id = String(r.uid);
        nextResults[id] = r;
        if (r.applied) {
          nextStatus[id] = "done";
          applied += 1;
        } else if (r.label) {
          nextStatus[id] = "error";
          failed += 1;
        } else {
          nextStatus[id] = "skipped";
          skipped += 1;
        }
      }

      setRowStatus(nextStatus);
      setRowResults(nextResults);
      setSummary({ applied, skipped, failed });
      onComplete?.();

      if (applied > 0) {
        setSelectedIds((prev) => {
          const next = new Set(prev);
          results.filter((r) => r.applied).forEach((r) => next.delete(String(r.uid)));
          return next;
        });
        void loadThreads();
      }
    } catch (e) {
      setRunError(e instanceof Error ? e.message : "AI labeling failed");
      setRowStatus({});
    } finally {
      setRunning(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl max-h-[90vh] flex flex-col rounded-xl p-0 gap-0">
        <DialogHeader className="px-6 pt-6 pb-4 border-b border-border flex-shrink-0">
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="w-5 h-5 text-violet-600" />
            AI Label
          </DialogTitle>
          <DialogDescription>
            Select inbox emails without custom labels. AI will assign one label using your definitions and profile
            default model.
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto subtle-scroll px-6 py-4 space-y-4 min-h-0">
          <div className="border border-border rounded-xl overflow-hidden">
            <button
              type="button"
              onClick={() => setDefinitionsOpen(!definitionsOpen)}
              className="w-full flex items-center justify-between px-4 py-3 text-sm font-semibold hover:bg-secondary/50 transition-colors"
            >
              <span>Label definitions ({labels.length})</span>
              {definitionsOpen ? (
                <ChevronDown className="w-4 h-4 text-muted-foreground" />
              ) : (
                <ChevronRight className="w-4 h-4 text-muted-foreground" />
              )}
            </button>
            {definitionsOpen && (
              <div className="px-4 pb-4 space-y-3 border-t border-border">
                <p className="text-xs text-muted-foreground pt-3">
                  Describe when each custom label should be used. AI reads these when classifying emails.
                </p>
                {labelTree.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No custom Gmail labels found.</p>
                ) : (
                  labelTree.map(({ label: l, depth }) => (
                    <div key={l.id} style={{ paddingLeft: `${depth * 14}px` }}>
                      <label className="flex items-center gap-2 text-sm font-medium mb-1">
                        <span className={cn("w-2 h-2 rounded-full flex-shrink-0", LABEL_DOT_CLASS[l.color])} />
                        {l.shortName || l.name}
                      </label>
                      <AthensTextarea
                        value={resolveDefinition(definitions, l)}
                        onChange={(e) => handleDefinitionChange(l, e.target.value)}
                        placeholder={`When should "${l.shortName || l.name}" be used?`}
                        rows={2}
                        className="text-sm"
                      />
                    </div>
                  ))
                )}
                <div className="flex items-center gap-2 pt-1">
                  <button
                    type="button"
                    onClick={() => void handleSaveDefinitions()}
                    disabled={savingDefinitions || !definitionsDirty}
                    className="px-3 py-1.5 rounded-lg text-xs font-semibold border border-border hover:bg-secondary disabled:opacity-50"
                  >
                    {savingDefinitions ? "Saving…" : "Save definitions"}
                  </button>
                  {definitionsSaved && !definitionsDirty && (
                    <span className="text-xs text-emerald-600 font-medium">Saved</span>
                  )}
                </div>
              </div>
            )}
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between gap-3">
              <label className="inline-flex items-center gap-2.5 cursor-pointer select-none">
                <Checkbox
                  checked={
                    allOnPageSelected && pageIds.length > 0 ? true : indeterminate ? "indeterminate" : false
                  }
                  onCheckedChange={toggleSelectAll}
                  disabled={loading || running || pageIds.length === 0}
                  aria-label="Select all on page"
                />
                <span className="text-sm">
                  <span className="text-muted-foreground">Unlabeled inbox</span>
                  <span className="mx-1.5 text-border">·</span>
                  <span className="font-semibold tabular-nums">
                    {selectedOnPage}/{pageIds.length}
                  </span>
                  {totalSelected > selectedOnPage && (
                    <span className="ml-1.5 text-xs font-medium text-primary">({totalSelected} total)</span>
                  )}
                </span>
              </label>
              <span className="text-xs text-muted-foreground tabular-nums">{total} total</span>
            </div>

            {loadError && (
              <div className="text-sm text-destructive bg-destructive/10 rounded-lg px-3 py-2">{loadError}</div>
            )}

            {loading ? (
              <div className="flex items-center justify-center py-12 text-muted-foreground gap-2">
                <span className="inline-flex size-5 shrink-0 items-center justify-center" aria-hidden>
                  <Loader2 className="size-5 animate-spin" />
                </span>
                Loading unlabeled emails…
              </div>
            ) : threads.length === 0 ? (
              <div className="text-center py-12 text-sm text-muted-foreground">
                No unlabeled inbox emails found.
              </div>
            ) : (
              <div className="border border-border rounded-xl overflow-hidden divide-y divide-border/40">
                {threads.map((thread) => {
                  const status = rowStatus[thread.id] || "idle";
                  const result = rowResults[thread.id];
                  const checked = selectedIds.has(thread.id);

                  return (
                    <div
                      key={thread.id}
                      className={cn(
                        "flex items-center gap-3 px-3 py-2.5 min-h-[44px]",
                        checked && "bg-primary/[0.03]",
                      )}
                    >
                      <Checkbox
                        checked={checked}
                        onCheckedChange={() => toggleSelect(thread.id)}
                        disabled={running}
                        aria-label={`Select ${thread.subj}`}
                      />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-baseline gap-2 min-w-0">
                          <span
                            className={cn(
                              "text-sm truncate flex-shrink-0 max-w-[140px]",
                              thread.unread ? "font-bold" : "font-medium",
                            )}
                          >
                            {thread.from.split("(")[0]?.trim() || thread.from}
                          </span>
                          <span className="text-sm text-muted-foreground truncate flex-1">{thread.subj}</span>
                          <span className="text-xs text-muted-foreground flex-shrink-0 tabular-nums">
                            {formatRowDate(thread)}
                          </span>
                        </div>
                        {result && (
                          <p className="text-xs mt-0.5 text-muted-foreground">
                            {result.applied && result.label ? (
                              <span className="text-emerald-600">Labeled: {result.label}</span>
                            ) : result.error ? (
                              <span className="text-destructive">{result.error}</span>
                            ) : (
                              <span>No matching label</span>
                            )}
                          </p>
                        )}
                      </div>
                      <div className="w-5 h-5 flex-shrink-0 flex items-center justify-center" aria-hidden>
                        {status === "running" ? (
                          <Loader2 className="w-4 h-4 animate-spin text-primary" />
                        ) : status === "done" ? (
                          <Check className="w-4 h-4 text-emerald-600" />
                        ) : status === "error" ? (
                          <X className="w-4 h-4 text-destructive" />
                        ) : null}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            {total > pageSize && (
              <PaginationBar
                page={page}
                pageSize={pageSize}
                total={total}
                onPageChange={setPage}
                onPageSizeChange={(size) => {
                  setPageSize(size);
                  setPage(1);
                }}
                pageSizeOptions={[10, 25, 50]}
              />
            )}

            {summary && (
              <div className="text-sm rounded-lg bg-secondary/60 border border-border px-3 py-2">
                Done: {summary.applied} labeled, {summary.skipped} skipped, {summary.failed} failed.
              </div>
            )}

            {runError && (
              <div className="text-sm text-destructive bg-destructive/10 rounded-lg px-3 py-2">{runError}</div>
            )}
          </div>
        </div>

        <DialogFooter className="px-6 py-4 border-t border-border flex-shrink-0 gap-2">
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            disabled={running}
            className="px-4 py-2 rounded-xl text-sm font-semibold border border-border hover:bg-secondary min-h-10 disabled:opacity-50"
          >
            {summary ? "Close" : "Cancel"}
          </button>
          <button
            type="button"
            onClick={() => void handleRun()}
            disabled={running || totalSelected === 0 || labels.length === 0}
            className="px-4 py-2 rounded-xl text-sm font-bold bg-primary text-white hover:bg-primary/90 min-h-10 disabled:opacity-50 inline-flex items-center gap-2"
          >
            <span className="inline-flex size-4 shrink-0 items-center justify-center" aria-hidden>
              {running ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Sparkles className="size-4" />
              )}
            </span>
            <span>{running ? "Labeling…" : `Run AI Label (${totalSelected})`}</span>
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
