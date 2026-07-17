/**
 * Per-job agent résumé drafts on disk (Node fs). Each Mongo job id gets a stable
 * `draft.pdf` path so the Agent UI can stream/preview without re-embedding huge base64.
 *
 * Drafts are keyed by a render fingerprint (templateId + theme + layout + renderer
 * version + title-policy fingerprint). Stale drafts (pre-templateId renderer, title
 * policy / profile / JD drift, or after the user changes Template / Theme / Layout
 * in My Resumes) are ignored so the next read re-renders.
 */
import { access, mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { TITLE_POLICY_VERSION } from "./resumeCareerTitlePolicy.js";

const REVIEW_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  ".local",
  "agent-resumes",
);
const DRAFT_ROOT = path.join(REVIEW_ROOT, "by-job");

/** Bump when sectionsToHtml / template catalog changes so old drafts re-render. */
export const AGENT_PDF_RENDER_VERSION = 2;

const safe = (s) => String(s || "").replace(/[^\w.\- ]+/g, "_").slice(0, 80);

async function pathExists(filePath) {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

/** Stable draft path for applier + job id. */
export function agentDraftPdfPath(applierName, jobId) {
  return path.join(DRAFT_ROOT, safe(applierName) || "applier", safe(jobId) || "job", "draft.pdf");
}

function draftMetaPath(applierName, jobId) {
  return path.join(path.dirname(agentDraftPdfPath(applierName, jobId)), "draft.meta.json");
}

/** Contact / header fields that appear on the rendered PDF (not in title-policy FP). */
export function identityContactFingerprint(identity) {
  const id = identity && typeof identity === "object" ? identity : {};
  const education = Array.isArray(id.education)
    ? id.education.map((e) => ({
        school: String(e?.school ?? "").trim(),
        degree: String(e?.degree ?? "").trim(),
        period: String(e?.period ?? "").trim(),
      }))
    : [];
  return createHash("sha1")
    .update(
      JSON.stringify({
        fullName: String(id.fullName ?? "").trim(),
        location: String(id.location ?? "").trim(),
        email: String(id.email ?? "").trim(),
        phone: String(id.phone ?? "").trim(),
        linkedin: String(id.linkedin ?? "").trim(),
        education,
      }),
    )
    .digest("hex");
}

/**
 * Fingerprint of the visual config + title policy + identity header that affect the draft PDF.
 * Pass `titlePolicyFingerprint` / `identityFingerprint` so Beta/profile/JD/contact
 * changes invalidate cached drafts.
 */
export function agentPdfRenderFingerprint(config, titlePolicyFingerprint, identityFingerprint) {
  const c = config && typeof config === "object" ? config : {};
  const titleFp =
    titlePolicyFingerprint ??
    c.titlePolicyFingerprint ??
    null;
  const identityFp =
    identityFingerprint ??
    c.identityFingerprint ??
    null;
  const payload = {
    v: AGENT_PDF_RENDER_VERSION,
    templateId: c.templateId ?? null,
    theme: c.theme ?? null,
    layout: c.layout ?? null,
    titlePolicyVersion: TITLE_POLICY_VERSION,
    titlePolicyFingerprint: titleFp,
    identityFingerprint: identityFp,
  };
  return createHash("sha1").update(JSON.stringify(payload)).digest("hex");
}

/** Write PDF bytes to the stable draft path (+ optional timestamped review copy). */
export async function writeAgentDraftPdf({
  buffer,
  applierName,
  jobId,
  html,
  config,
  titlePolicyFingerprint,
  identityFingerprint,
  skipReviewCopy = false,
}) {
  const draftPath = agentDraftPdfPath(applierName, jobId);
  const dir = path.dirname(draftPath);
  await mkdir(dir, { recursive: true });
  await writeFile(draftPath, buffer);
  if (html) {
    await writeFile(path.join(dir, "draft.html"), html, "utf8");
  }
  const titleFp = titlePolicyFingerprint ?? config?.titlePolicyFingerprint ?? null;
  const identityFp = identityFingerprint ?? config?.identityFingerprint ?? null;
  try {
    await writeFile(
      path.join(dir, "draft.meta.json"),
      JSON.stringify({
        fingerprint: agentPdfRenderFingerprint(config, titleFp, identityFp),
        templateId: config?.templateId ?? null,
        renderVersion: AGENT_PDF_RENDER_VERSION,
        titlePolicyVersion: TITLE_POLICY_VERSION,
        titlePolicyFingerprint: titleFp,
        identityFingerprint: identityFp,
        writtenAt: new Date().toISOString(),
      }),
      "utf8",
    );
  } catch {
    /* meta is best-effort */
  }

  let reviewPath = "";
  if (!skipReviewCopy) {
    try {
      const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
      const reviewDir = path.join(REVIEW_ROOT, stamp);
      await mkdir(reviewDir, { recursive: true });
      const base = `${safe(applierName) || "resume"}-${safe(jobId) || "job"}`;
      reviewPath = path.join(reviewDir, `${base}.pdf`);
      await writeFile(reviewPath, buffer);
      if (html) await writeFile(path.join(reviewDir, `${base}.html`), html, "utf8");
    } catch {
      /* review copy is best-effort */
    }
  }

  return { draftPath, reviewPath };
}

/**
 * Read the on-disk draft PDF if it exists and still matches the current render config.
 * Pass `config` (saved Resume Generator config) so template/theme/layout changes invalidate
 * the cache. Without config, any existing draft is returned (legacy callers).
 * When `titlePolicyFingerprint` / `identityFingerprint` are provided (or present on config),
 * title-policy or contact-header drift also invalidates the draft.
 */
export async function readAgentDraftPdf(
  applierName,
  jobId,
  config,
  titlePolicyFingerprint,
  identityFingerprint,
) {
  const draftPath = agentDraftPdfPath(applierName, jobId);
  if (!(await pathExists(draftPath))) return null;
  const buffer = await readFile(draftPath);
  if (!buffer?.length) return null;

  if (config !== undefined) {
    const metaFile = draftMetaPath(applierName, jobId);
    let meta = null;
    try {
      if (await pathExists(metaFile)) meta = JSON.parse(await readFile(metaFile, "utf8"));
    } catch {
      meta = null;
    }
    const titleFp = titlePolicyFingerprint ?? config?.titlePolicyFingerprint;
    const identityFp = identityFingerprint ?? config?.identityFingerprint;
    const expected = agentPdfRenderFingerprint(config, titleFp, identityFp);
    // No meta ⇒ pre-fingerprint / pre-templateId draft — always stale.
    if (!meta?.fingerprint || meta.fingerprint !== expected) return null;
  }

  return { buffer, draftPath };
}

/** Remove the stable draft PDF (and sibling html/meta) so the next run re-renders. */
export async function deleteAgentDraftPdf(applierName, jobId) {
  const draftPath = agentDraftPdfPath(applierName, jobId);
  const dir = path.dirname(draftPath);
  try {
    if (await pathExists(draftPath)) await unlink(draftPath);
    for (const name of ["draft.html", "draft.meta.json"]) {
      const p = path.join(dir, name);
      if (await pathExists(p)) await unlink(p);
    }
  } catch {
    /* best-effort */
  }
}

export { REVIEW_ROOT, DRAFT_ROOT };
