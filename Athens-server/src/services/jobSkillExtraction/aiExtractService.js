import { createHash } from 'crypto';
import { jobsCollection, accountInfoCollection } from '../../db/mongo.js';
import { chatCompletion, resolveDefaultModel } from '../llm/llmService.js';
import { JOB_SKILL_EXTRACTION_PROMPT } from '../../config/jobSkillExtractionPrompt.js';
import { toCanonical } from '@nextoffer/shared/skill-normalize';
import { normalizeJobSkills, jobSkillTokens, indexJobInRedis } from '../matching/skillIndex.js';
import { enrichJobSkillsFromTitle } from '../matching/jobSkillExtraction.js';
import { USER_SKILL_CATEGORIES } from '../../config/graphAndVectorConfig.js';
import { recordJobSkills } from '../skillDictionary/skillDictionaryStore.js';
import { decryptProfileApiKeys } from '../autoBidProfileSecrets.js';

const MAX_CHARS = Number(process.env.JOB_SKILL_EXTRACT_MAX_CHARS || 8000);
export const MAX_ATTEMPTS = Number(process.env.JOB_SKILL_EXTRACT_MAX_ATTEMPTS || 3);

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

/** Tolerant parse of the LLM response into normalized {name, category, requirement}. */
export function parseJobSkillsJson(content) {
  if (!content) return [];
  let text = String(content).trim();
  // Strip markdown fences DeepSeek may still emit despite json mode.
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) text = fence[1].trim();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    const braceStart = text.indexOf('{');
    const braceEnd = text.lastIndexOf('}');
    if (braceStart === -1 || braceEnd <= braceStart) return [];
    try {
      data = JSON.parse(text.slice(braceStart, braceEnd + 1));
    } catch {
      return [];
    }
  }

  const rawList = Array.isArray(data) ? data : Array.isArray(data?.skills) ? data.skills : [];
  const out = [];
  const seen = new Set();
  for (const item of rawList) {
    const name = String(item?.name || '').trim();
    if (!name) continue;
    const canonical = toCanonical(name) || name.toLowerCase();
    if (seen.has(canonical)) continue;
    seen.add(canonical);
    const category = USER_SKILL_CATEGORIES.includes(item?.category) ? item.category : 'hard';
    const requirement = Math.min(5, Math.max(1, Math.round(Number(item?.requirement)) || 3));
    out.push({ name, category, requirement });
  }
  return out;
}

function getProfileForExtraction(account) {
  const { provider, apiKey, model } = resolveDefaultModel(decryptProfileApiKeys(account?.autoBidProfile || {}));
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
  const account = await accountInfoCollection.findOne({ name }, { projection: { autoBidProfile: 1 } });
  if (!account) {
    throw new Error(`Account "${name}" not found — configure an AI API key in Settings → Profile.`);
  }
  const auth = getProfileForExtraction(account);
  if (!auth.apiKey) {
    throw new Error(`No DeepSeek/OpenAI API key configured for "${name}" (Settings → Profile).`);
  }
  return { ...auth, applierName: name };
}

/** Extract skills for one job via LLM and persist. `auth` from resolveExtractionAuth. `signal` aborts in-flight. */
export async function extractAndPersistJob(job, auth, { signal } = {}) {
  const jobId = String(job._id);
  const text = jobDescriptionText(job);

  let aiSkills;
  let usage = null;
  if (!text) {
    // No description/title text — derive from title only so the job still scores.
    const { skills } = enrichJobSkillsFromTitle(job);
    aiSkills = skills.map((name) => ({ name, category: 'hard', requirement: 3 }));
  } else {
    const result = await chatCompletion({
      provider: auth.providerId,
      apiKey: auth.apiKey,
      model: auth.model,
      jsonMode: true,
      feature: 'job-skill-extract',
      applierName: auth.applierName,
      signal,
      messages: [
        { role: 'system', content: JOB_SKILL_EXTRACTION_PROMPT },
        { role: 'user', content: `Job posting:\n\n${text}` },
      ],
    });
    usage = result?.usage || null;
    aiSkills = parseJobSkillsJson(result?.content);
    if (!aiSkills.length) {
      const { skills } = enrichJobSkillsFromTitle(job);
      aiSkills = skills.map((name) => ({ name, category: 'hard', requirement: 3 }));
    }
  }

  const displaySkills = aiSkills.map((s) => s.name);
  const skillsNormalized = normalizeJobSkills(displaySkills);
  const tokens = jobSkillTokens(displaySkills);
  const now = new Date().toISOString();

  await jobsCollection.updateOne(
    { _id: job._id },
    {
      $set: {
        aiSkills,
        skills: displaySkills,
        skillsNormalized,
        skillTokens: tokens,
        aiSkillStatus: 'extracted',
        aiSkillsHash: descriptionHash(job),
        aiSkillExtractedAt: now,
        aiSkillError: null,
        matchScoreStatus: 'pending',
      },
      $unset: { aiSkillAttempts: '' },
    },
  );

  await indexJobInRedis(jobId, skillsNormalized, tokens).catch(() => {});
  await recordJobSkills(aiSkills).catch(() => {});

  return { jobId, skillCount: aiSkills.length, usage };
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

