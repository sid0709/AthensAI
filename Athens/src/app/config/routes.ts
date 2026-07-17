import type { View } from "../types";

/**
 * Canonical URL paths for the app shell.
 * View ids (used in types/config) are decoupled from paths where it improves readability.
 */
export const PATHS = {
  dashboard: "/",
  jobs: "/jobs",
  resumes: "/resumes",
  applications: "/applications",
  copilot: "/copilot",
  agents: "/agents",
  mail: "/mail",
  calendar: "/calendar",
  interviews: "/interviews",
  reports: "/reports",
  aiUsage: "/ai-usage",
  apiUsageMonitor: "/api-usage-monitor",
  firebase: "/firebase",
  bidManagement: "/bid-management",
  settings: "/settings",
  signin: "/signin",
  signup: "/signup",
} as const;

/** Default tab segments when a section has sub-routes. */
export const DEFAULT_TABS = {
  resumes: "library",
  calendar: "month",
  reports: "overview",
  settings: "profile",
} as const;

export type ResumesTab = "library" | "editor" | "history" | "analysis";
export type CalendarTab = "month" | "week" | "pipeline";
export type ReportsTab = "overview" | "sources" | "funnel" | "velocity" | "insights";
export type SettingsTab = "profile" | "skills" | "notifications" | "integrations" | "security";

const VIEW_TO_BASE: Record<View, string> = {
  dashboard: PATHS.dashboard,
  "job-board": PATHS.jobs,
  resumes: PATHS.resumes,
  ats: PATHS.applications,
  copilot: PATHS.copilot,
  agents: PATHS.agents,
  mail: PATHS.mail,
  calendar: PATHS.calendar,
  interviews: PATHS.interviews,
  reports: PATHS.reports,
  "ai-usage": PATHS.aiUsage,
  "api-usage-monitor": PATHS.apiUsageMonitor,
  firebase: PATHS.firebase,
  "bid-management": PATHS.bidManagement,
  settings: PATHS.settings,
};

export type NavigateOptions = {
  tab?: string;
  threadId?: string;
  replace?: boolean;
};

/** Resolve a View (+ optional detail) to a concrete pathname. */
export function pathForView(view: View, options?: NavigateOptions): string {
  const base = VIEW_TO_BASE[view];
  if (view === "mail" && options?.threadId) {
    return `${PATHS.mail}/${encodeURIComponent(options.threadId)}`;
  }
  if (view === "resumes" && options?.tab) {
    return `${PATHS.resumes}/${options.tab}`;
  }
  if (view === "calendar" && options?.tab) {
    return `${PATHS.calendar}/${options.tab}`;
  }
  if (view === "reports" && options?.tab) {
    return `${PATHS.reports}/${options.tab}`;
  }
  if (view === "settings" && options?.tab) {
    return `${PATHS.settings}/${options.tab}`;
  }
  return base;
}

/** Infer the active sidebar View from the current pathname. */
export function viewFromPathname(pathname: string): View {
  const p = pathname.split("?")[0];
  if (p === PATHS.dashboard) return "dashboard";
  if (p.startsWith(PATHS.jobs)) return "job-board";
  if (p.startsWith(PATHS.resumes)) return "resumes";
  if (p.startsWith(PATHS.applications)) return "ats";
  if (p.startsWith(PATHS.copilot)) return "copilot";
  if (p.startsWith(PATHS.agents)) return "agents";
  if (p.startsWith(PATHS.mail)) return "mail";
  if (p.startsWith(PATHS.calendar)) return "calendar";
  if (p.startsWith(PATHS.interviews)) return "interviews";
  if (p.startsWith(PATHS.reports)) return "reports";
  if (p.startsWith(PATHS.aiUsage)) return "ai-usage";
  if (p.startsWith(PATHS.apiUsageMonitor)) return "api-usage-monitor";
  if (p.startsWith(PATHS.firebase)) return "firebase";
  if (p.startsWith(PATHS.bidManagement)) return "bid-management";
  if (p.startsWith(PATHS.settings)) return "settings";
  return "dashboard";
}

/** Validate tab segment; fall back to default if unknown. */
export function normalizeTab<T extends string>(
  value: string | undefined,
  allowed: readonly T[],
  fallback: T,
): T {
  if (value && (allowed as readonly string[]).includes(value)) return value as T;
  return fallback;
}
