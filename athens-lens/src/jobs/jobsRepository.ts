import { requestAthensApi } from "../api/athensApi";
import type { Job, JobsRepository } from "../types";

interface JobsResponse {
  success: true;
  jobs: Job[];
  total: number;
}

function isJob(value: unknown): value is Job {
  if (!value || typeof value !== "object") return false;
  const job = value as Record<string, unknown>;
  return [
    "id",
    "title",
    "company",
    "companyLogoUrl",
    "location",
    "workMode",
    "employmentType",
    "seniority",
    "salary",
    "experience",
    "postedAt",
    "applicantsText",
    "description",
    "applyUrl"
  ].every((key) => typeof job[key] === "string") &&
    Array.isArray(job.responsibilities) &&
    Array.isArray(job.qualifications) &&
    Array.isArray(job.skills) &&
    Array.isArray(job.tags);
}

export const athensJobsRepository: JobsRepository = {
  async listJobs(session) {
    const response = await requestAthensApi<JobsResponse>("/athens-lens/jobs", {
      accessToken: session.accessToken
    });
    if (!Array.isArray(response.jobs) || !response.jobs.every(isJob)) {
      throw new Error("Athens server returned an invalid jobs response.");
    }
    return response.jobs;
  }
};
