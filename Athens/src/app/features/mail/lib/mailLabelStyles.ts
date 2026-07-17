/** Pill colors for Gmail custom labels (Notion Mail style). */
const LABEL_STYLE_MAP: Record<string, string> = {
  Application: "bg-emerald-800/90 text-emerald-50",
  Notify: "bg-violet-800/90 text-violet-50",
  "Notify/Decline": "bg-zinc-600/90 text-zinc-100",
  "Notify/Job": "bg-amber-900/80 text-amber-50",
  "Notify/Unnecessary": "bg-stone-600/90 text-stone-100",
  Interview: "bg-violet-700/90 text-violet-50",
  Offer: "bg-amber-800/90 text-amber-50",
  Job: "bg-blue-800/90 text-blue-50",
};

const FALLBACK_STYLES = [
  "bg-slate-700/90 text-slate-100",
  "bg-indigo-800/90 text-indigo-50",
  "bg-teal-800/90 text-teal-50",
  "bg-rose-800/90 text-rose-50",
  "bg-cyan-800/90 text-cyan-50",
];

export function labelPillClass(name: string): string {
  if (LABEL_STYLE_MAP[name]) return LABEL_STYLE_MAP[name];
  const root = name.split("/")[0];
  if (LABEL_STYLE_MAP[root]) return LABEL_STYLE_MAP[root];
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = (hash + name.charCodeAt(i) * 17) % FALLBACK_STYLES.length;
  return FALLBACK_STYLES[hash]!;
}

export type DateSection = "today" | "yesterday" | "last7" | "older";

export function getDateSection(isoDate: string | undefined): DateSection {
  if (!isoDate) return "older";
  const date = new Date(isoDate);
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const startOfYesterday = new Date(startOfToday);
  startOfYesterday.setDate(startOfYesterday.getDate() - 1);
  const startOf7Days = new Date(startOfToday);
  startOf7Days.setDate(startOf7Days.getDate() - 7);

  if (date >= startOfToday) return "today";
  if (date >= startOfYesterday) return "yesterday";
  if (date >= startOf7Days) return "last7";
  return "older";
}

export const DATE_SECTION_LABELS: Record<DateSection, string | null> = {
  today: null,
  yesterday: "Yesterday",
  last7: "Last 7 days",
  older: "Older",
};

export function groupThreadsByDate<T extends { date?: string }>(
  threads: T[],
): { section: DateSection; label: string | null; threads: T[] }[] {
  const order: DateSection[] = ["today", "yesterday", "last7", "older"];
  const buckets = new Map<DateSection, T[]>();
  for (const t of threads) {
    const section = getDateSection(t.date);
    if (!buckets.has(section)) buckets.set(section, []);
    buckets.get(section)!.push(t);
  }
  return order
    .filter((s) => buckets.has(s))
    .map((section) => ({
      section,
      label: DATE_SECTION_LABELS[section],
      threads: buckets.get(section)!,
    }));
}
