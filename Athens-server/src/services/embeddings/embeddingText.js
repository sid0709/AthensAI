const MAX_RESUME_TEXT = 8000;
const MAX_SKILL_LINES = 80;

function resolveEntryLevel(item) {
	if (item?.level != null) {
		const n = Number.parseInt(String(item.level), 10);
		if (Number.isFinite(n)) return Math.max(1, Math.min(5, n));
	}
	const strength = Number(item?.strength ?? item?.score ?? 0);
	if (Number.isFinite(strength) && strength > 0) {
		if (strength <= 5) return Math.max(1, Math.min(5, Math.round(strength)));
		return Math.max(1, Math.min(5, Math.round(strength / 2)));
	}
	return 0;
}

function sortSkillProfile(skillProfile = []) {
	return [...skillProfile]
		.map((item) => {
			const name = String(item?.name ?? item?.skill ?? '').trim();
			const level = resolveEntryLevel(item);
			const category = String(item?.category ?? 'hard').trim().toLowerCase();
			return { name, category, level };
		})
		.filter((item) => item.name && item.level > 0)
		.sort((a, b) => b.level - a.level || a.name.localeCompare(b.name));
}

function formatSkillProfile(skillProfile = []) {
	const lines = [];
	for (const item of sortSkillProfile(skillProfile).slice(0, MAX_SKILL_LINES)) {
		lines.push(`${item.name} L${item.level} (${item.category})`);
	}
	return lines.join(', ');
}

export function buildResumeEmbeddingText(resumeDoc) {
	const techStack = String(resumeDoc?.techStack ?? '').trim();
	const skillLine = formatSkillProfile(resumeDoc?.skillProfile);
	const text = String(resumeDoc?.extractedText ?? '').trim();
	const truncatedText = text.length > MAX_RESUME_TEXT
		? `${text.slice(0, MAX_RESUME_TEXT)}\n[truncated]`
		: text;

	const parts = [];
	if (techStack) parts.push(`Tech stack: ${techStack}`);
	if (skillLine) parts.push(`Skills: ${skillLine}`);
	if (truncatedText) parts.push(truncatedText);
	return parts.join('\n\n').trim();
}

/**
 * Aggregated profile embedding text — driven by this user's resumes, not global role rules.
 */
export function buildProfileEmbeddingText(ownerName, skillProfile = [], { primaryStacks = [] } = {}) {
	const name = String(ownerName || '').trim();
	const skillLine = formatSkillProfile(skillProfile);
	const stacks = (primaryStacks || []).map((s) => String(s).trim()).filter(Boolean);

	const parts = [];
	if (name) parts.push(`Professional profile: ${name}`);
	if (stacks.length) parts.push(`Primary stacks: ${stacks.join(', ')}`);
	if (skillLine) parts.push(`Skills: ${skillLine}`);
	return parts.join('\n\n').trim();
}

const MAX_JOB_DESCRIPTION = 4000;

export function buildJobEmbeddingText(jobDoc) {
	const enriched = jobDoc?.skills?.length
		? jobDoc
		: { ...jobDoc, skills: [] };
	const skills = Array.isArray(enriched.skills)
		? enriched.skills.map((s) => String(s).trim()).filter(Boolean)
		: [];
	const title = String(jobDoc?.title ?? '').trim();
	const company = String(jobDoc?.company?.name ?? jobDoc?.company ?? '').trim();
	const seniority = String(jobDoc?.details?.seniority ?? '').trim();
	const description = String(jobDoc?.description ?? '').trim();
	const truncatedDescription = description.length > MAX_JOB_DESCRIPTION
		? `${description.slice(0, MAX_JOB_DESCRIPTION)}\n[truncated]`
		: description;

	const parts = [];
	if (title) parts.push(`Title: ${title}`);
	if (company) parts.push(`Company: ${company}`);
	if (seniority) parts.push(`Seniority: ${seniority}`);
	if (skills.length) parts.push(`Required skills: ${skills.join(', ')}`);
	if (truncatedDescription) parts.push(`Description: ${truncatedDescription}`);
	return parts.join('\n\n').trim();
}

export { resolveEntryLevel };
