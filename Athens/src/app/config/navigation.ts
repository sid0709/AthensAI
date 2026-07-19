import type { ElementType } from "react";
import {
  LayoutDashboard,
  Briefcase,
  FileText,
  Share2,
  Wand2,
  Bot,
  Mail,
  Calendar,
  Video,
  BarChart2,
  Cpu,
  Gauge,
  Flame,
  Clapperboard,
  Puzzle,
  ScrollText,
  Settings,
} from "lucide-react";
import type { View } from "../types";

export type NavItem = {
  id: View;
  label: string;
  icon: ElementType;
  comingSoon?: boolean;
  beta?: boolean;
  /** Only shown when account_info.permission === "admin" */
  admin?: boolean;
};

export const NAV_ITEMS: NavItem[] = [
  { id: "dashboard", label: "Dashboard", icon: LayoutDashboard, comingSoon: true },
  { id: "job-board", label: "Job Search", icon: Briefcase },
  { id: "resumes", label: "My Resumes", icon: FileText },
  { id: "ats", label: "My Applications", icon: Share2, comingSoon: true},
  { id: "copilot", label: "Career Copilot", icon: Wand2, comingSoon: true},
  { id: "agents", label: "Agents", icon: Bot },
  { id: "mail", label: "Mail", icon: Mail },
  { id: "calendar", label: "Calendar", icon: Calendar, comingSoon: true },
  { id: "interviews", label: "Interview Prep", icon: Video, comingSoon: true },
  { id: "bid-management", label: "Bid Management", icon: Clapperboard },
  { id: "apps-plugins", label: "Apps & Plugins", icon: Puzzle },
  { id: "firebase", label: "Firebase Atlas", icon: Flame },
  { id: "reports", label: "Analytics", icon: BarChart2, comingSoon: true },
  { id: "ai-usage", label: "AI API Usage", icon: Cpu, admin: true },
  { id: "api-usage-monitor", label: "API Usage Monitor", icon: Gauge, admin: true },
  { id: "settings", label: "Settings", icon: Settings },
  { id: "changelog", label: "Changelog", icon: ScrollText },
];

export const NAV_GROUPS: { label: string | null; ids: View[] }[] = [
  { label: "WORKSPACE", ids: ["dashboard", "job-board", "resumes"] },
  { label: "PIPELINE", ids: ["ats", "copilot"] },
  {
    label: "TOOLS",
    ids: ["agents", "mail", "calendar", "interviews", "bid-management", "apps-plugins", "firebase"],
  },
  { label: "INSIGHTS", ids: ["reports", "ai-usage", "api-usage-monitor"] },
  { label: null, ids: ["settings", "changelog"] },
];

export const VIEW_TITLES: Record<View, string> = {
  dashboard: "Dashboard",
  "job-board": "Job Search",
  resumes: "Resume Generator",
  ats: "My Applications",
  copilot: "Career Copilot",
  agents: "AI Agents",
  mail: "Mail",
  calendar: "Calendar",
  interviews: "Interview Prep",
  reports: "Job Search Analytics",
  "ai-usage": "AI API Usage",
  "api-usage-monitor": "API Usage Monitor",
  "bid-management": "Bid Management",
  "apps-plugins": "Apps & Plugins",
  changelog: "Changelog",
  firebase: "Firebase Atlas",
  settings: "Settings",
};
