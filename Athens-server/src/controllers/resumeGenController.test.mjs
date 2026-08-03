import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildParallelPurposeChains,
  buildTokenMap,
  formatCompanyToken,
  prepareGeneration,
  resolveResumePromptSkills,
} from "./resumeGenController.js";
import {
  TITLE_POLICY_VERSION,
  appendExperienceTitlePolicy,
  applyTitlePolicyToSections,
  computeTitlePolicyFingerprint,
  sourceCareers,
} from "../services/resumeCareerTitlePolicy.js";

test("formatCompanyToken formats full career entry as natural sentence", () => {
  const result = formatCompanyToken({
    title: "Senior Software Engineer",
    company: "McGrow Hill",
    period: "2026.2 – Present",
    description: "E-learning platform",
  });
  assert.equal(result, "Senior Software Engineer at McGrow Hill (2026.2 – Present) — E-learning platform");
});

test("formatCompanyToken omits description when empty", () => {
  const result = formatCompanyToken({
    title: "Software Engineer",
    company: "WSECU",
    period: "2021.6 – 2022.1",
    description: "",
  });
  assert.equal(result, "Software Engineer at WSECU (2021.6 – 2022.1)");
});

test("formatCompanyToken omits period when empty", () => {
  const result = formatCompanyToken({
    title: "Engineer",
    company: "Acme",
    period: "",
    description: "Healthcare platform",
  });
  assert.equal(result, "Engineer at Acme — Healthcare platform");
});

test("formatCompanyToken uses title alone when company missing", () => {
  const result = formatCompanyToken({
    title: "Consultant",
    company: "",
    period: "2020 – 2021",
    description: "",
  });
  assert.equal(result, "Consultant (2020 – 2021)");
});

test("formatCompanyToken uses company alone when title missing", () => {
  const result = formatCompanyToken({
    title: "",
    company: "Robert Half",
    period: "2016.9 – 2021.5",
    description: "Recruiting & HR platform",
  });
  assert.equal(result, "Robert Half (2016.9 – 2021.5) — Recruiting & HR platform");
});

test("formatCompanyToken returns description alone when no title or company", () => {
  assert.equal(formatCompanyToken({ description: "Freelance projects" }), "Freelance projects");
});

test("buildTokenMap maps company1 and company2 from careers array", () => {
  const map = buildTokenMap(
    {
      careers: [
        {
          title: "Senior Software Engineer",
          company: "McGrow Hill",
          period: "2026.2 – Present",
          description: "E-learning platform",
        },
        {
          title: "Senior Software Engineer",
          company: "Accolade, Inc",
          period: "2022.1 – 2026.2",
          description: "Healthcare Platform",
        },
      ],
    },
    "Build scalable APIs",
    ["TypeScript", "React"],
  );

  assert.equal(
    map.company1,
    "Senior Software Engineer at McGrow Hill (2026.2 – Present) — E-learning platform",
  );
  assert.equal(
    map.company2,
    "Senior Software Engineer at Accolade, Inc (2022.1 – 2026.2) — Healthcare Platform",
  );
  assert.equal(map.job_description, "Build scalable APIs");
  assert.equal(map.job_skills, "TypeScript, React");
  assert.equal(
    map.career,
    "Senior Software Engineer | McGrow Hill | 2026.2 – Present — E-learning platform\nSenior Software Engineer | Accolade, Inc | 2022.1 – 2026.2 — Healthcare Platform",
  );
  assert.equal(map.company1_name, undefined);
  assert.equal(map.company1_title, undefined);
});

test("coverage contract is authoritative for structured-job prompt skill scope", () => {
  const skills = resolveResumePromptSkills(
    ["Node.js", "Excluded Tool", "Unreviewed Tool"],
    {
      skills: [
        { name: "Node.js", decision: "used" },
        { name: "Redis", decision: "familiar" },
      ],
      excluded: [{ name: "Excluded Tool" }],
    },
  );
  assert.deepEqual(skills, ["Node.js", "Redis"]);
  assert.deepEqual(resolveResumePromptSkills(["Node.js"], null), ["Node.js"]);
});

test("resume generation ignores request/config models and uses the Profile default", async () => {
  const prepared = await prepareGeneration({
    applierName: "Test User",
    provider: "openai",
    model: "gpt-5.4-mini",
    steps: [{ purpose: "summary", kind: "final" }],
  }, {
    loadProfile: async () => ({
      openaiApiKey: "openai-key",
      deepseekApiKey: "deepseek-key",
      defaultProvider: "deepseek",
      defaultModel: "deepseek-v4-flash",
    }),
    loadAccountTier: async () => "Beta",
  });

  assert.equal(prepared.ok, true);
  assert.equal(prepared.providerId, "deepseek");
  assert.equal(prepared.model, "deepseek-v4-flash");
  assert.equal(prepared.apiKey, "deepseek-key");
});

test("resume generation parallelizes independent purpose chains without reordering their steps", () => {
  const chains = buildParallelPurposeChains([
    { purpose: "experience", kind: "fine-tune", name: "Experience draft" },
    { purpose: "experience", kind: "final", name: "Experience final" },
    { purpose: "skills", kind: "fine-tune", name: "Skills draft" },
    { purpose: "skills", kind: "final", name: "Skills final" },
    { purpose: "summary", kind: "final", name: "Summary final" },
  ]);
  assert.deepEqual(
    chains?.map((chain) => chain.entries.map(({ index }) => index)),
    [[1, 2], [3, 4], [5]],
  );
});

test("resume generation preserves global order for ambiguous cross-purpose plans", () => {
  assert.equal(buildParallelPurposeChains([
    { purpose: "summary", kind: "fine-tune" },
    { purpose: "skills", kind: "final" },
    { purpose: "summary", kind: "final" },
  ]), null);
  assert.equal(buildParallelPurposeChains([
    { purpose: "summary", kind: "final" },
    { purpose: "summary", kind: "fine-tune" },
    { purpose: "skills", kind: "final" },
  ]), null);
});

test("shared title policy keeps Profile titles when the saved preference is disabled", () => {
  const identity = {
    careers: [
      { title: "Software Engineer", company: "Acme", period: "2020 – 2022", description: "Java" },
      { title: "Senior Software Engineer", company: "Globex", period: "2022 – Present", description: "APIs" },
    ],
  };
  // Mirrors runGeneration final experience step: append policy then reconcile.
  const prompt = appendExperienceTitlePolicy("Write experience bullets.", {
    dynamicCareerTitles: false,
    jobDescription: "Backend role",
    careers: sourceCareers(identity),
  });
  assert.match(prompt, /TITLE POLICY \(mandatory — dynamic career titles disabled\)/);

  const modelOutput = {
    experiences: [
      { title: "Staff Platform Engineer", company: "Wrong", period: "x", bullets: ["Built APIs"] },
      { title: "Principal Engineer", company: "Wrong2", period: "y", bullets: ["Led team"] },
    ],
  };
  const reconciled = applyTitlePolicyToSections({ experience: modelOutput }, identity, false);
  assert.equal(reconciled.experience.experiences[0].title, "Software Engineer");
  assert.equal(reconciled.experience.experiences[1].title, "Senior Software Engineer");
  assert.equal(reconciled.experience.experiences[0].company, "Acme");
});

test("shared title policy keeps valid tailored titles when the preference is enabled", () => {
  const identity = {
    careers: [
      { title: "Software Engineer", company: "Acme", period: "2020 – 2022", description: "Java" },
      { title: "Senior Software Engineer", company: "Globex", period: "2022 – Present", description: "APIs" },
    ],
  };
  const prompt = appendExperienceTitlePolicy("Write experience.", {
    dynamicCareerTitles: true,
    jobDescription: "Looking for a backend engineer",
    careers: sourceCareers(identity),
  });
  assert.match(prompt, /TITLE POLICY \(mandatory — dynamic career titles enabled\)/);
  assert.match(prompt, /Looking for a backend engineer/);

  const modelOutput = {
    experiences: [
      { title: "Java Engineer", bullets: ["a"] },
      { title: "Senior Backend Engineer", bullets: ["b"] },
    ],
  };
  const reconciled = applyTitlePolicyToSections({ experience: modelOutput }, identity, true);
  assert.equal(reconciled.experience.experiences[0].title, "Java Engineer");
  assert.equal(reconciled.experience.experiences[1].title, "Senior Backend Engineer");
});

test("generation persistence fingerprint tracks the saved preference instead of account tier", () => {
  const body = {
    jobDescription: "JD",
    identity: {
      careers: [{ title: "Engineer", company: "Acme", period: "2020", description: "" }],
    },
    systemInstruction: "sys",
    steps: [{ purpose: "experience", kind: "final", prompt: "p" }],
  };
  const staticFp = computeTitlePolicyFingerprint({
    dynamicCareerTitles: false,
    jobDescription: body.jobDescription,
    careers: sourceCareers(body.identity),
    config: body,
  });
  const dynamicFp = computeTitlePolicyFingerprint({
    dynamicCareerTitles: true,
    jobDescription: body.jobDescription,
    careers: sourceCareers(body.identity),
    config: body,
  });
  assert.notEqual(staticFp, dynamicFp);
  assert.equal(TITLE_POLICY_VERSION, 4);
  assert.equal(staticFp.length, 40);
});
