/** JSON schema for resume skill extraction LLM output. */
export const RESUME_SKILL_ANALYSIS_SCHEMA = {
	type: 'array',
	maxItems: 28,
	items: {
		type: 'object',
		required: ['name', 'category', 'level'],
		properties: {
			name: { type: 'string', minLength: 1 },
			category: {
				type: 'string',
				enum: ['hard', 'devops', 'tools', 'domain', 'soft'],
			},
			level: { type: 'integer', minimum: 2, maximum: 5 },
		},
	},
};

export const RESUME_SKILL_CATEGORIES = RESUME_SKILL_ANALYSIS_SCHEMA.items.properties.category.enum;
