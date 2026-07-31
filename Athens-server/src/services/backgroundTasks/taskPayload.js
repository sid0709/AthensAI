import { BACKGROUND_TASK_TYPES } from './taskTypes.js';

const MAX_TASK_ITEMS = Math.max(
	1,
	Number.parseInt(String(process.env.BACKGROUND_TASK_MAX_ITEMS || ''), 10) || 2_000,
);

function clean(value) {
	return String(value ?? '').trim();
}

function ids(value, field = 'recordIds') {
	if (!Array.isArray(value)) return [];
	const normalized = [...new Set(value.map(clean).filter(Boolean))];
	if (normalized.length > MAX_TASK_ITEMS) {
		throw Object.assign(
			new Error(`Maximum ${MAX_TASK_ITEMS} ${field} per background task`),
			{ status: 400 },
		);
	}
	return normalized;
}

function positiveLimit(value) {
	if (value == null || value === '') return null;
	const parsed = Number(value);
	return Number.isFinite(parsed) && parsed > 0 ? Math.min(MAX_TASK_ITEMS, Math.floor(parsed)) : null;
}

export function normalizeBackgroundTaskPayload(type, raw = {}) {
	const payload = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
	switch (type) {
		case BACKGROUND_TASK_TYPES.RESUME_GENERATION: {
			const jobIds = ids(payload.jobIds, 'jobIds');
			const requestRecordIds = ids(payload.requestRecordIds, 'requestRecordIds');
			if (!jobIds.length && !requestRecordIds.length) {
				throw Object.assign(new Error('payload.jobIds or payload.requestRecordIds is required'), { status: 400 });
			}
			return {
				...(jobIds.length ? { jobIds } : {}),
				...(requestRecordIds.length ? { requestRecordIds } : {}),
				...(['job_search', 'avalon'].includes(payload.origin) ? { origin: payload.origin } : {}),
				forceRegenerate: payload.forceRegenerate === true,
				// Background Job Search generation intentionally defers Chromium work.
				deferPdf: payload.deferPdf !== false,
			};
		}
		case BACKGROUND_TASK_TYPES.TITLE_REVIEW:
		case BACKGROUND_TASK_TYPES.SKILL_EXTRACTION:
		case BACKGROUND_TASK_TYPES.SKILL_ENRICHMENT:
		case BACKGROUND_TASK_TYPES.JOB_EMBEDDING:
			return {
				...(positiveLimit(payload.limit) ? { limit: positiveLimit(payload.limit) } : {}),
				...(payload.mode === 'fast' || payload.mode === 'smart' ? { mode: payload.mode } : {}),
			};
		case BACKGROUND_TASK_TYPES.RESUME_SKILL_ANALYSIS: {
			const resumeIds = ids(payload.resumeIds, 'resumeIds');
			if (!resumeIds.length) throw Object.assign(new Error('payload.resumeIds is required'), { status: 400 });
			return { resumeIds, force: payload.force === true };
		}
		case BACKGROUND_TASK_TYPES.MAIL_AI_LABEL: {
			const messageIds = ids(payload.messageIds, 'messageIds');
			if (!messageIds.length) throw Object.assign(new Error('payload.messageIds is required'), { status: 400 });
			if (messageIds.length > 50) throw Object.assign(new Error('Maximum 50 messages per mail labeling task'), { status: 400 });
			return { messageIds };
		}
		case BACKGROUND_TASK_TYPES.RESUME_IDENTITY_REFRESH:
			return { forceAll: payload.forceAll === true };
		case BACKGROUND_TASK_TYPES.JOB_ANALYSIS:
		case BACKGROUND_TASK_TYPES.JOB_REMOVAL:
		case BACKGROUND_TASK_TYPES.RESUME_REMOVAL: {
			const recordIds = ids(payload.recordIds || payload.jobIds || payload.resumeIds);
			if (!recordIds.length) throw Object.assign(new Error('payload.recordIds is required'), { status: 400 });
			return { recordIds };
		}
		default:
			throw Object.assign(new Error(`Unsupported background task type: ${type}`), { status: 400 });
	}
}

export const backgroundTaskPayloadTest = { ids, positiveLimit, MAX_TASK_ITEMS };
