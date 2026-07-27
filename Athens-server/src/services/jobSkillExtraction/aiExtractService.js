import { createHash } from 'crypto';
import { jobsCollection, accountInfoCollection } from '../../db/dataStore.js';
import { chatCompletion, resolveDefaultModel } from '../llm/llmService.js';
import { JOB_SKILL_EXTRACTION_PROMPT } from '../../config/jobSkillExtractionPrompt.js';
import { toCanonical } from '@nextoffer/shared/skill-normalize';
import { normalizeJobSkills, jobSkillTokens, indexJobInRedis } from '../matching/skillIndex.js';
import { enrichJobSkillsFromTitle } from '../matching/jobSkillExtraction.js';
import { USER_SKILL_CATEGORIES } from '../../config/graphAndVectorConfig.js';
import { recordJobSkillBatches } from '../skillDictionary/skillDictionaryStore.js';
import { indexJobRankingBatch } from '../matching/jobRankingIndex.js';
import { decryptProfileApiKeys } from '../autoBidProfileSecrets.js';
import { isBetaTier } from '../../lib/betaTier.js';

function numericEnv(name, fallback, minimum = 0) {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value >= minimum ? value : fallback;
}

const MAX_CHARS = numericEnv('JOB_SKILL_EXTRACT_MAX_CHARS', 8000, 1000);
const MAX_OUTPUT_TOKENS = numericEnv('JOB_SKILL_EXTRACT_MAX_OUTPUT_TOKENS', 1400, 256);
const REQUEST_TIMEOUT_MS = numericEnv('JOB_SKILL_EXTRACT_TIMEOUT_MS', 90_000, 10_000);
const REQUEST_RETRIES = numericEnv('JOB_SKILL_EXTRACT_RETRIES', 1);
export const MAX_ATTEMPTS = numericEnv('JOB_SKILL_EXTRACT_MAX_ATTEMPTS', 3, 1);
export const SKILL_EXTRACT_BATCH_SIZE = Math.floor(numericEnv('JOB_SKILL_EXTRACT_BATCH_SIZE', 8, 1));
const BATCH_MAX_OUTPUT_TOKENS = numericEnv('JOB_SKILL_EXTRACT_BATCH_MAX_OUTPUT_TOKENS', 6000, 512);

const GENERIC_SKILL_NAMES = new Set([
  'automated testing',
  'best practices',
  'clean code',
  'cloud security',
  'data modeling',
  'data validation',
  'finops',
  'governance models',
  'integration testing',
  'logging',
  'metrics',
  'modular architecture',
  'monitoring',
  'object-oriented programming',
  'observability',
  'oop',
  'performance tracking',
  'query tuning',
  'scalable architecture',
  'traces',
  'unit testing',
  'version control best practices',
]);

function isConcreteSkillName(name) {
  const normalized = String(name || '')
    .trim()
    .toLowerCase()
    .replace(/[._/]+/g, ' ')
    .replace(/\s+/g, ' ');
  if (!normalized || GENERIC_SKILL_NAMES.has(normalized)) return false;
  if (/^(?:front[- ]end|back[- ]end|automated|unit|integration|end[- ]to[- ]end)?\s*testing frameworks?$/.test(normalized)) {
    return false;
  }
  return true;
}

function jobDescriptionText(job) {
  const parts = [job?.title, job?.description || job?.jobDescription].map((s) => String(s || '').trim());
  const text = parts.filter(Boolean).join('\n\n');
  return text.length > MAX_CHARS ? `${text.slice(0, MAX_CHARS)}\n\n[truncated]` : text;
}

function descriptionHash(job) {
  return createHash('sha256')
    .update(String(job?.title || ''))
    .update('')
    .update(String(job?.description || job?.jobDescription || ''))
    .digest('hex');
}

export function reasoningEffortForExtraction(providerId, model) {
  if (providerId !== 'openai') return undefined;
  const normalized = String(model || '').toLowerCase();
  const versionedGpt5 = normalized.match(/^gpt-5\.(\d+)/);
  if (versionedGpt5 && Number(versionedGpt5[1]) >= 1) return 'none';
  if (/^gpt-5(?:-|$)/.test(normalized)) return 'minimal';
  return undefined;
}

function parseJsonObject(content) {
  if (!content) return null;
  let text = String(content).trim();
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) text = fence[1].trim();
  try {
    return JSON.parse(text);
  } catch {
    const braceStart = text.indexOf('{');
    const braceEnd = text.lastIndexOf('}');
    if (braceStart === -1 || braceEnd <= braceStart) return null;
    try {
      return JSON.parse(text.slice(braceStart, braceEnd + 1));
    } catch {
      return null;
    }
  }
}

/** Tolerant parse of the LLM response into normalized {name, category, requirement}. */
export function parseJobSkillsJson(content) {
  const data = parseJsonObject(content);
  if (!data) return [];

  const rawList = Array.isArray(data) ? data : Array.isArray(data?.skills) ? data.skills : [];
  const out = [];
  const indexByCanonical = new Map();
  for (const item of rawList) {
    const name = String(item?.name || '').trim();
    if (!isConcreteSkillName(name)) continue;
    const canonical = toCanonical(name) || name.toLowerCase();
    const category = USER_SKILL_CATEGORIES.includes(item?.category) ? item.category : 'hard';
    const requirement = Math.min(5, Math.max(1, Math.round(Number(item?.requirement)) || 3));
    const existingIndex = indexByCanonical.get(canonical);
    if (existingIndex != null) {
      if (requirement > out[existingIndex].requirement) {
        out[existingIndex] = { ...out[existingIndex], category, requirement };
      }
      continue;
    }
    indexByCanonical.set(canonical, out.length);
    out.push({ name, category, requirement });
  }
  return out;
}

export function parseJobSkillsBatchJson(content, expectedIds = []) {
  const data = parseJsonObject(content);
  const rows = Array.isArray(data?.jobs)
    ? data.jobs
    : Array.isArray(data?.results)
      ? data.results
      : [];
  const expected = new Set(expectedIds.map(String));
  const byId = new Map();
  for (const row of rows) {
    const id = String(row?.id ?? row?.jobId ?? '').trim();
    if (!id || (expected.size && !expected.has(id)) || byId.has(id)) continue;
    const skills = parseJobSkillsJson(JSON.stringify({ skills: row?.skills }));
    if (skills.length) byId.set(id, skills);
  }
  return byId;
}

const JOB_SKILL_BATCH_EXTRACTION_PROMPT = JOB_SKILL_EXTRACTION_PROMPT.replace(
  /## Output[\s\S]*$/,
  `## Output\n\nYou will receive a JSON array of jobs. Return every input id exactly once. Output ONLY valid JSON:\n\n{\n  "jobs": [\n    {\n      "id": "the exact input id",\n      "skills": [\n        { "name": "Python", "category": "hard", "requirement": 5 }\n      ]\n    }\n  ]\n}`,
);

function titleFallbackSkills(job) {
  const { skills } = enrichJobSkillsFromTitle(job);
  return skills.map((name) => ({ name, category: 'hard', requirement: 3 }));
}

function prepareExtractedJob(job, aiSkills, extractedAt) {
  const displaySkills = aiSkills.map((skill) => skill.name);
  const skillsNormalized = normalizeJobSkills(displaySkills);
  const skillTokens = jobSkillTokens(displaySkills);
  return {
    job,
    jobId: String(job._id),
    aiSkills,
    displaySkills,
    skillsNormalized,
    skillTokens,
    extractedAt,
    rankingJob: {
      ...job,
      aiSkills,
      skills: displaySkills,
      skillsNormalized,
      skillTokens,
      aiSkillStatus: 'extracted',
      aiSkillExtractedAt: extractedAt,
    },
  };
}

async function persistExtractedJobs(rows) {
  if (!jobsCollection || !rows.length) return [];
  const extractedAt = new Date().toISOString();
  const prepared = rows.map(({ job, aiSkills }) => prepareExtractedJob(job, aiSkills, extractedAt));
  const writeOperations = prepared.map((row) => ({
      updateOne: {
        filter: { _id: row.job._id },
        update: {
          $set: {
            aiSkills: row.aiSkills,
            skills: row.displaySkills,
            skillsNormalized: row.skillsNormalized,
            skillTokens: row.skillTokens,
            aiSkillStatus: 'extracted',
            aiSkillsHash: descriptionHash(row.job),
            aiSkillExtractedAt: extractedAt,
            aiSkillError: null,
            matchScoreStatus: 'pending',
          },
          $unset: { aiSkillAttempts: '', aiSkillClaimedAt: '', aiSkillSessionId: '' },
        },
      },
    }));
  if (typeof jobsCollection.atomicBulkPatch === 'function') {
    await jobsCollection.atomicBulkPatch(writeOperations);
  } else {
    await jobsCollection.bulkWrite(writeOperations, { ordered: false });
  }

  await Promise.all([
    Promise.all(
      prepared.map((row) => indexJobInRedis(row.jobId, row.skillsNormalized, row.skillTokens)),
    ).catch(() => {}),
    recordJobSkillBatches(prepared.map((row) => row.aiSkills)).catch(() => {}),
    indexJobRankingBatch(prepared.map((row) => row.rankingJob), { wait: true }).catch(() => {}),
  ]);
  return prepared;
}

async function getProfileForExtraction(account) {
  const { provider, apiKey, model } = resolveDefaultModel(await decryptProfileApiKeys(account?.autoBidProfile || {}));
  return { providerId: provider, apiKey, model };
}

/**
 * Resolve the extraction credentials once per session, using ONLY the given
 * applier's own profile. If that account has no API key configured we throw so
 * the caller surfaces an error — we never borrow another account's key, model,
 * or billing.
 */
export async function resolveExtractionAuth(applierName) {
  if (!accountInfoCollection) throw new Error('Database not ready');
  const name = String(applierName || '').trim();
  if (!name) {
    throw new Error('No applier specified — cannot resolve an AI API key for skill extraction.');
  }
  const account = await accountInfoCollection.findOne({ name }, { projection: { autoBidProfile: 1, tier: 1 } });
  if (!account) {
    throw new Error(`Account "${name}" not found — configure an AI API key in Settings → Profile.`);
  }
  const auth = await getProfileForExtraction(account);
  if (!auth.apiKey) {
    throw new Error(`No DeepSeek/OpenAI API key configured for "${name}" (Settings → Profile).`);
  }
  return { ...auth, applierName: name, includeV2Jobs: isBetaTier(account.tier) };
}

/** Extract and persist several jobs with one LLM request and batched index writes. */
export async function extractAndPersistJobBatch(jobs, auth, { signal } = {}) {
  const list = (Array.isArray(jobs) ? jobs : []).filter((job) => job?._id);
  if (!list.length) return { results: [], usage: null };

  const withText = list
    .map((job) => ({ job, id: String(job._id), posting: jobDescriptionText(job) }))
    .filter((item) => item.posting);
  let usage = null;
  let parsed = new Map();
  if (withText.length) {
    const result = await chatCompletion({
      provider: auth.providerId,
      apiKey: auth.apiKey,
      model: auth.model,
      jsonMode: true,
      feature: 'job-skill-extract-batch',
      applierName: auth.applierName,
      jobId: `batch:${withText[0].id}:${withText.length}`,
      signal,
      reasoningEffort: reasoningEffortForExtraction(auth.providerId, auth.model),
      maxTokens: Math.min(
        BATCH_MAX_OUTPUT_TOKENS,
        Math.max(MAX_OUTPUT_TOKENS, 400 + withText.length * 450),
      ),
      timeoutMs: REQUEST_TIMEOUT_MS,
      retries: REQUEST_RETRIES,
      messages: [
        { role: 'system', content: JOB_SKILL_BATCH_EXTRACTION_PROMPT },
        {
          role: 'user',
          content: `Extract skills for these jobs:\n${JSON.stringify(
            withText.map(({ id, posting }) => ({ id, posting })),
          )}`,
        },
      ],
    });
    usage = result?.usage || null;
    parsed = parseJobSkillsBatchJson(result?.content, withText.map((item) => item.id));
  }

  const rows = list.map((job) => ({
    job,
    aiSkills: parsed.get(String(job._id)) || titleFallbackSkills(job),
  }));
  const prepared = await persistExtractedJobs(rows);
  return {
    results: prepared.map((row) => ({ jobId: row.jobId, skillCount: row.aiSkills.length })),
    usage,
  };
}

/** Single-job compatibility path; internally uses the same batched implementation. */
export async function extractAndPersistJob(job, auth, { signal } = {}) {
  const result = await extractAndPersistJobBatch([job], auth, { signal });
  return { ...(result.results[0] || { jobId: String(job?._id || ''), skillCount: 0 }), usage: result.usage };
}

/** Record a failed attempt: re-queue for retry until MAX_ATTEMPTS, then mark failed. */
export async function recordExtractionFailure(job, err, { catalog = 'market' } = {}) {
  if (catalog === 'external') {
    const { recordExternalExtractionFailure } = await import('./externalJobExtractService.js');
    return recordExternalExtractionFailure(job, err);
  }
  if (!jobsCollection) return;
  const attempts = (Number(job.aiSkillAttempts) || 0) + 1;
  const terminal = attempts >= MAX_ATTEMPTS;
  await jobsCollection.updateOne(
    { _id: job._id },
    {
      $set: {
        aiSkillStatus: terminal ? 'failed' : 'pending',
        aiSkillAttempts: attempts,
        aiSkillError: String(err?.message || err).slice(0, 500),
      },
      $unset: { aiSkillClaimedAt: '', aiSkillSessionId: '' },
    },
  );
  return { attempts, terminal };
}

/** Route extraction to market or external catalog. */
export async function extractAndPersistJobByCatalog(job, auth, { signal, catalog = 'market' } = {}) {
  if (catalog === 'external') {
    const { extractAndPersistExternalJob } = await import('./externalJobExtractService.js');
    return extractAndPersistExternalJob(job, auth, { signal });
  }
  return extractAndPersistJob(job, auth, { signal });
}

export { descriptionHash };
