import { describe, expect, it } from "vitest";
import { MOCK_JOBS } from "./mockJobs";

describe("mock job fixtures", () => {
  it("provides eight complete jobs with unique IDs", () => {
    expect(MOCK_JOBS).toHaveLength(8);
    expect(new Set(MOCK_JOBS.map((job) => job.id)).size).toBe(MOCK_JOBS.length);

    for (const job of MOCK_JOBS) {
      expect(job.title).toBeTruthy();
      expect(job.company).toBeTruthy();
      expect(job.responsibilities.length).toBeGreaterThan(0);
      expect(job.qualifications.length).toBeGreaterThan(0);
    }
  });

  it("uses safe, valid mock application URLs", () => {
    for (const job of MOCK_JOBS) {
      const url = new URL(job.applyUrl);
      expect(url.protocol).toBe("https:");
      expect(url.hostname).toBe("example.com");
    }
  });
});
