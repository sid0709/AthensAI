import { test } from "node:test";
import assert from "node:assert/strict";
import {
  assertPassedResumeQualityAudit,
  buildTokenMap,
  formatCompanyToken,
  prepareGeneration,
  resolveResumePromptSkills,
  runGeneration,
} from "./resumeGenController.js";
import {
  TITLE_POLICY_VERSION,
  appendExperienceTitlePolicy,
  applyTitlePolicyToSections,
  computeTitlePolicyFingerprint,
  sourceCareers,
} from "../services/resumeCareerTitlePolicy.js";

test("finished generations require an explicitly passed quality audit", () => {
  assert.throws(
    () => assertPassedResumeQualityAudit({ coverageAudit: null }),
    (error) => error?.status === 502 && /not saved/.test(error.message),
  );
  assert.deepEqual(
    assertPassedResumeQualityAudit({ coverageAudit: { passed: true } }),
    { passed: true },
  );
});

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

test("Experience generation allows optional blank career descriptions", async () => {
  const body = {
    applierName: "Test User",
    identity: {
      careers: [
        { company: "First Company", title: "Engineer", description: "" },
        { company: "Second Company", title: "Engineer", description: "Built APIs." },
      ],
    },
    steps: [{ purpose: "experience", kind: "final" }],
  };
  const prepared = await prepareGeneration(body, {
    loadProfile: async () => ({
      defaultProvider: "deepseek",
      defaultModel: "deepseek-v4-flash",
      deepseekApiKey: "deepseek-key",
    }),
    loadAccountTier: async () => "Free",
  });
  assert.equal(prepared.ok, true);
});

test("resume generation sends two-message sequential calls and resolves earlier outputs", async () => {
  const identity = {
    fullName: "Test User",
    careers: [{
      company: "First Company",
      title: "Engineer",
      period: "2022 – Present",
      description: "",
    }],
  };
  const calls = [];
  const responses = [
    "PLAN CONTENT",
    JSON.stringify({ experiences: [{ company: "First Company", title: "Engineer", period: "2022 – Present", bullets: ["Built production APIs for reliable customer workflows."] }] }),
    "SKILL POOL",
    JSON.stringify({ skills: [{ category: "Backend", items: ["APIs"] }] }),
    JSON.stringify({ summary: "Engineer who builds production APIs." }),
  ];
  const result = await runGeneration({
    providerId: "deepseek",
    apiKey: "test-key",
    model: "deepseek-v4-flash",
    systemInstruction: "SYSTEM INSTRUCTION",
    identity,
    jobDescription: "Build APIs.",
    coverageContract: null,
    steps: [
      { purpose: "experience", kind: "fine-tune", prompt: "Plan {career}. Prior: {previous_plan}" },
      { purpose: "experience", kind: "final", prompt: "Use this plan: {plan_output}", schema: { type: "object" } },
      { purpose: "skills", kind: "fine-tune", prompt: "Build a skill pool." },
      { purpose: "skills", kind: "final", prompt: "Use this pool: {skill_step1}", schema: { type: "object" } },
      { purpose: "summary", kind: "final", prompt: "Source: {source_resume}\nExperience: {work_experience}", schema: { type: "object" } },
    ],
    chat: async (request) => {
      calls.push(request);
      return {
        content: responses[calls.length - 1],
        usage: { model: "deepseek-v4-flash", inputTokens: 1, cachedTokens: 0, outputTokens: 1, totalTokens: 2, cost: 0, savings: 0 },
      };
    },
  });

  assert.equal(calls.length, 5);
  assert.equal(calls.every((call) => call.messages.length === 2), true);
  assert.equal(calls.every((call) => call.messages[0].role === "system" && call.messages[1].role === "user"), true);
  assert.match(calls[0].messages[0].content, /Career descriptions are optional/);
  assert.match(calls[1].messages[1].content, /PLAN CONTENT/);
  assert.doesNotMatch(calls[1].messages[1].content, /\{plan_output\}/);
  assert.match(calls[3].messages[1].content, /SKILL POOL/);
  assert.doesNotMatch(calls[3].messages[1].content, /\{skill_step1\}/);
  assert.match(calls[4].messages[1].content, /Built production APIs for reliable customer workflows/);
  assert.doesNotMatch(calls[4].messages[1].content, /\{(?:source_resume|work_experience)\}/);
  assert.equal(result.sections.experience.experiences[0].bullets.length, 1);
});

test("resume generation repairs empty authoritative roles before reporting success", async () => {
  const identity = {
    careers: [
      {
        title: "Senior Engineer",
        company: "First Company",
        period: "2024 – Present",
        description: "Built production services for customer workflows.",
      },
      {
        title: "Engineer",
        company: "Second Company",
        period: "2021 – 2024",
        description: "Supported integrations and production operations.",
      },
    ],
  };
  const responses = [
    {
      experiences: identity.careers.map((career) => ({
        company: career.company,
        title: career.title,
        period: career.period,
        bullets: [],
      })),
    },
    {
      experiences: [
        {
          company: "First Company",
          title: "Senior Engineer",
          period: "2024 – Present",
          bullets: ["Built production services that supported reliable customer workflows and ongoing releases."],
        },
        {
          company: "Second Company",
          title: "Engineer",
          period: "2021 – 2024",
          bullets: ["Supported production integrations and resolved customer workflow issues across connected services."],
        },
      ],
    },
  ];
  const events = [];
  let calls = 0;
  const result = await runGeneration({
    providerId: "deepseek",
    apiKey: "test-key",
    model: "deepseek-v4-flash",
    steps: [{
      name: "Experience final",
      purpose: "experience",
      kind: "final",
      prompt: "Return the Experience section.",
      schema: { type: "object" },
    }],
    systemInstruction: "Write a truthful resume.",
    identity,
    applierName: "Test User",
    jobDescription: "Build production services.",
    coverageContract: null,
    chat: async () => ({
      content: JSON.stringify(responses[calls++]),
      usage: {
        model: "deepseek-v4-flash",
        inputTokens: 1,
        cachedTokens: 0,
        outputTokens: 1,
        totalTokens: 2,
        cost: 0,
        savings: 0,
      },
    }),
  }, (event) => events.push(event));

  assert.equal(calls, 2);
  assert.equal(result.coverageAudit.passed, true);
  assert.equal(result.coverageAudit.completeRoleCount, 2);
  assert.equal(result.sections.experience.experiences.every((role) => role.bullets.length > 0), true);
  assert.equal(events.some((event) => event.phase === "quality-start"), true);
  assert.equal(events.some((event) => event.kind === "coverage-repair"), true);
  assert.equal(events.some((event) => event.phase === "quality-done"), true);
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
