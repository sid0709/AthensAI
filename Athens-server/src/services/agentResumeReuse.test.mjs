import { test } from "node:test";
import assert from "node:assert/strict";
import { matchesTitlePolicyFingerprint } from "./agentResumeGenService.js";
import {
  computeTitlePolicyFingerprint,
} from "./resumeCareerTitlePolicy.js";
import {
  writeAgentDraftPdf,
  readAgentDraftPdf,
  deleteAgentDraftPdf,
  agentPdfRenderFingerprint,
  identityContactFingerprint,
} from "./agentResumeDraftService.js";

test("matchesTitlePolicyFingerprint reuses only exact stored fingerprint", () => {
  assert.equal(matchesTitlePolicyFingerprint({ titlePolicyFingerprint: "abc" }, "abc"), true);
  assert.equal(matchesTitlePolicyFingerprint({ titlePolicyFingerprint: "abc" }, "xyz"), false);
});

test("matchesTitlePolicyFingerprint rejects missing fingerprint when expected is set", () => {
  // Pre-policy library/generation records must regenerate.
  assert.equal(matchesTitlePolicyFingerprint({}, "abc"), false);
  assert.equal(matchesTitlePolicyFingerprint({ titlePolicyFingerprint: "" }, "abc"), false);
  assert.equal(matchesTitlePolicyFingerprint({ titlePolicyFingerprint: null }, "abc"), false);
});

test("matchesTitlePolicyFingerprint allows any doc when expected fingerprint omitted", () => {
  assert.equal(matchesTitlePolicyFingerprint({}, null), true);
  assert.equal(matchesTitlePolicyFingerprint({}, ""), true);
  assert.equal(matchesTitlePolicyFingerprint({ titlePolicyFingerprint: "old" }, undefined), true);
});

test("title-policy fingerprint change invalidates agent draft PDF cache", async () => {
  const applier = `verify-title-policy-${Date.now()}`;
  const jobId = "job-cache-invalidate";
  const config = { templateId: "classic", theme: { accent: "#111" }, layout: [{ type: "summary" }] };
  const careers = [{ title: "Engineer", company: "Acme", period: "2020 – 2021", description: "Java" }];
  const fpA = computeTitlePolicyFingerprint({
    isBeta: false,
    jobDescription: "JD A",
    careers,
    config,
  });
  const fpB = computeTitlePolicyFingerprint({
    isBeta: true,
    jobDescription: "JD A",
    careers,
    config,
  });
  assert.notEqual(fpA, fpB);

  const buffer = Buffer.from("%PDF-1.4 title-policy-cache-test");
  await writeAgentDraftPdf({
    buffer,
    applierName: applier,
    jobId,
    config,
    titlePolicyFingerprint: fpA,
  });

  const hit = await readAgentDraftPdf(applier, jobId, config, fpA);
  assert.ok(hit?.buffer?.length);

  const miss = await readAgentDraftPdf(applier, jobId, config, fpB);
  assert.equal(miss, null);

  assert.notEqual(
    agentPdfRenderFingerprint(config, fpA),
    agentPdfRenderFingerprint(config, fpB),
  );

  await deleteAgentDraftPdf(applier, jobId);
});

test("identity contact fingerprint change invalidates agent draft PDF cache", async () => {
  const applier = `verify-identity-fp-${Date.now()}`;
  const jobId = "job-identity-invalidate";
  const config = { templateId: "classic", theme: { accent: "#111" }, layout: [{ type: "summary" }] };
  const titleFp = "title-fp-constant";
  const identityA = identityContactFingerprint({
    fullName: "Ada Lovelace",
    linkedin: "https://linkedin.com/in/ada-old",
  });
  const identityB = identityContactFingerprint({
    fullName: "Ada Lovelace",
    linkedin: "https://linkedin.com/in/ada-new",
  });
  assert.notEqual(identityA, identityB);

  const buffer = Buffer.from("%PDF-1.4 identity-cache-test");
  await writeAgentDraftPdf({
    buffer,
    applierName: applier,
    jobId,
    config,
    titlePolicyFingerprint: titleFp,
    identityFingerprint: identityA,
  });

  const hit = await readAgentDraftPdf(applier, jobId, config, titleFp, identityA);
  assert.ok(hit?.buffer?.length);

  const miss = await readAgentDraftPdf(applier, jobId, config, titleFp, identityB);
  assert.equal(miss, null);

  assert.notEqual(
    agentPdfRenderFingerprint(config, titleFp, identityA),
    agentPdfRenderFingerprint(config, titleFp, identityB),
  );

  await deleteAgentDraftPdf(applier, jobId);
});
