/** Per-category caps — sized so every skill fits on one radar chart. */
export const RESUME_SKILL_CATEGORY_LIMITS = {
	hard: 10,
	devops: 6,
	tools: 6,
	domain: 5,
	soft: 4,
};

export const RESUME_SKILL_TOTAL_LIMIT = 28;

/** Drop level-1 filler when trimming; kept if category would otherwise be empty. */
export const RESUME_SKILL_TRIM_MIN_LEVEL = 2;
