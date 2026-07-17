import { toCanonical } from "./skillNormalize.js";
import {
	normalizeResumeSkillEntry,
	compareResumeSkills,
	capResumeSkillProfile,
	normalizeSkillCategory,
	normalizeSkillLevel,
	legacyStrengthToLevel,
} from "./resumeSkillEntry.js";

const SKILL_ALIASES = [
	["go", "golang"],
	["nodejs", "node.js"],
	["postgres", "postgresql"],
	["k8s", "kubernetes"],
	["githubactions", "github actions"],
];

const GENERIC_STACK_RE =
	/^(languages?|frameworks?(?:\s*&\s*libraries?)?|cloud|devops|databases?|tools?|skills?|backend|frontend|other)$/i;

function skillKey(name) {
	return toCanonical(String(name ?? "").trim()) || String(name).toLowerCase();
}

function cleanString(v) {
	return String(v ?? "").trim();
}

function applyAliasMerges(map) {
	for (const [aliasKey, canonicalName] of SKILL_ALIASES) {
		const canonKey = skillKey(canonicalName);
		const alias = map.get(aliasKey);
		const canon = map.get(canonKey);

		if (alias && canon) {
			if (alias.level > canon.level) {
				map.set(canonKey, { ...alias, name: canonicalName });
			}
			map.delete(aliasKey);
		} else if (alias && !canon) {
			map.set(canonKey, { ...alias, name: canonicalName });
			map.delete(aliasKey);
		}
	}
}

function parseSkillArray(parsed) {
	if (!Array.isArray(parsed)) throw new Error("LLM skill profile must be a JSON array");

	const out = [];
	const seen = new Set();
	for (const item of parsed) {
		const entry = normalizeResumeSkillEntry(item);
		if (!entry) continue;
		const key = skillKey(entry.name);
		if (seen.has(key)) continue;
		seen.add(key);
		out.push(entry);
	}

	if (!out.length) throw new Error("LLM returned no usable skills");
	return out.sort(compareResumeSkills);
}

/** Parse LLM JSON array of { name, category, level } entries (uploaded resume analysis). */
export function parseSkillProfileJson(content) {
	const raw = String(content || "").trim();
	const jsonMatch = raw.match(/\[[\s\S]*\]/);
	const jsonStr = jsonMatch ? jsonMatch[0] : raw;
	let parsed;
	try {
		parsed = JSON.parse(jsonStr);
	} catch {
		throw new Error("LLM returned invalid JSON for skill profile");
	}
	return parseSkillArray(parsed);
}

/** Parse generated-resume analysis: { techStack, skills } or legacy array. */
export function parseGeneratedSkillAnalysis(content) {
	const raw = String(content || "").trim();
	const fenced = raw.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "").trim();

	let parsed;
	try {
		parsed = JSON.parse(fenced);
	} catch {
		const objMatch = fenced.match(/\{[\s\S]*\}/);
		const arrMatch = fenced.match(/\[[\s\S]*\]/);
		if (objMatch) {
			parsed = JSON.parse(objMatch[0]);
		} else if (arrMatch) {
			return { techStack: null, skills: parseSkillArray(JSON.parse(arrMatch[0])) };
		} else {
			throw new Error("LLM returned invalid JSON for skill profile");
		}
	}

	if (parsed && Array.isArray(parsed.skills)) {
		return {
			techStack: cleanString(parsed.techStack) || null,
			skills: parseSkillArray(parsed.skills),
		};
	}
	if (Array.isArray(parsed)) {
		return { techStack: null, skills: parseSkillArray(parsed) };
	}
	throw new Error("LLM skill analysis must include a skills array");
}

export function sanitizeTechStackLabel(label) {
	const s = cleanString(label).replace(/\s+/g, " ");
	if (!s || s.length > 48) return null;
	if (GENERIC_STACK_RE.test(s)) return null;
	if (/^(languages?|frameworks?)\s*\+/i.test(s)) return null;
	return s;
}

/** Build a short label from top weighted skills when LLM omits techStack. */
export function fallbackTechStackLabel(skillProfile) {
	const top = [...(skillProfile || [])].sort(compareResumeSkills);
	const names = top
		.map((s) => cleanString(s.name))
		.filter((n) => n && !GENERIC_STACK_RE.test(n))
		.slice(0, 2);
	if (!names.length) return "Generated";
	if (names.length === 1) return names[0].slice(0, 48);
	return `${names[0]} + ${names[1]}`.slice(0, 48);
}

/** Score catalog stack names against weighted skill profile; return best match. */
export function matchCatalogTechStack(skillProfile, catalog) {
	if (!catalog || typeof catalog !== "object" || Array.isArray(catalog)) return null;
	const weights = new Map();
	for (const s of skillProfile || []) {
		const key = skillKey(s.name);
		const score = Number(s.level) || legacyStrengthToLevel(s.strength);
		const prev = weights.get(key) ?? 0;
		weights.set(key, Math.max(prev, score * 2));
	}
	if (!weights.size) return null;

	let best = null;
	let bestScore = 0;
	for (const [stackName, stackSkills] of Object.entries(catalog)) {
		if (!stackSkills || typeof stackSkills !== "object") continue;
		let score = 0;
		for (const [skill, weight] of Object.entries(stackSkills)) {
			const w = weights.get(skillKey(skill));
			if (w != null) score += w * (Number(weight) || 1);
		}
		if (score > bestScore) {
			bestScore = score;
			best = stackName;
		}
	}
	return bestScore >= 25 ? best : null;
}

/** Resolve final techStack: LLM label → catalog match → top-skill fallback. */
export function resolveTechStackLabel({ llmLabel, skillProfile, catalog, jobDescription }) {
	const sanitized = sanitizeTechStackLabel(llmLabel);
	if (sanitized) return sanitized;

	const catalogMatch = matchCatalogTechStack(skillProfile, catalog);
	if (catalogMatch) return catalogMatch.slice(0, 48);

	const fallback = fallbackTechStackLabel(skillProfile);
	if (fallback !== "Generated") return fallback;

	const jd = cleanString(jobDescription);
	if (jd.length > 0 && jd.length <= 48) return jd;
	if (jd.length > 48) return `${jd.slice(0, 45)}…`;
	return "Generated";
}

/** Dedupe + alias-merge LLM skill output — no heuristic text parsing. */
export function finalizeLlmSkillProfile(llmSkills) {
	const map = new Map();
	for (const item of llmSkills || []) {
		const entry = normalizeResumeSkillEntry(item);
		if (!entry) continue;
		const key = skillKey(entry.name);
		const prev = map.get(key);
		if (!prev || entry.level > prev.level) {
			map.set(key, entry);
		}
	}
	applyAliasMerges(map);
	return capResumeSkillProfile([...map.values()].sort(compareResumeSkills));
}

export { normalizeSkillCategory, normalizeSkillLevel, legacyStrengthToLevel };
