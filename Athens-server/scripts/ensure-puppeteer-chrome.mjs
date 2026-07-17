#!/usr/bin/env node
/**
 * Ensure Puppeteer's Chrome for Testing is installed.
 * Used by postinstall / npm run install:chrome / prestart / Docker entrypoint.
 *
 * Does not use system Chrome — servers must ship the bundled browser.
 * Default cache: Athens-server/.cache/puppeteer (override with PUPPETEER_CACHE_DIR).
 *
 * Skip download during Docker image builds with:
 *   PUPPETEER_SKIP_DOWNLOAD=1  (or true)
 * Chrome is then installed on first container start (VPS network).
 */
import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const skip =
  process.env.PUPPETEER_SKIP_DOWNLOAD === "1" ||
  process.env.PUPPETEER_SKIP_DOWNLOAD === "true" ||
  process.env.PUPPETEER_SKIP_CHROME_DOWNLOAD === "1" ||
  process.env.PUPPETEER_SKIP_CHROME_DOWNLOAD === "true";

if (skip) {
  console.log("[puppeteer] Skipping Chrome download (PUPPETEER_SKIP_DOWNLOAD is set).");
  process.exit(0);
}

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const defaultCache = join(root, ".cache", "puppeteer");
const env = {
  ...process.env,
  PUPPETEER_CACHE_DIR: process.env.PUPPETEER_CACHE_DIR || defaultCache,
};

async function bundledPath() {
  const puppeteer = await import("puppeteer");
  return puppeteer.default.executablePath();
}

// Ensure puppeteer.executablePath() resolves against our cache.
process.env.PUPPETEER_CACHE_DIR = env.PUPPETEER_CACHE_DIR;

const path = await bundledPath();
if (existsSync(path)) {
  console.log(`[puppeteer] Chrome already installed: ${path}`);
  process.exit(0);
}

console.log(`[puppeteer] Installing Chrome for Testing → ${env.PUPPETEER_CACHE_DIR}`);
const result = spawnSync("npx", ["puppeteer", "browsers", "install", "chrome"], {
  cwd: root,
  stdio: "inherit",
  env,
  shell: process.platform === "win32",
});

if (result.status !== 0) {
  console.error(`
[puppeteer] Failed to install Chrome for Testing (exit ${result.status ?? 1}).
Résumé PDF rendering will fail until this succeeds.

Retry:
  npm run install:chrome -w Athens-server

Or set PUPPETEER_EXECUTABLE_PATH to a Chrome for Testing binary.
`);
  process.exit(result.status ?? 1);
}

const after = await bundledPath();
if (!existsSync(after)) {
  console.error(`[puppeteer] Install reported success but binary missing: ${after}`);
  process.exit(1);
}
console.log(`[puppeteer] Chrome ready: ${after}`);
