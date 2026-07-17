import {
	USER_SKILL_CATEGORIES,
	USER_SKILL_LEVEL_MIN,
	USER_SKILL_LEVEL_MAX,
} from '../config/graphAndVectorConfig.js';
import {
	RESUME_SKILL_CATEGORY_LIMITS,
	RESUME_SKILL_TOTAL_LIMIT,
	RESUME_SKILL_TRIM_MIN_LEVEL,
} from '../config/resumeSkillLimits.js';

export function normalizeSkillCategory(raw) {
	const c = String(raw ?? '')
		.trim()
		.toLowerCase();
	return USER_SKILL_CATEGORIES.includes(c) ? c : 'hard';
}

/** Map legacy 0.1–10 strength scores to proficiency level 1–5. */
export function legacyStrengthToLevel(strength) {
	const s = Number(strength);
	if (!Number.isFinite(s) || s <= 0) return 3;
	if (s <= USER_SKILL_LEVEL_MAX) {
		return Math.max(USER_SKILL_LEVEL_MIN, Math.min(USER_SKILL_LEVEL_MAX, Math.round(s)));
	}
	return Math.max(
		USER_SKILL_LEVEL_MIN,
		Math.min(USER_SKILL_LEVEL_MAX, Math.round(s / 2)),
	);
}

export function normalizeSkillLevel(raw, { legacyStrength } = {}) {
	if (raw != null && raw !== '') {
		const n = Number.parseInt(String(raw), 10);
		if (Number.isFinite(n)) {
			return Math.max(USER_SKILL_LEVEL_MIN, Math.min(USER_SKILL_LEVEL_MAX, n));
		}
	}
	if (legacyStrength != null) return legacyStrengthToLevel(legacyStrength);
	return 3;
}

/** Canonical resume skill entry stored on user_resumes.skillProfile. */
export function normalizeResumeSkillEntry(item) {
	if (!item || typeof item !== 'object') return null;
	const name = String(item.name ?? item.skill ?? '').trim();
	if (!name) return null;

	const level = normalizeSkillLevel(item.level, { legacyStrength: item.strength ?? item.score });
	const category = normalizeSkillCategory(item.category);

	return { name, category, level };
}

export function compareResumeSkills(a, b) {
	if (b.level !== a.level) return b.level - a.level;
	return a.name.localeCompare(b.name);
}

export function resumeSkillSortValue(entry) {
	return Number(entry?.level) || 0;
}

/** Keep highest-level skills per category up to configured caps. */
export function capResumeSkillProfile(skills = []) {
	const normalized = skills
		.map((item) => normalizeResumeSkillEntry(item))
		.filter(Boolean)
		.sort(compareResumeSkills);

	const byCategory = new Map();
	for (const cat of USER_SKILL_CATEGORIES) {
		byCategory.set(cat, []);
	}
	for (const entry of normalized) {
		byCategory.get(entry.category)?.push(entry);
	}

	const capped = [];
	for (const cat of USER_SKILL_CATEGORIES) {
		const limit = RESUME_SKILL_CATEGORY_LIMITS[cat] ?? 6;
		let items = byCategory.get(cat) ?? [];
		const aboveMin = items.filter((s) => s.level >= RESUME_SKILL_TRIM_MIN_LEVEL);
		if (aboveMin.length) items = aboveMin;
		capped.push(...items.slice(0, limit));
	}

	capped.sort(compareResumeSkills);
	return capped.slice(0, RESUME_SKILL_TOTAL_LIMIT);
}
