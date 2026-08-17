import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { DEFAULT_ANALYTICS_FILTERS } from "./analyticsFilters";
import {
  percentDelta,
  pointDelta,
  previousAnalyticsBounds,
  resolveAnalyticsBounds,
  toDayStamp,
} from "./dateRange";

describe("analytics date bounds", () => {
  it("resolves 30d to inclusive local days ending today", () => {
    const bounds = resolveAnalyticsBounds(DEFAULT_ANALYTICS_FILTERS);
    const today = toDayStamp(new Date());
    assert.equal(bounds.endDay, today);
    assert.ok(bounds.startDay <= bounds.endDay);
    assert.ok(bounds.startDate);
    assert.ok(bounds.endDate);
  });

  it("leaves all-time bounds empty", () => {
    const bounds = resolveAnalyticsBounds({
      ...DEFAULT_ANALYTICS_FILTERS,
      range: "all",
    });
    assert.deepEqual(bounds, {
      startDate: "",
      endDate: "",
      startDay: "",
      endDay: "",
    });
    assert.equal(previousAnalyticsBounds(bounds), null);
  });

  it("swaps inverted custom dates", () => {
    const bounds = resolveAnalyticsBounds({
      ...DEFAULT_ANALYTICS_FILTERS,
      range: "custom",
      customFrom: "2026-08-10",
      customTo: "2026-08-01",
    });
    assert.equal(bounds.startDay, "2026-08-01");
    assert.equal(bounds.endDay, "2026-08-10");
  });

  it("computes a previous window of equal length", () => {
    const bounds = resolveAnalyticsBounds({
      ...DEFAULT_ANALYTICS_FILTERS,
      range: "custom",
      customFrom: "2026-08-01",
      customTo: "2026-08-10",
    });
    const previous = previousAnalyticsBounds(bounds);
    assert.ok(previous);
    assert.ok(new Date(previous.endDate).getTime() < new Date(bounds.startDate).getTime());
    const currentSpan =
      new Date(bounds.endDate).getTime() - new Date(bounds.startDate).getTime();
    const previousSpan =
      new Date(previous.endDate).getTime() - new Date(previous.startDate).getTime();
    assert.equal(previousSpan, currentSpan);
  });

  it("hides count deltas when the prior window is empty", () => {
    assert.equal(percentDelta(12, 0), null);
    assert.equal(percentDelta(12, 10), 20);
    assert.equal(pointDelta(38, 30), 8);
  });
});
