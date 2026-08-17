import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { pivotPostingsBySource, sourcePeriodTotals } from "./postingsAreaChart";

describe("postings chart points", () => {
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
    assert.equal(Number(points[0].total), 310);
    assert.equal(Number(points[0].LinkedIn), 100);
  });
});
