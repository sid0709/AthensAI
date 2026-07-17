import { test } from "node:test";
import assert from "node:assert/strict";
import {
  TITLE_POLICY_VERSION,
  isStackedOrMalformedTitle,
  isAcceptableBetaTitle,
  reconcileExperienceTitles,
  applyTitlePolicyToSections,
  appendExperienceTitlePolicy,
  computeTitlePolicyFingerprint,
} from "../services/resumeCareerTitlePolicy.js";
import { agentPdfRenderFingerprint } from "../services/agentResumeDraftService.js";

const identity = {
  careers: [
    {
      title: "Software Engineer",
      company: "Acme",
      period: "2020 – 2022",
      description: "Java services",
    },
    {
      title: "Senior Software Engineer",
      company: "Globex",
      period: "2022 – Present",
      description: "Platform APIs",
    },
  ],
};

test("isStackedOrMalformedTitle detects slash and keyword piles", () => {
  assert.equal(isStackedOrMalformedTitle("Senior/Staff Backend/Java Engineer"), true);
  assert.equal(isStackedOrMalformedTitle("Engineer | Manager"), true);
  assert.equal(isStackedOrMalformedTitle("Java, Python, React Engineer"), true);
  assert.equal(isStackedOrMalformedTitle(""), true);
  assert.equal(isStackedOrMalformedTitle("Senior Backend Engineer"), false);
});

test("non-Beta reconcile overwrites titles with Profile Settings titles", () => {
  const section = {
    experiences: [
      {
        company: "WRONG",
        title: "Staff Platform Engineer",
        period: "changed",
        bullets: ["Built APIs"],
      },
      {
        company: "ALSO WRONG",
        title: "Principal Engineer",
        period: "x",
        bullets: ["Led team"],
      },
    ],
  };
  const out = reconcileExperienceTitles(section, identity, false);
  assert.equal(out.experiences.length, 2);
  assert.equal(out.experiences[0].title, "Software Engineer");
  assert.equal(out.experiences[0].company, "Acme");
  assert.equal(out.experiences[0].period, "2020 – 2022");
  assert.deepEqual(out.experiences[0].bullets, ["Built APIs"]);
  assert.equal(out.experiences[1].title, "Senior Software Engineer");
  assert.equal(out.experiences[1].company, "Globex");
});

test("Beta reconcile accepts valid JD-aligned titles", () => {
  const section = {
    experiences: [
      { company: "Acme", title: "Java Engineer", bullets: ["a"] },
      { company: "Globex", title: "Senior Backend Engineer", bullets: ["b"] },
    ],
  };
  const out = reconcileExperienceTitles(section, identity, true);
  assert.equal(out.experiences[0].title, "Java Engineer");
  assert.equal(out.experiences[1].title, "Senior Backend Engineer");
  assert.equal(out.experiences[0].company, "Acme");
  assert.equal(out.experiences[1].period, "2022 – Present");
});

test("Beta reconcile falls back for stacked / empty / missing model rows", () => {
  const section = {
    experiences: [
      { title: "Senior/Staff Backend/Java Engineer", bullets: ["kept"] },
      // second row missing — fall back to source title
    ],
  };
  const out = reconcileExperienceTitles(section, identity, true);
  assert.equal(out.experiences[0].title, "Software Engineer");
  assert.deepEqual(out.experiences[0].bullets, ["kept"]);
  assert.equal(out.experiences[1].title, "Senior Software Engineer");
  assert.deepEqual(out.experiences[1].bullets, []);
});

test("reconcile preserves career count/order when model reorders or pads", () => {
  const section = {
    experiences: [
      { company: "Globex", title: "Senior Backend Engineer", bullets: ["second"] },
      { company: "Acme", title: "Java Engineer", bullets: ["first"] },
      { company: "Extra", title: "CTO", bullets: ["ignored"] },
    ],
  };
  const out = reconcileExperienceTitles(section, identity, true);
  assert.equal(out.experiences.length, 2);
  // Index-aligned to Profile order, not model company matching
  assert.equal(out.experiences[0].company, "Acme");
  assert.equal(out.experiences[0].title, "Senior Backend Engineer");
  assert.equal(out.experiences[1].company, "Globex");
  assert.equal(out.experiences[1].title, "Java Engineer");
});

test("applyTitlePolicyToSections leaves non-experience sections untouched", () => {
  const sections = {
    summary: { summary: "hello" },
    experience: {
      experiences: [{ title: "Renamed", company: "X", bullets: ["y"] }],
    },
  };
  const out = applyTitlePolicyToSections(sections, identity, false);
  assert.equal(out.summary.summary, "hello");
  assert.equal(out.experience.experiences[0].title, "Software Engineer");
  assert.equal(out.experience.experiences[1].title, "Senior Software Engineer");
});

test("Beta guidance appendix includes JD and authoritative sequence", () => {
  const prompt = appendExperienceTitlePolicy("Base prompt.", {
    isBeta: true,
    jobDescription: "Need a backend engineer",
    careers: identity.careers,
  });
  assert.match(prompt, /TITLE POLICY \(mandatory — Beta\)/);
  assert.match(prompt, /Need a backend engineer/);
  assert.match(prompt, /Acme/);
  assert.match(prompt, /slash or keyword stacking/i);
  assert.match(prompt, /Base prompt\./);
});

test("non-Beta guidance requires exact Profile titles", () => {
  const prompt = appendExperienceTitlePolicy("Base.", {
    isBeta: false,
    jobDescription: "ignored for titles",
    careers: identity.careers,
  });
  assert.match(prompt, /non-Beta/);
  assert.match(prompt, /EXACTLY/);
});

test("title policy fingerprint changes with Beta, JD, careers, and policy version", () => {
  const base = {
    isBeta: false,
    jobDescription: "JD A",
    careers: identity.careers,
    config: { systemInstruction: "sys", steps: [{ purpose: "experience", kind: "final", prompt: "p" }] },
  };
  const a = computeTitlePolicyFingerprint(base);
  const b = computeTitlePolicyFingerprint({ ...base, isBeta: true });
  const c = computeTitlePolicyFingerprint({ ...base, jobDescription: "JD B" });
  const d = computeTitlePolicyFingerprint({
    ...base,
    careers: [{ ...identity.careers[0], title: "Changed" }, identity.careers[1]],
  });
  assert.equal(typeof a, "string");
  assert.equal(a.length, 40);
  assert.notEqual(a, b);
  assert.notEqual(a, c);
  assert.notEqual(a, d);
  assert.equal(TITLE_POLICY_VERSION, 1);
});

test("agent PDF render fingerprint includes title policy fingerprint", () => {
  const config = { templateId: "classic", theme: { accent: "#111" }, layout: [{ type: "summary" }] };
  const without = agentPdfRenderFingerprint(config, null);
  const withFp = agentPdfRenderFingerprint(config, "abc123");
  assert.notEqual(without, withFp);
  assert.equal(agentPdfRenderFingerprint(config, "abc123"), withFp);
});

test("isAcceptableBetaTitle rejects multi-and piles", () => {
  assert.equal(isAcceptableBetaTitle("Engineer and Manager and Lead"), false);
  assert.equal(isAcceptableBetaTitle("Senior Backend Engineer"), true);
});

test("Beta accepts realistic multi-role seniority progression", () => {
  const progressionIdentity = {
    careers: [
      {
        title: "Software Engineer",
        company: "StartupCo",
        period: "2018 – 2020",
        description: "Built Java services",
      },
      {
        title: "Software Engineer",
        company: "MidCo",
        period: "2020 – 2023",
        description: "Owned backend APIs",
      },
      {
        title: "Senior Software Engineer",
        company: "BigCo",
        period: "2023 – Present",
        description: "Led platform squad",
      },
    ],
  };
  const section = {
    experiences: [
      { title: "Junior Java Engineer", bullets: ["a"] },
      { title: "Backend Engineer", bullets: ["b"] },
      { title: "Senior Backend Engineer", bullets: ["c"] },
    ],
  };
  const out = reconcileExperienceTitles(section, progressionIdentity, true);
  assert.equal(out.experiences[0].title, "Junior Java Engineer");
  assert.equal(out.experiences[1].title, "Backend Engineer");
  assert.equal(out.experiences[2].title, "Senior Backend Engineer");
  assert.equal(out.experiences[0].company, "StartupCo");
  assert.equal(out.experiences[2].period, "2023 – Present");
});

test("Beta accepts discipline transitions when titles are concise", () => {
  const transitionIdentity = {
    careers: [
      {
        title: "Data Analyst",
        company: "DataCo",
        period: "2019 – 2021",
        description: "SQL dashboards",
      },
      {
        title: "Machine Learning Engineer",
        company: "AiCo",
        period: "2021 – Present",
        description: "NLP models",
      },
    ],
  };
  const section = {
    experiences: [
      { title: "Data Engineer", bullets: ["pipelines"] },
      { title: "AI Engineer", bullets: ["models"] },
    ],
  };
  const out = reconcileExperienceTitles(section, transitionIdentity, true);
  assert.equal(out.experiences[0].title, "Data Engineer");
  assert.equal(out.experiences[1].title, "AI Engineer");
  assert.equal(out.experiences[0].company, "DataCo");
  assert.equal(out.experiences[1].company, "AiCo");
  assert.equal(out.experiences[0].period, "2019 – 2021");
  assert.equal(out.experiences[1].period, "2021 – Present");
});

test("Beta and non-Beta always preserve authoritative company and dates over model values", () => {
  const section = {
    experiences: [
      {
        company: "Model Invented Co",
        title: "Backend Engineer",
        period: "Jan 1999 – Dec 1999",
        bullets: ["kept"],
      },
      {
        company: "Another Fake",
        title: "Staff Engineer",
        period: "Forever",
        bullets: ["also kept"],
      },
    ],
  };
  for (const isBeta of [true, false]) {
    const out = reconcileExperienceTitles(section, identity, isBeta);
    assert.equal(out.experiences[0].company, "Acme");
    assert.equal(out.experiences[0].period, "2020 – 2022");
    assert.equal(out.experiences[1].company, "Globex");
    assert.equal(out.experiences[1].period, "2022 – Present");
    assert.deepEqual(out.experiences[0].bullets, ["kept"]);
  }
});

test("Beta guidance mentions domain transitions and chronological plausibility", () => {
  const prompt = appendExperienceTitlePolicy("Base.", {
    isBeta: true,
    jobDescription: "Full stack role",
    careers: identity.careers,
  });
  assert.match(prompt, /Domain transitions/i);
  assert.match(prompt, /humanly plausible/i);
  assert.match(prompt, /Software Engineer @ Acme/);
});
