import assert from "node:assert/strict";
import { test } from "node:test";
import { defaultGeneratorConfig } from "../config/resumeGeneratorDefaults.js";
import {
  isCanonicalGeneratorConfig,
  migrateGeneratorConfig,
} from "./resumeGeneratorConfigSchema.js";

test("legacy EditorDraft migrates to canonical v3 without run data", () => {
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
  assert.equal(migrated.config.schemaVersion, 3);
  assert.equal(migrated.config.theme.baseSize, 11);
  assert.equal(migrated.config.theme.paper, "a4");
  assert.equal(migrated.config.layout[0].type, "experience");
  assert.equal("jobDescription" in migrated.config, false);
  assert.equal("document" in migrated.config, false);
  assert.equal("refinementSteps" in migrated.config, false);
});

test("canonical v3 config remains canonical", () => {
  const canonical = migrateGeneratorConfig(defaultGeneratorConfig()).config;
  assert.equal(isCanonicalGeneratorConfig(canonical), true);
});
