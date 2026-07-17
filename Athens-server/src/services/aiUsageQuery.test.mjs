import { test } from "node:test";
import assert from "node:assert/strict";
import { buildAiUsageMatch, parseAiUsageDate } from "./aiUsageQuery.js";

test("parseAiUsageDate returns undefined for invalid values", () => {
  assert.equal(parseAiUsageDate(undefined), undefined);
  assert.equal(parseAiUsageDate(""), undefined);
  assert.equal(parseAiUsageDate("not-a-date"), undefined);
});

test("parseAiUsageDate parses ISO strings", () => {
  const d = parseAiUsageDate("2026-07-01T00:00:00.000Z");
  assert.ok(d instanceof Date);
  assert.equal(d.toISOString(), "2026-07-01T00:00:00.000Z");
});

test("buildAiUsageMatch includes applier, feature, and date range", () => {
  const match = buildAiUsageMatch({
    applierName: "Eli Taylor",
    feature: "resume-generate:summary",
    since: "2026-07-01T00:00:00.000Z",
    until: "2026-07-07T23:59:59.999Z",
  });

  assert.equal(match.applierName, "Eli Taylor");
  assert.equal(match.feature, "resume-generate:summary");
  assert.ok(match.createdAt.$gte instanceof Date);
  assert.ok(match.createdAt.$lte instanceof Date);
});

test("buildAiUsageMatch ignores empty strings", () => {
  const match = buildAiUsageMatch({
    applierName: "  ",
    runId: "",
    feature: "",
  });
  assert.deepEqual(match, {});
});

test("buildAiUsageMatch supports runId filter", () => {
  const match = buildAiUsageMatch({ runId: "run-abc" });
  assert.equal(match.runId, "run-abc");
});
