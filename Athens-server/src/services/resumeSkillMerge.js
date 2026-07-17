import { toCanonical } from "../services/skillNormalize.js";
import {
	normalizeResumeSkillEntry,
	compareResumeSkills,
	capResumeSkillProfile,
} from "./resumeSkillEntry.js";

const SKILL_ALIASES = [
	["go", "golang"],
	["nodejs", "node.js"],
	["postgres", "postgresql"],
	["k8s", "kubernetes"],
	["githubactions", "github actions"],
];

function skillKey(name) {
	return toCanonical(String(name ?? "").trim()) || String(name).toLowerCase();
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

/** Dedupe and alias-merge LLM skill output — no Skills-section flood. */
export function mergeSkillProfiles(llmSkills, _resumeText) {
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
