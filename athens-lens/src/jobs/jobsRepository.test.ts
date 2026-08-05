import { afterEach, describe, expect, it, vi } from "vitest";
import { athensJobsRepository } from "./jobsRepository";
import { MOCK_JOBS } from "./mockJobs";
import type { Session } from "../types";

const SESSION: Session = {
  username: "Alex",
  displayName: "Alex",
  profileId: "profile-1",
  authenticatedAt: "2026-08-04T12:00:00.000Z",
  expiresAt: "2099-08-04T12:00:00.000Z",
  accessToken: "jobs-token"
};

describe("athensJobsRepository", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("loads the server's data-driven Bid Ready response with the session token", async () => {
    const jobs = [MOCK_JOBS[2]];
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      void input;
      void init;
      return new Response(JSON.stringify({ success: true, jobs, total: 1 }), {
        status: 200,
        headers: { "Content-Type": "application/json" }
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(athensJobsRepository.listJobs(SESSION)).resolves.toEqual(jobs);
    const [, request] = fetchMock.mock.calls[0]!;
    expect(new Headers(request?.headers).get("Authorization")).toBe("Bearer jobs-token");
  });
});
