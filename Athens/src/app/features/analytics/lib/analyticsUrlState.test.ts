import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { DEFAULT_ANALYTICS_FILTERS } from "./analyticsFilters";
import {
  canonicalAnalyticsQuery,
  parseAnalyticsUrl,
  serializeAnalyticsUrl,
} from "./analyticsUrlState";

describe("analytics URL state", () => {
  it("omits default 30-day range from the query", () => {
    const query = serializeAnalyticsUrl(DEFAULT_ANALYTICS_FILTERS).toString();
    assert.equal(query, "");
  });

  it("round-trips custom range and catalog sources", () => {
    const params = new URLSearchParams();
    params.set("range", "custom");
    params.set("from", "2026-06-01");
    params.set("to", "2026-08-17");
    params.append("source", "LinkedIn");
    params.append("source", "Greenhouse");
    params.append("source", "missing");
    const state = parseAnalyticsUrl(params);
    assert.equal(state.range, "custom");
    assert.equal(state.customFrom, "2026-06-01");
    assert.equal(state.customTo, "2026-08-17");
    assert.deepEqual(state.source, ["LinkedIn", "Greenhouse"]);
    assert.equal(
      parseAnalyticsUrl(serializeAnalyticsUrl(state)).customFrom,
      "2026-06-01",
    );
  });

  it("drops custom dates unless range is custom", () => {
    const query = canonicalAnalyticsQuery(
      new URLSearchParams("range=90d&from=2026-01-01&to=2026-02-01&source=missing"),
    );
    const state = parseAnalyticsUrl(new URLSearchParams(query));
    assert.equal(state.range, "90d");
    assert.equal(state.customFrom, "");
    assert.equal(state.customTo, "");
    assert.deepEqual(state.source, []);
    assert.equal(query, "range=90d");
  });
});
