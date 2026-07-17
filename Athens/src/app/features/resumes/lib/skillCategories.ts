import type { UserSkillCategory } from "../../job-search/hooks/useProfileMatchSkills";

export const CATEGORY_META: Record<UserSkillCategory, { label: string; chip: string }> = {
  hard: { label: "Hard skills", chip: "border-violet-500/40 bg-violet-500/10" },
  devops: { label: "DevOps", chip: "border-sky-500/40 bg-sky-500/10" },
  tools: { label: "Tools", chip: "border-emerald-500/40 bg-emerald-500/10" },
  domain: { label: "Domain", chip: "border-amber-500/40 bg-amber-500/10" },
  soft: { label: "Soft skills", chip: "border-rose-500/40 bg-rose-500/10" },
};

export const CATEGORY_ORDER: UserSkillCategory[] = ["hard", "devops", "tools", "domain", "soft"];

export function normalizeSkillCategory(raw: unknown): UserSkillCategory {
  const c = String(raw ?? "").trim().toLowerCase();
  if (c === "hard" || c === "devops" || c === "tools" || c === "domain" || c === "soft") {
    return c;
  }
  return "hard";
}

export function legacyStrengthToLevel(strength: number): number {
  if (!Number.isFinite(strength) || strength <= 0) return 3;
  if (strength <= 5) return Math.max(1, Math.min(5, Math.round(strength)));
  return Math.max(1, Math.min(5, Math.round(strength / 2)));
}

export function resolveSkillLevel(entry: { level?: number; strength?: number }): number {
  if (entry.level != null && Number.isFinite(entry.level)) {
    return Math.max(1, Math.min(5, Math.round(entry.level)));
  }
  if (entry.strength != null) return legacyStrengthToLevel(entry.strength);
  return 3;
}

export type CategorizedSkill = {
  name: string;
  category: UserSkillCategory;
  level: number;
};

export function groupSkillsByCategory(skills: CategorizedSkill[]) {
  const byCategory = new Map<UserSkillCategory, CategorizedSkill[]>();
  for (const skill of skills) {
    const list = byCategory.get(skill.category) ?? [];
    list.push(skill);
    byCategory.set(skill.category, list);
  }
  return CATEGORY_ORDER.map((category) => ({
    category,
    items: (byCategory.get(category) ?? []).sort(
      (a, b) => b.level - a.level || a.name.localeCompare(b.name),
    ),
  })).filter((g) => g.items.length > 0);
}

export const CATEGORY_RADAR_COLORS: Record<UserSkillCategory, string> = {
  hard: "#8b5cf6",
  devops: "#0ea5e9",
  tools: "#10b981",
  domain: "#f59e0b",
  soft: "#f43f5e",
};

export function shortenSkillLabel(name: string, max = 14): string {
  const n = name.trim();
  if (n.length <= max) return n;
  return `${n.slice(0, max - 1)}…`;
}

/** All skills in a category → radar axes (level 1–5 mapped to 0–100). */
export function categoryRadarData(items: CategorizedSkill[]) {
  return items.map((s) => ({
    dim: shortenSkillLabel(s.name, items.length > 8 ? 10 : 14),
    strength: s.level * 20,
  }));
}

export function categoryRadarHeight(itemCount: number): number {
  if (itemCount <= 0) return 0;
  return Math.min(380, Math.max(220, 160 + itemCount * 14));
}
