import { inferJobSource } from '@/app/data/jobs/pub';
import type { ApplierAccount } from "@/context/applier-context";
import type { Job, JobStatus, WorkMode } from "../types/job";

function readScore(doc: Record<string, unknown>, ...keys: string[]): number | null {
  for (const key of keys) {
    const v = doc[key];
    if (typeof v === "number" && !Number.isNaN(v)) return Math.round(v);
  }
  return null;
}

export function normalizeId(value: unknown): string {
  if (value == null) return "";
  if (typeof value === "object" && value !== null && "$oid" in value) {
    return String((value as { $oid: string }).$oid);
  }
  return String(value);
}

type ResolvedApplierStatus =
  | "applied"
  | "scheduled"
  | "declined"
  | "bid-ready"
  | "bid-completed"
  | "none";

function resolveStatusForApplier(
  statusArr: unknown[] | undefined,
  applierId: string | null,
): ResolvedApplierStatus {
  if (!Array.isArray(statusArr) || !applierId) return "none";
  for (const s of statusArr) {
    if (!s || typeof s !== "object") continue;
    const row = s as Record<string, unknown>;
    if (normalizeId(row.applier) !== applierId) continue;
    if (row.declinedDate) return "declined";
    if (row.scheduledDate) return "scheduled";
    if (row.appliedDate) return "applied";
    if (row.bidCompletedDate) return "bid-completed";
    if (row.bidReadyDate) return "bid-ready";
  }
  return "none";
}

function mapApiStatusToJob(st: ResolvedApplierStatus): JobStatus {
  if (st === "declined") return "declined";
  if (st === "scheduled") return "scheduled";
  if (st === "applied") return "applied";
  if (st === "bid-completed") return "bid-completed";
  if (st === "bid-ready") return "bid-ready";
  return "posted";
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
  const st = isExternal ? "none" : resolveStatusForApplier(doc.status as unknown[] | undefined, applierId);
  const status = mapApiStatusToJob(st);

  const location = String(details.position || (isAnalyzedExternal ? "—" : isExternal ? "—" : "—"));
  const workMode = isAnalyzedExternal
    ? parseWorkMode(String(details.remote || ""))
    : isExternal
      ? "onsite"
      : parseWorkMode(String(details.remote || ""));
  const type = String(details.time || (isExternal ? "—" : "Full-time"));
  const seniority = String(details.seniority || "—");
  const salary = String(details.money || (isExternal ? "—" : "Undisclosed"));
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

  const useScores = !isExternal || isAnalyzedExternal;
  const skill = useScores ? readScore(doc, "scoreSkill", "matchScore", "skillScore") ?? 0 : 0;
  const overall = useScores ? readScore(doc, "_score", "scoreOverall") ?? skill : 0;
  const skillsCovered = readScore(doc, "skillsCovered") ?? undefined;
  const skillsRequired = readScore(doc, "skillsRequired") ?? undefined;
  const scoreVector = readScore(doc, "scoreVector");

  const skillHighlights = Array.isArray(doc.skillHighlights)
    ? (doc.skillHighlights as { name?: unknown; matched?: unknown }[])
        .map((row) => ({
          name: String(row?.name ?? "").trim(),
          matched: Boolean(row?.matched),
        }))
        .filter((row) => row.name)
    : undefined;

  const bestResumeTechStack =
    typeof doc.bestResumeTechStack === "string" && doc.bestResumeTechStack.trim()
      ? doc.bestResumeTechStack.trim()
      : undefined;

  const bestResumeId =
    typeof doc.bestResumeId === "string" && doc.bestResumeId.trim()
      ? doc.bestResumeId.trim()
      : undefined;

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
    title,
    company: String(company.name || doc.companyName || "Unknown"),
    companyUrl,
    logoUrl,
    location,
    workMode,
    type,
    seniority,
    experience: String(details.date || "").trim() || undefined,
    industries,
    status,
    scores: {
      overall,
      skill,
      vector: scoreVector ?? undefined,
      skillsCovered: skillsCovered ?? undefined,
      skillsRequired: skillsRequired ?? undefined,
    },
    matchScore: overall,
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
    bestResumeTechStack,
    bestResumeId,
    skillHighlights,
    aiSkills,
    catalog: isExternal ? "external" : "market",
  };
}

/** Preserve list-time scores and recommendation metadata when detail fetch lacks them. */
export function mergeListJobMetadata(listJob: Job, detailJob: Job): Job {
  const preferListScores =
    listJob.scores.overall > detailJob.scores.overall ||
    (listJob.scores.overall === detailJob.scores.overall &&
      listJob.scores.skill > detailJob.scores.skill);

  return {
    ...detailJob,
    scores: preferListScores ? listJob.scores : detailJob.scores,
    matchScore: preferListScores ? listJob.matchScore : detailJob.matchScore,
    bestResumeTechStack: listJob.bestResumeTechStack ?? detailJob.bestResumeTechStack,
    bestResumeId: listJob.bestResumeId ?? detailJob.bestResumeId,
    skillHighlights: listJob.skillHighlights?.length ? listJob.skillHighlights : detailJob.skillHighlights,
    aiSkills: detailJob.aiSkills?.length ? detailJob.aiSkills : listJob.aiSkills,
  };
}

export const SORT_TO_API: Record<string, string> = {
  newest: "postedAt_desc",
  matchScore: "recommended",
  title: "title_asc",
};
