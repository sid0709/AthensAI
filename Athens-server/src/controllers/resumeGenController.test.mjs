import { test } from "node:test";
import assert from "node:assert/strict";
import {
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

test("resume generation runs section series concurrently and keeps each conversation continuous", async () => {
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
  let initialCount = 0;
  let releaseInitial;
  let barrierTimer;
  const initialBarrier = new Promise((resolve, reject) => {
    releaseInitial = () => {
      clearTimeout(barrierTimer);
      resolve();
    };
    barrierTimer = setTimeout(
      () => reject(new Error("Section pipelines did not start concurrently.")),
      1_000,
    );
  });
  const responseFor = (request) => {
    const purpose = String(request.feature).split(":").at(-1);
    const turn = request.messages.filter((message) => message.role === "user").length;
    if (purpose === "experience" && turn < 4) return `EXPERIENCE PLAN ${turn}`;
    if (purpose === "experience") {
      return JSON.stringify({ experiences: [{ company: "First Company", title: "Engineer", period: "2022 – Present", bullets: ["Built production APIs for reliable customer workflows."] }] });
    }
    if (purpose === "skills" && turn === 1) return "SKILL POOL";
    if (purpose === "skills") return JSON.stringify({ skills: [{ category: "Backend", items: ["APIs"] }] });
    return JSON.stringify({ summary: "Engineer who builds production APIs." });
  };
  const result = await runGeneration({
    providerId: "deepseek",
    apiKey: "test-key",
    model: "deepseek-v4-flash",
    systemInstruction: "SYSTEM INSTRUCTION",
    identity,
    jobDescription: "Build APIs.",
    coverageContract: null,
    steps: [
      { purpose: "experience", kind: "fine-tune", prompt: "Plan {career}." },
      { purpose: "experience", kind: "fine-tune", prompt: "Improve the Experience plan with clearer evidence boundaries." },
      { purpose: "experience", kind: "fine-tune", prompt: "Review the Experience plan for repetition." },
      { purpose: "experience", kind: "final", prompt: "Write the final Experience section from our work above.", schema: { type: "object" } },
      { purpose: "skills", kind: "fine-tune", prompt: "Build a skill pool." },
      { purpose: "skills", kind: "final", prompt: "Write the final Skills section from our work above.", schema: { type: "object" } },
      { purpose: "summary", kind: "final", prompt: "Write a summary from this profile: {source_resume}", schema: { type: "object" } },
    ],
    chat: async (request) => {
      calls.push(request);
      if (request.messages.length === 2) {
        initialCount += 1;
        if (initialCount === 3) releaseInitial();
        await initialBarrier;
      }
      return {
        content: responseFor(request),
        usage: { model: "deepseek-v4-flash", inputTokens: 1, cachedTokens: 0, outputTokens: 1, totalTokens: 2, cost: 0, savings: 0 },
      };
    },
  });

  assert.equal(calls.length, 7);
  const experienceCalls = calls
    .filter((call) => call.feature === "resume-generate:experience")
    .sort((left, right) => left.messages.length - right.messages.length);
  const skillsCalls = calls
    .filter((call) => call.feature === "resume-generate:skills")
    .sort((left, right) => left.messages.length - right.messages.length);
  const summaryCalls = calls.filter((call) => call.feature === "resume-generate:summary");
  assert.equal(initialCount, 3);
  assert.deepEqual(experienceCalls.map((call) => call.messages.length), [2, 4, 6, 8]);
  assert.deepEqual(experienceCalls[3].messages.map((message) => message.role), [
    "system", "user", "assistant", "user", "assistant", "user", "assistant", "user",
  ]);
  assert.match(experienceCalls[0].messages[0].content, /Career descriptions are optional/);
  assert.equal(experienceCalls[3].messages[2].content, "EXPERIENCE PLAN 1");
  assert.equal(experienceCalls[3].messages[4].content, "EXPERIENCE PLAN 2");
  assert.equal(experienceCalls[3].messages[6].content, "EXPERIENCE PLAN 3");
  assert.deepEqual(skillsCalls.map((call) => call.messages.length), [2, 4]);
  assert.equal(skillsCalls[1].messages[2].content, "SKILL POOL");
  assert.equal(summaryCalls.length, 1);
  assert.equal(summaryCalls[0].messages.length, 2);
  assert.match(summaryCalls[0].messages[1].content, /Test User/);
  assert.doesNotMatch(summaryCalls[0].messages[1].content, /\{source_resume\}/);
  assert.equal(result.sections.experience.experiences[0].bullets.length, 1);
});

test("unknown prompt tokens are rejected before a model call", async () => {
  await assert.rejects(
    runGeneration({
      providerId: "deepseek",
      apiKey: "test-key",
      model: "deepseek-v4-flash",
      systemInstruction: "SYSTEM INSTRUCTION",
      identity: { careers: [] },
      steps: [{ purpose: "experience", kind: "fine-tune", prompt: "Use {unknown_reference}." }],
      chat: async () => assert.fail("The model must not be called for an unresolved token."),
    }),
    /Unresolved prompt token: \{unknown_reference\}/,
  );
});

test("resume generation returns final sections without an audit or repair pass", async () => {
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
  const response = {
    experiences: identity.careers.map((career) => ({
      company: career.company,
      title: career.title,
      period: career.period,
      bullets: [],
    })),
  };
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
    chat: async () => {
      calls += 1;
      return {
        content: JSON.stringify(response),
        usage: {
          model: "deepseek-v4-flash",
          inputTokens: 1,
          cachedTokens: 0,
          outputTokens: 1,
          totalTokens: 2,
          cost: 0,
          savings: 0,
        },
      };
    },
  }, (event) => events.push(event));

  assert.equal(calls, 1);
  assert.equal(result.sections.experience.experiences.every((role) => role.bullets.length === 0), true);
  assert.equal(events.some((event) => String(event.phase).startsWith("quality-")), false);
  assert.equal(events.some((event) => event.kind === "coverage-repair"), false);
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
