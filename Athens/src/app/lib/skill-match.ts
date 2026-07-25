import type { Job } from "../types";

/** Client mirror of @nextoffer/shared skill-tokens + skill-compact + skill-match */

export function compactSkillText(skill: string): string {
  return String(skill ?? "")
    .trim()
    .toLowerCase()
    .replace(/[\s\-–—_,;:()[\]{}'"`\\/|]/g, "");
}

const MIN_COMPACT_LEN = 2;
const MIN_TOKEN_LEN = 2;
/** Min length for the substring fallback so short tokens (e.g. "ai") can't match "gmail"/"training". */
const SHIM_MIN_LEN = 5;

/** Role-agnostic filler words dropped from token matching (mirror of @nextoffer/shared). */
const STOP_TOKENS = new Set([
  "development",
  "management",
  "engineering",
  "solution", "solutions",
  "system", "systems",
  "application", "applications",
  "service", "services",
  "framework", "frameworks",
  "architecture",
  "programming",
  "platform", "platforms",
  "tool", "tools",
  "workflow", "workflows",
  "pipeline", "pipelines",
]);

/** Split a skill into lowercase word tokens (AI/ML System → ai, ml). */
export function skillTokens(skill: string): string[] {
  const lower = String(skill ?? "").toLowerCase();
  if (!lower) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (let part of lower.split(/[^a-z0-9+#.]+/)) {
    part = part.replace(/^\.+|\.+$/g, "");
    if (part.length < MIN_TOKEN_LEN) continue;
    if (!/[a-z0-9]/.test(part)) continue;
    if (STOP_TOKENS.has(part)) continue;
    if (seen.has(part)) continue;
    seen.add(part);
    out.push(part);
  }
  return out;
}

export type ProfileMatchContext = {
  profileTokens: string[];
  profileCompacts: string[];
  tokenWeights?: Record<string, number>;
  compactWeights?: { c: string; w: number }[];
  categoryWeights?: Record<string, number>;
};

export function buildProfileCompacts(skills: string[] = []): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of skills) {
    const compact = compactSkillText(raw);
    if (!compact || compact.length < MIN_COMPACT_LEN || seen.has(compact)) continue;
    seen.add(compact);
    out.push(compact);
  }
  return out;
}

export function buildClientMatchContext(
  profileTokens: string[] = [],
  profileCompacts: string[] = [],
  tokenWeights: Record<string, number> = {},
  compactWeights: { c: string; w: number }[] = [],
  categoryWeights: Record<string, number> = {},
): ProfileMatchContext {
  return { profileTokens, profileCompacts, tokenWeights, compactWeights, categoryWeights };
}

function matchProficiency(jobSkill: string, ctx: ProfileMatchContext): number {
  let best = 0;
  for (const token of skillTokens(jobSkill)) {
    best = Math.max(best, Number(ctx.tokenWeights?.[token]) || 0);
  }
  const jobCompact = compactSkillText(jobSkill);
  if (jobCompact) {
    for (const { c, w } of ctx.compactWeights ?? []) {
      if (!c || c.length < SHIM_MIN_LEN || w <= best) continue;
      if (jobCompact.includes(c) || (jobCompact.length >= SHIM_MIN_LEN && c.includes(jobCompact))) {
        best = w;
      }
    }
  }
  return best;
}

export function jobSkillMatchesProfile(jobSkill: string, ctx: ProfileMatchContext): boolean {
  const tokens = skillTokens(jobSkill);
  if (!tokens.length) return false;

  if (ctx.profileTokens?.length) {
    const profileTokenSet = new Set(ctx.profileTokens);
    for (const token of tokens) {
      if (profileTokenSet.has(token)) return true;
    }
  }

  if (ctx.profileCompacts?.length) {
    const jobCompact = compactSkillText(jobSkill);
    if (jobCompact) {
      for (const profile of ctx.profileCompacts) {
        if (profile.length < SHIM_MIN_LEN) continue;
        if (jobCompact.includes(profile)) return true;
        if (jobCompact.length >= SHIM_MIN_LEN && profile.includes(jobCompact)) return true;
      }
    }
  }

  return false;
}

export function computeSkillHighlights(
  jobSkills: string[],
  ctx: ProfileMatchContext,
): { name: string; matched: boolean }[] {
  return jobSkills.map((name) => ({
    name,
    matched: jobSkillMatchesProfile(name, ctx),
  }));
}

export function rescoreJobWithContext(job: Job, ctx: ProfileMatchContext): Job {
  const weighted = Boolean(Object.keys(ctx.tokenWeights ?? {}).length || ctx.compactWeights?.length);
  const rawSkillRows = job.aiSkills?.length
    ? job.aiSkills
    : job.skills.map((name) => ({ name, category: "hard", requirement: 1 }));
  const seenSkills = new Set<string>();
  const skillRows = rawSkillRows.filter(({ name }) => {
    const key = String(name).trim().toLowerCase();
    if (!key || seenSkills.has(key)) return false;
    seenSkills.add(key);
    return true;
  });
  let denominator = 0;
  let numerator = 0;
  const highlights = skillRows.map(({ name, category, requirement }) => {
    const proficiency = weighted ? matchProficiency(name, ctx) : Number(jobSkillMatchesProfile(name, ctx));
    const categoryWeight = Number(ctx.categoryWeights?.[category] ?? ctx.categoryWeights?.hard ?? 1);
    const contribution = Math.max(1, Number(requirement) || 1) * categoryWeight;
    denominator += contribution;
    numerator += contribution * proficiency;
    return { name, matched: proficiency > 0 };
  });
  const covered = highlights.filter((highlight) => highlight.matched).length;
  const required = highlights.length;
  const skill = denominator ? Math.round((numerator / denominator) * 100) : job.scores.skill;
  const vector = job.scores.vector;
  const overall =
    vector != null && vector > 0
      ? Math.round(0.55 * skill + 0.45 * vector)
      : skill;

  return {
    ...job,
    skillHighlights: highlights,
    scores: {
      ...job.scores,
      skill,
      overall,
      skillsCovered: covered,
      skillsRequired: required,
    },
    matchScore: overall,
  };
}

/**
 * Align list-card scores with the JD modal: keep backend highlights when present,
 * otherwise recompute coverage from the current profile match context.
 */
export function alignJobScoreForDisplay(job: Job, ctx: ProfileMatchContext | null | undefined): Job {
  if (!ctx?.profileTokens.length && !ctx?.profileCompacts.length) return job;
  if (job.skillHighlights?.length) return job;
  const hasSkills = job.skills.length > 0 || (job.aiSkills?.length ?? 0) > 0;
  if (!hasSkills) return job;
  return rescoreJobWithContext(job, ctx);
}
