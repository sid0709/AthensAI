import assert from "node:assert/strict";
import { test } from "node:test";
import {
  defaultGeneratorConfig,
  LEGACY_TIERED_EXPERIENCE_PROMPT,
} from "../config/resumeGeneratorDefaults.js";
import {
  buildGenerationRequestFromSavedConfig,
  isDefaultGeneratorPipeline,
  mergeStoredConfig,
  selectGeneratorConfigRecord,
} from "./resumeGenerationService.js";

function record(id, applierName, config, updatedAt) {
  return { _id: id, applierName, config, updatedAt: new Date(updatedAt) };
}

test("legacy email pipeline wins over a later default-only display-name config", () => {
  const current = defaultGeneratorConfig();
  delete current.dynamicCareerTitles;
  current.templateId = "accent-bar";
  const legacy = defaultGeneratorConfig();
  legacy.templateId = "modern";
  legacy.systemInstruction = "Use the candidate's facts and my saved writing policy.";
  legacy.steps.push({
    id: "skills-review",
    purpose: "skills",
    kind: "fine-tune",
    name: "Skills review",
    prompt: "Apply my saved skills wording rules.",
    schema: "",
  });

  assert.equal(isDefaultGeneratorPipeline(current), true);
  assert.equal(isDefaultGeneratorPipeline(legacy), false);
  const selected = selectGeneratorConfigRecord([
    record("name", "Oliver Baltay", current, "2026-07-26T05:32:07.510Z"),
    record("email", "oliver@example.com", legacy, "2026-07-21T14:59:50.444Z"),
  ], { applierName: "Oliver Baltay", profileId: "profile-1" });

  assert.equal(selected?.source, "legacy-alias");
  assert.equal(selected?.record?._id, "email");
});

test("an authored display-name config remains authoritative", () => {
  const canonical = defaultGeneratorConfig();
  canonical.systemInstruction = "Keep this canonical writing policy.";
  const legacy = defaultGeneratorConfig();
  legacy.systemInstruction = "Older alias policy.";

  const selected = selectGeneratorConfigRecord([
    record("name", "Oliver Baltay", canonical, "2026-07-20T00:00:00.000Z"),
    record("email", "oliver@example.com", legacy, "2026-07-27T00:00:00.000Z"),
  ], { applierName: "Oliver Baltay" });

  assert.equal(selected?.source, "applier-name");
  assert.equal(selected?.record?._id, "name");
});

test("an explicit false dynamic-title preference beats an older authored alias", () => {
  const canonical = defaultGeneratorConfig();
  canonical.dynamicCareerTitles = false;
  const legacy = defaultGeneratorConfig();
  legacy.dynamicCareerTitles = true;
  legacy.systemInstruction = "Older alias policy.";

  const selected = selectGeneratorConfigRecord([
    record("name", "Oliver Baltay", canonical, "2026-07-20T00:00:00.000Z"),
    record("email", "oliver@example.com", legacy, "2026-07-27T00:00:00.000Z"),
  ], { applierName: "Oliver Baltay" });

  assert.equal(selected?.source, "applier-name");
  assert.equal(selected?.record?._id, "name");
  assert.equal(selected?.record?.config?.dynamicCareerTitles, false);
});

test("dynamic career titles are optional and disabled by default", () => {
  assert.equal(defaultGeneratorConfig().dynamicCareerTitles, false);
  assert.equal(mergeStoredConfig({}).dynamicCareerTitles, false);
  assert.equal(mergeStoredConfig({ dynamicCareerTitles: "true" }).dynamicCareerTitles, false);
});

test("legacy tier-gated default prompts migrate to the saved preference wording", () => {
  const legacy = defaultGeneratorConfig();
  const experience = legacy.steps.find((step) => step.purpose === "experience");
  experience.prompt = LEGACY_TIERED_EXPERIENCE_PROMPT;

  assert.equal(isDefaultGeneratorPipeline(legacy), true);
  const merged = mergeStoredConfig(legacy);
  const migratedPrompt = merged.steps.find((step) => step.purpose === "experience")?.prompt;
  assert.doesNotMatch(migratedPrompt, /Beta accounts/);
  assert.match(migratedPrompt, /Dynamic career titles preference/);
});

test("saved dynamic career titles propagate to Agent and Job Search generation requests", () => {
  const savedConfig = {
    ...defaultGeneratorConfig(),
    dynamicCareerTitles: true,
  };
  const body = buildGenerationRequestFromSavedConfig({
    applierName: "Oliver Baltay",
    jobDescription: "Backend engineer",
    savedConfig,
    identity: { careers: [] },
    generateParentJobId: "job-123",
    structuredJob: true,
  });

  assert.equal(body.dynamicCareerTitles, true);
  assert.deepEqual(body.coverage, { settings: savedConfig.coverage });
  assert.equal(isDefaultGeneratorPipeline(savedConfig), false);
});
