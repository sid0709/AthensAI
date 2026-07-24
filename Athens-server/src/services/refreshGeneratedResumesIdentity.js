/**
 * Beta-only: rewrite stored generation identity + library text and re-render
 * per-job draft PDFs from the current Profile Settings contact/header fields
 * (LinkedIn, email, phone, name, education). Does not re-run the LLM.
 *
 * Incremental sync:
 * - Profile `updatedAt` is the identity version watermark after each profile save.
 * - Profile `resumeUpdatedAt` is set when every generation is synced to that version.
 * - Each generation stores `identitySyncedAt` (= profile.updatedAt it was synced to).
 * - Bulk refresh only processes generations where identitySyncedAt < profile.updatedAt
 *   (or missing), so re-runs skip already-updated résumés.
 *
 * PDF speed: high parallel Chromium pool + no nested limiter; skips review copies.
 */
import { ObjectId } from "mongodb";
import {
  accountInfoCollection,
  resumeGenerationsCollection,
  userResumesCollection,
} from "../db/mongo.js";
import { isBetaTier } from "../lib/betaTier.js";
import { identityFromProfile } from "../utils/identityFromProfile.js";
import {
  decryptProfileApiKeys,
  encryptProfileApiKeys,
  loadDecryptedAutoBidProfile,
} from "./autoBidProfileSecrets.js";
import { sectionsToText } from "./generatedResumeText.js";
import { loadGeneratorConfig, buildGenerationRequestFromSavedConfig } from "./resumeGenerationService.js";
import { renderAgentResumePdf } from "./agentResumePdf.js";
import {
  deleteAgentDraftPdf,
  identityContactFingerprint,
} from "./agentResumeDraftService.js";
import {
  computeTitlePolicyFingerprint,
  sourceCareers,
  TITLE_POLICY_VERSION,
} from "./resumeCareerTitlePolicy.js";
import { createLimiter } from "../utils/concurrency.js";
import { storeUserResumeContent } from "./userResumeService.js";

const cleanString = (v) => String(v ?? "").trim();

/** How many generations to update in parallel (Mongo + library + PDF). */
const DEFAULT_REFRESH_CONCURRENCY = 16;

function refreshConcurrency() {
  const n = Number.parseInt(String(process.env.RESUME_IDENTITY_REFRESH_CONCURRENCY ?? ""), 10);
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_REFRESH_CONCURRENCY;
}

function toMs(isoOrDate) {
  if (!isoOrDate) return 0;
  const t = new Date(isoOrDate).getTime();
  return Number.isFinite(t) ? t : 0;
}

/** True when this generation still needs identity sync for the current profile version. */
export function needsIdentitySync(generation, profileUpdatedAt) {
  const profileMs = toMs(profileUpdatedAt);
  if (!profileMs) return true;
  const syncedMs = toMs(generation?.identitySyncedAt);
  return syncedMs < profileMs;
}

async function resolveIsBeta(applierName) {
  if (!accountInfoCollection) return false;
  const name = cleanString(applierName);
  if (!name) return false;
  let acc = await accountInfoCollection.findOne({ name }, { projection: { tier: 1 } });
  if (!acc) {
    const esc = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    acc = await accountInfoCollection.findOne(
      { name: { $regex: new RegExp(`^${esc}$`, "i") } },
      { projection: { tier: 1 } },
    );
  }
  return isBetaTier(acc?.tier);
}

async function findAccountDoc(applierName) {
  if (!accountInfoCollection) return null;
  const name = cleanString(applierName);
  if (!name) return null;
  let acc = await accountInfoCollection.findOne({ name });
  if (!acc) {
    const esc = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    acc = await accountInfoCollection.findOne({ name: { $regex: new RegExp(`^${esc}$`, "i") } });
  }
  return acc;
}

async function setProfileResumeUpdatedAt(applierName, resumeUpdatedAt) {
  const acc = await findAccountDoc(applierName);
  if (!acc?._id || !accountInfoCollection) return;
  const existing = await decryptProfileApiKeys(acc.autoBidProfile || {});
  const next = await encryptProfileApiKeys({
    ...existing,
    resumeUpdatedAt,
  });
  await accountInfoCollection.updateOne({ _id: acc._id }, { $set: { autoBidProfile: next } });
}

async function updateLibraryResumeText({ generationId, resumeId, ownerName, extractedText, identitySyncedAt }) {
  if (!userResumesCollection || (!generationId && !resumeId)) return false;
  let filter;
  if (resumeId) {
    try {
      filter = { _id: new ObjectId(String(resumeId)), ownerName };
    } catch {
      return false;
    }
  } else {
    filter = { ownerName, generationId: String(generationId), source: "generated" };
  }
  const existing = await userResumesCollection.findOne(filter);
  if (!existing) return false;
  const now = new Date().toISOString();
  const buffer = Buffer.from(extractedText || "Generated resume", "utf8");
  const stored = await storeUserResumeContent({
    resumeId: existing._id,
    ownerName,
    fileName: existing.fileName || "generated-resume.txt",
    mimeType: existing.mimeType || "text/plain",
    buffer,
  });
  const patch = {
    extractedText,
    contentBase64: stored.contentBase64,
    storage: stored.storage,
    file: stored.file,
    sizeBytes: stored.sizeBytes,
    updatedAt: now,
    identitySyncedAt,
    identityRefreshedAt: now,
  };
  const byGen = await userResumesCollection.updateOne(
    { _id: existing._id },
    { $set: patch, $unset: { gridFsId: "" } },
  );
  return byGen.matchedCount > 0;
}

function emitProgress(onProgress, state) {
  if (typeof onProgress !== "function") return;
  onProgress({
    phase: state.phase,
    done: state.done,
    total: state.total,
    left: Math.max(0, state.total - state.done),
    updated: state.updated,
    pdfs: state.pdfs,
    skipped: state.skipped,
    alreadyCurrent: state.alreadyCurrent ?? 0,
    active: state.active ?? 0,
    failed: state.failed ?? 0,
    profileUpdatedAt: state.profileUpdatedAt ?? null,
    resumeUpdatedAt: state.resumeUpdatedAt ?? null,
  });
}

/**
 * @param {string} applierNameRaw
 * @param {{ onProgress?: (evt: object) => void, forceAll?: boolean }} [opts]
 * @returns {Promise<object>}
 */
export async function refreshGeneratedResumesIdentity(applierNameRaw, opts = {}) {
  const onProgress = opts.onProgress;
  const forceAll = Boolean(opts.forceAll);
  const name = cleanString(applierNameRaw);
  if (!name) {
    const err = new Error("applierName is required");
    err.status = 400;
    throw err;
  }
  if (!(await resolveIsBeta(name))) {
    const err = new Error("Beta workspace required.");
    err.status = 403;
    err.betaRequired = true;
    throw err;
  }
  if (!resumeGenerationsCollection) {
    const err = new Error("Database not ready");
    err.status = 503;
    throw err;
  }

  const profile = await loadDecryptedAutoBidProfile(name);
  if (!profile) {
    const err = new Error(`No autoBidProfile found for ${name}`);
    err.status = 404;
    throw err;
  }

  const profileUpdatedAt = cleanString(profile.updatedAt) || new Date().toISOString();
  const identity = identityFromProfile(profile);
  const identityFingerprint = identityContactFingerprint(identity);
  const savedConfig = await loadGeneratorConfig(name);
  const isBeta = true;

  const generations = await resumeGenerationsCollection
    .find({
      applierName: name,
      status: "completed",
      sections: { $exists: true, $ne: null },
    })
    .toArray();

  const stale = forceAll
    ? generations
    : generations.filter((g) => needsIdentitySync(g, profileUpdatedAt));
  const alreadyCurrent = generations.length - stale.length;

  const total = stale.length;
  const counters = {
    phase: "start",
    done: 0,
    total,
    updated: 0,
    pdfs: 0,
    skipped: 0,
    alreadyCurrent,
    failed: 0,
    active: 0,
    profileUpdatedAt,
    resumeUpdatedAt: profile.resumeUpdatedAt || null,
  };
  emitProgress(onProgress, counters);

  if (total === 0) {
    // All generations already match this profile version — stamp the watermark.
    await setProfileResumeUpdatedAt(name, profileUpdatedAt);
    counters.phase = "done";
    counters.resumeUpdatedAt = profileUpdatedAt;
    emitProgress(onProgress, counters);
    return {
      updated: 0,
      pdfs: 0,
      skipped: 0,
      alreadyCurrent,
      failed: 0,
      total: 0,
      catalogTotal: generations.length,
      profileUpdatedAt,
      resumeUpdatedAt: profileUpdatedAt,
    };
  }

  const limiter = createLimiter({ concurrency: Math.min(refreshConcurrency(), total) });

  await Promise.all(
    stale.map((gen) =>
      limiter.run(async () => {
        counters.active += 1;
        emitProgress(onProgress, { ...counters, phase: "progress" });
        try {
          if (!gen?.sections) {
            counters.skipped += 1;
            return;
          }

          const extractedText = sectionsToText(gen.sections, identity);
          const jobId = cleanString(gen.generate_parent_job_id);
          const jd = cleanString(gen.jobDescription);
          const body = buildGenerationRequestFromSavedConfig({
            applierName: name,
            jobDescription: jd,
            savedConfig,
            identity,
            generateParentJobId: jobId || undefined,
            structuredJob: Boolean(jobId),
          });
          const titlePolicyFingerprint = computeTitlePolicyFingerprint({
            isBeta,
            jobDescription: jd,
            careers: sourceCareers(identity),
            config: body,
          });
          const now = new Date();

          await resumeGenerationsCollection.updateOne(
            { _id: gen._id },
            {
              $set: {
                identity,
                titlePolicyFingerprint,
                titlePolicyVersion: TITLE_POLICY_VERSION,
                isBeta: true,
                identityRefreshedAt: now,
                // Watermark: this résumé matches profile.updatedAt
                identitySyncedAt: profileUpdatedAt,
              },
            },
          );

          const generationId = String(gen._id);
          const libraryUpdated = await updateLibraryResumeText({
            generationId,
            ownerName: name,
            extractedText,
            identitySyncedAt: profileUpdatedAt,
          });

          if (!libraryUpdated && gen.libraryResumeId && userResumesCollection) {
            await updateLibraryResumeText({
              resumeId: gen.libraryResumeId,
              ownerName: name,
              extractedText,
              identitySyncedAt: profileUpdatedAt,
            });
          }

          if (jobId) {
            await deleteAgentDraftPdf(name, jobId);
            // htmlToPdf already uses pdfRenderLimiter — do not nest another acquire.
            await renderAgentResumePdf({
              sections: gen.sections,
              identity,
              applierName: name,
              jobId,
              config: savedConfig,
              titlePolicyFingerprint,
              identityFingerprint,
              skipReviewCopy: true,
            });
            counters.pdfs += 1;
          }

          counters.updated += 1;
        } catch (err) {
          counters.failed += 1;
          console.warn(
            `[refresh-identity] failed for generation ${String(gen?._id)}:`,
            err?.message || err,
          );
        } finally {
          counters.active = Math.max(0, counters.active - 1);
          counters.done += 1;
          emitProgress(onProgress, { ...counters, phase: "progress" });
        }
      }),
    ),
  );

  // Only advance profile.resumeUpdatedAt when every stale résumé succeeded.
  let resumeUpdatedAt = profile.resumeUpdatedAt || null;
  if (counters.failed === 0) {
    await setProfileResumeUpdatedAt(name, profileUpdatedAt);
    resumeUpdatedAt = profileUpdatedAt;
  }

  counters.phase = "done";
  counters.active = 0;
  counters.resumeUpdatedAt = resumeUpdatedAt;
  emitProgress(onProgress, counters);

  return {
    updated: counters.updated,
    pdfs: counters.pdfs,
    skipped: counters.skipped,
    alreadyCurrent,
    failed: counters.failed,
    total,
    catalogTotal: generations.length,
    profileUpdatedAt,
    resumeUpdatedAt,
  };
}
