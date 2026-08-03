import assert from "node:assert/strict";
import { test } from "node:test";
import {
  auditResumeCoverage,
  buildAutomaticResumeCoveragePayload,
  buildResumeCoverageContract,
  extractParentheticalCoverageCandidates,
  isNamedResumeCoverageSkill,
  parseResumeCoverageAnalysis,
  RESUME_COVERAGE_ANALYSIS_PROMPT,
  resumeCoverageRepairPrompt,
  textContainsBoldCoverageSkill,
  textContainsCoverageSkill,
} from "./resumeCoverageService.js";

test("coverage analysis prompt rejects capitalized generic category labels", () => {
  assert.match(RESUME_COVERAGE_ANALYSIS_PROMPT, /Capitalization is not evidence/);
  assert.match(RESUME_COVERAGE_ANALYSIS_PROMPT, /“Programming Language” is not a skill/);
  assert.match(RESUME_COVERAGE_ANALYSIS_PROMPT, /Python \(Programming Language\).*only “Python”/);
});

test("deterministic list fallback preserves explicit parenthetical alternatives", () => {
  const candidates = extractParentheticalCoverageCandidates(
    "Experience integrating ERP systems (NetSuite, Acumatica, Microsoft Dynamics, SAP, etc.) and APIs (SOAP/REST, webhooks).",
  );
  assert.deepEqual(
    candidates.map((item) => item.name),
    ["NetSuite", "Acumatica", "Microsoft Dynamics", "SAP", "SOAP", "REST"],
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

test("bold coverage requires the exact canonical spelling inside Markdown markers", () => {
  assert.equal(textContainsBoldCoverageSkill("Built with **Node.js** services.", { name: "Node.js" }), true);
  assert.equal(textContainsBoldCoverageSkill("Built with **NodeJS** services.", { name: "Node.js" }), false);
  assert.equal(textContainsBoldCoverageSkill("Built with Node.js services.", { name: "Node.js" }), false);
  assert.equal(textContainsBoldCoverageSkill("Built with **node.js** services.", { name: "Node.js" }), false);
});

test("coverage names include named technologies and reject ordinary technical concepts", () => {
  const jobDescription = "Use XML, ACH, Acumatica, integrator.io, JavaScript, and SQL for data modeling, data mapping, authentication, automation, and custom logic.";
  assert.equal(isNamedResumeCoverageSkill("XML", jobDescription), true);
  assert.equal(isNamedResumeCoverageSkill("ACH", jobDescription), true);
  assert.equal(isNamedResumeCoverageSkill("Acumatica", jobDescription), true);
  assert.equal(isNamedResumeCoverageSkill("integrator.io", jobDescription), true);
  assert.equal(isNamedResumeCoverageSkill("JavaScript", jobDescription), true);
  assert.equal(isNamedResumeCoverageSkill("Data Modeling", jobDescription), false);
  assert.equal(isNamedResumeCoverageSkill("data mapping", jobDescription), false);
  assert.equal(isNamedResumeCoverageSkill("authentication", jobDescription), false);
  assert.equal(isNamedResumeCoverageSkill("automation", jobDescription), false);
  assert.equal(isNamedResumeCoverageSkill("custom logic", jobDescription), false);

  const unseenNames = "Build with nova.io, dbt, and Ruby on Rails instead of service coordination.";
  assert.equal(isNamedResumeCoverageSkill("nova.io", unseenNames), true);
  assert.equal(isNamedResumeCoverageSkill("dbt", unseenNames), true);
  assert.equal(isNamedResumeCoverageSkill("Ruby on Rails", unseenNames), true);
  assert.equal(isNamedResumeCoverageSkill("Service Coordination", unseenNames), false);

  const agenticDescription = "Use Celigo agentic services and MCP servers.";
  assert.equal(isNamedResumeCoverageSkill("Celigo", agenticDescription), true);
  assert.equal(isNamedResumeCoverageSkill("Celigo agentic services", agenticDescription), false);
  assert.equal(isNamedResumeCoverageSkill("MCP", agenticDescription), true);
  assert.equal(isNamedResumeCoverageSkill("MCP servers", agenticDescription), false);
});

test("coverage analysis keeps only atomic proper names when the model returns concepts", () => {
  const jobDescription = "Build custom logic with JavaScript and SQL data modeling. Support authentication and automation across cloud/SaaS platforms such as Salesforce and Acumatica. Exchange JSON, XML, CSV, EDI, and ACH files.";
  const names = [
    "custom logic",
    "JavaScript",
    "data modeling",
    "SQL",
    "authentication",
    "automation",
    "cloud/SaaS platforms",
    "SaaS",
    "Salesforce",
    "Acumatica",
    "JSON",
    "XML",
    "CSV",
    "EDI",
    "ACH",
  ];
  const analysis = parseResumeCoverageAnalysis(JSON.stringify({
    skills: names.map((name) => ({ name, category: "tool", requirement: 4, sourceText: name })),
  }), { jobDescription, identity: { careers: [] } });

  assert.deepEqual(
    analysis.skills.map((skill) => skill.name).sort(),
    ["ACH", "Acumatica", "CSV", "EDI", "JSON", "JavaScript", "SaaS", "SQL", "Salesforce", "XML"].sort(),
  );
});

test("coverage analysis defaults high-priority skills to used and lower-priority skills to familiar", () => {
  const jobDescription = "Required: REST APIs, SOAP, NetSuite, webhooks, and OAuth. Acumatica is a plus.";
  const content = JSON.stringify({
    skills: [
      { name: "REST", aliases: ["REST APIs"], category: "protocol", requirement: 5, sourceText: "REST APIs" },
      { name: "SOAP", aliases: [], category: "protocol", requirement: 4, sourceText: "SOAP" },
      { name: "NetSuite", aliases: [], category: "platform", requirement: 4, sourceText: "NetSuite" },
      { name: "webhooks", aliases: ["webhook"], category: "protocol", requirement: 4, sourceText: "webhooks" },
      { name: "OAuth", aliases: [], category: "protocol", requirement: 4, sourceText: "OAuth" },
      { name: "Acumatica", aliases: [], category: "platform", requirement: 2, sourceText: "Acumatica" },
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
    ["NetSuite", "OAuth", "REST", "SOAP"],
  );
  assert.deepEqual(
    analysis.skills.filter((skill) => skill.decision === "familiar").map((skill) => skill.name).sort(),
    ["Acumatica"],
  );
  assert.equal(analysis.unresolvedCount, 0);
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

test("structured runs apply the same automatic coverage decisions as the Editor", () => {
  const analysis = {
    fingerprint: "analysis-structured",
    skills: [
      { id: "verified", name: "Node.js", requirement: 2, evidenceStatus: "verified", decision: null },
      { id: "required", name: "PostgreSQL", requirement: 5, evidenceStatus: "unverified", decision: null },
      { id: "optional", name: "Redis", requirement: 2, evidenceStatus: "unverified", decision: null },
    ],
  };
  const payload = buildAutomaticResumeCoveragePayload(analysis, {
    enabled: true,
    experienceRequirementThreshold: 4,
    maxRepairAttempts: 2,
  });

  assert.deepEqual(payload.decisions, {
    verified: "used",
    required: "used",
    optional: "familiar",
  });
  const contract = buildResumeCoverageContract(payload.analysis, payload.decisions, payload.settings);
  assert.deepEqual(contract.skills.find((skill) => skill.id === "verified").placements, ["skills"]);
  assert.deepEqual(contract.skills.find((skill) => skill.id === "required").placements, ["skills", "experience"]);
  assert.deepEqual(contract.skills.find((skill) => skill.id === "optional").placements, ["skills"]);
  assert.equal(contract.maxRepairAttempts, 2);
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
    skills: { skills: [{ category: "Languages", items: ["**Node.js**", "**SOAP**"] }] },
    experience: { experiences: [{ bullets: ["Built API routing for services."] }] },
  }, contract);

  assert.equal(audit.passed, false);
  assert.deepEqual(audit.missing, [{ skillId: "node", skill: "Node.js", section: "experience" }]);
  assert.equal(audit.sections.skills.passed, true);
});

test("deterministic audit rejects repeated, compound, and out-of-contract Skills items", () => {
  const contract = {
    schemaVersion: 1,
    maxRepairAttempts: 1,
    skills: [
      { id: "python", name: "Python", aliases: [], category: "language", requirement: 5, decision: "used", placements: ["skills"] },
      { id: "openai", name: "OpenAI", aliases: [], category: "platform", requirement: 4, decision: "used", placements: ["skills"] },
    ],
    unresolved: [],
    excluded: [],
  };
  const audit = auditResumeCoverage({
    skills: {
      skills: [
        { category: "Languages", items: ["**Python**", "Python for API services"] },
        { category: "AI Platforms", items: ["**OpenAI**, model orchestration", "Anthropic"] },
      ],
    },
  }, contract);

  assert.equal(audit.passed, false);
  assert.deepEqual(audit.missing, [{ skillId: "openai", skill: "OpenAI", section: "skills" }]);
  assert.deepEqual(audit.skillIssues, [
    { section: "skills", reason: "noncanonical-item", item: "Python for API services" },
    { section: "skills", reason: "noncanonical-item", item: "**OpenAI**, model orchestration" },
    { section: "skills", reason: "unexpected-item", item: "Anthropic" },
    { section: "skills", reason: "duplicate-skill", skillId: "python", skill: "Python", count: 2 },
  ]);
});

test("deterministic audit requires a contextual bold Experience placement", () => {
  const contract = {
    schemaVersion: 1,
    maxRepairAttempts: 1,
    skills: [
      { id: "node", name: "Node.js", aliases: ["NodeJS"], category: "language", requirement: 5, decision: "used", placements: ["skills", "experience"] },
    ],
    unresolved: [],
    excluded: [],
  };

  const unformatted = auditResumeCoverage({
    skills: { skills: [{ category: "Languages", items: ["Node.js"] }] },
    experience: { experiences: [{ bullets: ["Built production services with NodeJS for reliable request processing."] }] },
  }, contract);
  assert.equal(unformatted.passed, false);
  assert.deepEqual(unformatted.missing, [
    { skillId: "node", skill: "Node.js", section: "skills" },
    { skillId: "node", skill: "Node.js", section: "experience" },
  ]);

  const keywordDump = auditResumeCoverage({
    skills: { skills: [{ category: "Languages", items: ["**Node.js**"] }] },
    experience: { experiences: [{ bullets: ["**Node.js**"] }] },
  }, contract);
  assert.deepEqual(keywordDump.missing, [
    { skillId: "node", skill: "Node.js", section: "experience" },
  ]);

  const compliant = auditResumeCoverage({
    skills: { skills: [{ category: "Languages", items: ["**Node.js**"] }] },
    experience: {
      experiences: [{
        bullets: ["Built production services with **Node.js** to support reliable request processing across customer workflows."],
      }],
    },
  }, contract);
  assert.equal(compliant.passed, true);
  assert.equal(compliant.coveredCount, 2);
});

test("coverage repair instructions require contextual exact bold placement", () => {
  const prompt = resumeCoverageRepairPrompt({
    purpose: "experience",
    missing: ["Example.Tool"],
    remove: ["Legacy.Tool"],
    incompleteRoles: [{
      index: 0,
      title: "Senior Engineer",
      company: "Example Company",
      period: "2024 – Present",
      description: "Built and supported customer-facing production services.",
    }],
    currentSection: { experiences: [] },
    schema: { type: "object" },
  });
  assert.match(prompt, /\*\*Canonical Skill Name\*\*/);
  assert.match(prompt, /concrete task or workflow/);
  assert.match(prompt, /Do not append a keyword list/);
  assert.match(prompt, /Example\.Tool/);
  assert.match(prompt, /Legacy\.Tool/);
  assert.match(prompt, /Authoritative roles requiring substantive bullets/);
  assert.match(prompt, /exactly one Experience object per authoritative profile role/);
});

test("Skills repair instructions enforce a closed set of atomic unique items", () => {
  const prompt = resumeCoverageRepairPrompt({
    purpose: "skills",
    missing: ["OpenAI"],
    remove: [],
    skillIssues: [
      { reason: "duplicate-skill", skill: "Python", count: 3 },
      { reason: "unexpected-item", item: "Unsupported Tool" },
    ],
    currentSection: { skills: [] },
    schema: { type: "object" },
  });
  assert.match(prompt, /closed set/);
  assert.match(prompt, /standalone term/);
  assert.match(prompt, /Python appears 3 times/);
  assert.match(prompt, /unexpected-item: Unsupported Tool/);
});

test("deterministic audit rejects an authoritative career with no substantive bullets", () => {
  const identity = {
    careers: [
      { title: "Senior Engineer", company: "First Company", period: "2024 – Present", description: "Built production services." },
      { title: "Engineer", company: "Second Company", period: "2021 – 2024", description: "Supported integrations." },
    ],
  };
  const incomplete = auditResumeCoverage({
    experience: {
      experiences: [
        { company: "First Company", bullets: [] },
        { company: "Second Company", bullets: ["Supported production integrations and resolved customer workflow issues across connected services."] },
      ],
    },
  }, null, identity);

  assert.equal(incomplete.passed, false);
  assert.equal(incomplete.requiredRoleCount, 2);
  assert.equal(incomplete.completeRoleCount, 1);
  assert.deepEqual(incomplete.careerIssues, [{
    index: 0,
    company: "First Company",
    title: "Senior Engineer",
    period: "2024 – Present",
    description: "Built production services.",
    reason: "no-substantive-bullets",
  }]);

  const complete = auditResumeCoverage({
    experience: {
      experiences: [
        { company: "First Company", bullets: ["Built production services that supported reliable customer workflows and ongoing releases."] },
        { company: "Second Company", bullets: ["Supported production integrations and resolved customer workflow issues across connected services."] },
      ],
    },
  }, null, identity);
  assert.equal(complete.passed, true);
  assert.equal(complete.completeRoleCount, 2);
  assert.deepEqual(complete.careerIssues, []);
});

test("deterministic audit rejects familiar-only Experience claims and excluded terms", () => {
  const contract = {
    schemaVersion: 1,
    maxRepairAttempts: 1,
    skills: [
      { id: "familiar", name: "Example.Tool", category: "tool", requirement: 3, decision: "familiar", placements: ["skills"] },
    ],
    unresolved: [],
    excluded: [{ id: "excluded", name: "Legacy.Tool" }],
  };
  const audit = auditResumeCoverage({
    skills: { skills: [{ category: "Tools", items: ["**Example.Tool**", "Legacy.Tool"] }] },
    experience: {
      experiences: [{
        bullets: ["Supported customer workflows with Example.Tool and Legacy.Tool while resolving production integration issues."],
      }],
    },
  }, contract);

  assert.equal(audit.passed, false);
  assert.deepEqual(audit.missing, []);
  assert.deepEqual(audit.violations, [
    { skillId: "excluded", skill: "Legacy.Tool", section: "skills", reason: "excluded" },
    { skillId: "excluded", skill: "Legacy.Tool", section: "experience", reason: "excluded" },
    { skillId: "familiar", skill: "Example.Tool", section: "experience", reason: "familiar-only" },
  ]);
});
