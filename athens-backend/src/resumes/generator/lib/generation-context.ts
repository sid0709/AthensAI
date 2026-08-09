import { cleanString } from './clean-string';

type CareerLike = { description?: unknown };
type IdentityLike = { careers?: CareerLike[] };

function careersMissingEvidence(identity: IdentityLike | null | undefined) {
  const careers = Array.isArray(identity?.careers) ? identity.careers : [];
  return careers.filter((career) => !cleanString(career?.description));
}

/** Optional guidance when profile career descriptions are blank. */
export function optionalCareerDetailsPrompt(
  identity: IdentityLike | null | undefined,
): string {
  const missing = careersMissingEvidence(identity);
  if (!missing.length) return '';
  return `OPTIONAL CAREER DETAILS — ${missing.length} career description${
    missing.length === 1 ? ' is' : 's are'
  } blank.
Career descriptions are optional and blank descriptions must not produce empty Experience roles. Treat Skill Coverage terms marked Used as explicitly confirmed candidate experience. Distribute those confirmed terms conservatively among suitable roles based on title and chronology, and write non-quantified bullets describing their technical function and practical purpose from the job description.
Use each candidate-confirmed term in at most one suitable blank role unless separate role evidence is supplied. Keep a blank role to one or two conservative bullets and do not invent employer-specific facts, metrics, achievements, project names, internal systems, team size, ownership, or technologies outside the confirmed Used set.`;
}

/** Stable candidate profile block for prompt-cache friendly system content. */
export function buildContextBlock(
  identity: Record<string, unknown> | null | undefined,
): string {
  return `CANDIDATE PROFILE — these are authoritative facts. Do not invent employers, dates, schools, or credentials.\n\n${JSON.stringify(
    identity ?? {},
    null,
    2,
  )}`;
}
