import test from "node:test";
import assert from "node:assert/strict";
import type { CompanyJobGroup, Job, JobStatus } from "../../../types";
import { companyApplyTargets, companyApplyTargetsForPrimaries } from "./companyApplyTargets";

function job(id: string, status: JobStatus = "posted", catalog: Job["catalog"] = "market"): Job {
  return { id, backendId: id, companyId: "acme", status, catalog } as Job;
}

function group(jobs: Job[], matchingJobIds?: string[]): CompanyJobGroup {
  return {
    companyId: "acme",
    company: { name: "Acme" },
    jobs,
    matchingJobCount: matchingJobIds?.length ?? jobs.length,
    matchingJobIds,
  };
}

test("skips the clicked job and already-applied siblings", () => {
  const primary = job("a");
  const result = companyApplyTargets(
    primary,
    group([primary, job("b"), job("c", "applied"), job("d", "bid-ready")]),
  );
  assert.deepEqual(result.siblings.map(({ id }) => id), ["b", "d"]);
  assert.deepEqual(result.unloadedIds, []);
});

test("includes matching ids that are not hydrated yet", () => {
  const primary = job("a");
  const result = companyApplyTargets(
    primary,
    group([primary, job("b")], ["a", "b", "c", "d"]),
  );
  assert.deepEqual(result.siblings.map(({ id }) => id), ["b"]);
  assert.deepEqual(result.unloadedIds, ["c", "d"]);
});

test("includes external scraped siblings for status updates", () => {
  const primary = job("a");
  const result = companyApplyTargets(
    primary,
    group([primary, job("b", "posted", "external")]),
  );
  assert.deepEqual(result.siblings.map(({ id }) => id), ["b"]);
});

test("finds the company group even when job.companyId does not match", () => {
  const primary = { ...job("a"), companyId: "legacy:a" } as Job;
  const sibling = job("b");
  const result = companyApplyTargets(
    primary,
    group([job("a"), sibling], ["a", "b", "c"]),
  );
  assert.deepEqual(result.siblings.map(({ id }) => id), ["b"]);
  assert.deepEqual(result.unloadedIds, ["c"]);
});

test("multiple selected roles at the same company stay out of the sibling set", () => {
  const a = job("a");
  const b = job("b");
  const c = job("c");
  const result = companyApplyTargetsForPrimaries(
    [a, b],
    [group([a, b, c], ["a", "b", "c", "d"])],
  );
  assert.deepEqual(result.siblings.map(({ id }) => id), ["c"]);
  assert.deepEqual(result.unloadedIds, ["d"]);
});
