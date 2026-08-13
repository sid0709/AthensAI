import test from "node:test";
import assert from "node:assert/strict";
import type { CompanyJobGroup, Job } from "../../../types";
import {
  dropMatchingJobsById,
  keepOnlyCompanyJob,
  mergeCompanyMembers,
  removeCompanyJobs,
} from "./companyGroupState";

function job(id: string): Job {
  return { id, backendId: id, companyId: "acme" } as Job;
}

function group(ids: string[], matchingJobCount = ids.length, nextMemberOffset: number | null = null): CompanyJobGroup {
  return {
    companyId: "acme",
    company: { name: "Acme" },
    jobs: ids.map(job),
    matchingJobCount,
    nextMemberOffset,
  };
}

test("member batches append in order and deduplicate focused roles", () => {
  const result = mergeCompanyMembers(
    [group(["primary"])],
    "acme",
    [
      { job: job("member-1"), order: 1 },
      { job: job("member-1"), order: 1 },
      { job: job("focused"), order: 20 },
    ],
    11,
  );
  assert.deepEqual(result[0].jobs.map(({ id }) => id), ["primary", "member-1", "focused"]);
  assert.equal(result[0].nextMemberOffset, 11);
});

test("later member batches retain server ordering around a deep-linked role", () => {
  const withFocus = mergeCompanyMembers(
    [group(["primary"])],
    "acme",
    [{ job: job("focused"), order: 20 }],
    1,
  );
  const result = mergeCompanyMembers(
    withFocus,
    "acme",
    [
      { job: job("member-1"), order: 1 },
      { job: job("member-2"), order: 2 },
    ],
    3,
  );
  assert.deepEqual(result[0].jobs.map(({ id }) => id), ["primary", "member-1", "member-2", "focused"]);
});

test("removing the primary promotes a loaded member and preserves the company total", () => {
  const result = removeCompanyJobs(
    [group(["primary", "member-1", "member-2"], 5, 3)],
    ({ id }) => id === "primary",
  );
  assert.deepEqual(result.groups[0].jobs.map(({ id }) => id), ["member-1", "member-2"]);
  assert.equal(result.groups[0].matchingJobCount, 4);
  assert.equal(result.groups[0].nextMemberOffset, 2);
  assert.equal(result.removedGroups, 0);
  assert.equal(result.removedJobs, 1);
});

test("removing the final match removes its company", () => {
  const result = removeCompanyJobs([group(["only"], 1)], ({ id }) => id === "only");
  assert.deepEqual(result.groups, []);
  assert.equal(result.removedGroups, 1);
  assert.equal(result.removedJobs, 1);
});

test("an unloaded replacement requests a directory refresh", () => {
  const result = removeCompanyJobs([group(["primary"], 4, 1)], ({ id }) => id === "primary");
  assert.equal(result.groups.length, 1);
  assert.deepEqual(result.groups[0].jobs, []);
  assert.equal(result.needsDirectoryRefresh, true);
  assert.equal(result.removedGroups, 0);
});

test("keeping one role removes loaded and unloaded company siblings", () => {
  const result = keepOnlyCompanyJob(
    [group(["primary", "active", "member-2"], 8, 3)],
    "acme",
    "active",
  );
  assert.deepEqual(result.groups[0].jobs.map(({ id }) => id), ["active"]);
  assert.equal(result.groups[0].matchingJobCount, 1);
  assert.equal(result.groups[0].nextMemberOffset, null);
  assert.deepEqual(result.groups[0].memberOrder, { active: 0 });
  assert.deepEqual(result.groups[0].matchingJobIds, ["active"]);
  assert.equal(result.removedJobs, 7);
});

test("drops unloaded matching ids when marking siblings applied", () => {
  const groups: CompanyJobGroup[] = [{
    companyId: "acme",
    company: { name: "Acme" },
    jobs: [job("primary")],
    matchingJobCount: 4,
    matchingJobIds: ["primary", "b", "c", "d"],
    nextMemberOffset: 1,
  }];
  const result = dropMatchingJobsById(groups, ["b", "c", "d"]);
  assert.equal(result.groups.length, 1);
  assert.deepEqual(result.groups[0].jobs.map(({ id }) => id), ["primary"]);
  assert.equal(result.groups[0].matchingJobCount, 1);
  assert.deepEqual(result.groups[0].matchingJobIds, ["primary"]);
  assert.equal(result.removedJobs, 3);
});
