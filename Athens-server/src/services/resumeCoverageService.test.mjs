import assert from "node:assert/strict";
import { test } from "node:test";
import {
  auditResumeCoverage,
  buildResumeCoverageContract,
  extractParentheticalCoverageCandidates,
  parseResumeCoverageAnalysis,
  textContainsCoverageSkill,
} from "./resumeCoverageService.js";

test("deterministic list fallback preserves explicit parenthetical alternatives", () => {
  const candidates = extractParentheticalCoverageCandidates(
    "Experience integrating ERP systems (NetSuite, Acumatica, Microsoft Dynamics, SAP, etc.) and APIs (SOAP/REST, webhooks).",
  );
  assert.deepEqual(
    candidates.map((item) => item.name),
    ["NetSuite", "Acumatica", "Microsoft Dynamics", "SAP", "SOAP", "REST", "webhooks"],
  );
  assert.equal(candidates.find((item) => item.name === "NetSuite")?.requirement, 4);
});

test("coverage matching handles aliases, punctuation, plurals, and strict boundaries", () => {
  assert.equal(textContainsCoverageSkill("Built NodeJS routing", { name: "Node.js" }), true);
  assert.equal(textContainsCoverageSkill("Delivered webhook handlers", { name: "webhooks" }), true);
  assert.equal(textContainsCoverageSkill("Integrated Dynamics 365", {
    name: "Microsoft Dynamics",
    aliases: ["Dynamics 365"],
  }), true);
  assert.equal(textContainsCoverageSkill("The migration disappeared overnight", { name: "SAP" }), false);
  assert.equal(textContainsCoverageSkill("Managed Gmail workflows", { name: "AI" }), false);
});

test("coverage analysis auto-verifies only skills found in career evidence", () => {
  const jobDescription = "Required: REST APIs, SOAP, NetSuite, webhooks, and OAuth.";
  const content = JSON.stringify({
    skills: [
      { name: "REST", aliases: ["REST APIs"], category: "protocol", requirement: 5, sourceText: "REST APIs" },
      { name: "SOAP", aliases: [], category: "protocol", requirement: 4, sourceText: "SOAP" },
      { name: "NetSuite", aliases: [], category: "platform", requirement: 4, sourceText: "NetSuite" },
      { name: "webhooks", aliases: ["webhook"], category: "protocol", requirement: 4, sourceText: "webhooks" },
      { name: "OAuth", aliases: [], category: "protocol", requirement: 4, sourceText: "OAuth" },
    ],
  });
  const analysis = parseResumeCoverageAnalysis(content, {
    jobDescription,
    identity: {
      careers: [{
        company: "Acme",
        title: "Integration Developer",
        description: "Built REST API and webhook integrations secured with OAuth.",
      }],
    },
  });

  assert.deepEqual(
    analysis.skills.filter((skill) => skill.decision === "used").map((skill) => skill.name).sort(),
    ["OAuth", "REST", "webhooks"],
  );
  assert.deepEqual(
    analysis.skills.filter((skill) => skill.decision == null).map((skill) => skill.name).sort(),
    ["NetSuite", "SOAP"],
  );
  assert.equal(analysis.unresolvedCount, 2);
});

test("coverage contract separates used, familiar-only, and excluded terms", () => {
  const analysis = {
    fingerprint: "analysis-1",
    skills: [
      { id: "rest", name: "REST", aliases: [], category: "protocol", requirement: 5, decision: "used", evidenceStatus: "verified" },
      { id: "soap", name: "SOAP", aliases: [], category: "protocol", requirement: 4, decision: null, evidenceStatus: "unverified" },
      { id: "netsuite", name: "NetSuite", aliases: [], category: "platform", requirement: 4, decision: null, evidenceStatus: "unverified" },
    ],
  };
  const contract = buildResumeCoverageContract(
    analysis,
    { soap: "familiar", netsuite: "exclude" },
    { enabled: true, experienceRequirementThreshold: 4, maxRepairAttempts: 1 },
  );

  assert.deepEqual(contract.unresolved, []);
  assert.deepEqual(contract.skills.find((skill) => skill.name === "REST").placements, ["skills", "experience"]);
  assert.deepEqual(contract.skills.find((skill) => skill.name === "SOAP").placements, ["skills"]);
  assert.deepEqual(contract.excluded.map((skill) => skill.name), ["NetSuite"]);
});

test("deterministic audit reports section-specific gaps", () => {
  const contract = {
    schemaVersion: 1,
    maxRepairAttempts: 1,
    skills: [
      { id: "node", name: "Node.js", aliases: ["NodeJS"], category: "language", requirement: 5, decision: "used", placements: ["skills", "experience"] },
      { id: "soap", name: "SOAP", aliases: [], category: "protocol", requirement: 4, decision: "familiar", placements: ["skills"] },
    ],
    unresolved: [],
    excluded: [],
  };
  const audit = auditResumeCoverage({
    skills: { skills: [{ category: "Languages", items: ["NodeJS", "SOAP"] }] },
    experience: { experiences: [{ bullets: ["Built API routing for services."] }] },
  }, contract);

  assert.equal(audit.passed, false);
  assert.deepEqual(audit.missing, [{ skillId: "node", skill: "Node.js", section: "experience" }]);
  assert.equal(audit.sections.skills.passed, true);
});
