import { inferJobSource } from '@/app/data/jobs/pub';
import { resolveJobStatusState } from '@nextoffer/shared/job-status';
import type { ApplierAccount } from "@/context/applier-context";
import type { Job, JobStatus, WorkMode } from "../types/job";

export function normalizeId(value: unknown): string {
  if (value == null) return "";
  if (typeof value === "object" && value !== null && "$oid" in value) {
    return String((value as { $oid: string }).$oid);
  }
  return String(value);
}

function parseWorkMode(remote: string): WorkMode {
  const r = remote.toLowerCase();
  if (r.includes("remote")) return "remote";
  if (r.includes("hybrid")) return "hybrid";
  return "onsite";
}

export function mapDocToJob(doc: Record<string, unknown>, applier: ApplierAccount | null): Job {
  const backendId = normalizeId(doc._id);
  const isExternal = doc.catalog === "external" || (typeof doc.jobTitle === "string" && !doc.title);
  const isAnalyzedExternal = isExternal && doc.aiSkillStatus === "extracted";
  const company = (doc.company as { name?: string; tags?: string[]; logo?: string } | undefined) || {};
  const details = (doc.details as Record<string, string | undefined> | undefined) || {};
  const title = String(doc.title || doc.jobTitle || "Untitled role");

  const rawLogo =
    typeof company.logo === "string"
      ? company.logo.trim()
      : typeof doc.companyIcon === "string"
        ? doc.companyIcon.trim()
        : "";
  let logoUrl: string | undefined;
  if (/^https?:\/\//i.test(rawLogo)) logoUrl = rawLogo;
  else if (rawLogo.startsWith("//")) logoUrl = `https:${rawLogo}`;

  const companyLinkRaw = typeof doc.companyLink === "string" ? doc.companyLink.trim() : "";
  const companyUrl = /^https?:\/\//i.test(companyLinkRaw) ? companyLinkRaw : "#";

  const industries = Array.isArray(company.tags) ? company.tags.map(String) : isExternal ? [] : ["General"];
  const applierId = applier?._id != null ? normalizeId(applier._id) : null;
  const viewerStatus = typeof doc.viewerStatus === "string" ? doc.viewerStatus : null;
  const status = ((viewerStatus && ["posted", "bid-ready", "worker-pool", "bid-completed", "applied", "scheduled", "declined"].includes(viewerStatus)
    ? viewerStatus
    : !applierId
      ? "posted"
      : resolveJobStatusState(doc.status as unknown[] | undefined, applierId))) as JobStatus;

  const location = String(
    details.location || details.position || "—",
  );
  const workMode = isAnalyzedExternal
    ? parseWorkMode(String(details.remote || ""))
    : isExternal
      ? "onsite"
      : parseWorkMode(String(details.remote || ""));
  const type = String(details.time || (isExternal ? "—" : "Full-time"));
  const seniority = String(details.seniority || "—");
  const salary = String(
    details.salary || details.money || (isExternal ? "—" : "Undisclosed"),
  );
  const postedRaw = String(doc.postedAt || doc._createdAt || "");
  const postedAt = postedRaw ? postedRaw.slice(0, 10) : "";
  const posted = postedRaw ? new Date(postedRaw).toLocaleString() : "—";
  const applyUrl = String(doc.applyLink || doc.jobLink || "#");
  const source =
    typeof doc.source === "string" && doc.source
      ? doc.source
      : typeof doc.sender === "string" && doc.sender
        ? doc.sender
        : inferJobSource(String(doc.applyLink || doc.jobLink || ""));

  const skillAnalysis =
    doc.skillAnalysis && typeof doc.skillAnalysis === "object"
      ? (doc.skillAnalysis as Job["skillAnalysis"])
      : undefined;

  const aiSkills = Array.isArray(doc.aiSkills)
    ? (doc.aiSkills as { name?: unknown; category?: unknown; requirement?: unknown }[])
        .map((row) => ({
          name: String(row?.name ?? "").trim(),
          category: String(row?.category ?? "hard"),
          requirement: Math.min(5, Math.max(1, Number(row?.requirement) || 1)),
        }))
        .filter((row) => row.name)
    : undefined;

  const skills = Array.isArray(doc.skills) ? doc.skills.map(String).filter(Boolean) : [];
  const tags = Array.isArray(doc.tags) ? doc.tags.map(String).filter(Boolean) : [];
  const applicantsObj = doc.applicants as { text?: string; count?: number } | undefined;
  const applicantsText =
    typeof applicantsObj?.text === "string" && applicantsObj.text.trim()
      ? applicantsObj.text.trim()
      : tags.find((t) => /applicant/i.test(t));

  return {
    id: backendId,
    backendId,
		companyId: String(doc.companyId || `legacy:${backendId}`),
    title,
    company: String(company.name || doc.companyName || "Unknown"),
    companyUrl,
    logoUrl,
    location,
    workMode,
    type,
    seniority,
    industries,
    status,
    posted,
    postedAt,
    postedAgo: typeof doc.postedAgo === "string" ? doc.postedAgo : undefined,
    salary,
    source,
    jobDescription: String(
      doc.jobDescription ||
        doc.description ||
        `${title} at ${company.name || doc.companyName || "company"}.`,
    ),
    skills,
    tags,
    applicantsText,
    applyUrl,
    skillAnalysis,
    aiSkills,
    skillCount: typeof doc.aiSkillCount === "number" ? doc.aiSkillCount : aiSkills?.length,
    version:
      typeof doc.version === "string" && doc.version.trim()
        ? doc.version.trim()
        : null,
    catalog: isExternal ? "external" : "market",
    recommendedResumeStack:
      typeof doc.recommendedResumeStack === "string" && doc.recommendedResumeStack.trim()
        ? doc.recommendedResumeStack.trim()
        : null,
    recommendedResumeId:
      typeof doc.recommendedResumeId === "string" && doc.recommendedResumeId.trim()
        ? doc.recommendedResumeId.trim()
        : null,
    recommendedResumeReason:
      typeof doc.recommendedResumeReason === "string" && doc.recommendedResumeReason.trim()
        ? doc.recommendedResumeReason.trim()
        : null,
    useCustomizedResume: Boolean(doc.useCustomizedResume),
    recommendWarning:
      typeof doc.recommendWarning === "string" && doc.recommendWarning.trim()
        ? doc.recommendWarning.trim()
        : null,
    recommendedAt:
      typeof doc.recommendedAt === "string" && doc.recommendedAt.trim()
        ? doc.recommendedAt.trim()
        : null,
    recommendMode:
      doc.recommendMode === "llm" ||
      doc.recommendMode === "heuristic" ||
      doc.recommendMode === "manual"
        ? doc.recommendMode
        : null,
  };
}

/** Preserve compact list metadata when the full detail response omits it. */
export function mergeListJobMetadata(listJob: Job, detailJob: Job): Job {
  return {
    ...detailJob,
    aiSkills: detailJob.aiSkills?.length ? detailJob.aiSkills : listJob.aiSkills,
    recommendedResumeStack:
      detailJob.recommendedResumeStack || listJob.recommendedResumeStack || null,
    recommendedResumeId:
      detailJob.recommendedResumeId || listJob.recommendedResumeId || null,
    recommendedResumeReason:
      detailJob.recommendedResumeReason || listJob.recommendedResumeReason || null,
    useCustomizedResume:
      detailJob.recommendedResumeStack || detailJob.recommendedResumeReason
        ? detailJob.useCustomizedResume
        : listJob.useCustomizedResume,
    recommendWarning: detailJob.recommendWarning || listJob.recommendWarning || null,
    recommendedAt: detailJob.recommendedAt || listJob.recommendedAt || null,
    recommendMode: detailJob.recommendMode || listJob.recommendMode || null,
  };
}

export const SORT_TO_API: Record<string, string> = {
  newest: "newest",
};
