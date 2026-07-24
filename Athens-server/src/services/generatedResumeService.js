import { ObjectId } from "mongodb";
import { userResumesCollection, accountInfoCollection, resumeGenerationsCollection } from "../db/mongo.js";
import { deleteUserResume, storeUserResumeContent } from "./userResumeService.js";
import { sectionsToText } from "./generatedResumeText.js";
import {
  buildUserGraphFromResume,
  mergeSkillsIntoPersonalInfo,
  rebuildProfileGraph,
} from "./userKnowledgeGraph/index.js";
import { invalidateRecommendationCache } from "./matching/matchingService.js";

function cleanString(v) {
  return String(v ?? "").trim();
}

async function findOwnerId(ownerName) {
  if (!accountInfoCollection) return null;
  const name = cleanString(ownerName);
  if (!name) return null;
  let acc = await accountInfoCollection.findOne({ name }, { projection: { _id: 1 } });
  if (!acc) {
    const esc = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    acc = await accountInfoCollection.findOne({ name: { $regex: new RegExp(`^${esc}$`, "i") } }, { projection: { _id: 1 } });
  }
  return acc?._id ?? null;
}

/**
 * After a successful generation run, persist LLM skill analysis and register
 * the resume in the user library.
 */
export async function syncGeneratedResumeAfterRun({
  generationId,
  ownerName,
  sections,
  identity,
  jobDescription,
  templateId,
  skillProfile,
  techStack,
  skillAnalysisError,
  generateParentJobId,
  titlePolicyFingerprint,
  titlePolicyVersion,
  isBeta,
  identitySyncedAt,
}) {
  if (!userResumesCollection || !sections || !ownerName) return null;

  const profile = Array.isArray(skillProfile) ? skillProfile : [];
  const stackLabel = cleanString(techStack) || "Generated";
  const extractedText = sectionsToText(sections, identity);
  const fullName = cleanString(identity?.fullName) || "Resume";
  const now = new Date().toISOString();
  const fileName = `${fullName.replace(/\s+/g, "_")}_generated_${Date.now()}.txt`;
  const analyzed = profile.length > 0;

  const ownerId = await findOwnerId(ownerName);
  if (!ownerId) {
    console.warn("[generatedResumeService] ownerId not found for", ownerName);
    return { skillProfile: profile, skippedLibrary: true };
  }

  const buffer = Buffer.from(extractedText || "Generated resume", "utf8");
  const parentJobId = cleanString(generateParentJobId) || null;
  const fingerprint = cleanString(titlePolicyFingerprint) || null;
  const policyVersion = titlePolicyVersion ?? null;
  const syncedAt = cleanString(identitySyncedAt) || now;
  let targetResume = null;
  if (generationId && resumeGenerationsCollection) {
    targetResume = await userResumesCollection.findOne({
      ownerName,
      generationId: String(generationId),
    });
  }
  if (!targetResume && parentJobId) {
    targetResume = await userResumesCollection.findOne({
      ownerName,
      generateParentJobId: parentJobId,
      source: "generated",
    });
  }

  const resumeId = targetResume?._id || new ObjectId();
  const stored = await storeUserResumeContent({
    resumeId,
    ownerName,
    fileName,
    mimeType: "text/plain",
    buffer,
  });
  const doc = {
    ownerId,
    ownerName,
    techStack: stackLabel,
    fileName,
    mimeType: "text/plain",
    sizeBytes: stored.sizeBytes,
    storage: stored.storage,
    file: stored.file,
    contentBase64: stored.contentBase64,
    extractedText,
    source: "generated",
    generationId: generationId ? String(generationId) : null,
    generateParentJobId: parentJobId,
    templateId: templateId ?? null,
    isPrimary: false,
    analyzed,
    analyzedAt: analyzed ? now : null,
    skillProfile: profile,
    analysisError: skillAnalysisError ?? null,
    titlePolicyFingerprint: fingerprint,
    titlePolicyVersion: policyVersion,
    isBeta: Boolean(isBeta),
    identitySyncedAt: syncedAt,
    identityRefreshedAt: now,
    uploadedAt: now,
    updatedAt: now,
  };

  if (targetResume) {
    await userResumesCollection.updateOne(
      { _id: resumeId },
      {
        $set: {
          ...doc,
          generateParentJobId: parentJobId ?? targetResume.generateParentJobId ?? null,
          generationId: generationId ? String(generationId) : targetResume.generationId,
          titlePolicyFingerprint: fingerprint ?? targetResume.titlePolicyFingerprint ?? null,
          titlePolicyVersion: policyVersion ?? targetResume.titlePolicyVersion ?? null,
        },
        $unset: { gridFsId: "" },
      },
    );
  } else {
    await userResumesCollection.insertOne({ _id: resumeId, ...doc });
  }

  const resumeIdStr = String(resumeId);

  if (generationId && resumeGenerationsCollection) {
    await resumeGenerationsCollection.updateOne(
      { _id: new ObjectId(String(generationId)) },
      {
        $set: {
          skillProfile: profile,
          techStack: stackLabel,
          analyzed,
          analyzedAt: analyzed ? now : null,
          skillAnalysisError: skillAnalysisError ?? null,
          libraryResumeId: resumeIdStr,
          ...(fingerprint
            ? {
                titlePolicyFingerprint: fingerprint,
                titlePolicyVersion: policyVersion,
                isBeta: Boolean(isBeta),
              }
            : {}),
        },
      },
    );
  }

  if (profile.length) {
    await buildUserGraphFromResume({
      applierName: ownerName,
      resumeId: resumeIdStr,
      resumeName: fileName,
      skills: profile,
    });
    await mergeSkillsIntoPersonalInfo(profile.map((s) => s.name));
    await rebuildProfileGraph(ownerName);
    invalidateRecommendationCache(ownerName);
  }

  return { skillProfile: profile, techStack: stackLabel, resumeId: resumeIdStr, fileName };
}

/** Delete a generation run and its linked generated library resume (if any). */
export async function deleteGenerationRun(id, ownerName) {
  if (!resumeGenerationsCollection) throw new Error("Database not ready");
  const name = cleanString(ownerName);
  if (!name) throw new Error("applierName is required");

  let _id;
  try {
    _id = new ObjectId(id);
  } catch {
    throw new Error("Invalid generation id");
  }

  const run = await resumeGenerationsCollection.findOne({ _id, applierName: name });
  if (!run) throw new Error("Generation run not found");

  let resumeDeleted = false;
  const resumeId = cleanString(run.libraryResumeId);
  if (resumeId) {
    try {
      await deleteUserResume(resumeId, name);
      resumeDeleted = true;
    } catch (err) {
      if (!String(err?.message || "").toLowerCase().includes("not found")) throw err;
    }
  } else if (userResumesCollection) {
    const linked = await userResumesCollection.findOne({
      ownerName: name,
      generationId: String(_id),
    });
    if (linked) {
      await deleteUserResume(String(linked._id), name);
      resumeDeleted = true;
    }
  }

  await resumeGenerationsCollection.deleteOne({ _id, applierName: name });
  return { deleted: true, generationId: String(_id), resumeDeleted };
}

export { sectionsToText };
