import assert from "node:assert/strict";
import test from "node:test";

import { generatedFromStepEvents, mergeGeneratedFromStepEvent } from "./content";

test("final step-done events fill the live résumé draft", () => {
  const afterSummary = mergeGeneratedFromStepEvent(null, {
    phase: "step-done",
    kind: "final",
    purpose: "summary",
    output: { summary: "Shipped Java and React services." },
  });
  const afterExperience = generatedFromStepEvents(
    [
      {
        phase: "step-done",
        kind: "final",
        purpose: "experience",
        output: {
          experiences: [
            {
              title: "Engineer",
              company: "Twitch",
              period: "2022.4 – Present",
              bullets: ["Built React clients on Java APIs."],
            },
          ],
        },
      },
    ],
    afterSummary,
  );

  assert.equal(afterExperience?.summary, "Shipped Java and React services.");
  assert.equal(afterExperience?.experience?.[0]?.company, "Twitch");
  assert.equal(afterExperience?.experience?.[0]?.period, "Apr 2022 – Present");
});

test("non-final progress does not clear an existing draft", () => {
  const draft = mergeGeneratedFromStepEvent(null, {
    phase: "step-done",
    kind: "final",
    purpose: "summary",
    output: { summary: "Keep this." },
  });
  const unchanged = mergeGeneratedFromStepEvent(draft, {
    phase: "step-start",
    kind: "final",
    purpose: "skills",
    output: { skills: [] },
  });
  assert.equal(unchanged?.summary, "Keep this.");
});
