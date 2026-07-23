import { chatCompletion } from '../llm/llmService.js';
import { JOB_TITLE_SCAN_PROMPT } from '../../config/jobTitleScanPrompt.js';
import {
	DEFAULT_TITLE_SCAN_ROLE,
	TITLE_SCAN_ROLE_SET,
} from '../../config/jobTitleScanRoles.js';
import { resolveExtractionAuth } from '../jobSkillExtraction/aiExtractService.js';
import { jobsCollection } from '../../db/mongo.js';

export { resolveExtractionAuth };

/** Titles per LLM call — titles are tiny, so large batches are safe and fast. */
export const TITLE_SCAN_BATCH_SIZE = Math.max(
	5,
	Number(process.env.JOB_TITLE_SCAN_BATCH_SIZE || 50),
);

function normalizeRole(raw) {
	const role = String(raw || '').trim();
	if (TITLE_SCAN_ROLE_SET.has(role)) return role;
	const lower = role.toLowerCase();
	for (const allowed of TITLE_SCAN_ROLE_SET) {
		if (allowed.toLowerCase() === lower) return allowed;
	}
	// Light alias cleanup for common model drift (specialized domains before generic SWE).
	if (/health|clinical|biomed|fhir|hl7/.test(lower)) return 'Healthcare Engineer';
	if (/\bai\b|machine learning|\bml\b|llm|genai|mlops/.test(lower)) {
		return 'AI engineer';
	}
	if (/data eng|analytics eng|\betl\b/.test(lower)) return 'Data Engineer';
	if (/devops|sre|site reliability|platform/.test(lower)) return 'DevOps';
	if (/cloud|network|\brpa\b|security eng|sales eng|support eng/.test(lower)) {
		return DEFAULT_TITLE_SCAN_ROLE;
	}
	if (/software|full.?stack|front.?end|back.?end|mobile|\bswe\b/.test(lower)) {
		return 'Software Engineer';
	}
	return DEFAULT_TITLE_SCAN_ROLE;
}

/** Tolerant parse of batched title-classification JSON. */
export function parseTitleScanJson(content, expectedIds) {
	const byId = new Map();
	if (!content) return byId;

	let text = String(content).trim();
	const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
	if (fence) text = fence[1].trim();

	let data;
	try {
		data = JSON.parse(text);
	} catch {
		const braceStart = text.indexOf('{');
		const braceEnd = text.lastIndexOf('}');
		if (braceStart === -1 || braceEnd <= braceStart) return byId;
		try {
			data = JSON.parse(text.slice(braceStart, braceEnd + 1));
		} catch {
			return byId;
		}
	}

	const list = Array.isArray(data)
		? data
		: Array.isArray(data?.results)
			? data.results
			: [];

	const expected = new Set((expectedIds || []).map(String));
	for (const item of list) {
		const id = String(item?.id ?? item?.jobId ?? '').trim();
		if (!id || (expected.size && !expected.has(id))) continue;
		byId.set(id, normalizeRole(item?.role ?? item?.titleScanned ?? item?.category));
	}
	return byId;
}

/**
 * Classify a batch of { _id, title } jobs in one LLM call and persist titleScanned.
 * Missing/invalid model rows fall back to "Others" so the batch always completes.
 */
export async function classifyAndPersistTitleBatch(jobs, auth, { signal } = {}) {
	const items = (jobs || [])
		.map((job) => ({
			id: String(job._id),
			_id: job._id,
			title: String(job.title || '').trim() || '(untitled)',
		}))
		.filter((j) => j.id);

	if (!items.length) {
		return { classified: 0, usage: null, roles: {} };
	}

	const result = await chatCompletion({
		provider: auth.providerId,
		apiKey: auth.apiKey,
		model: auth.model,
		jsonMode: true,
		feature: 'job-title-scan',
		applierName: auth.applierName,
		signal,
		messages: [
			{ role: 'system', content: JOB_TITLE_SCAN_PROMPT },
			{
				role: 'user',
				content: `Classify these job titles:\n${JSON.stringify(
					items.map(({ id, title }) => ({ id, title })),
				)}`,
			},
		],
	});

	const parsed = parseTitleScanJson(result?.content, items.map((i) => i.id));
	const now = new Date().toISOString();
	const roles = {};
	const ops = [];

	for (const item of items) {
		const role = parsed.get(item.id) || DEFAULT_TITLE_SCAN_ROLE;
		roles[item.id] = role;
		ops.push({
			updateOne: {
				filter: { _id: item._id },
				update: {
					$set: {
						titleScanned: role,
						titleScannedAt: now,
					},
					$unset: { titleScanStatus: '', titleScanError: '' },
				},
			},
		});
	}

	if (ops.length && jobsCollection) {
		await jobsCollection.bulkWrite(ops, { ordered: false });
	}

	return {
		classified: ops.length,
		usage: result?.usage || null,
		roles,
	};
}

export async function recordTitleScanFailure(jobs, err) {
	if (!jobsCollection || !jobs?.length) return;
	const message = String(err?.message || err || 'Title scan failed').slice(0, 500);
	await jobsCollection
		.updateMany(
			{ _id: { $in: jobs.map((j) => j._id) } },
			{
				$set: { titleScanStatus: 'failed', titleScanError: message },
				$unset: { titleScanned: '' },
			},
		)
		.catch(() => {});
}
