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
): ProfileMatchContext {
  return { profileTokens, profileCompacts };
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
  const skillNames =
    job.skills.length > 0
      ? job.skills
      : (job.aiSkills?.map((s) => s.name).filter(Boolean) ?? []);
  const highlights = computeSkillHighlights(skillNames, ctx);
  const covered = highlights.filter((h) => h.matched).length;
  const required = highlights.length;
  const skill = required ? Math.round((covered / required) * 100) : job.scores.skill;
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
