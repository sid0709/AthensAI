import {
  countPendingExtraction,
} from '../services/jobSkillExtraction/extractSession.js';
import {
  createBackgroundTask,
  findActiveBackgroundTask,
  listBackgroundTasks,
  requestBackgroundTaskCancellation,
} from '../services/backgroundTasks/taskStore.js';
import { BACKGROUND_TASK_TYPES } from '../services/backgroundTasks/taskTypes.js';

function taskIdentity(req, applierName) {
  const name = String(applierName || req.authProfile?.profileName || req.authProfile?.applierName || '').trim();
  return {
    applierName: name,
    profileId: String(req.authProfile?.profileId || req.body?.profileId || req.query?.profileId || '').trim()
      || name.toLocaleLowerCase('en-US'),
    ownerUid: String(req.auth?.uid || '').trim() || null,
  };
}

function skillSession(task, pending = null) {
  if (!task) return { running: false, status: 'idle', pending, pendingKnown: pending != null };
  const progress = task.progress || {};
  const status = task.status === 'queued'
    ? 'running'
    : task.status === 'cancelling'
      ? 'stopping'
      : task.status === 'completed_with_errors' ? 'completed' : task.status;
  return {
    running: ['queued', 'running', 'cancelling'].includes(task.status),
    status,
    sessionId: task.id,
    pending,
    pendingKnown: pending != null,
    total: progress.total ?? null,
    processed: progress.completed ?? 0,
    extracted: progress.extracted ?? 0,
    failed: progress.failed ?? 0,
    retried: progress.retried ?? 0,
    cancelled: progress.cancelled ?? 0,
    remaining: progress.remaining ?? null,
    phase: progress.phase ?? null,
    inflight: progress.active ?? 0,
    lastJob: progress.lastJob ?? null,
    startedAt: task.startedAt,
    finishedAt: task.finishedAt,
    error: task.error,
    concurrency: 8,
    batchSize: 8,
    jobsPerWave: 64,
  };
}

async function latestSkillTask(profileId) {
  const active = await findActiveBackgroundTask(profileId, BACKGROUND_TASK_TYPES.SKILL_EXTRACTION);
  if (active) return active;
  const tasks = await listBackgroundTasks(profileId, { limit: 20 });
  return tasks.find((task) => task.type === BACKGROUND_TASK_TYPES.SKILL_EXTRACTION) || null;
}

export async function getSkillExtractStatus(req, res) {
  try {
    const applierName = String(req.query.applierName || '').trim();
    const identity = taskIdentity(req, applierName);
    const [task, pending] = await Promise.all([
      latestSkillTask(identity.profileId),
      countPendingExtraction(true).catch(() => null),
    ]);
    return res.json({ success: true, ...skillSession(task, pending) });
  } catch (err) {
    console.error('GET /api/jobs/skill-extract/status error', err);
    return res.status(500).json({ success: false, error: err.message });
  }
}

export async function startSkillExtract(req, res) {
  try {
    const applierName = req.body?.applierName;
    const limit = req.body?.limit;
    const identity = taskIdentity(req, applierName);
    const result = await createBackgroundTask({
      requestId: req.body?.requestId,
      type: BACKGROUND_TASK_TYPES.SKILL_EXTRACTION,
      ...identity,
      payload: { ...(limit != null ? { limit } : {}) },
    });
    return res.status(result.created ? 202 : 200).json({
      success: true,
      started: result.created,
      sessionId: result.task.id,
      pending: null,
      pendingKnown: false,
      ...(result.alreadyActive ? { message: 'Skill extraction is already running.' } : {}),
    });
  } catch (err) {
    const status = Number.isInteger(err?.status) ? err.status : 500;
    console.error('POST /api/jobs/skill-extract/start error', err);
    return res.status(status).json({ success: false, error: err.message });
  }
}

export async function stopSkillExtract(req, res) {
  try {
    const identity = taskIdentity(req, req.body?.applierName);
    const task = await findActiveBackgroundTask(identity.profileId, BACKGROUND_TASK_TYPES.SKILL_EXTRACTION);
    if (!task) return res.json({ success: true, stopped: false, message: 'No active session' });
    const next = await requestBackgroundTaskCancellation(task.id);
    return res.status(202).json({ success: true, stopped: true, sessionId: next.id, status: next.status });
  } catch (err) {
    console.error('POST /api/jobs/skill-extract/stop error', err);
    return res.status(500).json({ success: false, error: err.message });
  }
}
