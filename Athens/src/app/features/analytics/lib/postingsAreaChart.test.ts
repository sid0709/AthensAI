import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  POSTINGS_CHART_TOP_N,
  POSTINGS_OTHER_KEY,
  pivotPostingsBySource,
  sourcePeriodTotals,
  toTopNOtherSeries,
} from "./postingsAreaChart";

describe("postingsAreaChart Lens helpers", () => {
  const rows = [
    { date: "2026-07-01", source: "LinkedIn", count: 100 },
    { date: "2026-07-01", source: "Indeed", count: 80 },
    { date: "2026-07-01", source: "Greenhouse", count: 40 },
    { date: "2026-07-01", source: "Workday", count: 30 },
    { date: "2026-07-01", source: "Ashby", count: 20 },
    { date: "2026-07-01", source: "Lever", count: 15 },
    { date: "2026-07-01", source: "Dice", count: 10 },
    { date: "2026-07-01", source: "Wellfound", count: 8 },
    { date: "2026-07-01", source: "ZipRecruiter", count: 5 },
    { date: "2026-07-01", source: "TinyBoard", count: 2 },
    { date: "2026-07-02", source: "LinkedIn", count: 50 },
    { date: "2026-07-02", source: "TinyBoard", count: 3 },
  ];

  it("keeps every source in period totals and matches grand total", () => {
    const { points, sources } = pivotPostingsBySource(
      rows,
      "2026-07-01",
      "2026-07-02",
    );
    const ranked = sourcePeriodTotals(points, sources);
    const rankedSum = ranked.reduce((s, r) => s + r.count, 0);
    const pointSum = points.reduce((s, p) => s + Number(p.total), 0);

    assert.equal(ranked.length, 10);
    assert.equal(rankedSum, pointSum);
    assert.equal(rankedSum, 363);
    assert.equal(ranked[0]?.source, "LinkedIn");
    assert.ok(ranked.some((r) => r.source === "TinyBoard"));
  });

  it("collapses to top N + Other without losing day totals", () => {
    const { points, sources } = pivotPostingsBySource(
      rows,
      "2026-07-01",
      "2026-07-02",
    );
    const chart = toTopNOtherSeries(points, sources, POSTINGS_CHART_TOP_N);

    assert.ok(chart.series.length <= POSTINGS_CHART_TOP_N + 1);
    assert.equal(chart.series[chart.series.length - 1], POSTINGS_OTHER_KEY);
    assert.ok(!chart.series.includes("TinyBoard"));

    for (let i = 0; i < points.length; i += 1) {
      const original = Number(points[i].total);
      const display = chart.series.reduce(
        (s, key) => s + (Number(chart.points[i][key]) || 0),
        0,
      );
      assert.equal(display, original);
    }
  });

  it("promotes a focused source into the visible stack", () => {
    const { points, sources } = pivotPostingsBySource(
      rows,
      "2026-07-01",
      "2026-07-02",
    );
    const chart = toTopNOtherSeries(
      points,
      sources,
      POSTINGS_CHART_TOP_N,
      "TinyBoard",
    );

    assert.ok(chart.series.includes("TinyBoard"));
    assert.ok(chart.series.length <= POSTINGS_CHART_TOP_N + 1);
    const day0Tiny = Number(chart.points[0].TinyBoard) || 0;
    assert.equal(day0Tiny, 2);
  });
});
