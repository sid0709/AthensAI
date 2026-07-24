import { ObjectId } from "mongodb";
import { userResumesCollection, accountInfoCollection } from "../db/mongo.js";
import { chatCompletion, resolveDefaultModel } from "./llm/llmService.js";
import { RESUME_SKILL_ANALYSIS_PROMPT } from "../config/resumeSkillAnalysisPrompt.js";
import {
  buildUserGraphFromResume,
  mergeSkillsIntoPersonalInfo,
  rebuildProfileGraph,
} from "./userKnowledgeGraph/index.js";
import { mergeSkillProfiles } from "./resumeSkillMerge.js";
import { parseSkillProfileJson } from "./resumeSkillProfile.js";
import { invalidateRecommendationCache } from "./matching/matchingService.js";
import { decryptAccountDoc } from "./autoBidProfileSecrets.js";
import { updateAccountInfoById } from "./accountInfoStore.js";

async function findAccount(applierNameRaw) {
  const name = String(applierNameRaw ?? "").trim();
  if (!name || !accountInfoCollection) return null;
  const proj = { projection: { autoBidProfile: 1 } };
  let acc = await accountInfoCollection.findOne({ name }, proj);
  if (!acc) {
    const esc = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    acc = await accountInfoCollection.findOne({ name: { $regex: new RegExp(`^${esc}$`, "i") } }, proj);
  }
  return acc;
}

async function findAccountForResumeAnalysisCatalogSync(applierNameRaw) {
  const name = String(applierNameRaw ?? "").trim();
  if (!name || !accountInfoCollection) return null;
  const proj = { projection: { _id: 1, name: 1, resumeAnalysisCatalog: 1 } };
  let acc = await accountInfoCollection.findOne({ name }, proj);
  if (!acc) {
    const esc = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    acc = await accountInfoCollection.findOne(
      { name: { $regex: new RegExp(`^${esc}$`, "i") } },
      proj,
    );
  }
  return acc || null;
}

function buildCatalogSkillListFromResumes(resumes) {
  // key: lowercased skill name -> { name, category, level }
  const skillByKey = new Map();

  for (const resume of resumes || []) {
    for (const raw of resume.skillProfile || []) {
      const name = String(raw?.name ?? "").trim();
      if (!name) continue;

      const level = Number(raw?.level);
      if (!Number.isFinite(level)) continue;
      const clampedLevel = Math.max(1, Math.min(5, Math.round(level)));

      const category = String(raw?.category ?? "").trim();
      const key = name.toLowerCase();

      const prev = skillByKey.get(key);
      if (!prev || clampedLevel > prev.level) {
        skillByKey.set(key, { name, category, level: clampedLevel });
      }
    }
  }

  return [...skillByKey.values()].sort((a, b) => b.level - a.level || a.name.localeCompare(b.name));
}

/**
 * Sync the *detailed* analyzed resume skills into account_info so that
 * Bid-Monitor / recommend-resume can rank using the same signal as the
 * Athens "Analysis" tab.
 *
 * Writes:
 * - account_info.resumeAnalysisCatalog[stackName] = [{ name, category, level }]
 * - account_info.resumeAnalysisCatalogUpdatedAt
 *
 * This sync rebuilds only the affected stack from analyzed resumes.
 */
async function syncResumeAnalysisCatalogStackFromAnalysis(ownerName, stackName) {
  const owner = String(ownerName ?? "").trim();
  const stack = String(stackName ?? "").trim();
  if (!owner || !stack) return { skipped: true, reason: "missing_owner_or_stack" };
  if (!userResumesCollection || !accountInfoCollection) return { skipped: true, reason: "db_not_ready" };

  const acc = await findAccountForResumeAnalysisCatalogSync(owner);
  if (!acc) return { skipped: true, reason: "account_not_found" };

  const analyzedResumes = await userResumesCollection
    .find({ ownerName: owner, analyzed: true, techStack: stack })
    .project({ skillProfile: 1 })
    .toArray();

  if (!Array.isArray(analyzedResumes) || analyzedResumes.length === 0) {
    return { skipped: true, reason: "no_analyzed_resumes_for_stack" };
  }

  const skillsList = buildCatalogSkillListFromResumes(analyzedResumes);
  if (!skillsList || !skillsList.length) {
    return { skipped: true, reason: "empty_skill_list" };
  }

  const existingCatalog =
    acc?.resumeAnalysisCatalog && typeof acc.resumeAnalysisCatalog === "object" && !Array.isArray(acc.resumeAnalysisCatalog)
      ? acc.resumeAnalysisCatalog
      : {};

  const updatedCatalog = {
    ...existingCatalog,
    [stack]: skillsList,
  };

  const updatedAt = new Date().toISOString();
  await updateAccountInfoById(acc._id, acc.name, {
    $set: { resumeAnalysisCatalog: updatedCatalog, resumeAnalysisCatalogUpdatedAt: updatedAt },
  });

  return { ok: true, stack, updatedAt };
}

async function extractSkillsWithLlm(extractedText, profile, ownerName) {
  const { provider: providerId, apiKey, model } = resolveDefaultModel(profile);
  if (!apiKey) {
    throw new Error("No LLM API key configured in profile (OpenAI or DeepSeek).");
  }

  const text = String(extractedText || "").trim();
  if (!text) throw new Error("Resume has no extractable text");

  const truncated = text.length > 12000 ? `${text.slice(0, 12000)}\n\n[truncated]` : text;

  const result = await chatCompletion({
    provider: providerId,
    apiKey,
    model,
    feature: "resume-skill-analysis",
		applierName: ownerName,
    messages: [
      { role: "system", content: RESUME_SKILL_ANALYSIS_PROMPT },
      { role: "user", content: `Resume text:\n\n${truncated}` },
    ],
  });

  return {
    skillProfile: mergeSkillProfiles(parseSkillProfileJson(result?.content), text),
    usage: result?.usage || null,
    provider: providerId,
    model,
  };
}

async function loadResumeDoc(resumeId, ownerName) {
  if (!userResumesCollection) throw new Error("Database not ready");
  const name = String(ownerName || "").trim();
  if (!name) throw new Error("ownerName is required");

  let objectId;
  try {
    objectId = new ObjectId(resumeId);
  } catch {
    throw new Error("Invalid resume id");
  }

  const doc = await userResumesCollection.findOne({ _id: objectId, ownerName: name });
  if (!doc) throw new Error("Resume not found");
  return doc;
}

/**
 * Analyze resume skills with LLM, build per-resume graph, merge into profile knowledge.
 */
export async function analyzeResumeSkills(resumeId, ownerName, { force = false } = {}) {
  const doc = await loadResumeDoc(resumeId, ownerName);
  const resumeIdStr = String(doc._id);

  if (doc.source === "generated" && doc.analyzed && Array.isArray(doc.skillProfile) && doc.skillProfile.length && !force) {
    const graph = await buildUserGraphFromResume({
      applierName: ownerName,
      resumeId: resumeIdStr,
      resumeName: doc.fileName,
      skills: doc.skillProfile,
    });
    const profileGraph = await rebuildProfileGraph(ownerName);
    void syncResumeAnalysisCatalogStackFromAnalysis(ownerName, doc.techStack).catch(() => {});
    return {
      alreadyAnalyzed: true,
      skillProfile: doc.skillProfile,
      graph,
      profileGraph,
      usage: null,
      fromGeneration: true,
    };
  }

  if (doc.analyzed && !force && Array.isArray(doc.skillProfile) && doc.skillProfile.length) {
    const graph = await buildUserGraphFromResume({
      applierName: ownerName,
      resumeId: resumeIdStr,
      resumeName: doc.fileName,
      skills: doc.skillProfile,
    });
    const profileGraph = await rebuildProfileGraph(ownerName);
    void syncResumeAnalysisCatalogStackFromAnalysis(ownerName, doc.techStack).catch(() => {});
    return {
      alreadyAnalyzed: true,
      skillProfile: doc.skillProfile,
      graph,
      profileGraph,
      usage: null,
    };
  }

  const acc = await decryptAccountDoc(await findAccount(ownerName));
  if (!acc) throw new Error("Account not found");

  const profile = acc.autoBidProfile || {};
  let skillProfile;
  let usage;
  let provider;
  let model;

  try {
		const llmResult = await extractSkillsWithLlm(doc.extractedText, profile, ownerName);
    skillProfile = llmResult.skillProfile;
    usage = llmResult.usage;
    provider = llmResult.provider;
    model = llmResult.model;
  } catch (err) {
    const now = new Date().toISOString();
    await userResumesCollection.updateOne(
      { _id: doc._id },
      { $set: { analysisError: err.message, updatedAt: now } },
    );
    throw err;
  }

  const now = new Date().toISOString();
  await userResumesCollection.updateOne(
    { _id: doc._id },
    {
      $set: {
        analyzed: true,
        analyzedAt: now,
        skillProfile,
        analysisError: null,
        updatedAt: now,
      },
    },
  );

  const graph = await buildUserGraphFromResume({
    applierName: ownerName,
    resumeId: resumeIdStr,
    resumeName: doc.fileName,
    skills: skillProfile,
  });

  await mergeSkillsIntoPersonalInfo(skillProfile.map((s) => s.name));
  const profileGraph = await rebuildProfileGraph(ownerName);

  invalidateRecommendationCache(ownerName);
  await syncResumeAnalysisCatalogStackFromAnalysis(ownerName, doc.techStack);

  return {
    alreadyAnalyzed: false,
    skillProfile,
    graph,
    profileGraph,
    usage,
    provider,
    model,
  };
}
