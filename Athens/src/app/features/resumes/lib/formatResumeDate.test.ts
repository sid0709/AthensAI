import assert from "node:assert/strict";
import test from "node:test";

import {
  formatResumeMonthYear,
  formatResumePeriodFromProfile,
  formatResumePeriodLabel,
} from "./formatResumeDate";

test("formats profile month and year as Apr 2022", () => {
  assert.equal(formatResumeMonthYear("2022", "4"), "Apr 2022");
  assert.equal(formatResumeMonthYear("2022", "04"), "Apr 2022");
  assert.equal(formatResumeMonthYear("2022", "12"), "Dec 2022");
  assert.equal(formatResumeMonthYear("2022", ""), "2022");
  assert.equal(formatResumeMonthYear("", "4"), "Apr");
});

test("formats a profile career span in American style", () => {
  assert.equal(
    formatResumePeriodFromProfile({ startYear: "2022", startMonth: "4", endPresent: true }),
    "Apr 2022 – Present",
  );
  assert.equal(
    formatResumePeriodFromProfile({
      startYear: "2018",
      startMonth: "3",
      endYear: "2020",
      endMonth: "12",
    }),
    "Mar 2018 – Dec 2020",
  );
  assert.equal(formatResumePeriodFromProfile({ startYear: "", startMonth: "" }), "");
});

test("rewrites stored 2022.4 period labels without changing American dates", () => {
  assert.equal(formatResumePeriodLabel("2022.4 – Present"), "Apr 2022 – Present");
  assert.equal(formatResumePeriodLabel("2022.4-2023.6"), "Apr 2022-Jun 2023");
  assert.equal(formatResumePeriodLabel("Apr 2022 – Present"), "Apr 2022 – Present");
  assert.equal(formatResumePeriodLabel("2022 – 2024"), "2022 – 2024");
});
