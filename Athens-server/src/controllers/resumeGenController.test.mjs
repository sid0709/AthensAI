import { test } from "node:test";
import assert from "node:assert/strict";
import { buildTokenMap, formatCompanyToken } from "./resumeGenController.js";
import {
  TITLE_POLICY_VERSION,
  appendExperienceTitlePolicy,
  applyTitlePolicyToSections,
  computeTitlePolicyFingerprint,
  sourceCareers,
} from "../services/resumeCareerTitlePolicy.js";
import { isBetaTier } from "../lib/betaTier.js";

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

test("shared title policy: runGeneration-shaped Experience step reconciles non-Beta titles", () => {
  const identity = {
    careers: [
      { title: "Software Engineer", company: "Acme", period: "2020 – 2022", description: "Java" },
      { title: "Senior Software Engineer", company: "Globex", period: "2022 – Present", description: "APIs" },
    ],
  };
  // Mirrors runGeneration final experience step: append policy then reconcile.
  const prompt = appendExperienceTitlePolicy("Write experience bullets.", {
    isBeta: false,
    jobDescription: "Backend role",
    careers: sourceCareers(identity),
  });
  assert.match(prompt, /TITLE POLICY \(mandatory — non-Beta\)/);

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

test("shared title policy: Beta Experience step keeps valid tailored titles", () => {
  const identity = {
    careers: [
      { title: "Software Engineer", company: "Acme", period: "2020 – 2022", description: "Java" },
      { title: "Senior Software Engineer", company: "Globex", period: "2022 – Present", description: "APIs" },
    ],
  };
  const prompt = appendExperienceTitlePolicy("Write experience.", {
    isBeta: true,
    jobDescription: "Looking for a backend engineer",
    careers: sourceCareers(identity),
  });
  assert.match(prompt, /TITLE POLICY \(mandatory — Beta\)/);
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

test("generation persistence fingerprint tracks Beta entitlement and policy version", () => {
  // prepareGeneration resolves isBeta via isBetaTier(account.tier); finalizeGenerationRun
  // persists computeTitlePolicyFingerprint — stale fingerprints must not reuse.
  assert.equal(isBetaTier("pro"), false);
  assert.equal(isBetaTier("beta"), true);

  const body = {
    jobDescription: "JD",
    identity: {
      careers: [{ title: "Engineer", company: "Acme", period: "2020", description: "" }],
    },
    systemInstruction: "sys",
    steps: [{ purpose: "experience", kind: "final", prompt: "p" }],
  };
  const nonBetaFp = computeTitlePolicyFingerprint({
    isBeta: false,
    jobDescription: body.jobDescription,
    careers: sourceCareers(body.identity),
    config: body,
  });
  const betaFp = computeTitlePolicyFingerprint({
    isBeta: true,
    jobDescription: body.jobDescription,
    careers: sourceCareers(body.identity),
    config: body,
  });
  assert.notEqual(nonBetaFp, betaFp);
  assert.equal(TITLE_POLICY_VERSION, 1);
  assert.equal(nonBetaFp.length, 40);
});
