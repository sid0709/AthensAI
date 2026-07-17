import type { BadgeVariant } from "@/app/types";

export interface JobSource {
  label: string;
  color: string;
  host?: string;
}

const SOURCE_RULES: { pattern: RegExp; label: string; color: string }[] = [
  { pattern: /ashbyhq\.com/i, label: "Ashby", color: "violet" },
  { pattern: /greenhouse\.io/i, label: "Greenhouse", color: "emerald" },
  { pattern: /lever\.co/i, label: "Lever", color: "blue" },
  { pattern: /myworkdayjobs\.com|workday\.com/i, label: "Workday", color: "amber" },
  { pattern: /workable\.com/i, label: "Workable", color: "blue" },
  { pattern: /smartrecruiters\.com/i, label: "SmartRecruiters", color: "violet" },
  { pattern: /jobvite\.com/i, label: "Jobvite", color: "pink" },
  { pattern: /icims\.com/i, label: "iCIMS", color: "amber" },
  { pattern: /taleo\.net/i, label: "Taleo", color: "subtle" },
  { pattern: /bamboohr\.com/i, label: "BambooHR", color: "success" },
  { pattern: /rippling\.com/i, label: "Rippling", color: "blue" },
  { pattern: /linkedin\.com/i, label: "LinkedIn", color: "blue" },
  { pattern: /indeed\.com/i, label: "Indeed", color: "blue" },
  { pattern: /glassdoor\.com/i, label: "Glassdoor", color: "success" },
  { pattern: /ziprecruiter\.com/i, label: "ZipRecruiter", color: "blue" },
  { pattern: /applytojob\.com|jazz\.co/i, label: "JazzHR", color: "pink" },
  { pattern: /recruitee\.com/i, label: "Recruitee", color: "violet" },
  { pattern: /teamtailor\.com/i, label: "Teamtailor", color: "pink" },
];

const COLOR_TO_BADGE: Record<string, BadgeVariant> = {
  violet: "violet",
  emerald: "success",
  blue: "blue",
  orange: "amber",
  amber: "amber",
  cyan: "blue",
  indigo: "violet",
  rose: "pink",
  slate: "subtle",
  lime: "success",
  sky: "blue",
  green: "success",
  teal: "blue",
  pink: "pink",
  red: "err",
  purple: "violet",
  neutral: "subtle",
};

export function detectJobSource(url: string | null | undefined): JobSource | null {
  const raw = String(url ?? "").trim();
  if (!raw) return null;
  try {
    const host = new URL(raw).hostname.replace(/^www\./i, "");
    for (const rule of SOURCE_RULES) {
      if (rule.pattern.test(host)) {
        return { label: rule.label, color: rule.color, host };
      }
    }
    const parts = host.split(".");
    const label = parts.length >= 2 ? parts[parts.length - 2] : host;
    return {
      label: label.charAt(0).toUpperCase() + label.slice(1),
      color: "neutral",
      host,
    };
  } catch {
    return null;
  }
}

export function jobSourceBadgeVariant(color: string): BadgeVariant {
  return COLOR_TO_BADGE[color] ?? "subtle";
}
