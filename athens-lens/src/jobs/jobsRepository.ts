import type { JobsRepository } from "../types";
import { MOCK_JOBS } from "./mockJobs";

export const mockJobsRepository: JobsRepository = {
  async listJobs() {
    return MOCK_JOBS;
  }
};
