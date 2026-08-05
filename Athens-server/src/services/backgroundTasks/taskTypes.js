export const BACKGROUND_TASK_TYPES = Object.freeze({
	RESUME_GENERATION: 'resume_generation',
	TITLE_REVIEW: 'title_review',
	SKILL_EXTRACTION: 'skill_extraction',
	RESUME_SKILL_ANALYSIS: 'resume_skill_analysis',
	MAIL_AI_LABEL: 'mail_ai_label',
	JOB_ANALYSIS: 'job_analysis',
	SKILL_ENRICHMENT: 'skill_enrichment',
	JOB_REMOVAL: 'job_removal',
	RESUME_REMOVAL: 'resume_removal',
	RESUME_IDENTITY_REFRESH: 'resume_identity_refresh',
	JOB_STATUS_VISIBILITY: 'job_status_visibility',
	RENDER_RESUME_PDF: 'render_resume_pdf',
	RENDER_RESUME_IDENTITY_PDF: 'render_resume_identity_pdf',
});

export const BACKGROUND_TASK_STATUS = Object.freeze({
	QUEUED: 'queued',
	RUNNING: 'running',
	CANCELLING: 'cancelling',
	CANCELLED: 'cancelled',
	COMPLETED: 'completed',
	COMPLETED_WITH_ERRORS: 'completed_with_errors',
	FAILED: 'failed',
});

export const ACTIVE_TASK_STATUSES = new Set([
	BACKGROUND_TASK_STATUS.QUEUED,
	BACKGROUND_TASK_STATUS.RUNNING,
	BACKGROUND_TASK_STATUS.CANCELLING,
]);

export const TERMINAL_TASK_STATUSES = new Set([
	BACKGROUND_TASK_STATUS.CANCELLED,
	BACKGROUND_TASK_STATUS.COMPLETED,
	BACKGROUND_TASK_STATUS.COMPLETED_WITH_ERRORS,
	BACKGROUND_TASK_STATUS.FAILED,
]);

export const SINGLETON_TASK_TYPES = new Set([
	BACKGROUND_TASK_TYPES.TITLE_REVIEW,
	BACKGROUND_TASK_TYPES.SKILL_EXTRACTION,
	BACKGROUND_TASK_TYPES.SKILL_ENRICHMENT,
	BACKGROUND_TASK_TYPES.RESUME_IDENTITY_REFRESH,
]);

export const TASK_LANES = Object.freeze({
	AI: 'ai',
	IO: 'io',
	PDF: 'pdf',
	CLEANUP: 'cleanup',
});

const TYPE_TO_LANE = Object.freeze({
	[BACKGROUND_TASK_TYPES.RESUME_GENERATION]: TASK_LANES.AI,
	[BACKGROUND_TASK_TYPES.TITLE_REVIEW]: TASK_LANES.AI,
	[BACKGROUND_TASK_TYPES.SKILL_EXTRACTION]: TASK_LANES.AI,
	[BACKGROUND_TASK_TYPES.RESUME_SKILL_ANALYSIS]: TASK_LANES.AI,
	[BACKGROUND_TASK_TYPES.MAIL_AI_LABEL]: TASK_LANES.AI,
	[BACKGROUND_TASK_TYPES.JOB_ANALYSIS]: TASK_LANES.AI,
	[BACKGROUND_TASK_TYPES.SKILL_ENRICHMENT]: TASK_LANES.AI,
	[BACKGROUND_TASK_TYPES.JOB_REMOVAL]: TASK_LANES.IO,
	[BACKGROUND_TASK_TYPES.RESUME_REMOVAL]: TASK_LANES.IO,
	[BACKGROUND_TASK_TYPES.RESUME_IDENTITY_REFRESH]: TASK_LANES.IO,
	[BACKGROUND_TASK_TYPES.JOB_STATUS_VISIBILITY]: TASK_LANES.IO,
	[BACKGROUND_TASK_TYPES.RENDER_RESUME_PDF]: TASK_LANES.PDF,
	[BACKGROUND_TASK_TYPES.RENDER_RESUME_IDENTITY_PDF]: TASK_LANES.PDF,
});

export function isBackgroundTaskType(value) {
	return Object.values(BACKGROUND_TASK_TYPES).includes(String(value || ''));
}

export function laneForTaskType(type) {
	return TYPE_TO_LANE[type] || null;
}

export function publicTaskSnapshot(task) {
	if (!task) return null;
	return {
		id: task.id,
		requestId: task.requestId,
		type: task.type,
		status: task.status,
		profileId: task.profileId,
		applierName: task.applierName,
		progress: task.progress || {},
		result: task.result || null,
		error: task.error || null,
		createdAt: task.createdAt,
		startedAt: task.startedAt || null,
		cancelRequestedAt: task.cancelRequestedAt || null,
		cancelAcknowledgedAt: task.cancelAcknowledgedAt || null,
		finishedAt: task.finishedAt || null,
		updatedAt: task.updatedAt,
	};
}
