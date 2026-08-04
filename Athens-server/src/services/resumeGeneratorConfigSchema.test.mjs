import assert from "node:assert/strict";
import { test } from "node:test";
import { defaultGeneratorConfig } from "../config/resumeGeneratorDefaults.js";
import {
  isCanonicalGeneratorConfig,
  migrateGeneratorConfig,
} from "./resumeGeneratorConfigSchema.js";

test("legacy EditorDraft migrates to canonical v4 without run data", () => {
  const legacy = {
    document: { id: "draft", summary: "transient" },
    jobDescription: "Transient JD",
    provider: "openai",
    model: "gpt-5-mini",
    templateId: "modern",
    theme: {
      font: "Inter",
      bodySizePt: 11,
      nameSizePt: 25,
      accentColor: "#123456",
      textColor: "#111111",
      paperSize: "a4",
      marginIn: 0.7,
    },
    sections: [
      { id: "experience", titleSizePt: 13, bodySizePt: 11, color: "#123456", order: 0 },
      { id: "skills", titleSizePt: 12, bodySizePt: 10, color: "#123456", order: 1 },
    ],
    systemInstruction: "Keep facts exact.",
    refinementSteps: defaultGeneratorConfig().steps,
  };
  const migrated = migrateGeneratorConfig(legacy);

  assert.equal(migrated.sourceVersion, 2);
  assert.equal(migrated.migrated, true);
  assert.equal(migrated.legacyJobDescription, "Transient JD");
  assert.equal(migrated.config.schemaVersion, 4);
  assert.equal(migrated.config.theme.baseSize, 11);
  assert.equal(migrated.config.theme.paper, "a4");
  assert.equal(migrated.config.layout[0].type, "experience");
  assert.equal("jobDescription" in migrated.config, false);
  assert.equal("document" in migrated.config, false);
  assert.equal("refinementSteps" in migrated.config, false);
});

test("canonical v4 config remains canonical", () => {
  const canonical = migrateGeneratorConfig(defaultGeneratorConfig()).config;
  assert.equal(isCanonicalGeneratorConfig(canonical), true);
});

test("coverage controls migrate to fixed enabled priority-four settings", () => {
  const saved = defaultGeneratorConfig();
  saved.coverage = {
    enabled: false,
    experienceRequirementThreshold: 5,
    maxRepairAttempts: 2,
    aliases: { "Node.js": ["NodeJS"] },
  };
  const migrated = migrateGeneratorConfig(saved).config;

  assert.equal(migrated.coverage.enabled, true);
  assert.equal(migrated.coverage.experienceRequirementThreshold, 4);
  assert.equal(migrated.coverage.maxRepairAttempts, 2);
  assert.deepEqual(migrated.coverage.aliases, { "Node.js": ["NodeJS"] });
});

test("saved system and step prompts are preserved without content migration", () => {
  const saved = defaultGeneratorConfig();
  saved.systemInstruction = "My database system instruction.";
  saved.steps[1].prompt = "My database Skills prompt, including legacy wording.";

  const migrated = migrateGeneratorConfig(saved).config;
  assert.equal(migrated.systemInstruction, saved.systemInstruction);
  assert.equal(migrated.steps[1].prompt, saved.steps[1].prompt);
});
