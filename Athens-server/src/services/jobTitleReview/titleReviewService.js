import { chatCompletion } from '../llm/llmService.js';
import { JOB_TITLE_REVIEW_PROMPT } from '../../config/jobTitleReviewPrompt.js';
import { resolveExtractionAuth } from '../jobSkillExtraction/aiExtractService.js';
import { jobsCollection } from '../../db/dataStore.js';
import { syncJobTitleReviewUpdates } from './titleReviewIndexSync.js';
import {
	firestoreMutationLimiter,
	indexMutationLimiter,
} from '../backgroundTasks/resourceLimits.js';

export { resolveExtractionAuth };

export const TITLE_REVIEW_LABELS = ['APPROVED', 'REVIEW_REQUIRED'];
export const TITLE_REVIEW_LABEL_SET = new Set(TITLE_REVIEW_LABELS);
const configuredBatchSize = Number(process.env.JOB_TITLE_REVIEW_BATCH_SIZE || 10);
export const TITLE_REVIEW_BATCH_SIZE = Number.isFinite(configuredBatchSize)
	? Math.max(1, Math.min(10, Math.floor(configuredBatchSize)))
	: 10;

function throwIfAborted(signal) {
	if (!signal?.aborted) return;
	throw signal.reason instanceof Error
		? signal.reason
		: Object.assign(new Error('Title review cancelled'), { name: 'AbortError' });
}

function invalidResult(code, message) {
	return { code, message };
}

/** Strictly validate a model response against the exact submitted indexes and titles. */
export function parseTitleReviewJson(content, expectedItems = []) {
	const valid = new Map();
	const errors = new Map();
	const expected = new Map(expectedItems.map((item) => [Number(item.index), item]));
	for (const item of expectedItems) {
		errors.set(Number(item.index), invalidResult('MISSING_RESULT', 'The model omitted this title.'));
	}

	let data;
	try {
		data = JSON.parse(String(content || ''));
	} catch {
		for (const item of expectedItems) {
			errors.set(Number(item.index), invalidResult('INVALID_JSON', 'The model returned invalid JSON.'));
		}
		return { valid, errors };
	}

	if (!data || !Array.isArray(data.results)) {
		for (const item of expectedItems) {
			errors.set(Number(item.index), invalidResult('INVALID_SHAPE', 'The model response has no results array.'));
		}
		return { valid, errors };
	}

	const rowsByIndex = new Map();
	for (const row of data.results) {
		if (!Number.isInteger(row?.index) || !expected.has(row.index)) continue;
		const rows = rowsByIndex.get(row.index) || [];
		rows.push(row);
		rowsByIndex.set(row.index, rows);
	}

	for (const [index, item] of expected) {
		const rows = rowsByIndex.get(index) || [];
		if (rows.length === 0) continue;
		if (rows.length > 1) {
			errors.set(index, invalidResult('DUPLICATE_INDEX', `The model returned index ${index} more than once.`));
			continue;
		}
		const row = rows[0];
		if (typeof row.title !== 'string' || row.title !== item.title) {
			errors.set(index, invalidResult('TITLE_MISMATCH', 'The returned title did not exactly match the submitted title.'));
			continue;
		}
		if (!TITLE_REVIEW_LABEL_SET.has(row.label)) {
			errors.set(index, invalidResult('INVALID_LABEL', 'The model returned an unsupported label.'));
			continue;
		}
		if (typeof row.confidence !== 'number' || !Number.isFinite(row.confidence) || row.confidence < 0 || row.confidence > 1) {
			errors.set(index, invalidResult('INVALID_CONFIDENCE', 'The model returned an invalid confidence value.'));
			continue;
		}
		const reason = typeof row.reason === 'string' ? row.reason.trim() : '';
		if (!reason) {
			errors.set(index, invalidResult('INVALID_REASON', 'The model returned an empty reason.'));
			continue;
		}
		valid.set(index, {
			index,
			title: row.title,
			label: row.label,
			confidence: row.confidence,
			reason: reason.slice(0, 500),
		});
		errors.delete(index);
	}

	return { valid, errors };
}

function failurePatch(error, now) {
	return {
		$set: {
			'titleReview.processingState': 'failed',
			'titleReview.error': {
				code: String(error?.code || 'MODEL_OUTPUT_INVALID').slice(0, 80),
				message: String(error?.message || 'Title review failed').slice(0, 500),
				failedAt: now,
			},
		},
		$unset: { 'titleReview.lease': '' },
	};
}

/** Classify one leased batch, applying only index+title validated model rows. */
export async function classifyAndPersistTitleReviewBatch(jobs, auth, {
	sessionId,
	signal,
	complete = chatCompletion,
	collection = jobsCollection,
	syncUpdates = syncJobTitleReviewUpdates,
} = {}) {
	const items = (jobs || []).map((job, index) => ({
		index,
		id: String(job._id),
		_id: job._id,
		title: String(job.title || ''),
	}));
	if (!items.length) return { processed: 0, approved: 0, reviewRequired: 0, failed: 0, usage: null, labels: {} };

	const result = await complete({
		provider: auth.providerId,
		apiKey: auth.apiKey,
		model: auth.model,
		jsonMode: true,
		feature: 'job-title-review',
		applierName: auth.applierName,
		signal,
		messages: [
			{ role: 'system', content: JOB_TITLE_REVIEW_PROMPT },
			{
				role: 'user',
				content: JSON.stringify(items.map(({ index, title }) => ({ index, title }))),
			},
		],
	});
	throwIfAborted(signal);

	const parsed = parseTitleReviewJson(result?.content, items);
	const now = new Date().toISOString();
	const operations = [];
	const labels = {};
	let approved = 0;
	let reviewRequired = 0;
	let failed = 0;

	for (const item of items) {
		const accepted = parsed.valid.get(item.index);
		const filter = {
			_id: item._id,
			title: item.title,
			'titleReview.lease.sessionId': sessionId,
		};
		if (!accepted) {
			operations.push({
				item,
				accepted: null,
				filter,
				update: failurePatch(parsed.errors.get(item.index), now),
			});
			continue;
		}

		operations.push({
			item,
			accepted,
			filter,
			update: {
				$set: {
					titleReview: {
						processingState: 'completed',
						label: accepted.label,
						aiLabel: accepted.label,
						originalTitle: item.title,
						confidence: accepted.confidence,
						reason: accepted.reason,
						decisionSource: 'ai',
						classifiedAt: now,
					},
				},
			},
		});
	}

	let persisted = 0;
	if (collection) {
		let results;
		if (typeof collection.atomicBulkConditionalPatch === 'function') {
			const write = await firestoreMutationLimiter.run(() => {
				throwIfAborted(signal);
				return collection.atomicBulkConditionalPatch(operations.map((operation) => ({
					updateOne: { filter: operation.filter, update: operation.update },
				})));
			});
			const modified = new Set((write.modifiedIds || []).map(String));
			results = operations.map((operation) => ({
				...operation,
				persisted: modified.has(String(operation.item._id)),
			}));
			const stale = results.filter((operation) => !operation.persisted);
			if (stale.length) {
				await firestoreMutationLimiter.run(() => {
					throwIfAborted(signal);
					return collection.atomicBulkConditionalPatch(stale.map((operation) => ({
						updateOne: {
							filter: { _id: operation.item._id, 'titleReview.lease.sessionId': sessionId },
							update: {
								$set: { 'titleReview.processingState': 'pending' },
								$unset: { 'titleReview.lease': '', 'titleReview.error': '' },
							},
						},
					})));
				});
			}
		} else {
			results = await Promise.all(operations.map(async (operation) => {
				const write = await firestoreMutationLimiter.run(() => {
					throwIfAborted(signal);
					return collection.updateOne(operation.filter, operation.update);
				});
				if (write.modifiedCount) return { ...operation, persisted: true };
				// The title or lease changed while the model was running. Release only this
				// stale lease and let the current title be classified in a later batch.
				await firestoreMutationLimiter.run(() => collection.updateOne(
					{ _id: operation.item._id, 'titleReview.lease.sessionId': sessionId },
					{
						$set: { 'titleReview.processingState': 'pending' },
						$unset: { 'titleReview.lease': '', 'titleReview.error': '' },
					},
				));
				return { ...operation, persisted: false };
			}));
		}
		for (const operation of results) {
			if (!operation.persisted) {
				failed += 1;
				continue;
			}
			persisted += 1;
			if (!operation.accepted) {
				failed += 1;
				continue;
			}
			labels[operation.item.id] = operation.accepted.label;
			if (operation.accepted.label === 'APPROVED') approved += 1;
			else reviewRequired += 1;
		}
	}
	if (Object.keys(labels).length) {
		try {
			throwIfAborted(signal);
			await indexMutationLimiter.run(() => syncUpdates(labels));
		} catch (error) {
			if (signal?.aborted || error?.name === 'AbortError') throw error;
			// Firestore is authoritative. A transient search-index failure must not
			// turn an already persisted classification into a failed AI batch.
			console.warn('[title-review] read-model sync failed', error?.message || error);
		}
	}

	return {
		processed: operations.length,
		persisted,
		approved,
		reviewRequired,
		failed,
		usage: result?.usage || null,
		labels,
	};
}

export async function recordTitleReviewBatchFailure(jobs, sessionId, error) {
	if (!jobsCollection || !jobs?.length) return 0;
	const now = new Date().toISOString();
	const operations = jobs.map((job) => ({
		updateOne: {
			filter: { _id: job._id, title: String(job.title || ''), 'titleReview.lease.sessionId': sessionId },
			update: failurePatch({
				code: error?.name === 'AbortError' ? 'ABORTED' : 'REQUEST_FAILED',
				message: error?.message || error || 'Title review request failed',
			}, now),
		},
	}));
	const result = await firestoreMutationLimiter.run(() => jobsCollection.bulkWrite(operations, { ordered: false }));
	return result.modifiedCount || 0;
}
