import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import {
  DEFAULT_PUBLIC_ORIGIN,
  GOOGLE_SITE_VERIFICATION,
  LANDING_DESCRIPTION,
  LANDING_TITLE,
  PRIVATE_ROBOTS,
  PUBLIC_INDEX_PATHS,
  ROBOTS_DISALLOW,
  documentForPath,
  landingJsonLd,
  robotsTxt,
  sitemapXml,
} from "./site";

const here = path.dirname(fileURLToPath(import.meta.url));
const athensRoot = path.resolve(here, "../../..");

test("the public home page is the document Google should rank", () => {
  const doc = documentForPath("/");
  assert.equal(doc.title, LANDING_TITLE);
  assert.equal(doc.description, LANDING_DESCRIPTION);
  assert.equal(doc.indexable, true);
  assert.match(doc.robots, /^index, follow/);
});

test("sign-in and sign-up stay indexable so branded queries can resolve", () => {
  assert.equal(documentForPath("/signin").indexable, true);
  assert.equal(documentForPath("/signup").indexable, true);
  assert.equal(documentForPath("/signin/").canonicalPath, "/signin");
});

test("workspace and status URLs stay out of the index", () => {
  assert.equal(documentForPath("/jobs").robots, PRIVATE_ROBOTS);
  assert.equal(documentForPath("/resumes/editor").robots, PRIVATE_ROBOTS);
  assert.equal(documentForPath("/status").robots, PRIVATE_ROBOTS);
  assert.equal(documentForPath("/changelog").indexable, false);
});

test("robots.txt allows the marketing surface and blocks the signed-in app", () => {
  const blocked = new Set<string>(ROBOTS_DISALLOW);
  for (const pathName of PUBLIC_INDEX_PATHS) {
    assert.equal(blocked.has(pathName), false);
  }
  assert.ok(blocked.has("/jobs"));
  assert.ok(blocked.has("/api/"));
  const txt = robotsTxt();
  assert.match(txt, /Allow: \//);
  assert.match(txt, /Disallow: \/jobs/);
  assert.match(txt, new RegExp(`Sitemap: ${DEFAULT_PUBLIC_ORIGIN}/sitemap.xml`));
  const published = readFileSync(path.join(athensRoot, "public/robots.txt"), "utf8");
  assert.equal(published, txt);
});

test("sitemap lists only public URLs", () => {
  const xml = sitemapXml();
  assert.match(xml, /<loc>https:\/\/athensai\.remotepairnet\.net\/<\/loc>/);
  assert.match(xml, /<loc>https:\/\/athensai\.remotepairnet\.net\/signin<\/loc>/);
  assert.match(xml, /<loc>https:\/\/athensai\.remotepairnet\.net\/signup<\/loc>/);
  assert.doesNotMatch(xml, /\/jobs/);
  const published = readFileSync(path.join(athensRoot, "public/sitemap.xml"), "utf8");
  assert.equal(published, xml);
});

test("index.html no longer tells crawlers to stay away", () => {
  const html = readFileSync(path.join(athensRoot, "index.html"), "utf8");
  assert.doesNotMatch(html, /noindex/);
  assert.match(html, /<title>AthensAI — Your career galaxy<\/title>/);
  assert.match(html, new RegExp(LANDING_DESCRIPTION.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.match(html, /application\/ld\+json/);
  assert.match(html, /og-image\.jpg/);
  assert.match(html, /<html lang="en">/);
  assert.match(html, new RegExp(`name="google-site-verification" content="${GOOGLE_SITE_VERIFICATION}"`));
  const jsonLdMatch = html.match(/id="athens-jsonld">([^<]+)<\/script>/);
  assert.ok(jsonLdMatch);
  assert.deepEqual(JSON.parse(jsonLdMatch[1]), landingJsonLd(DEFAULT_PUBLIC_ORIGIN));
});
