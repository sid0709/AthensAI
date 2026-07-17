import { API_BASE } from "@/lib/api-base";

export type DictionarySkill = {
  name: string;
  nameCanonical: string;
  category: "hard" | "soft" | "devops" | "tools" | "domain";
  jobCount: number;
  requirementAvg: number;
};

export async function searchSkillDictionary(
  q: string,
  { mode = "prefix", limit = 12 }: { mode?: "prefix" | "contains"; limit?: number } = {},
): Promise<DictionarySkill[]> {
  const params = new URLSearchParams({ q, mode, limit: String(limit) });
  const res = await fetch(`${API_BASE}/personal/skill-dictionary?${params}`);
  if (!res.ok) return [];
  const data = (await res.json()) as { success?: boolean; skills?: DictionarySkill[] };
  return data.skills ?? [];
}

export async function fetchSkillCoverage(skill: string): Promise<number> {
  const params = new URLSearchParams({ skill });
  const res = await fetch(`${API_BASE}/personal/skill-dictionary/coverage?${params}`);
  if (!res.ok) return 0;
  const data = (await res.json()) as { success?: boolean; covered?: number };
  return data.covered ?? 0;
}
