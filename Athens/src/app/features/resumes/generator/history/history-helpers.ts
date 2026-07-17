import type { RunSummary } from "./history-types";
import type { HistorySort } from "./history-types";

export const idStr = (v: unknown): string =>
  v && typeof v === "object" && "$oid" in (v as Record<string, unknown>) ? String((v as { $oid: string }).$oid) : String(v);

export function resumeSummarySnippet(run: RunSummary): string {
  const sec = run.sections;
  const summary = sec?.summary;
  if (summary && typeof summary === "object" && typeof (summary as { summary?: unknown }).summary === "string") {
    return String((summary as { summary: string }).summary).trim();
  }
  return "";
}

export function jdHeadline(jd: string, max = 90): string {
  const line = (jd || "").trim().split("\n").find(Boolean) ?? "";
  return line.length > max ? `${line.slice(0, max)}…` : line;
}

export const HISTORY_SORTS: { id: HistorySort; label: string }[] = [
  { id: "newest", label: "Newest first" },
  { id: "oldest", label: "Oldest first" },
  { id: "cost-desc", label: "Highest cost" },
  { id: "cost-asc", label: "Lowest cost" },
  { id: "tokens-desc", label: "Most tokens" },
];

export const HISTORY_PER_PAGE = 15;
