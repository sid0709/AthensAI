import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { isBetaTier } from "./betaTier.js";

test("isBetaTier accepts normalized beta (exact, case, whitespace)", () => {
  assert.equal(isBetaTier("beta"), true);
  assert.equal(isBetaTier("Beta"), true);
  assert.equal(isBetaTier("BETA"), true);
  assert.equal(isBetaTier("  beta  "), true);
  assert.equal(isBetaTier("\tBeTa\n"), true);
});

test("isBetaTier rejects pro, missing, and unknown tiers", () => {
  assert.equal(isBetaTier("pro"), false);
  assert.equal(isBetaTier("Pro"), false);
  assert.equal(isBetaTier("PRO"), false);
  assert.equal(isBetaTier(""), false);
  assert.equal(isBetaTier("   "), false);
  assert.equal(isBetaTier(null), false);
  assert.equal(isBetaTier(undefined), false);
  assert.equal(isBetaTier("free"), false);
  assert.equal(isBetaTier("premium"), false);
  assert.equal(isBetaTier("beta-user"), false);
  assert.equal(isBetaTier("bet"), false);
});

test("mail AI gates expose betaRequired (not proRequired)", () => {
  const mailPath = path.join(
    path.dirname(fileURLToPath(import.meta.url)),
    "../controllers/mailController.js",
  );
  const src = readFileSync(mailPath, "utf8");
  assert.match(src, /betaRequired:\s*true/);
  assert.match(src, /Beta workspace required/);
  assert.equal(/proRequired/.test(src), false);
  assert.equal(/Pro workspace required/.test(src), false);
});
