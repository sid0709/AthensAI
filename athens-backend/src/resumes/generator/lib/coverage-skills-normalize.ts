import { toCanonical } from '@nextoffer/shared/skill-normalize';
import { cleanString } from './clean-string';
import { normalizeResumeCoverageContract } from './coverage-contract-core';

type EvidenceEntry = {
  roleIndex: number | null;
  company: string;
  title: string;
  excerpt: string;
};

type ContractSkill = {
  id: string;
  name: string;
  aliases: string[];
  category: unknown;
  decision: string;
  allowedPlacements: string[];
  requiredPlacements: string[];
  evidence?: EvidenceEntry[];
};

type CoverageContract = {
  skills: ContractSkill[];
  excluded: Array<{ name?: unknown }>;
};

function asContract(raw: unknown): CoverageContract | null {
  const contract = normalizeResumeCoverageContract(raw);
  if (!contract) return null;
  return {
    skills: (contract.skills as ContractSkill[]).map((skill) => ({
      ...skill,
      aliases: Array.isArray(skill.aliases)
        ? skill.aliases.map((a) => cleanString(a))
        : [],
      allowedPlacements: Array.isArray(skill.allowedPlacements)
        ? skill.allowedPlacements.map(String)
        : ['skills'],
      requiredPlacements: Array.isArray(skill.requiredPlacements)
        ? skill.requiredPlacements.map(String)
        : ['skills'],
      evidence: Array.isArray(skill.evidence) ? skill.evidence : [],
    })),
    excluded: Array.isArray(contract.excluded)
      ? (contract.excluded as Array<{ name?: unknown }>)
      : [],
  };
}

function skillItemKey(value: unknown): string {
  return toCanonical(cleanString(value).replace(/\*\*/g, ''));
}

function coverageCategoryLabel(value: unknown): string {
  const name = cleanString(value).replace(/[_-]+/g, ' ');
  if (!name) return 'Skills';
  return name.replace(/\b\w/g, (character) => character.toUpperCase());
}

/** Normalize model-authored Skills into the exact closed set required by coverage. */
export function normalizeSkillsSectionToContract(
  section: unknown,
  rawContract: unknown,
) {
  const contract = asContract(rawContract);
  if (!contract) return section;
  const required = contract.skills.filter((skill) =>
    skill.requiredPlacements.includes('skills'),
  );
  const sourceGroups = Array.isArray((section as { skills?: unknown })?.skills)
    ? ((section as { skills: unknown[] }).skills as Record<string, unknown>[])
    : [];
  const matches = new Map<string, string>();
  const categoryByType = new Map<string, string>();
  for (const group of sourceGroups) {
    const category = cleanString(group?.category) || 'Skills';
    for (const item of Array.isArray(group?.items)
      ? (group.items as unknown[])
      : []) {
      const key = skillItemKey(item);
      if (!key) continue;
      const skill = required.find((candidate) =>
        [candidate.name, ...candidate.aliases].some(
          (name) => toCanonical(cleanString(name)) === key,
        ),
      );
      if (!skill || matches.has(skill.id)) continue;
      matches.set(skill.id, category);
      const catKey = cleanString(skill.category);
      if (catKey && !categoryByType.has(catKey)) {
        categoryByType.set(catKey, category);
      }
    }
  }

  const groups = new Map<string, string[]>();
  for (const skill of required) {
    const category =
      matches.get(skill.id) ||
      categoryByType.get(cleanString(skill.category)) ||
      coverageCategoryLabel(skill.category);
    if (!groups.has(category)) groups.set(category, []);
    groups.get(category)!.push(`**${skill.name}**`);
  }
  return {
    skills: [...groups].map(([category, items]) => ({ category, items })),
  };
}

export function resumeCoveragePrompt(rawContract: unknown): string {
  const contract = asContract(rawContract);
  if (!contract) return '';
  const skills = contract.skills.filter((skill) =>
    skill.requiredPlacements.includes('skills'),
  );
  const experience = contract.skills.filter((skill) =>
    skill.requiredPlacements.includes('experience'),
  );
  const optionalExperience = contract.skills.filter(
    (skill) =>
      skill.allowedPlacements.includes('experience') &&
      !skill.requiredPlacements.includes('experience'),
  );
  const familiar = contract.skills.filter(
    (skill) => skill.decision === 'familiar',
  );
  const excluded = contract.excluded
    .map((item) => cleanString(item?.name))
    .filter(Boolean);
  const evidenceLines = contract.skills
    .filter((skill) => skill.allowedPlacements.includes('experience'))
    .map((skill) => {
      const roles = (skill.evidence || []).map((item) => {
        const index = Number.isInteger(item.roleIndex)
          ? `role #${(item.roleIndex as number) + 1}`
          : 'profile role';
        return [index, item.title, item.company].filter(Boolean).join(' ');
      });
      return `${skill.name}: ${roles.join('; ') || 'candidate-confirmed; use in one suitable role only'}`;
    });
  return [
    'RESUME COVERAGE INSTRUCTIONS — use these requested placements while generating the structured sections.',
    `Skills section closed set (exact canonical names, each bolded once): ${skills.map((s) => s.name).join(', ') || 'none'}`,
    `Required Experience terms (each needs one primary, evidence-grounded bullet): ${experience.map((s) => s.name).join(', ') || 'none'}`,
    optionalExperience.length
      ? `Optional Used terms permitted in Experience only where their role evidence supports them: ${optionalExperience.map((s) => s.name).join(', ')}.`
      : '',
    evidenceLines.length
      ? `Experience role evidence:\n${evidenceLines.join('\n')}`
      : '',
    familiar.length
      ? `Familiar-only terms: ${familiar.map((s) => s.name).join(', ')}. These may appear in Skills but must not be claimed in Experience.`
      : '',
    excluded.length
      ? `Excluded terms: ${excluded.join(', ')}. Do not add these to the resume.`
      : '',
    'For every assigned placement, use the exact canonical spelling and wrap its first meaningful occurrence exactly as **Canonical Skill Name**.',
    'In Skills, return exactly one standalone item per assigned term, formatted only as **Canonical Skill Name**. Add no descriptions, compound items, repeated terms, subcategory items, or other skills; category labels are grouping labels only.',
    "In Experience, put target skills only inside complete, credible bullets. Each placement must connect a concrete task or workflow, the skill's technical function, and a practical purpose.",
    'Prefer zero to two target skills per Experience bullet and never more than three. Do not mention one skill in more than two bullets within a role.',
    'A candidate-confirmed skill without profile-role evidence may appear in one suitable role only. Never use a standalone keyword-list bullet, and never infer related products, projects, metrics, ownership, or achievements.',
  ]
    .filter(Boolean)
    .join('\n');
}
