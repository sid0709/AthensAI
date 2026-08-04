import { DocumentId } from '@nextoffer/shared/document-id';
import {
	backgroundTaskInputsCollection,
	externalScrapedJobsCollection,
	jobsCollection,
	resumeGenerationsCollection,
} from '../../db/dataStore.js';
import { mapPool } from '../../utils/concurrency.js';
import { resumeGenLimiter } from '../../utils/concurrency.js';
import { ensureAgentJobResume, deleteAgentJobResumes } from '../agentResumeGenService.js';
import {
	finalizeGenerationRun,
	prepareGeneration,
	runGeneration,
} from '../../controllers/resumeGenController.js';
import { removeJobRecords } from '../../controllers/jobController.js';
import { runSkillExtractionTask } from '../jobSkillExtraction/extractSession.js';
import { runTitleReviewTask } from '../jobTitleReview/titleReviewSession.js';
import { analyzeJobRecord } from '../jobAnalysis/index.js';
import { analyzeResumeSkills } from '../resumeSkillAnalysisService.js';
import { runJobEmbeddingTask } from '../embeddings/jobEmbeddingWorker.js';
import { resolveExtractionAuth } from '../jobSkillExtraction/aiExtractService.js';
import {
	extractAndPersistExternalJob,
	recordExternalExtractionFailure,
} from '../jobSkillExtraction/externalJobExtractService.js';
import { prepareMailAiLabelTaskRun } from '../../controllers/mailController.js';
import { runMailAiLabelBatch } from '../mail/aiLabelService.js';
import { refreshGeneratedResumesIdentity } from '../refreshGeneratedResumesIdentity.js';
import { createTaskReporter } from './taskReporter.js';
import { BACKGROUND_TASK_TYPES } from './taskTypes.js';
import { firestoreMutationLimiter } from './resourceLimits.js';
import {
	mergeResumeGenerationSteps,
	persistResumeSectionBeforeEmit,
} from './resumeGenerationProgress.js';
import {
	renderResumeIdentityPdfInBackgroundLane,
	renderResumePdfInBackgroundLane,
} from './pdfLane.js';

const RESUME_ITEM_CONCURRENCY = Math.max(
	1,
	Math.min(12, Number.parseInt(String(process.env.RESUME_GEN_PER_USER_CONCURRENCY || ''), 10) || 12),
);

function abortError(signal, message = 'Background task cancelled') {
	if (signal?.reason instanceof Error) return signal.reason;
	return Object.assign(new Error(message), { name: 'AbortError' });
}

function throwIfAborted(signal) {
	if (signal?.aborted) throw abortError(signal);
}

function isAbortError(error, signal) {
	return signal?.aborted || error?.name === 'AbortError';
}

function clean(value) {
	return String(value ?? '').trim();
}

function jobDescription(doc) {
	return clean(
		doc?.jobDescription
		|| doc?.description
		|| doc?.details?.description
		|| doc?.details?.jobDescription,
	);
}

async function loadResumeJob(jobId) {
	if (!DocumentId.isValid(jobId)) return null;
	const id = new DocumentId(jobId);
	const projection = {
		title: 1,
		description: 1,
		jobDescription: 1,
		details: 1,
	};
	const market = await jobsCollection?.findOne({ _id: id }, { projection });
	if (market) return market;
	return externalScrapedJobsCollection?.findOne({ _id: id }, { projection }) || null;
}

function redisSafeStep(step) {
	if (!step || typeof step !== 'object') return null;
	const plannedSteps = Array.isArray(step.steps)
		? step.steps.slice(0, 100).map((planned, offset) => ({
			index: Number.isFinite(Number(planned?.index)) ? Number(planned.index) : offset + 1,
			name: planned?.name || `Step ${offset + 1}`,
			purpose: planned?.purpose || null,
			kind: planned?.kind || null,
		}))
		: null;
	return {
		phase: step.phase || null,
		name: step.name || null,
		purpose: step.purpose || null,
		kind: step.kind || null,
		index: Number.isFinite(Number(step.index)) ? Number(step.index) : null,
		usage: step.usage || null,
		cumulative: step.cumulative || null,
		...(plannedSteps ? { steps: plannedSteps } : {}),
	};
}

function resultFromGenerationRecord(record) {
	if (!record) return null;
	return {
		provider: record.provider || null,
		model: record.model || null,
		sections: record.sections || {},
		usage: record.usage || null,
		skillProfile: record.skillProfile || [],
		techStack: record.techStack || null,
		skillAnalysisError: record.skillAnalysisError || null,
		coverageContract: record.coverageContract || null,
		generationId: String(record._id),
		isBeta: record.isBeta === true,
		dynamicCareerTitles: record.dynamicCareerTitles === true,
		titlePolicyFingerprint: record.titlePolicyFingerprint || null,
		titlePolicyVersion: record.titlePolicyVersion || null,
	};
}

async function runStoredResumeGeneration(task, inputId, signal, onStep) {
	if (!backgroundTaskInputsCollection) throw new Error('Database not ready');
	let input = await backgroundTaskInputsCollection.findOne({
		_id: inputId,
		applierName: task.applierName,
	});
	if (!input) throw new Error('Resume generation input not found');
	if (input.status === 'completed' && input.result) {
		return { inputId, generationId: input.result.generationId || null, recovered: true };
	}

	// A queued input cannot already have a saved generation: the worker marks it
	// running before any model or persistence work. Only retries need recovery.
	// backgroundTaskInputId is unique and single-field indexed; do not combine it
	// with status, which would require a composite index and previously triggered
	// a full completed-generation scan before the first model call.
	const generationForInput = input.status === 'queued'
		? null
		: await resumeGenerationsCollection?.findOne({ backgroundTaskInputId: inputId });
	const existing = generationForInput?.status === 'completed' ? generationForInput : null;
	if (existing) {
		const recoveredResult = resultFromGenerationRecord(existing);
		await firestoreMutationLimiter.run(() => backgroundTaskInputsCollection.updateOne(
			{ _id: inputId },
			{ $set: { status: 'completed', result: recoveredResult, error: null, updatedAt: new Date() } },
		));
		return { inputId, generationId: recoveredResult.generationId, recovered: true };
	}

	throwIfAborted(signal);
	await firestoreMutationLimiter.run(async () => {
		throwIfAborted(signal);
		await backgroundTaskInputsCollection.updateOne(
			{ _id: inputId },
			{
				$set: {
					status: 'running',
					workerTaskId: task.id,
					startedAt: input.startedAt || new Date(),
					updatedAt: new Date(),
					error: null,
				},
			},
		);
	});
	input = { ...input, status: 'running' };
	const body = {
		...(input.request || {}),
		applierName: task.applierName,
		profileId: input.profileId || task.profileId || input.request?.profileId,
		backgroundTaskInputId: inputId,
	};
	let partialWrite = Promise.resolve();
	let stepRevision = 0;
	const emitStep = (safeStep, label = null) => {
		if (!safeStep) return;
		let progressLabel = label;
		if (!progressLabel) {
			switch (safeStep.phase) {
				case 'queued':
					progressLabel = 'Waiting for generation slot…';
					break;
				case 'step-start':
					progressLabel = `Running: ${safeStep.name || 'Step'}…`;
					break;
				default:
					progressLabel = safeStep.name || 'Generating résumé…';
			}
		}
		onStep?.({
			step: progressLabel,
			stepEvent: safeStep,
			stepRevision: ++stepRevision,
		});
	};
	try {
		if (Array.isArray(body.steps) && body.steps.length) {
			const safePlan = redisSafeStep({ phase: 'pipeline-ready', steps: body.steps });
			emitStep(safePlan, 'Preparing résumé generation…');
		}
		const prep = await prepareGeneration(body);
		throwIfAborted(signal);
		if (!prep.ok) throw Object.assign(new Error(prep.error), { status: prep.status });
		// The request may contain a stale model from a previously saved generator
		// config. Execution and persisted run metadata must both reflect the
		// Profile default resolved by prepareGeneration at task run time.
		body.provider = prep.providerId;
		body.model = prep.model;
		const startedAt = new Date();
		const generated = await resumeGenLimiter.run(
			task.applierName,
			() => runGeneration({
				...prep,
				systemInstruction: body.systemInstruction,
				identity: body.identity,
				applierName: task.applierName,
				jobDescription: body.jobDescription,
				reasoningEffort: body.reasoningEffort,
				signal,
			}, (step) => {
				const safeStep = redisSafeStep(step);
				if (
					step?.phase === 'step-done'
					&& step?.kind === 'final'
					&& step?.purpose
					&& step.output != null
				) {
					// A final checkmark is also the UI's signal to fetch this section.
					// Persist first so that fetch can never race an unfinished write.
					partialWrite = partialWrite.then(() => firestoreMutationLimiter.run(() => (
						persistResumeSectionBeforeEmit(
							async () => {
								throwIfAborted(signal);
								await backgroundTaskInputsCollection.updateOne(
									{ _id: inputId },
									{
										$set: {
											[`partialSections.${step.purpose}`]: step.output,
											updatedAt: new Date(),
										},
									},
								);
							},
							() => emitStep(safeStep, `Completed: ${safeStep?.name || step.purpose}`),
						)
					)));
					return;
				}
				emitStep(safeStep);
			}),
			{
				signal,
				onQueued: () => emitStep(
					redisSafeStep({ phase: 'queued', name: 'Waiting for generation slot' }),
					'Waiting for generation slot…',
				),
			},
		);
		throwIfAborted(signal);
		await partialWrite;
		const finalized = await finalizeGenerationRun({ prep, body, result: generated, startedAt, signal });
		const storedResult = {
			provider: prep.providerId,
			model: prep.model,
			sections: finalized.sections,
			usage: finalized.usage,
			skillProfile: finalized.skillProfile,
			techStack: finalized.techStack,
			skillAnalysisError: finalized.skillAnalysisError,
			coverageContract: finalized.coverageContract,
			generationId: finalized.generationId ? String(finalized.generationId) : null,
			isBeta: finalized.isBeta,
			dynamicCareerTitles: finalized.dynamicCareerTitles,
			titlePolicyFingerprint: finalized.titlePolicyFingerprint,
			titlePolicyVersion: finalized.titlePolicyVersion,
		};
		await firestoreMutationLimiter.run(async () => {
			throwIfAborted(signal);
			await backgroundTaskInputsCollection.updateOne(
				{ _id: inputId },
				{
					$set: {
						status: 'completed',
						result: storedResult,
						error: null,
						finishedAt: new Date(),
						updatedAt: new Date(),
					},
				},
			);
		});
		return { inputId, generationId: storedResult.generationId, recovered: false };
	} catch (error) {
		await partialWrite.catch(() => undefined);
		await firestoreMutationLimiter.run(() => backgroundTaskInputsCollection.updateOne(
			{ _id: inputId, status: { $ne: 'completed' } },
			{
				$set: {
					status: isAbortError(error, signal) ? 'cancelled' : 'failed',
					error: isAbortError(error, signal) ? null : error?.message || String(error),
					finishedAt: new Date(),
					updatedAt: new Date(),
				},
			},
		)).catch(() => undefined);
		throw error;
	}
}

async function runResumeGeneration(task, signal) {
	const reporter = createTaskReporter(task.id);
	const jobIds = Array.isArray(task.payload?.jobIds) ? task.payload.jobIds : [];
	const requestRecordIds = Array.isArray(task.payload?.requestRecordIds) ? task.payload.requestRecordIds : [];
	const work = [
		...jobIds.map((id) => ({ id, kind: 'job' })),
		...requestRecordIds.map((id) => ({ id, kind: 'stored-request' })),
	];
	const items = Object.fromEntries(work.map(({ id }) => [id, { status: 'queued', step: null }]));
	let completed = 0;
	let failed = 0;
	let cancelled = 0;
	let active = 0;
	const completedJobIds = [];
	const failedJobIds = [];
	const resultRecordIds = [];

	const reportProgress = () => reporter.progress({
		total: work.length,
		completed,
		failed,
		cancelled,
		active,
		remaining: Math.max(0, work.length - completed - failed - cancelled),
		items,
	});

	await reportProgress();
	await mapPool(work, RESUME_ITEM_CONCURRENCY, async ({ id: itemId, kind }) => {
		if (signal.aborted) {
			cancelled += 1;
			items[itemId] = { status: 'cancelled', step: null };
			return;
		}
		active += 1;
		items[itemId] = {
			status: 'running',
			step: kind === 'job' ? 'Loading job description…' : 'Preparing résumé generation…',
		};
		await reporter.item('task-item-started', { taskId: task.id, itemId, item: items[itemId] });
		await reportProgress();
		try {
			let result;
			if (kind === 'stored-request') {
				result = await runStoredResumeGeneration(task, itemId, signal, (step) => {
					const generationSteps = mergeResumeGenerationSteps(
						items[itemId]?.generationSteps,
						step?.stepEvent,
					);
					items[itemId] = {
						...items[itemId],
						status: 'running',
						...step,
						...(generationSteps.length ? { generationSteps } : {}),
					};
					void reporter.item('task-item-progress', {
						taskId: task.id,
						itemId,
						item: items[itemId],
					});
					void reportProgress();
				});
				resultRecordIds.push(itemId);
			} else {
				const job = await loadResumeJob(itemId);
				throwIfAborted(signal);
				if (!job) throw Object.assign(new Error('Job not found'), { status: 404 });
				const description = jobDescription(job);
				if (!description) throw Object.assign(new Error('No job description saved for this job'), { status: 422 });
				const requiresPdf = task.payload?.deferPdf === false;
				result = await ensureAgentJobResume({
					applierName: task.applierName,
					profileId: task.profileId,
					jobId: itemId,
					jobDescription: description,
					forceRegenerate: task.payload?.forceRegenerate === true,
					// Chromium is always dispatched through the dedicated BullMQ PDF lane.
					deferPdf: true,
					signal,
					onStep: (step) => {
						const label = step?.phase === 'step-start'
							? `Running: ${step.name || 'Step'}…`
							: step?.phase === 'rendering-pdf'
								? 'Rendering PDF…'
								: step?.phase === 'reused'
									? 'Reusing saved draft…'
									: step?.name || null;
						items[itemId] = { ...items[itemId], status: 'running', step: label };
						void reporter.item('task-item-progress', {
							taskId: task.id,
							itemId,
							item: items[itemId],
							step: redisSafeStep(step),
						});
						void reportProgress();
					},
				});
				if (requiresPdf) {
					throwIfAborted(signal);
					items[itemId] = { ...items[itemId], status: 'running', step: 'Rendering PDF…' };
					await reporter.item('task-item-progress', {
						taskId: task.id,
						itemId,
						item: items[itemId],
					});
					await reportProgress();
					const pdf = await renderResumePdfInBackgroundLane({
						taskId: task.id,
						profileId: task.profileId,
						jobId: itemId,
						signal,
					});
					result = { ...result, resumePdfPath: pdf?.draftPath || null };
				}
				completedJobIds.push(itemId);
			}
			throwIfAborted(signal);
			completed += 1;
			const generationSteps = items[itemId]?.generationSteps;
			items[itemId] = {
				status: 'completed',
				step: null,
				...(Array.isArray(generationSteps) ? { generationSteps } : {}),
				reused: result.reused === true || result.recovered === true,
				generationId: result.generationId || null,
				...(kind === 'job' ? {
					resumeId: result.resumeId || null,
					fileName: result.fileName || null,
					techStack: result.techStack || null,
					model: result.model || null,
					provider: result.provider || null,
					usage: result.usage || null,
					resumePdfPath: result.resumePdfPath || result.draftPath || null,
				} : {}),
				...(kind === 'stored-request' ? { resultRecordId: itemId } : {}),
			};
			await reporter.item('task-item-completed', { taskId: task.id, itemId, item: items[itemId] });
		} catch (error) {
			if (isAbortError(error, signal)) {
				cancelled += 1;
				const generationSteps = items[itemId]?.generationSteps;
				items[itemId] = {
					status: 'cancelled',
					step: null,
					...(Array.isArray(generationSteps) ? { generationSteps } : {}),
				};
				await reporter.item('task-item-cancelled', { taskId: task.id, itemId, item: items[itemId] });
			} else {
				failed += 1;
				if (kind === 'job') failedJobIds.push(itemId);
				const generationSteps = items[itemId]?.generationSteps;
				items[itemId] = {
					status: 'failed',
					step: null,
					error: error?.message || String(error),
					...(Array.isArray(generationSteps) ? { generationSteps } : {}),
				};
				await reporter.item('task-item-failed', { taskId: task.id, itemId, item: items[itemId] });
			}
		} finally {
			active = Math.max(0, active - 1);
			await reportProgress();
		}
	});
	await reporter.flush();
	return {
		progress: {
			total: work.length,
			completed,
			failed,
			cancelled,
			active: 0,
			remaining: Math.max(0, work.length - completed - failed - cancelled),
			items,
		},
		result: { completedJobIds, failedJobIds, resultRecordIds },
	};
}

async function runTitleReview(task, signal) {
	const reporter = createTaskReporter(task.id);
	const session = await runTitleReviewTask({
		taskId: task.id,
		applierName: task.applierName,
		profileId: task.profileId,
		limit: task.payload?.limit,
		signal,
		onProgress: (snapshot) => reporter.progress({
			total: snapshot.total,
			completed: snapshot.processed,
			failed: snapshot.failed,
			cancelled: snapshot.status === 'cancelled'
				? Math.max(0, Number(snapshot.total || 0) - Number(snapshot.processed || 0))
				: 0,
			active: snapshot.running ? Math.min(snapshot.concurrency || 0, Math.ceil((snapshot.remaining || 0) / (snapshot.batchSize || 1))) : 0,
			remaining: snapshot.remaining,
			approved: snapshot.approved,
			reviewRequired: snapshot.reviewRequired,
			phase: snapshot.phase,
			inputTokens: snapshot.inputTokens,
			outputTokens: snapshot.outputTokens,
			costUsd: snapshot.costUsd,
		}),
	});
	await reporter.flush();
	return {
		progress: {
			total: session.total,
			completed: session.processed,
			failed: session.failed,
			cancelled: session.status === 'cancelled' ? Math.max(0, session.total - session.processed) : 0,
			active: 0,
			remaining: session.remaining,
			approved: session.approved,
			reviewRequired: session.reviewRequired,
			phase: session.phase,
		},
		result: {
			approved: session.approved,
			reviewRequired: session.reviewRequired,
			failed: session.failed,
		},
	};
}

async function runSkillExtraction(task, signal) {
	const reporter = createTaskReporter(task.id);
	const session = await runSkillExtractionTask({
		taskId: task.id,
		applierName: task.applierName,
		profileId: task.profileId,
		limit: task.payload?.limit,
		signal,
		onProgress: (snapshot) => reporter.progress({
			total: snapshot.total,
			completed: snapshot.processed,
			failed: snapshot.failed,
			cancelled: snapshot.cancelled,
			active: snapshot.inflight,
			remaining: snapshot.remaining,
			extracted: snapshot.extracted,
			retried: snapshot.retried,
			phase: snapshot.phase,
			lastJob: snapshot.lastJob,
			inputTokens: snapshot.inputTokens,
			outputTokens: snapshot.outputTokens,
			costUsd: snapshot.costUsd,
		}),
	});
	await reporter.flush();
	return {
		progress: {
			total: session.total,
			completed: session.processed,
			failed: session.failed,
			cancelled: session.cancelled,
			active: 0,
			remaining: session.remaining,
			extracted: session.extracted,
			retried: session.retried,
			phase: session.phase,
			lastJob: session.lastJob,
		},
		result: {
			extracted: session.extracted,
			failed: session.failed,
			retried: session.retried,
		},
	};
}

async function runResumeRemoval(task, signal) {
	const reporter = createTaskReporter(task.id);
	const recordIds = task.payload?.recordIds || [];
	throwIfAborted(signal);
	const result = await deleteAgentJobResumes(task.applierName, recordIds, {
		signal,
		onProgress: (progress) => {
			void reporter.progress({
				total: progress.total,
				completed: progress.done,
				failed: progress.failed,
				cancelled: 0,
				active: progress.active,
				remaining: progress.left,
				phase: progress.phase,
			});
		},
	});
	await reporter.flush();
	return {
		progress: {
			total: recordIds.length,
			completed: result.deletedJobIds.length + result.failedJobIds.length,
			failed: result.failedJobIds.length,
			cancelled: 0,
			active: 0,
			remaining: 0,
			phase: 'done',
		},
		result,
	};
}

async function runJobRemoval(task, signal) {
	const reporter = createTaskReporter(task.id);
	const recordIds = Array.isArray(task.payload?.recordIds) ? task.payload.recordIds : [];
	throwIfAborted(signal);
	await reporter.progress({
		total: recordIds.length,
		completed: 0,
		failed: 0,
		cancelled: 0,
		active: 1,
		remaining: recordIds.length,
		phase: 'removing',
	});
	const result = await removeJobRecords(recordIds, { signal });
	throwIfAborted(signal);
	const completed = recordIds.length;
	return {
		progress: {
			total: recordIds.length,
			completed,
			failed: 0,
			cancelled: 0,
			active: 0,
			remaining: 0,
			phase: 'done',
		},
		result,
	};
}

async function runJobAnalysis(task, signal) {
	const reporter = createTaskReporter(task.id);
	const recordIds = Array.isArray(task.payload?.recordIds) ? task.payload.recordIds : [];
	const items = Object.fromEntries(recordIds.map((id) => [id, { status: 'queued' }]));
	let completed = 0;
	let failed = 0;
	let cancelled = 0;
	let active = 0;
	const analyzedJobIds = [];
	const failedJobIds = [];
	const report = () => reporter.progress({
		total: recordIds.length,
		completed,
		failed,
		cancelled,
		active,
		remaining: Math.max(0, recordIds.length - completed - failed - cancelled),
		items,
		phase: 'analyzing',
	});
	await report();
	await mapPool(recordIds, 8, async (recordId) => {
		if (signal.aborted) {
			cancelled += 1;
			items[recordId] = { status: 'cancelled' };
			return;
		}
		active += 1;
		items[recordId] = { status: 'running' };
		await report();
		try {
			if (!DocumentId.isValid(recordId)) throw new Error('Invalid job id');
			const job = await jobsCollection?.findOne({ _id: new DocumentId(recordId) });
			if (!job) throw new Error('Job not found');
			await analyzeJobRecord(job, { signal });
			completed += 1;
			analyzedJobIds.push(recordId);
			items[recordId] = { status: 'completed' };
		} catch (error) {
			if (isAbortError(error, signal)) {
				cancelled += 1;
				items[recordId] = { status: 'cancelled' };
			} else {
				failed += 1;
				failedJobIds.push(recordId);
				items[recordId] = { status: 'failed', error: error?.message || String(error) };
			}
		} finally {
			active = Math.max(0, active - 1);
			await report();
		}
	});
	await reporter.flush();
	return {
		progress: {
			total: recordIds.length,
			completed,
			failed,
			cancelled,
			active: 0,
			remaining: 0,
			items,
			phase: 'done',
		},
		result: { analyzedJobIds, failedJobIds },
	};
}

async function runResumeSkillAnalysis(task, signal) {
	const reporter = createTaskReporter(task.id);
	const resumeIds = Array.isArray(task.payload?.resumeIds) ? task.payload.resumeIds : [];
	const items = Object.fromEntries(resumeIds.map((id) => [id, { status: 'queued' }]));
	let completed = 0;
	let failed = 0;
	let cancelled = 0;
	let active = 0;
	const analyzedResumeIds = [];
	const failedResumeIds = [];
	const report = () => reporter.progress({
		total: resumeIds.length,
		completed,
		failed,
		cancelled,
		active,
		remaining: Math.max(0, resumeIds.length - completed - failed - cancelled),
		items,
		phase: 'analyzing',
	});
	await report();
	// Profile graph/catalog updates are shared per owner, so preserve the previous
	// sequential behavior while moving all work out of the HTTP process.
	await mapPool(resumeIds, 1, async (resumeId) => {
		if (signal.aborted) {
			cancelled += 1;
			items[resumeId] = { status: 'cancelled' };
			return;
		}
		active = 1;
		items[resumeId] = { status: 'running', step: 'Analyzing résumé skills…' };
		await report();
		try {
			const result = await analyzeResumeSkills(resumeId, task.applierName, {
				force: task.payload?.force === true,
				signal,
			});
			throwIfAborted(signal);
			completed += 1;
			analyzedResumeIds.push(resumeId);
			items[resumeId] = {
				status: 'completed',
				step: null,
				alreadyAnalyzed: result.alreadyAnalyzed === true,
				skillCount: Array.isArray(result.skillProfile) ? result.skillProfile.length : 0,
			};
		} catch (error) {
			if (isAbortError(error, signal)) {
				cancelled += 1;
				items[resumeId] = { status: 'cancelled' };
			} else {
				failed += 1;
				failedResumeIds.push(resumeId);
				items[resumeId] = { status: 'failed', error: error?.message || String(error) };
			}
		} finally {
			active = 0;
			await report();
		}
	});
	await reporter.flush();
	return {
		progress: {
			total: resumeIds.length,
			completed,
			failed,
			cancelled,
			active: 0,
			remaining: 0,
			items,
			phase: 'done',
		},
		result: { analyzedResumeIds, failedResumeIds },
	};
}

async function runJobEmbedding(task, signal) {
	const reporter = createTaskReporter(task.id);
	const session = await runJobEmbeddingTask({
		limit: task.payload?.limit,
		signal,
		onProgress: (progress) => reporter.progress({
			total: progress.total,
			completed: progress.processed,
			failed: progress.failed,
			cancelled: progress.cancelled,
			active: progress.active,
			remaining: progress.remaining,
			embedded: progress.embedded,
			skipped: progress.skipped,
			phase: progress.phase,
			lastJob: progress.lastJob,
			lastSkipReason: progress.lastSkipReason,
		}),
	});
	await reporter.flush();
	return {
		progress: {
			total: session.total,
			completed: session.processed,
			failed: session.failed,
			cancelled: session.cancelled,
			active: 0,
			remaining: session.remaining,
			embedded: session.embedded,
			skipped: session.skipped,
			phase: session.phase,
		},
		result: {
			embedded: session.embedded,
			skipped: session.skipped,
			failed: session.failed,
		},
	};
}

async function runSkillEnrichment(task, signal) {
	if (!externalScrapedJobsCollection) throw new Error('Database not ready');
	const reporter = createTaskReporter(task.id);
	const auth = await resolveExtractionAuth(task.applierName, { profileId: task.profileId });
	throwIfAborted(signal);
	const maxItems = Math.max(
		1,
		Number.parseInt(String(process.env.BACKGROUND_TASK_MAX_ITEMS || ''), 10) || 2_000,
	);
	const limit = task.payload?.limit == null
		? maxItems
		: Math.min(maxItems, Math.max(1, Math.floor(Number(task.payload.limit) || 1)));
	const candidates = await externalScrapedJobsCollection
		.find({ aiSkillStatus: 'pending' })
		.limit(limit)
		.toArray();
	const claimed = [];
	for (const job of candidates) {
		if (signal.aborted) break;
		const result = await firestoreMutationLimiter.run(async () => {
			throwIfAborted(signal);
			return externalScrapedJobsCollection.updateOne(
				{ _id: job._id, aiSkillStatus: 'pending' },
				{
				$set: {
					aiSkillStatus: 'extracting',
					aiSkillClaimedAt: new Date().toISOString(),
					aiSkillSessionId: task.id,
				},
				},
			);
		});
		if (Number(result?.modifiedCount) === 1) claimed.push(job);
	}
	const items = Object.fromEntries(claimed.map((job) => [String(job._id), { status: 'queued' }]));
	let completed = 0;
	let failed = 0;
	let cancelled = 0;
	let active = 0;
	let extracted = 0;
	let retried = 0;
	const report = () => reporter.progress({
		total: claimed.length,
		completed,
		failed,
		cancelled,
		active,
		remaining: Math.max(0, claimed.length - completed - failed - cancelled),
		extracted,
		retried,
		items,
		phase: 'enriching',
	});
	await report();
	await mapPool(claimed, 8, async (job) => {
		const jobId = String(job._id);
		if (signal.aborted) {
			cancelled += 1;
			items[jobId] = { status: 'cancelled' };
			await firestoreMutationLimiter.run(() => externalScrapedJobsCollection.updateOne(
				{ _id: job._id, aiSkillSessionId: task.id },
				{ $set: { aiSkillStatus: 'pending' }, $unset: { aiSkillClaimedAt: '', aiSkillSessionId: '' } },
			)).catch(() => {});
			return;
		}
		active += 1;
		items[jobId] = { status: 'running' };
		await report();
		try {
			const result = await extractAndPersistExternalJob(job, auth, { signal });
			throwIfAborted(signal);
			completed += 1;
			extracted += 1;
			items[jobId] = { status: 'completed', skillCount: result.skillCount };
		} catch (error) {
			if (isAbortError(error, signal)) {
				cancelled += 1;
				items[jobId] = { status: 'cancelled' };
				await firestoreMutationLimiter.run(() => externalScrapedJobsCollection.updateOne(
					{ _id: job._id, aiSkillSessionId: task.id },
					{ $set: { aiSkillStatus: 'pending' }, $unset: { aiSkillClaimedAt: '', aiSkillSessionId: '' } },
				)).catch(() => {});
			} else {
				const outcome = await recordExternalExtractionFailure(job, error, { signal });
				if (outcome?.terminal) failed += 1;
				else retried += 1;
				items[jobId] = { status: 'failed', error: error?.message || String(error) };
			}
		} finally {
			active = Math.max(0, active - 1);
			await report();
		}
	});
	await reporter.flush();
	return {
		progress: {
			total: claimed.length,
			completed,
			failed,
			cancelled,
			active: 0,
			remaining: 0,
			extracted,
			retried,
			items,
			phase: signal.aborted ? 'cancelled' : 'done',
		},
		result: { extracted, failed, retried },
	};
}

async function runMailAiLabel(task, signal) {
	const reporter = createTaskReporter(task.id);
	const messageIds = Array.isArray(task.payload?.messageIds) ? task.payload.messageIds : [];
	const items = Object.fromEntries(messageIds.map((id) => [id, { status: 'queued' }]));
	let completed = 0;
	let failed = 0;
	let applied = 0;
	let skipped = 0;
	let phase = 'preparing';
	const report = () => reporter.progress({
		total: messageIds.length,
		completed,
		failed,
		cancelled: 0,
		active: Math.max(0, messageIds.length - completed),
		remaining: Math.max(0, messageIds.length - completed),
		applied,
		skipped,
		phase,
		items,
	});
	await report();
	const run = await prepareMailAiLabelTaskRun({
		applierName: task.applierName,
		messageIds,
	});
	throwIfAborted(signal);
	const result = await runMailAiLabelBatch({
		...run,
		signal,
		onEvent: (event, data) => {
			if (event === 'progress') {
				phase = data?.phase || phase;
				completed = Math.max(completed, Number(data?.completed || 0));
				void report();
				return;
			}
			if (event !== 'result' || !data?.result) return;
			const outcome = data.result;
			const rawId = messageIds.find((id) => String(id).split('\0').at(-1) === String(outcome.uid))
				|| String(outcome.uid);
			const itemStatus = outcome.applied
				? 'completed'
				: outcome.error || (outcome.reason && outcome.reason !== 'no_match')
					? 'failed'
					: 'completed';
			items[rawId] = {
				status: itemStatus,
				result: outcome,
				...(outcome.error ? { error: outcome.error } : {}),
			};
			completed = Math.max(completed, Number(data.completed || 0));
			if (outcome.applied) applied += 1;
			else if (itemStatus === 'failed') failed += 1;
			else skipped += 1;
			void reporter.item('task-item-completed', {
				taskId: task.id,
				itemId: rawId,
				item: items[rawId],
			});
			void report();
		},
	});
	if (!result.ok) throw new Error(result.error || 'Mail AI labeling failed');
	await reporter.flush();
	phase = 'done';
	const results = Array.isArray(result.results) ? result.results : [];
	completed = results.length;
	return {
		progress: {
			total: messageIds.length,
			completed,
			failed,
			cancelled: 0,
			active: 0,
			remaining: 0,
			applied,
			skipped,
			phase,
			items,
		},
		result: {
			results,
			usage: result.usage,
			model: result.model,
			processing: result.processing,
		},
	};
}

async function runResumeIdentityRefresh(task, signal) {
	const reporter = createTaskReporter(task.id);
	let latest = {
		total: 0,
		completed: 0,
		failed: 0,
		cancelled: 0,
		active: 0,
		remaining: 0,
		phase: 'starting',
	};
	const result = await refreshGeneratedResumesIdentity(task.applierName, {
		forceAll: task.payload?.forceAll === true,
		signal,
		renderPdf: ({ applierName, generationId, jobId }) => renderResumeIdentityPdfInBackgroundLane({
			taskId: task.id,
			profileId: task.profileId,
			generationId,
			jobId,
			signal,
		}),
		onProgress: (progress) => {
			latest = {
				total: Number(progress.total || 0),
				completed: Number(progress.done || 0),
				failed: Number(progress.failed || 0),
				cancelled: 0,
				active: Number(progress.active || 0),
				remaining: Number(progress.left || 0),
				phase: progress.phase || 'refreshing',
				updated: Number(progress.updated || 0),
				pdfs: Number(progress.pdfs || 0),
				skipped: Number(progress.skipped || 0),
				alreadyCurrent: Number(progress.alreadyCurrent || 0),
				profileUpdatedAt: progress.profileUpdatedAt || null,
				resumeUpdatedAt: progress.resumeUpdatedAt || null,
			};
			void reporter.progress(latest);
		},
	});
	await reporter.flush();
	return { progress: { ...latest, active: 0, phase: 'done' }, result };
}

export async function processBackgroundTask(task, signal) {
	switch (task.type) {
		case BACKGROUND_TASK_TYPES.RESUME_GENERATION:
			return runResumeGeneration(task, signal);
		case BACKGROUND_TASK_TYPES.TITLE_REVIEW:
			return runTitleReview(task, signal);
		case BACKGROUND_TASK_TYPES.SKILL_EXTRACTION:
			return runSkillExtraction(task, signal);
		case BACKGROUND_TASK_TYPES.RESUME_REMOVAL:
			return runResumeRemoval(task, signal);
		case BACKGROUND_TASK_TYPES.JOB_REMOVAL:
			return runJobRemoval(task, signal);
		case BACKGROUND_TASK_TYPES.JOB_ANALYSIS:
			return runJobAnalysis(task, signal);
		case BACKGROUND_TASK_TYPES.RESUME_SKILL_ANALYSIS:
			return runResumeSkillAnalysis(task, signal);
		case BACKGROUND_TASK_TYPES.JOB_EMBEDDING:
			return runJobEmbedding(task, signal);
		case BACKGROUND_TASK_TYPES.SKILL_ENRICHMENT:
			return runSkillEnrichment(task, signal);
		case BACKGROUND_TASK_TYPES.MAIL_AI_LABEL:
			return runMailAiLabel(task, signal);
		case BACKGROUND_TASK_TYPES.RESUME_IDENTITY_REFRESH:
			return runResumeIdentityRefresh(task, signal);
		default:
			throw Object.assign(new Error(`No worker processor is registered for ${task.type}`), {
				code: 'BACKGROUND_TASK_PROCESSOR_MISSING',
			});
	}
}

export const backgroundTaskProcessorTest = { jobDescription, isAbortError };
