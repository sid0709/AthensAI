import test from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_JOB_SEARCH_URL_STATE,
  canonicalJobSearchQuery,
  jobSearchFilterTransition,
  jobSearchFilterHistoryMode,
  jobSearchPageSizeTransition,
  parseJobSearchUrl,
  serializeJobSearchUrl,
} from "./jobSearchUrlState";

test("default Job Search state serializes every URL field in a stable order", () => {
  const query = serializeJobSearchUrl(DEFAULT_JOB_SEARCH_URL_STATE).toString();
  assert.equal(query, [
    "status=all",
    "q=",
    "company=",
    "source=all",
    "location=all",
    "workMode=all",
    "seniority=all",
    "industry=all",
    "postedFrom=",
    "postedTo=",
    "overallMin=0",
    "overallMax=100",
    "skillMin=0",
    "skillMax=100",
    "sort=matchScore",
    "aiExtracted=0",
    "includeExternal=0",
    "page=1",
    "pageSize=25",
    "view=list",
    "showScores=0",
    "group=",
    "job=",
  ].join("&"));
});

test("URL parsing round-trips repeated filters and exact open view state", () => {
  const params = new URLSearchParams();
  params.set("status", "posted");
  params.set("q", "data engineer");
  params.append("source", "Lever");
  params.append("source", "Ashby");
  params.append("source", "Lever");
  params.append("seniority", "Senior");
  params.set("skillMin", "70");
  params.set("page", "2");
  params.set("pageSize", "50");
  params.set("view", "grid");
  params.set("showScores", "1");
  params.set("group", "company/id");
  params.set("job", "job id");
  const state = parseJobSearchUrl(params);
  assert.deepEqual(state.filters.source, ["Ashby", "Lever"]);
  assert.deepEqual(state.filters.seniority, ["Senior"]);
  assert.equal(state.filters.scores.skill.min, 70);
  assert.equal(state.page, 2);
  assert.equal(state.pageSize, 50);
  assert.equal(state.view, "grid");
  assert.equal(state.showScores, true);
  assert.equal(state.groupId, "company/id");
  assert.equal(state.jobId, "job id");
  assert.equal(parseJobSearchUrl(serializeJobSearchUrl(state)).jobId, "job id");
});

test("invalid URL values normalize to canonical defaults", () => {
  const query = canonicalJobSearchQuery(new URLSearchParams(
    "status=unknown&source=missing&workMode=space&page=2x&pageSize=17&overallMin=72.5&overallMax=-4&view=tiles&showScores=true&job=orphan",
  ));
  const state = parseJobSearchUrl(new URLSearchParams(query));
  assert.equal(state.filters.statusTab, "all");
  assert.deepEqual(state.filters.source, []);
  assert.equal(state.filters.workMode, "all");
  assert.equal(state.page, 1);
  assert.equal(state.pageSize, 25);
  assert.deepEqual(state.filters.scores.overall, { min: 0, max: 100 });
  assert.equal(state.view, "list");
  assert.equal(state.showScores, false);
  assert.equal(state.jobId, "");
});

test("typing and score edits replace history while committed filters push", () => {
  const base = DEFAULT_JOB_SEARCH_URL_STATE.filters;
  assert.equal(jobSearchFilterHistoryMode(base, { ...base, jobQuery: "react" }), "replace");
  assert.equal(jobSearchFilterHistoryMode(base, {
    ...base,
    scores: { ...base.scores, skill: { min: 70, max: 100 } },
  }), "replace");
  assert.equal(jobSearchFilterHistoryMode(base, { ...base, statusTab: "posted" }), "push");
});

test("filter and page-size transitions reset pagination and exact open state", () => {
  const openState = {
    ...DEFAULT_JOB_SEARCH_URL_STATE,
    page: 4,
    groupId: "acme",
    jobId: "job-4",
  };
  const filterTransition = jobSearchFilterTransition(openState, {
    ...openState.filters,
    statusTab: "posted",
  });
  assert.equal(filterTransition.replace, false);
  assert.equal(filterTransition.changed, true);
  assert.equal(filterTransition.state.page, 1);
  assert.equal(filterTransition.state.groupId, "");
  assert.equal(filterTransition.state.jobId, "");

  const sized = jobSearchPageSizeTransition(openState, 50);
  assert.equal(sized.pageSize, 50);
  assert.equal(sized.page, 1);
  assert.equal(sized.groupId, "");
  assert.equal(sized.jobId, "");

  const unchanged = jobSearchFilterTransition(openState, openState.filters);
  assert.equal(unchanged.changed, false);
  assert.equal(unchanged.state, openState);
});
